//! Multiple choice: how many options, and which wrong ones.
//! Wrong options come from related cards, nearest first: same lesson, then
//! same unit, then the rest of the deck. Later on they are picked for
//! similarity to the answer, so guessing gets harder as the card advances.
//! A reverse card is offered other notes' fronts; a gap, other gaps.

use crate::cards::{face, gaps, note_of};
use crate::model::{CardState, Deck, Note};
use crate::rng::shuffle;
use crate::text::{answer_kind, distance, normalize};
use std::collections::{BTreeMap, BTreeSet};

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
fn offers(note: &Note, reverse: bool, cloze: bool) -> Vec<String> {
    if cloze {
        return if note.cloze { gaps(&note.front).into_iter().map(|g| g.answer).collect() } else { vec![] };
    }
    if note.cloze {
        return vec![];
    }
    vec![if reverse { note.front.clone() } else { note.back.clone() }]
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
    let mut wrong: Vec<String> = Vec::new();
    let want = count.saturating_sub(1);

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

    let index = index_deck(deck);
    let my_lesson = index.lesson_of.get(note_id);
    let my_unit = index.unit_of.get(note_id);
    let mut tiers: [Vec<String>; 3] = [vec![], vec![], vec![]];
    for other in deck.notes.values() {
        let tier = if other.id == note_id {
            // Other gaps of the same note are close relatives.
            0
        } else if index.lesson_of.get(&other.id) == my_lesson {
            0
        } else if index.unit_of.get(&other.id) == my_unit {
            1
        } else {
            2
        };
        for text in offers(other, f.reverse, f.cloze) {
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
        distance(&t, &target) as f64 + (t.chars().count() as f64 - target_len).abs() * 0.5
            - if same_start { 1.0 } else { 0.0 }
    };

    for tier in tiers.iter_mut() {
        if wrong.len() >= want {
            break;
        }
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

    let mut options = vec![f.answer.clone()];
    options.extend(wrong);
    shuffle(&mut options);
    options
}
