//! Mastery stages and the mapping from what happened to a scheduler grade.
//!
//!  1 Meet             multiple choice, 2 to 3 options   up after 1 correct
//!  2 Recognise        multiple choice, 4 to 8 options   up after 2 separate days
//!  3 Assisted recall  typed, colour while typing        up after 2 separate days, no red
//!  4 Firm recall      typed, plain text                 up after 2 separate days
//!  5 Mastered         typed, plain text, long gaps      stays while correct
//!
//! A wrong answer drops the card one stage, never back to the start.

use crate::model::{CardState, Clock, DeckOptions, Outcome, Seen, HISTORY};
use crate::schedule::{review_with, Grade, Limits};

/// Counted correct days needed to leave a stage, with the deck's settings for stages 2 to 4.
pub fn threshold_with(stage: u8, opts: &DeckOptions) -> usize {
    match stage {
        1 => 1,
        2..=4 => opts.stage_days[(stage - 2) as usize].clamp(1, 7),
        _ => usize::MAX,
    }
}

pub fn threshold(stage: u8) -> usize {
    threshold_with(stage, &DeckOptions::default())
}

pub fn stage_name(stage: u8) -> &'static str {
    match stage {
        1 => "Meet",
        2 => "Recognise",
        3 => "Assisted recall",
        4 => "Firm recall",
        _ => "Mastered",
    }
}

pub fn introduce(clock: Clock) -> CardState {
    CardState {
        stage: 1,
        ok_days: vec![],
        demoted: false,
        lapses: 0,
        reps: 0,
        due: clock.now,
        mem: None,
        suspended: false,
        buried: None,
        added: Some(clock.day()),
        hist: vec![],
    }
}

/// "Fast" for the Easy grade: a base allowance plus time per character.
pub fn is_fast(ms: f64, answer_len: usize) -> bool {
    ms < 1500.0 + 400.0 * answer_len as f64
}

pub fn grade_of(stage: u8, o: &Outcome, answer_len: usize) -> Grade {
    if !o.correct {
        Grade::Again
    } else if o.ai_graded {
        // AI-graded free text may only count as Again or Good.
        Grade::Good
    } else if o.assisted {
        Grade::Hard
    } else if stage == 5 && is_fast(o.ms, answer_len) {
        Grade::Easy
    } else {
        Grade::Good
    }
}

pub struct Applied {
    pub card: CardState,
    pub grade: Grade,
    pub promoted: bool,
    pub demoted: bool,
}

/// Apply one graded answer to a card: stage movement and the next due time.
pub fn apply_outcome(card: &CardState, o: &Outcome, clock: Clock, answer_len: usize) -> Applied {
    apply_with(card, o, clock, answer_len, &DeckOptions::default())
}

pub fn apply_with(card: &CardState, o: &Outcome, clock: Clock, answer_len: usize, opts: &DeckOptions) -> Applied {
    let before = card.stage;
    let grade = grade_of(before, o, answer_len);
    let limits = Limits { retention: opts.retention, max_interval: opts.max_interval as f64 };
    let sched = review_with(card.mem, grade, clock, limits);

    let mut stage = before;
    let mut ok_days = card.ok_days.clone();
    let mut was_demoted = card.demoted;
    let mut promoted = false;
    let mut demoted = false;

    if o.correct {
        // In stage 3 a correct answer that turned red on the way does not count.
        let counts = !(before == 3 && o.saw_red);
        let today = clock.day();
        if counts && !ok_days.contains(&today) {
            ok_days.push(today);
        }
        if before < 5 && ok_days.len() >= threshold_with(before, opts) {
            stage = before + 1;
            ok_days.clear();
            was_demoted = false;
            promoted = true;
        }
    } else {
        if before > 1 {
            stage = before - 1;
            demoted = true;
            was_demoted = true;
        }
        ok_days.clear();
    }

    // Stages 1 and 2 are recognition only, so they never earn more than a
    // day. A wrong answer also comes back by tomorrow at the latest.
    let mut due = sched.due;
    if before <= 2 || !o.correct {
        due = due.min(clock.start_of_tomorrow());
    }

    let mut hist = card.hist.clone();
    hist.push(Seen { day: clock.day(), ok: o.correct, stage: before });
    if hist.len() > HISTORY {
        hist.drain(..hist.len() - HISTORY);
    }
    Applied {
        card: CardState {
            stage,
            ok_days,
            demoted: was_demoted,
            lapses: card.lapses + u32::from(!o.correct),
            reps: card.reps + 1,
            due,
            mem: Some(sched.mem),
            suspended: card.suspended,
            buried: None,
            added: card.added.or(Some(clock.day())),
            hist,
        },
        grade,
        promoted,
        demoted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::DAY_MS;

    pub fn clock() -> Clock {
        Clock::new(1_794_300_000_000.0, 120.0)
    }
    fn ok() -> Outcome {
        Outcome { correct: true, assisted: false, saw_red: false, ms: 3000.0, ai_graded: false }
    }
    fn later(c: Clock, ms: f64) -> Clock {
        Clock::new(c.now + ms, c.tz)
    }

    #[test]
    fn maps_results_to_grades() {
        assert_eq!(grade_of(2, &Outcome { correct: false, ..ok() }, 5), Grade::Again);
        assert_eq!(grade_of(2, &Outcome { assisted: true, ..ok() }, 5), Grade::Hard);
        assert_eq!(grade_of(4, &ok(), 5), Grade::Good);
        assert_eq!(grade_of(5, &Outcome { ms: 1000.0, ..ok() }, 5), Grade::Easy);
        assert_eq!(grade_of(5, &Outcome { ms: 60000.0, ..ok() }, 5), Grade::Good);
        assert_eq!(grade_of(4, &Outcome { ms: 1000.0, ..ok() }, 5), Grade::Good);
        assert_eq!(grade_of(5, &Outcome { ms: 100.0, ai_graded: true, ..ok() }, 5), Grade::Good);
    }

    #[test]
    fn leaves_stage_1_after_one_correct_answer() {
        let r = apply_outcome(&introduce(clock()), &Outcome { assisted: true, ..ok() }, clock(), 5);
        assert_eq!(r.card.stage, 2);
        assert!(r.promoted);
    }

    #[test]
    fn stage_2_needs_two_days_and_never_schedules_past_tomorrow() {
        let c = clock();
        let helped = Outcome { assisted: true, ..ok() };
        let mut card = apply_outcome(&introduce(c), &helped, c, 5).card;
        card = apply_outcome(&card, &helped, later(c, 60_000.0), 5).card;
        assert_eq!(card.stage, 2);
        card = apply_outcome(&card, &helped, later(c, 120_000.0), 5).card;
        assert_eq!(card.stage, 2, "the same day does not count twice");
        assert!(card.due <= c.start_of_tomorrow());
        card = apply_outcome(&card, &helped, later(c, DAY_MS), 5).card;
        assert_eq!(card.stage, 3);
    }

    #[test]
    fn a_red_answer_in_stage_3_does_not_count() {
        let c = clock();
        let mut card = CardState { stage: 3, ..introduce(c) };
        card = apply_outcome(&card, &Outcome { assisted: true, saw_red: true, ..ok() }, c, 5).card;
        assert!(card.ok_days.is_empty());
        card = apply_outcome(&card, &Outcome { assisted: true, ..ok() }, later(c, DAY_MS), 5).card;
        assert_eq!(card.ok_days.len(), 1);
    }

    #[test]
    fn drops_one_stage_on_a_wrong_answer_never_below_1() {
        let c = clock();
        let wrong = Outcome { correct: false, ..ok() };
        let three = apply_outcome(&CardState { stage: 3, ..introduce(c) }, &wrong, c, 5);
        assert_eq!(three.card.stage, 2);
        assert!(three.demoted);
        assert_eq!(three.card.lapses, 1);
        assert_eq!(apply_outcome(&introduce(c), &wrong, c, 5).card.stage, 1);
    }

    #[test]
    fn deck_settings_change_how_many_days_a_stage_needs() {
        let c = clock();
        let opts = DeckOptions { stage_days: [1, 3, 2], ..Default::default() };
        let card = CardState { stage: 2, ..introduce(c) };
        let r = apply_with(&card, &Outcome { assisted: true, ..ok() }, c, 5, &opts);
        assert_eq!(r.card.stage, 3, "one day is enough in stage 2 here");
        assert_eq!(r.card.hist.len(), 1);
        assert_eq!(threshold_with(3, &opts), 3);
    }

    #[test]
    fn typed_recall_earns_more_than_a_day() {
        let c = clock();
        let typed = apply_outcome(&CardState { stage: 4, ..introduce(c) }, &ok(), c, 5).card;
        assert!(typed.due - c.now > DAY_MS);
    }
}
