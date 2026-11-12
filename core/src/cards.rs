//! Cards: the questions a note gives rise to.
//!
//! A one-way note gives one card, whose id is the note's id, so progress
//! saved before cards existed still lines up. "Both ways" adds a reverse card
//! (`<note>:r`). A fill-the-gap note gives one card per gap number: the first
//! uses the note's id, the rest `<note>:c2`, `<note>:c3` and so on.

use crate::model::{Deck, Note};
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

/// The card ids a note gives rise to under the deck's options.
pub fn cards_of(deck: &Deck, note: &Note) -> Vec<String> {
    if note.cloze {
        return cloze_numbers(&note.front)
            .into_iter()
            .enumerate()
            .map(|(i, n)| if i == 0 { note.id.clone() } else { format!("{}:c{n}", note.id) })
            .collect();
    }
    let mut out = vec![note.id.clone()];
    if deck.options.both_ways {
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
}

pub fn face(deck: &Deck, card_id: &str) -> Option<Face> {
    let note = deck.notes.get(note_of(card_id))?;
    let suffix = card_id.split_once(':').map(|(_, s)| s).unwrap_or("");
    if note.cloze {
        let numbers = cloze_numbers(&note.front);
        let n = match suffix.strip_prefix('c') {
            Some(d) => d.parse().ok()?,
            None => *numbers.first()?,
        };
        let (prompt, answer) = cloze_face(&note.front, n);
        return Some(Face {
            note_id: note.id.clone(),
            prompt,
            accepted: accepted_answers(&answer, &note.alts),
            answer,
            reverse: false,
            cloze: true,
            qmedia: note.qmedia.clone(),
            amedia: note.amedia.clone(),
            extra: note.extra.clone(),
        });
    }
    if suffix == "r" {
        return Some(Face {
            note_id: note.id.clone(),
            prompt: note.back.clone(),
            answer: note.front.clone(),
            accepted: accepted_answers(&note.front, &[]),
            reverse: true,
            cloze: false,
            qmedia: note.amedia.clone(),
            amedia: note.qmedia.clone(),
            extra: note.extra.clone(),
        });
    }
    let prompt = match &deck.prompt {
        Some(p) if !p.is_empty() => p.replace("{front}", &note.front),
        _ => note.front.clone(),
    };
    Some(Face {
        note_id: note.id.clone(),
        prompt,
        answer: note.back.clone(),
        accepted: accepted_answers(&note.back, &note.alts),
        reverse: false,
        cloze: false,
        qmedia: note.qmedia.clone(),
        amedia: note.amedia.clone(),
        extra: note.extra.clone(),
    })
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
}
