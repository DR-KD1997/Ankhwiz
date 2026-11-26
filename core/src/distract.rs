//! Multiple choice: how many options, and which wrong ones.
//! Wrong options come from related cards, nearest first: same lesson, then
//! same unit, then the rest of the deck. Later on they are picked for
//! similarity to the answer, so guessing gets harder as the card advances.
//! A reverse card is offered other notes' fronts; a gap, other gaps; a hidden
//! part of a picture, the names of other parts.

use crate::cards::{face, gaps, note_of};
use crate::model::{CardState, Deck, Note};
use crate::rng::shuffle;
use crate::text::{answer_kind, distance, is_sound_file, media_token, normalize, side_text, AnswerKind};
use std::collections::{BTreeMap, BTreeSet, HashMap};

pub struct Index {
    pub lesson_of: BTreeMap<String, String>,
    pub unit_of: BTreeMap<String, String>,
}

/// Which lesson and unit each note belongs to.
pub fn index_deck(deck: &Deck) -> Index {
    let mut lesson_of = BTreeMap::new();
    let mut unit_of = BTreeMap::new();
    for unit in &deck.units {
        for lesson_id in &unit.lesson_ids {
            if let Some(lesson) = deck.lessons.get(lesson_id) {
                for note_id in &lesson.note_ids {
                    lesson_of.insert(note_id.clone(), lesson_id.clone());
                    unit_of.insert(note_id.clone(), unit.id.clone());
                }
            }
        }
    }
    Index { lesson_of, unit_of }
}

/// Which lesson and unit each note belongs to, borrowing the deck's own
/// strings (cheaper than `index_deck` when called for every card shown).
/// Gives the same answers as `index_deck`.
pub fn note_places(deck: &Deck) -> (HashMap<&str, &str>, HashMap<&str, &str>) {
    let mut lesson_of = HashMap::with_capacity(deck.notes.len());
    let mut unit_of = HashMap::with_capacity(deck.notes.len());
    for unit in &deck.units {
        for lesson_id in &unit.lesson_ids {
            if let Some(lesson) = deck.lessons.get(lesson_id) {
                for note_id in &lesson.note_ids {
                    lesson_of.insert(note_id.as_str(), lesson_id.as_str());
                    unit_of.insert(note_id.as_str(), unit.id.as_str());
                }
            }
        }
    }
    (lesson_of, unit_of)
}

/// How many options to show: 2 right after first seeing the answer, 3 for a
/// later stage-1 check, then 4, 6 and 8 as the card advances.
pub fn option_count(card: Option<&CardState>, just_met: bool) -> usize {
    match card {
        None => if just_met { 2 } else { 3 },
        Some(c) if c.stage == 1 => if just_met { 2 } else { 3 },
        Some(c) if c.stage == 2 => (4 + 2 * c.ok_days.len() + if c.demoted { 2 } else { 0 }).min(8),
        // A later-stage card that cannot be typed still gets the hardest version.
        Some(_) => 8,
    }
}

/// What another note can offer as a wrong option for this kind of card.
fn offers(note: &Note, reverse: bool, cloze: bool, picture: bool) -> Vec<String> {
    // A hidden part is offered the names of other parts.
    if picture {
        return note.occlusion.as_ref().map(|o| o.shapes.iter().map(|s| s.label.trim().to_string()).filter(|l| !l.is_empty()).collect()).unwrap_or_default();
    }
    if note.occlusion.is_some() {
        return vec![];
    }
    if cloze {
        return if note.cloze { gaps(&note.front).into_iter().map(|g| g.answer).collect() } else { vec![] };
    }
    if note.cloze {
        return vec![];
    }
    vec![if reverse { side_text(&note.front, &note.qmedia) } else { side_text(&note.back, &note.amedia) }]
}

/// The options for a card: the answer plus up to `count - 1` wrong ones,
/// shuffled. Returns fewer when the deck has too few distinct answers.
pub fn pick_options(deck: &Deck, card_id: &str, count: usize, hard: bool) -> Vec<String> {
    let Some(f) = face(deck, card_id) else { return vec![] };
    let note_id = note_of(card_id);
    let Some(note) = deck.notes.get(note_id) else { return vec![] };
    let strict = deck.strict_accents;
    let kind = answer_kind(&f.answer);
    let mut taken: BTreeSet<String> = f.accepted.iter().map(|a| normalize(a, strict)).collect();
    taken.insert(normalize(&f.answer, strict));
    // Answers close in meaning are never offered against each other.
    if !f.cloze && f.picture.is_none() {
        taken.extend(crate::links::close_answers(deck, note_id, f.reverse).iter().map(|a| normalize(a, strict)));
    }
    let mut wrong: Vec<String> = Vec::new();
    let want = count.saturating_sub(1);

    if f.kana {
        // A reading card: readings that sound almost the same, then other
        // cards' readings of about the same length.
        let mut near = crate::furigana::near_readings(&f.answer);
        shuffle(&mut near);
        for r in near.iter() {
            if wrong.len() >= want {
                break;
            }
            let key = normalize(r, strict);
            if taken.insert(key) {
                wrong.push(r.clone());
            }
        }
        let len = f.answer.chars().count();
        let mut others: Vec<String> = deck
            .notes
            .values()
            .filter(|n| n.id != note_id)
            .filter_map(|n| crate::furigana::reading_question(&n.front).map(|(_, _, r)| r))
            .filter(|r| r.chars().count().abs_diff(len) <= 2)
            .collect();
        shuffle(&mut others);
        for r in others.iter() {
            if wrong.len() >= want {
                break;
            }
            let key = normalize(r, strict);
            if taken.insert(key) {
                wrong.push(r.clone());
            }
        }
        let mut options = vec![f.answer.clone()];
        options.extend(wrong);
        shuffle(&mut options);
        return options;
    }

    let mut offer = |text: &str, wrong: &mut Vec<String>| {
        let key = normalize(text, strict);
        if !key.is_empty() && taken.insert(key) {
            wrong.push(text.to_string());
        }
    };

    // Hand-set wrong options belong to the forward direction.
    if !f.reverse && !f.cloze {
        for w in &note.wrong {
            if wrong.len() >= want {
                break;
            }
            offer(w, &mut wrong);
        }
    }

    let (lesson_of, unit_of) = note_places(deck);
    let my_lesson = lesson_of.get(note_id);
    let my_unit = unit_of.get(note_id);
    // Sort the notes into tiers first; their offers are only worked out for
    // the tiers actually reached, which for most cards is the first.
    let mut members: [Vec<&Note>; 3] = [vec![], vec![], vec![]];
    for other in deck.notes.values() {
        let tier = if other.id == note_id {
            // Other gaps of the same note are close relatives.
            0
        } else if lesson_of.get(other.id.as_str()) == my_lesson {
            0
        } else if unit_of.get(other.id.as_str()) == my_unit {
            1
        } else {
            2
        };
        members[tier].push(other);
    }
    let tier_texts = |notes: &[&Note]| -> Vec<String> {
        let mut out = Vec::new();
        for other in notes {
            for text in offers(other, f.reverse, f.cloze, f.picture.is_some()) {
                if answer_kind(&text) == kind {
                    out.push(text);
                }
            }
        }
        out
    };

    let target = normalize(&f.answer, strict);
    let target_len = target.chars().count() as f64;
    let similarity = |text: &str| -> f64 {
        let t = normalize(text, strict);
        let same_start = t.chars().next() == target.chars().next();
        distance(&t, &target) as f64 + (t.chars().count() as f64 - target_len).abs() * 0.5
            - if same_start { 1.0 } else { 0.0 }
    };

    for notes in members.iter() {
        if wrong.len() >= want {
            break;
        }
        let mut tier = tier_texts(notes);
        let tier = &mut tier;
        // Shuffle first so ties, and the easy case, vary from one showing to the next.
        shuffle(tier);
        if hard {
            tier.sort_by(|a, b| similarity(a).partial_cmp(&similarity(b)).unwrap_or(std::cmp::Ordering::Equal));
        }
        for text in tier.iter() {
            if wrong.len() >= want {
                break;
            }
            offer(text, &mut wrong);
        }
    }

    // A picture (or sound) answer with too few others like it in the deck is
    // offered the deck's other pictures (or sounds), nearest first.
    if kind == AnswerKind::Media && wrong.len() < want {
        let sound = media_token(&f.answer).map(|(k, _)| k == "sound").unwrap_or(false);
        for notes in members.iter() {
            let mut files: Vec<String> = notes
                .iter()
                .filter(|n| n.id != note_id)
                .flat_map(|n| if f.reverse { [&n.qmedia, &n.amedia] } else { [&n.amedia, &n.qmedia] })
                .flatten()
                .filter(|m| is_sound_file(m) == sound)
                .map(|m| format!("[[{}:{m}]]", if sound { "sound" } else { "picture" }))
                .collect();
            shuffle(&mut files);
            for text in files.iter() {
                if wrong.len() >= want {
                    break;
                }
                offer(text, &mut wrong);
            }
        }
    }

    let mut options = vec![f.answer.clone()];
    options.extend(wrong);
    shuffle(&mut options);
    options
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::all_cards;
    use crate::rng::seed;
    use crate::sample::sample_deck;

    /// The picker as it was before 0.5.0, kept to prove the faster one gives
    /// exactly the same options.
    fn reference(deck: &Deck, card_id: &str, count: usize, hard: bool) -> Vec<String> {
        let Some(f) = face(deck, card_id) else { return vec![] };
        let note_id = note_of(card_id);
        let Some(note) = deck.notes.get(note_id) else { return vec![] };
        let strict = deck.strict_accents;
        let kind = answer_kind(&f.answer);
        let mut taken: BTreeSet<String> = f.accepted.iter().map(|a| normalize(a, strict)).collect();
        taken.insert(normalize(&f.answer, strict));
        let mut wrong: Vec<String> = Vec::new();
        let want = count.saturating_sub(1);
        let mut offer = |text: &str, wrong: &mut Vec<String>| {
            let key = normalize(text, strict);
            if !key.is_empty() && taken.insert(key) {
                wrong.push(text.to_string());
            }
        };
        if !f.reverse && !f.cloze {
            for w in &note.wrong {
                if wrong.len() >= want {
                    break;
                }
                offer(w, &mut wrong);
            }
        }
        let index = index_deck(deck);
        let my_lesson = index.lesson_of.get(note_id);
        let my_unit = index.unit_of.get(note_id);
        let mut tiers: [Vec<String>; 3] = [vec![], vec![], vec![]];
        for other in deck.notes.values() {
            let tier = if other.id == note_id {
                0
            } else if index.lesson_of.get(&other.id) == my_lesson {
                0
            } else if index.unit_of.get(&other.id) == my_unit {
                1
            } else {
                2
            };
            for text in offers(other, f.reverse, f.cloze, f.picture.is_some()) {
                if answer_kind(&text) == kind {
                    tiers[tier].push(text);
                }
            }
        }
        let target = normalize(&f.answer, strict);
        let target_len = target.chars().count() as f64;
        let similarity = |text: &str| -> f64 {
            let t = normalize(text, strict);
            let same_start = t.chars().next() == target.chars().next();
            distance(&t, &target) as f64 + (t.chars().count() as f64 - target_len).abs() * 0.5 - if same_start { 1.0 } else { 0.0 }
        };
        for tier in tiers.iter_mut() {
            if wrong.len() >= want {
                break;
            }
            shuffle(tier);
            if hard {
                tier.sort_by(|a, b| similarity(a).partial_cmp(&similarity(b)).unwrap_or(std::cmp::Ordering::Equal));
            }
            for text in tier.iter() {
                if wrong.len() >= want {
                    break;
                }
                offer(text, &mut wrong);
            }
        }
        let mut options = vec![f.answer.clone()];
        options.extend(wrong);
        shuffle(&mut options);
        options
    }

    #[test]
    fn the_faster_picker_gives_exactly_the_same_options() {
        // The sample deck, and a bigger deck of several units with similar answers.
        let rows: Vec<crate::model::RawNote> = (0..400)
            .map(|i| serde_json::from_value(serde_json::json!({"front": format!("palabra {i}"), "back": format!("word {}", i % 37)})).unwrap())
            .collect();
        let big = crate::split::build_deck("Big", &rows, &serde_json::from_str("{\"lessonSize\":8}").unwrap(), 0.0);
        for (k, id) in all_cards(&big).iter().enumerate().step_by(7) {
            for hard in [false, true] {
                seed(k as u64 + 5);
                let want = reference(&big, id, 4, hard);
                seed(k as u64 + 5);
                assert_eq!(pick_options(&big, id, 4, hard), want, "{id}");
            }
        }
        let mut deck = sample_deck(0.0);
        for both in [false, true] {
            deck.options.both_ways = both;
            for (i, id) in all_cards(&deck).iter().enumerate() {
                for count in [2, 3, 4, 6, 8, 40] {
                    for hard in [false, true] {
                        let s = (i * 97 + count * 13 + hard as usize) as u64;
                        seed(s);
                        let want = reference(&deck, id, count, hard);
                        seed(s);
                        assert_eq!(pick_options(&deck, id, count, hard), want, "{id} {count} {hard}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_picture_answer_is_offered_pictures_and_a_word_never_is() {
        let rows: Vec<crate::model::RawNote> = [
            ("kedi", "(picture)", vec!["cat.png"], vec![]),
            ("elma", "apple", vec!["apple.png"], vec![]),
            ("(picture)", "flag", vec![], vec!["flag.png"]),
            ("su", "water", vec![], vec![]),
            ("ev", "house", vec![], vec![]),
        ]
        .iter()
        .map(|(f, b, am, qm)| serde_json::from_value(serde_json::json!({"front": f, "back": b, "amedia": am, "qmedia": qm})).unwrap())
        .collect();
        let deck = crate::split::build_deck("Pictures", &rows, &serde_json::from_str("{\"lessonSize\":8}").unwrap(), 0.0);
        let id_of = |front: &str| deck.notes.values().find(|n| n.front == front).unwrap().id.clone();
        let cat = pick_options(&deck, &id_of("kedi"), 3, false);
        assert_eq!(cat.len(), 3);
        assert!(cat.contains(&"[[picture:cat.png]]".to_string()));
        assert!(cat.iter().all(|o| o.starts_with("[[picture:")), "{cat:?}");
        for front in ["elma", "su", "ev", "(picture)"] {
            let opts = pick_options(&deck, &id_of(front), 4, false);
            assert!(opts.iter().all(|o| !o.starts_with("[[")), "{front}: {opts:?}");
        }
        assert_eq!(face(&deck, &id_of("(picture)")).unwrap().prompt, "[[picture:flag.png]]");
    }
}
