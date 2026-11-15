//! Cards: the questions a note gives rise to.
//!
//! A one-way note gives one card, whose id is the note's id, so progress
//! saved before cards existed still lines up. "Both ways" adds a reverse card
//! (`<note>:r`). A fill-the-gap note gives one card per gap number: the first
//! uses the note's id, the rest `<note>:c2`, `<note>:c3` and so on. A
//! picture with hidden parts gives one card per part number in the same way
//! (`<note>:o2`, `<note>:o3`, …).

use crate::model::{Deck, Note, Occlusion};
use serde::Serialize;
use crate::text::accepted_answers;

pub struct Gap {
    pub n: u32,
    pub answer: String,
    pub hint: String,
    /// Byte range of the whole `{{c1::…}}` marker.
    pub start: usize,
    pub end: usize,
}

/// Every `{{cN::answer}}` or `{{cN::answer::hint}}` in a text, in order.
pub fn gaps(text: &str) -> Vec<Gap> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find("{{c") {
        let start = from + rel;
        let rest = &text[start + 3..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        let after = start + 3 + digits.len();
        if digits.is_empty() || !text[after..].starts_with("::") {
            from = start + 3;
            continue;
        }
        let Some(close) = text[after + 2..].find("}}") else { break };
        let inner = &text[after + 2..after + 2 + close];
        let (answer, hint) = match inner.find("::") {
            Some(i) => (&inner[..i], &inner[i + 2..]),
            None => (inner, ""),
        };
        let end = after + 2 + close + 2;
        out.push(Gap { n: digits.parse().unwrap_or(1), answer: answer.trim().to_string(), hint: hint.trim().to_string(), start, end });
        from = end;
    }
    out
}

/// Gap numbers in a text, sorted, without repeats.
pub fn cloze_numbers(text: &str) -> Vec<u32> {
    let mut ns: Vec<u32> = gaps(text).iter().map(|g| g.n).collect();
    ns.sort_unstable();
    ns.dedup();
    ns
}

/// The text with gap `n` hidden (as `[…]` or `[hint]`) and every other gap filled in.
/// Returns the question and the hidden answer.
pub fn cloze_face(text: &str, n: u32) -> (String, String) {
    let mut prompt = String::new();
    let mut answers = Vec::new();
    let mut last = 0;
    for g in gaps(text) {
        prompt.push_str(&text[last..g.start]);
        if g.n == n {
            prompt.push_str(&if g.hint.is_empty() { "[…]".to_string() } else { format!("[{}]", g.hint) });
            answers.push(g.answer.clone());
        } else {
            prompt.push_str(&g.answer);
        }
        last = g.end;
    }
    prompt.push_str(&text[last..]);
    (prompt, answers.join(", "))
}

/// The text with every gap filled in, for lists and exports to plain text.
pub fn cloze_full(text: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    for g in gaps(text) {
        out.push_str(&text[last..g.start]);
        out.push_str(&g.answer);
        last = g.end;
    }
    out.push_str(&text[last..]);
    out
}

pub fn note_of(card_id: &str) -> &str {
    card_id.split(':').next().unwrap_or(card_id)
}

/// Part numbers of a picture, sorted, without repeats.
pub fn part_numbers(o: &Occlusion) -> Vec<u32> {
    let mut ns: Vec<u32> = o.shapes.iter().map(|s| s.ord).collect();
    ns.sort_unstable();
    ns.dedup();
    ns
}

/// Whether a question-and-answer note is also asked the other way round: its
/// Anki note type's own setting when it has one, otherwise the deck's.
pub fn asks_both_ways(deck: &Deck, note: &Note) -> bool {
    if note.cloze || note.occlusion.is_some() {
        return false;
    }
    note.anki
        .as_ref()
        .and_then(|a| deck.anki.as_ref()?.notetypes.get(&a.ntid))
        .and_then(|t| t.both_ways)
        .unwrap_or(deck.options.both_ways)
}

/// The card ids a note gives rise to under the deck's options.
pub fn cards_of(deck: &Deck, note: &Note) -> Vec<String> {
    if let Some(o) = &note.occlusion {
        return part_numbers(o)
            .into_iter()
            .enumerate()
            .map(|(i, n)| if i == 0 { note.id.clone() } else { format!("{}:o{n}", note.id) })
            .collect();
    }
    if note.cloze {
        return cloze_numbers(&note.front)
            .into_iter()
            .enumerate()
            .map(|(i, n)| if i == 0 { note.id.clone() } else { format!("{}:c{n}", note.id) })
            .collect();
    }
    let mut out = vec![note.id.clone()];
    if asks_both_ways(deck, note) {
        out.push(format!("{}:r", note.id));
    }
    out
}

pub fn lesson_cards(deck: &Deck, lesson_id: &str) -> Vec<String> {
    deck.lessons
        .get(lesson_id)
        .map(|l| l.note_ids.iter().filter_map(|n| deck.notes.get(n)).flat_map(|n| cards_of(deck, n)).collect())
        .unwrap_or_default()
}

/// Every card of the deck, in path order.
pub fn all_cards(deck: &Deck) -> Vec<String> {
    deck.units.iter().flat_map(|u| u.lesson_ids.iter()).flat_map(|l| lesson_cards(deck, l)).collect()
}

/// Whether a card id still means something in the deck (its note exists and
/// its direction or gap is still asked).
pub fn is_live(deck: &Deck, card_id: &str) -> bool {
    deck.notes.get(note_of(card_id)).is_some_and(|n| cards_of(deck, n).iter().any(|c| c == card_id))
}

/// One part of a picture as a card shows it: `ask` is the part asked about,
/// `hidden` is covered too, `open` is visible (with its name, if it has one).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    pub kind: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<[f64; 2]>,
    pub state: &'static str,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    pub image: String,
    pub masks: Vec<Mask>,
}

fn picture(o: &Occlusion, n: u32) -> Picture {
    Picture {
        image: o.image.clone(),
        masks: o
            .shapes
            .iter()
            .map(|s| Mask {
                kind: s.kind.clone(),
                left: s.left,
                top: s.top,
                width: s.width,
                height: s.height,
                points: s.points.clone(),
                state: if s.ord == n {
                    "ask"
                } else if o.hide_all {
                    "hidden"
                } else {
                    "open"
                },
                label: s.label.clone(),
            })
            .collect(),
    }
}

fn filled(v: &[String]) -> Vec<String> {
    v.iter().filter(|x| !x.trim().is_empty()).cloned().collect()
}

/// What a card shows and expects.
pub struct Face {
    pub note_id: String,
    pub prompt: String,
    pub answer: String,
    pub accepted: Vec<String>,
    pub reverse: bool,
    pub cloze: bool,
    pub qmedia: Vec<String>,
    pub amedia: Vec<String>,
    pub extra: String,
    /// More question fields, shown under the question.
    pub front_more: Vec<String>,
    /// Fields shown with the answer once given (the question's extra fields on a reverse card).
    pub answer_more: Vec<String>,
    /// More extra fields, after `extra`.
    pub extra_more: Vec<String>,
    /// The learner checks this card themselves.
    pub self_check: bool,
    pub picture: Option<Picture>,
}

pub fn face(deck: &Deck, card_id: &str) -> Option<Face> {
    let note = deck.notes.get(note_of(card_id))?;
    let suffix = card_id.split_once(':').map(|(_, s)| s).unwrap_or("");
    let base = |prompt: String, answer: String, accepted: Vec<String>| Face {
        note_id: note.id.clone(),
        prompt,
        answer,
        accepted,
        reverse: false,
        cloze: false,
        qmedia: note.qmedia.clone(),
        amedia: note.amedia.clone(),
        extra: note.extra.clone(),
        front_more: filled(&note.front_more),
        answer_more: vec![],
        extra_more: filled(&note.extra_more),
        self_check: note.self_check,
        picture: None,
    };
    if let Some(o) = &note.occlusion {
        let numbers = part_numbers(o);
        let n = match suffix.strip_prefix('o') {
            Some(d) => d.parse().ok()?,
            None => *numbers.first()?,
        };
        let mut names: Vec<String> = o.shapes.iter().filter(|s| s.ord == n && !s.label.trim().is_empty()).map(|s| s.label.trim().to_string()).collect();
        names.dedup();
        let answer = names.join(", ");
        let header = note.front.trim();
        let prompt = if !header.is_empty() {
            header.to_string()
        } else if answer.is_empty() {
            "What is under the hidden part?".to_string()
        } else {
            "Which part is hidden?".to_string()
        };
        let mut f = base(prompt, answer.clone(), accepted_answers(&answer, &note.alts));
        f.self_check = note.self_check || answer.is_empty();
        f.picture = Some(picture(o, n));
        return Some(f);
    }
    if note.cloze {
        let numbers = cloze_numbers(&note.front);
        let n = match suffix.strip_prefix('c') {
            Some(d) => d.parse().ok()?,
            None => *numbers.first()?,
        };
        let (prompt, answer) = cloze_face(&note.front, n);
        let accepted = accepted_answers(&answer, &note.alts);
        let mut f = base(prompt, answer, accepted);
        f.cloze = true;
        return Some(f);
    }
    if suffix == "r" {
        // Asked the other way: the answer is shown and the main question field
        // is expected. The question's other fields would give it away, so they
        // wait until the answer is shown.
        let mut f = base(note.back.clone(), note.front.clone(), accepted_answers(&note.front, &[]));
        f.reverse = true;
        f.qmedia = note.amedia.clone();
        f.amedia = note.qmedia.clone();
        f.answer_more = std::mem::take(&mut f.front_more);
        return Some(f);
    }
    let prompt = match &deck.prompt {
        Some(p) if !p.is_empty() => p.replace("{front}", &note.front),
        _ => note.front.clone(),
    };
    Some(base(prompt, note.back.clone(), accepted_answers(&note.back, &note.alts)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_deck;

    #[test]
    fn reads_gaps_with_and_without_hints() {
        let text = "{{c1::Paris}} is the capital of {{c2::France::country}}.";
        assert_eq!(cloze_numbers(text), vec![1, 2]);
        assert_eq!(cloze_face(text, 1), ("[…] is the capital of France.".to_string(), "Paris".to_string()));
        assert_eq!(cloze_face(text, 2).0, "Paris is the capital of [country].");
        assert_eq!(cloze_full(text), "Paris is the capital of France.");
        assert!(gaps("no gaps {{here}}").is_empty());
    }

    #[test]
    fn both_ways_adds_a_reverse_card() {
        let mut deck = sample_deck(0.0);
        let id = deck.lessons[&deck.units[0].lesson_ids[0]].note_ids[0].clone();
        assert_eq!(lesson_cards(&deck, &deck.units[0].lesson_ids[0]).len(), 6);
        deck.options.both_ways = true;
        assert_eq!(lesson_cards(&deck, &deck.units[0].lesson_ids[0]).len(), 12);
        let back = face(&deck, &format!("{id}:r")).unwrap();
        assert_eq!((back.prompt.as_str(), back.answer.as_str(), back.reverse), ("the apple", "la manzana", true));
        assert!(is_live(&deck, &format!("{id}:r")));
        deck.options.both_ways = false;
        assert!(!is_live(&deck, &format!("{id}:r")));
    }

    #[test]
    fn each_anki_note_type_can_be_asked_both_ways_on_its_own() {
        use crate::model::{AnkiDeck, AnkiNote, AnkiNotetype};
        let mut deck = sample_deck(0.0);
        let ids: Vec<String> = deck.notes.keys().take(3).cloned().collect();
        let mut types = std::collections::BTreeMap::new();
        for (t, both) in [("vocab", Some(true)), ("phrases", Some(false)), ("old", None)] {
            types.insert(t.to_string(), AnkiNotetype { id: t.into(), name: t.into(), both_ways: both, ..Default::default() });
        }
        deck.anki = Some(AnkiDeck { notetypes: types });
        for (id, t) in ids.iter().zip(["vocab", "phrases", "old"]) {
            deck.notes.get_mut(id).unwrap().anki = Some(AnkiNote { ntid: t.into(), ..Default::default() });
        }
        let count = |d: &Deck, id: &str| cards_of(d, &d.notes[id]).len();
        assert_eq!((count(&deck, &ids[0]), count(&deck, &ids[1]), count(&deck, &ids[2])), (2, 1, 1));
        // A type without its own setting, and cards made in Ankhwiz, follow the deck.
        deck.options.both_ways = true;
        assert_eq!((count(&deck, &ids[0]), count(&deck, &ids[1]), count(&deck, &ids[2])), (2, 1, 2));
        let native = deck.notes.keys().nth(5).unwrap().clone();
        assert_eq!(count(&deck, &native), 2);
    }

    #[test]
    fn fill_the_gap_notes_give_one_card_per_gap() {
        let mut deck = sample_deck(0.0);
        let id = deck.notes.keys().next().unwrap().clone();
        let note = deck.notes.get_mut(&id).unwrap();
        note.cloze = true;
        note.front = "{{c1::Hola}}, ¿qué {{c2::tal}}?".into();
        let n = deck.notes[&id].clone();
        assert_eq!(cards_of(&deck, &n), vec![id.clone(), format!("{id}:c2")]);
        let f = face(&deck, &format!("{id}:c2")).unwrap();
        assert_eq!((f.prompt.as_str(), f.answer.as_str()), ("Hola, ¿qué […]?", "tal"));
    }

    #[test]
    fn more_question_fields_wait_for_the_answer_on_a_reverse_card() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        let id = deck.notes.keys().next().unwrap().clone();
        let note = deck.notes.get_mut(&id).unwrap();
        note.front_more = vec!["noun".into(), "".into(), "feminine".into()];
        note.extra_more = vec!["la manzana roja".into()];
        let f = face(&deck, &id).unwrap();
        assert_eq!(f.front_more, vec!["noun", "feminine"]);
        assert!(f.answer_more.is_empty());
        let r = face(&deck, &format!("{id}:r")).unwrap();
        assert!(r.front_more.is_empty());
        assert_eq!(r.answer_more, vec!["noun", "feminine"]);
        assert_eq!(r.extra_more, vec!["la manzana roja"]);
    }

    #[test]
    fn a_picture_gives_one_card_per_part() {
        use crate::model::{Occlusion, Shape};
        let mut deck = sample_deck(0.0);
        let id = deck.notes.keys().next().unwrap().clone();
        let shape = |ord: u32, label: &str| Shape { ord, kind: "rect".into(), left: 0.1, top: 0.1, width: 0.2, height: 0.1, label: label.into(), ..Default::default() };
        let note = deck.notes.get_mut(&id).unwrap();
        note.front = String::new();
        note.occlusion = Some(Occlusion { image: "arm.png".into(), shapes: vec![shape(1, "Radius"), shape(2, "Ulna"), shape(3, "")], hide_all: false });
        let n = deck.notes[&id].clone();
        assert_eq!(cards_of(&deck, &n), vec![id.clone(), format!("{id}:o2"), format!("{id}:o3")]);
        let f = face(&deck, &format!("{id}:o2")).unwrap();
        assert_eq!((f.prompt.as_str(), f.answer.as_str(), f.self_check), ("Which part is hidden?", "Ulna", false));
        let states: Vec<&str> = f.picture.as_ref().unwrap().masks.iter().map(|m| m.state).collect();
        assert_eq!(states, vec!["open", "ask", "open"]);
        let unnamed = face(&deck, &format!("{id}:o3")).unwrap();
        assert!(unnamed.self_check, "a part without a name is checked by the learner");
    }
}
