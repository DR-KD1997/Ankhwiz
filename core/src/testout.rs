//! Testing out of a unit: a short quiz for learners who already know it.
//!
//! Up to 12 questions, spread over the unit's lessons, with no help: typed
//! where the answer can be typed, otherwise multiple choice with four options.
//! Passing (10 of 12, or the same share of fewer) opens the unit: every card
//! not yet met starts at stage 3 instead of 1, cards answered correctly reach
//! at least stage 3, and missed cards go back to stage 1 to be relearned.
//! Below the pass mark nothing changes.

use crate::cards::{face, lesson_cards};
use crate::distract::pick_options;
use crate::model::{CardState, Clock, Deck, Progress};
use crate::rng::shuffle;
use crate::session::Exercise;
use crate::stages::introduce;
use crate::text::is_typeable;
use serde::{Deserialize, Serialize};

pub const MAX_QUESTIONS: usize = 12;
/// Stage that cards of a passed unit start at.
pub const START_STAGE: u8 = 3;

/// Correct answers needed to pass a test of `n` questions: 10 of 12.
pub fn pass_mark(n: usize) -> usize {
    (n * 5).div_ceil(6)
}

/// Whether a unit can be tested out of: some of its cards are still unmet,
/// and some can be marked by the app (self-check cards cannot be tested).
pub fn can_test_out(deck: &Deck, progress: &Progress, unit_id: &str) -> bool {
    let cards = unit_cards(deck, unit_id);
    cards.iter().any(|c| !progress.contains_key(c)) && cards.iter().any(|c| face(deck, c).is_some_and(|f| !f.self_check && !f.answer.is_empty()))
}

fn unit_cards(deck: &Deck, unit_id: &str) -> Vec<String> {
    deck.units.iter().filter(|u| u.id == unit_id).flat_map(|u| u.lesson_ids.iter()).flat_map(|l| lesson_cards(deck, l)).collect()
}

/// The questions, spread over the unit's lessons in turn.
pub fn questions(deck: &Deck, unit_id: &str) -> Vec<Exercise> {
    let Some(unit) = deck.units.iter().find(|u| u.id == unit_id) else { return vec![] };
    // Cards the app can mark, lesson by lesson, shuffled within each lesson.
    let mut pools: Vec<Vec<String>> = unit
        .lesson_ids
        .iter()
        .map(|l| {
            let mut ids: Vec<String> = lesson_cards(deck, l).into_iter().filter(|c| face(deck, c).is_some_and(|f| !f.self_check && !f.answer.is_empty())).collect();
            shuffle(&mut ids);
            ids
        })
        .filter(|p| !p.is_empty())
        .collect();
    let mut picked = Vec::new();
    while picked.len() < MAX_QUESTIONS && pools.iter().any(|p| !p.is_empty()) {
        for pool in pools.iter_mut() {
            if picked.len() >= MAX_QUESTIONS {
                break;
            }
            if let Some(id) = pool.pop() {
                picked.push(id);
            }
        }
    }
    picked.iter().filter_map(|id| exercise(deck, id)).collect()
}

fn exercise(deck: &Deck, card_id: &str) -> Option<Exercise> {
    let f = face(deck, card_id)?;
    let note = deck.notes.get(&f.note_id)?;
    let mut ex = Exercise {
        kind: "typed",
        card_id: card_id.to_string(),
        note_id: f.note_id.clone(),
        prompt: f.prompt,
        answer: f.answer.clone(),
        accepted: f.accepted,
        options: None,
        live: Some(false),
        stage: START_STAGE,
        ai: note.ai,
        reverse: f.reverse,
        cloze: f.cloze,
        extra: f.extra,
        qmedia: f.qmedia,
        amedia: f.amedia,
        front_more: f.front_more,
        answer_more: f.answer_more,
        extra_more: f.extra_more,
        picture: f.picture,
    };
    if !is_typeable(&f.answer) {
        let options = pick_options(deck, card_id, 4, true);
        if options.len() < 2 {
            return None;
        }
        ex.kind = "choice";
        ex.live = None;
        ex.options = Some(options);
    }
    Some(ex)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub card_id: String,
    pub correct: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub passed: bool,
    pub correct: usize,
    pub total: usize,
    pub pass_mark: usize,
    /// Progress after the test (unchanged when not passed).
    pub progress: Progress,
    /// Cards sent back to stage 1.
    pub relearn: Vec<String>,
}

pub fn apply(deck: &Deck, progress: &Progress, unit_id: &str, answers: &[Answer], clock: Clock) -> TestResult {
    let total = answers.len();
    let correct = answers.iter().filter(|a| a.correct).count();
    let mark = pass_mark(total);
    let passed = total > 0 && correct >= mark;
    let mut out = progress.clone();
    let mut relearn = Vec::new();
    if passed {
        let today = clock.day();
        // New stage-3 cards are spread over the coming week so they do not all fall due tomorrow.
        for (i, id) in unit_cards(deck, unit_id).iter().enumerate() {
            if out.contains_key(id) {
                continue;
            }
            let mut c = introduce(clock);
            c.stage = START_STAGE;
            c.due = clock.start_of(today + 1 + (i % 7) as i64);
            out.insert(id.clone(), c);
        }
        for a in answers {
            let Some(c) = out.get_mut(&a.card_id) else { continue };
            if a.correct {
                if c.stage < START_STAGE {
                    *c = CardState { stage: START_STAGE, ok_days: vec![], demoted: false, ..c.clone() };
                }
            } else {
                *c = CardState { stage: 1, ok_days: vec![], demoted: true, due: clock.now, ..c.clone() };
                relearn.push(a.card_id.clone());
            }
        }
    }
    TestResult { passed, correct, total, pass_mark: mark, progress: out, relearn }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_deck;
    use crate::session::deck_view;

    fn clock() -> Clock {
        Clock::new(1_794_300_000_000.0, 120.0)
    }

    #[test]
    fn twelve_questions_spread_over_the_lessons() {
        let deck = sample_deck(0.0);
        let unit = &deck.units[1];
        let qs = questions(&deck, &unit.id);
        assert_eq!(qs.len(), MAX_QUESTIONS);
        for l in &unit.lesson_ids {
            let cards = lesson_cards(&deck, l);
            assert!(qs.iter().filter(|q| cards.contains(&q.card_id)).count() >= 3, "each lesson is tested");
        }
        assert!(qs.iter().all(|q| q.kind == "typed" && q.live == Some(false)), "no help while testing out");
        assert_eq!(pass_mark(12), 10);
        assert_eq!(pass_mark(6), 5);
    }

    #[test]
    fn passing_opens_the_unit_and_missed_cards_are_relearned() {
        let deck = sample_deck(0.0);
        let unit = deck.units[1].clone();
        let progress = Progress::new();
        assert!(can_test_out(&deck, &progress, &unit.id));
        let qs = questions(&deck, &unit.id);
        let answers: Vec<Answer> = qs.iter().enumerate().map(|(i, q)| Answer { card_id: q.card_id.clone(), correct: i != 0 }).collect();
        let r = apply(&deck, &progress, &unit.id, &answers, clock());
        assert!(r.passed && r.correct == 11);
        assert_eq!(r.relearn, vec![qs[0].card_id.clone()]);
        assert_eq!(r.progress[&qs[0].card_id].stage, 1);
        assert_eq!(r.progress[&qs[1].card_id].stage, START_STAGE);
        let all = unit_cards(&deck, &unit.id);
        assert!(all.iter().all(|c| r.progress.contains_key(c)));
        assert!(!can_test_out(&deck, &r.progress, &unit.id));
        let view = deck_view(&deck, &r.progress, clock());
        assert!(unit.lesson_ids.iter().all(|l| view.lessons[l].state != "new"));
        // Nothing passed falls due all on one day.
        let tomorrow = clock().start_of(clock().day() + 1);
        assert!(r.progress.values().filter(|c| c.due == tomorrow).count() < all.len());
    }

    #[test]
    fn failing_changes_nothing() {
        let deck = sample_deck(0.0);
        let unit = deck.units[1].clone();
        let qs = questions(&deck, &unit.id);
        let answers: Vec<Answer> = qs.iter().enumerate().map(|(i, q)| Answer { card_id: q.card_id.clone(), correct: i < 9 }).collect();
        let r = apply(&deck, &Progress::new(), &unit.id, &answers, clock());
        assert!(!r.passed);
        assert!(r.progress.is_empty());
    }
}
