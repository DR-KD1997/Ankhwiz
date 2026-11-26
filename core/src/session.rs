//! Lessons, reviews and practice: what is due, what a session contains, and
//! which exercise a card gets at its current stage. Everything here works on
//! cards (see `cards.rs`), so a note asked both ways counts as two.

use crate::cards::{all_cards, face, is_live, is_reading_card, lesson_cards, note_of};
use crate::distract::{option_count, pick_options};
use crate::model::{CardState, Clock, Deck, Progress, Streak};
use crate::text::{answer_kind, is_buildable, is_typeable, AnswerKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_REVIEWS_IN_LESSON: usize = 3;
pub const MAX_REVIEW_SESSION: usize = 15;
pub const MAX_PRACTICE: usize = 20;
/// At or above this many due cards, the path offers a review before new material.
pub const REVIEW_FIRST_AT: usize = 10;
/// Wrong answers after which a card counts as tricky (Anki: leech).
pub const TRICKY_LAPSES: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub card_id: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retry: bool,
}

fn item(id: &str) -> QueueItem {
    QueueItem { card_id: id.to_string(), retry: false }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Exercise {
    /// meet, choice, build (the answer put together from word tiles), typed,
    /// free (a long answer, marked by AI or by the learner) or self (the
    /// learner sees the answer and says how close they were).
    pub kind: &'static str,
    pub card_id: String,
    pub note_id: String,
    pub prompt: String,
    pub answer: String,
    pub accepted: Vec<String>,
    /// Choice: the options, the answer among them. Build: other answers of the
    /// deck, whose words are mixed in with the answer's as extra tiles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    /// Typed only: true in stage 3, where the text changes colour while typing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live: Option<bool>,
    pub stage: u8,
    pub ai: bool,
    /// Asked the other way round (answer side shown, question side expected).
    pub reverse: bool,
    pub cloze: bool,
    pub extra: String,
    pub qmedia: Vec<String>,
    pub amedia: Vec<String>,
    /// More question fields, shown under the question in smaller type.
    pub front_more: Vec<String>,
    /// Shown with the answer once given.
    pub answer_more: Vec<String>,
    pub extra_more: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<crate::cards::Picture>,
    /// Accepted answers that come from other cards with the same meaning, so
    /// the learner can be told "this card's answer is …; yours fits too".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub linked: Vec<String>,
    /// A reading card: the reading of `mark` (or of the whole prompt) is answered in kana.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub kana: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub mark: String,
}

/// A card that can be asked now: not stopped, not skipped today.
fn askable(c: &CardState, clock: Clock) -> bool {
    !c.suspended && c.buried != Some(clock.day())
}

/// How a deck spaces a card and its other-way-round twin.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Spacing {
    Spread,
    NextDay,
    Together,
}

pub fn spacing(deck: &Deck) -> Spacing {
    match deck.options.reverse_spacing.as_str() {
        "nextDay" => Spacing::NextDay,
        "together" => Spacing::Together,
        _ => Spacing::Spread,
    }
}

/// The other-way-round card of a question-and-answer note.
fn is_reverse(id: &str) -> bool {
    id.ends_with(":r")
}

/// A reverse card not yet met that, under `nextDay`, is not met in its lesson
/// but among reviews once its forward card has had a day to settle.
fn waits_for_reviews(deck: &Deck, progress: &Progress, id: &str) -> bool {
    if is_reading_card(id) {
        return deck.options.look.reading_cards == "firm" && !progress.contains_key(id);
    }
    spacing(deck) == Spacing::NextDay && is_reverse(id) && !progress.contains_key(id)
}

/// Under `nextDay`: reverse cards ready to be met today, because their
/// forward card was met on an earlier day. In path order.
/// Also, with reading cards met "after the meaning is firm": reading cards
/// whose card has reached Firm recall.
pub fn reverses_to_meet(deck: &Deck, progress: &Progress, clock: Clock) -> Vec<String> {
    let next_day = spacing(deck) == Spacing::NextDay;
    let firm = deck.options.look.reading_cards == "firm";
    if !next_day && !firm {
        return vec![];
    }
    let today = clock.day();
    all_cards(deck)
        .into_iter()
        .filter(|id| !progress.contains_key(id))
        .filter(|id| {
            let forward = progress.get(note_of(id));
            if is_reading_card(id) {
                firm && forward.is_some_and(|f| f.stage >= 4 && !f.suspended)
            } else {
                next_day && is_reverse(id) && forward.is_some_and(|f| f.added.is_some_and(|d| d < today) && !f.suspended)
            }
        })
        .collect()
}

/// Cards due by the end of today, most overdue first. Unless the deck asks
/// twins together, only one card of a note is asked a day: a card waits while
/// its twin is due before it or was already answered today.
pub fn due_cards(deck: &Deck, progress: &Progress, clock: Clock) -> Vec<String> {
    let limit = clock.end_of_today();
    let mut ids: Vec<&String> = progress
        .iter()
        .filter(|(id, c)| c.due <= limit && askable(c, clock) && is_live(deck, id))
        .map(|(id, _)| id)
        .collect();
    ids.sort_by(|a, b| progress[*a].due.partial_cmp(&progress[*b].due).unwrap_or(std::cmp::Ordering::Equal));
    if spacing(deck) == Spacing::Together {
        return ids.into_iter().cloned().collect();
    }
    let today = clock.day();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let note = note_of(id);
        if is_reading_card(id) || (!is_reverse(id) && !progress.contains_key(&format!("{note}:r"))) {
            // No twin: nothing to space.
            out.push(id.clone());
            continue;
        }
        let twin = if is_reverse(id) { note.to_string() } else { format!("{note}:r") };
        let twin_today = progress.get(&twin).is_some_and(|c| c.hist.last().is_some_and(|h| h.day == today));
        if !twin_today && seen.insert(note) {
            out.push(id.clone());
        }
    }
    out
}

/// Reviews already answered today (cards met before today and answered today).
pub fn reviews_today(progress: &Progress, clock: Clock) -> usize {
    let today = clock.day();
    progress
        .values()
        .filter(|c| c.added.is_some_and(|d| d < today) && c.hist.last().is_some_and(|h| h.day == today))
        .count()
}

/// Reviews still offered today under the deck's daily cap.
pub fn reviews_left(deck: &Deck, progress: &Progress, clock: Clock) -> usize {
    (deck.options.review_cap as usize).saturating_sub(reviews_today(progress, clock))
}

/// Lessons with a card first met today.
pub fn lessons_started_today(deck: &Deck, progress: &Progress, clock: Clock) -> usize {
    let today = clock.day();
    // Most days only a few cards were first met today; skip the deck's index when none were.
    if !progress.values().any(|c| c.added == Some(today)) {
        return 0;
    }
    let (lesson_of, _) = crate::distract::note_places(deck);
    let mut lessons: Vec<&str> = progress
        .iter()
        .filter(|(_, c)| c.added == Some(today))
        // A reverse card met among reviews does not start its lesson again.
        .filter(|(id, _)| !is_reverse(id) || progress.get(note_of(id)).is_none_or(|f| f.added == Some(today)))
        .filter_map(|(id, _)| lesson_of.get(note_of(id)).copied())
        .collect();
    lessons.sort();
    lessons.dedup();
    lessons.len()
}

pub fn ordered_lesson_ids(deck: &Deck) -> Vec<String> {
    deck.units.iter().flat_map(|u| u.lesson_ids.iter().cloned()).collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LessonStatus {
    /// new: nothing met. started: partly met. learned: all met.
    /// complete: every card has passed plain typed recall once.
    pub state: &'static str,
    pub total: usize,
    pub introduced: usize,
    /// Average mastery stage of the lesson's cards, 0 to 5.
    pub strength: f64,
    pub due: usize,
    pub unlocked: bool,
}

pub fn lesson_status(deck: &Deck, progress: &Progress, lesson_id: &str, clock: Clock) -> LessonStatus {
    let ids = lesson_cards(deck, lesson_id);
    let limit = clock.end_of_today();
    let (mut introduced, mut stages, mut passed, mut due, mut waiting) = (0usize, 0usize, 0usize, 0usize, 0usize);
    for id in &ids {
        let Some(c) = progress.get(id) else {
            if waits_for_reviews(deck, progress, id) {
                waiting += 1;
            }
            continue;
        };
        introduced += 1;
        stages += c.stage as usize;
        if c.stage == 5 || (c.stage == 4 && !c.ok_days.is_empty()) {
            passed += 1;
        }
        if c.due <= limit && askable(c, clock) {
            due += 1;
        }
    }
    let total = ids.len();
    let state = if introduced == 0 {
        "new"
    } else if introduced + waiting < total {
        "started"
    } else if passed == total {
        "complete"
    } else {
        "learned"
    };
    LessonStatus {
        state,
        total,
        introduced,
        strength: if total > 0 { stages as f64 / total as f64 } else { 0.0 },
        due,
        unlocked: false,
    }
}

/// The first lesson with cards still to meet, or None when all are met.
pub fn next_lesson_id(deck: &Deck, progress: &Progress) -> Option<String> {
    ordered_lesson_ids(deck)
        .into_iter()
        .find(|id| lesson_cards(deck, id).iter().any(|c| !progress.contains_key(c) && !waits_for_reviews(deck, progress, c)))
}

/// Cards that keep being missed, worst first.
pub fn tricky_cards(deck: &Deck, progress: &Progress) -> Vec<String> {
    let mut ids: Vec<(&String, &CardState)> = progress
        .iter()
        .filter(|(id, c)| c.lapses >= TRICKY_LAPSES && !c.suspended && is_live(deck, id))
        .collect();
    ids.sort_by(|a, b| b.1.lapses.cmp(&a.1.lapses).then(a.1.stage.cmp(&b.1.stage)));
    ids.into_iter().map(|(id, _)| id.clone()).collect()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeckView {
    pub total: usize,
    pub introduced: usize,
    pub due: usize,
    pub next_id: Option<String>,
    pub review_first: bool,
    /// Cards at each mastery stage, 1 to 5.
    pub stages: [usize; 5],
    pub lessons: BTreeMap<String, LessonStatus>,
    /// Lessons started today, and the deck's daily goal (0: none).
    pub started_today: usize,
    pub goal: u32,
    pub goal_met: bool,
    pub reviews_left: usize,
    pub tricky: usize,
    pub stopped: usize,
}

/// Everything the path screen needs, in one pass. A lesson opens once the
/// lesson before it has been fully met (in order, or by testing out of a
/// unit), and stays open once any of its cards has been met.
pub fn deck_view(deck: &Deck, progress: &Progress, clock: Clock) -> DeckView {
    let order = ordered_lesson_ids(deck);
    let next_id = next_lesson_id(deck, progress);
    let mut lessons = BTreeMap::new();
    let mut prev_met = true;
    for id in order.iter() {
        let mut status = lesson_status(deck, progress, id, clock);
        status.unlocked = prev_met || status.introduced > 0;
        prev_met = status.state == "learned" || status.state == "complete";
        lessons.insert(id.clone(), status);
    }
    let mut stages = [0usize; 5];
    let (mut introduced, mut stopped) = (0, 0);
    for (id, c) in progress {
        if is_live(deck, id) {
            introduced += 1;
            stages[(c.stage.clamp(1, 5) - 1) as usize] += 1;
            if c.suspended {
                stopped += 1;
            }
        }
    }
    let left = reviews_left(deck, progress, clock);
    let due = (due_cards(deck, progress, clock).len() + reverses_to_meet(deck, progress, clock).len()).min(left);
    let started_today = lessons_started_today(deck, progress, clock);
    let goal = deck.options.new_lessons_per_day;
    DeckView {
        total: all_cards(deck).len(),
        introduced,
        due,
        next_id,
        review_first: due >= REVIEW_FIRST_AT,
        stages,
        lessons,
        started_today,
        goal,
        goal_met: goal > 0 && started_today >= goal as usize,
        reviews_left: left,
        tricky: tricky_cards(deck, progress).len(),
        stopped,
    }
}

/// A lesson session. Each new card is met, asked at once, and asked again a
/// little later; up to three due reviews from earlier lessons are woven in.
/// A lesson already met is simply practised once through.
pub fn build_lesson_queue(deck: &Deck, progress: &Progress, lesson_id: &str, clock: Clock) -> Vec<QueueItem> {
    let ids = lesson_cards(deck, lesson_id);
    if ids.is_empty() {
        return vec![];
    }
    let mode = spacing(deck);
    let mut fresh: Vec<&String> = ids.iter().filter(|id| !progress.contains_key(*id) && !waits_for_reviews(deck, progress, id)).collect();
    if fresh.is_empty() {
        let mut again: Vec<QueueItem> = ids.iter().filter(|id| progress.get(*id).is_some_and(|c| askable(c, clock))).map(|id| item(id)).collect();
        if mode != Spacing::Together {
            // Forward cards first, then the other way round.
            again.sort_by_key(|q| is_reverse(&q.card_id));
        }
        return again;
    }
    if mode == Spacing::Spread {
        // Forward cards first, then the reverse cards in the same order.
        fresh.sort_by_key(|id| is_reverse(id));
    }
    // Reading cards learned from the start come after the cards they read.
    fresh.sort_by_key(|id| is_reading_card(id));

    let mut reviews: std::collections::VecDeque<String> = due_cards(deck, progress, clock)
        .into_iter()
        .filter(|id| !ids.contains(id))
        .take(MAX_REVIEWS_IN_LESSON.min(reviews_left(deck, progress, clock)))
        .collect();

    let mut queue = Vec::new();
    let mut follow_ups: std::collections::VecDeque<&String> = Default::default();
    for (i, card_id) in fresh.iter().enumerate() {
        // First showing meets the card; the second asks it straight away.
        queue.push(item(card_id));
        queue.push(item(card_id));
        follow_ups.push_back(card_id);
        // Ask an earlier card again once two newer ones have come between.
        if follow_ups.len() > 2 {
            if let Some(f) = follow_ups.pop_front() {
                queue.push(item(f));
            }
        }
        if i % 2 == 1 {
            if let Some(r) = reviews.pop_front() {
                queue.push(item(&r));
            }
        }
    }
    queue.extend(follow_ups.iter().map(|f| item(f)));
    queue.extend(reviews.iter().map(|r| item(r)));
    if mode != Spacing::Together {
        space_twins(&mut queue, TWIN_GAP);
    }
    queue
}

/// Fewest items between a card and its twin in one session, where possible.
pub const TWIN_GAP: usize = 4;

/// Moves items so that a card and its other-way-round twin are at least `gap`
/// places apart where the queue allows it. Repeats of the same card are left
/// as they are, and every item stays in the queue.
pub fn space_twins(queue: &mut Vec<QueueItem>, gap: usize) {
    let clash = |q: &[QueueItem], at: usize, card: &str| {
        let note = note_of(card);
        let lo = at.saturating_sub(gap - 1);
        let hi = (at + gap).min(q.len());
        (lo..hi).any(|j| j != at && q[j].card_id != card && note_of(&q[j].card_id) == note)
    };
    for i in 0..queue.len() {
        let card = queue[i].card_id.clone();
        if !clash(queue, i, &card) {
            continue;
        }
        // Bring forward the nearest later item that fits here, unless moving it
        // would put this card or that one next to a twin.
        if let Some(j) = (i + 1..queue.len()).find(|&j| {
            let other = queue[j].card_id.clone();
            if note_of(&other) == note_of(&card) {
                return false;
            }
            let mut trial = queue.clone();
            let moved = trial.remove(j);
            trial.insert(i, moved);
            !clash(&trial, i, &other) && !clash(&trial, i + 1, &card)
        }) {
            let moved = queue.remove(j);
            queue.insert(i, moved);
        }
    }
}

pub fn build_review_queue(deck: &Deck, progress: &Progress, clock: Clock) -> Vec<QueueItem> {
    let n = MAX_REVIEW_SESSION.min(reviews_left(deck, progress, clock));
    let mut queue: Vec<QueueItem> = due_cards(deck, progress, clock).iter().take(n).map(|id| item(id)).collect();
    // Under `nextDay`, reverse cards whose forward card was met before today
    // are met here, as in a lesson: shown, asked, and asked again a little later.
    let room = n.saturating_sub(queue.len());
    let mut follow_ups: std::collections::VecDeque<String> = Default::default();
    for id in reverses_to_meet(deck, progress, clock).into_iter().take(room) {
        queue.push(item(&id));
        queue.push(item(&id));
        follow_ups.push_back(id);
        if follow_ups.len() > 2 {
            if let Some(f) = follow_ups.pop_front() {
                queue.push(item(&f));
            }
        }
    }
    queue.extend(follow_ups.iter().map(|f| item(f)));
    if spacing(deck) != Spacing::Together {
        space_twins(&mut queue, TWIN_GAP);
    }
    queue
}

/// Practice: extra rounds that never change the schedule.
/// `tricky`: the cards most often missed. `unit`: met cards of one unit.
/// `cram`: the weakest met cards of the whole deck.
pub fn build_practice_queue(deck: &Deck, progress: &Progress, mode: &str, unit_id: &str) -> Vec<QueueItem> {
    let met = |id: &String| progress.get(id).is_some_and(|c| !c.suspended);
    let mut ids: Vec<String> = match mode {
        "tricky" => tricky_cards(deck, progress),
        "unit" => deck
            .units
            .iter()
            .filter(|u| u.id == unit_id)
            .flat_map(|u| u.lesson_ids.iter())
            .flat_map(|l| lesson_cards(deck, l))
            .filter(met)
            .collect(),
        _ => {
            let mut all: Vec<String> = all_cards(deck).into_iter().filter(met).collect();
            all.sort_by_key(|id| progress[id].stage);
            all
        }
    };
    if mode == "unit" {
        crate::rng::shuffle(&mut ids);
    }
    ids.truncate(MAX_PRACTICE);
    ids.iter().map(|id| item(id)).collect()
}

/// The exercise for a card right now. Built when it is shown, not when the
/// session starts, because the card's stage can change during the session.
pub fn make_exercise(deck: &Deck, progress: &Progress, card_id: &str, just_met: bool) -> Option<Exercise> {
    let f = face(deck, card_id)?;
    let note = deck.notes.get(&f.note_id)?;
    let card = progress.get(card_id);
    let mut ex = Exercise {
        kind: "meet",
        card_id: card_id.to_string(),
        note_id: f.note_id.clone(),
        prompt: f.prompt,
        answer: f.answer.clone(),
        accepted: f.accepted,
        options: None,
        live: None,
        stage: card.map(|c| c.stage).unwrap_or(1),
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
        linked: f.linked,
        kana: f.kana,
        mark: f.mark,
    };
    let Some(card) = card else { return Some(ex) };
    if f.self_check {
        ex.kind = "self";
        return Some(ex);
    }

    if ex.kana {
        // A reading: picked from near-sounding readings at first, typed from Assisted recall on.
        if card.stage >= 3 {
            ex.kind = "typed";
            ex.live = Some(card.stage == 3);
            return Some(ex);
        }
        let options = pick_options(deck, card_id, option_count(Some(card), just_met), false);
        ex.kind = if options.len() >= 2 { "choice" } else { "typed" };
        if options.len() >= 2 {
            ex.options = Some(options);
        }
        return Some(ex);
    }
    if card.stage >= 3 {
        if answer_kind(&f.answer) == AnswerKind::Media {
            // A picture or a sound cannot be typed: it is picked from the most options.
            let options = pick_options(deck, card_id, option_count(Some(card), false), true);
            if options.len() >= 2 {
                ex.kind = "choice";
                ex.options = Some(options);
            } else {
                ex.kind = "self";
            }
            return Some(ex);
        }
        if is_typeable(&f.answer) {
            ex.kind = "typed";
            ex.live = Some(card.stage == 3);
        } else {
            // A long answer cannot be matched letter by letter: it is written
            // freely and marked by AI, or compared by the learner without AI.
            ex.kind = "free";
        }
        return Some(ex);
    }

    let count = option_count(Some(card), just_met);
    let hard = card.stage == 2 && (!card.ok_days.is_empty() || card.demoted);
    if deck.options.build_sentences && !note.no_build && ex.picture.is_none() && is_buildable(&f.answer) {
        // A sentence is put together from its words, with a few from other answers mixed in.
        let mut others = pick_options(deck, card_id, 4, hard);
        others.retain(|o| o != &f.answer);
        ex.kind = "build";
        ex.options = Some(others);
        return Some(ex);
    }
    let options = pick_options(deck, card_id, count, hard);
    if options.len() < 2 {
        // Nothing in the deck to offer as a wrong option.
        ex.kind = "free";
    } else {
        ex.kind = "choice";
        ex.options = Some(options);
    }
    Some(ex)
}

/// Where a missed card goes back into the queue: a few items later.
pub fn requeue(queue: &[QueueItem], index: usize, card_id: &str) -> Vec<QueueItem> {
    let retries = queue.iter().filter(|q| q.card_id == card_id && q.retry).count();
    let mut out = queue.to_vec();
    if retries < 2 {
        let at = (index + 4).min(out.len());
        out.insert(at, QueueItem { card_id: card_id.to_string(), retry: true });
    }
    out
}

/// The streak after a finished session today.
pub fn streak_after(streak: &Streak, clock: Clock) -> Streak {
    let today = clock.day();
    let mut days = streak.days.clone();
    if !days.contains(&today) {
        days.push(today);
    }
    if days.len() > 400 {
        days.drain(..days.len() - 400);
    }
    if streak.last == Some(today) {
        return Streak { days, ..streak.clone() };
    }
    let count = if streak.last == Some(today - 1) { streak.count + 1 } else { 1 };
    Streak { count, last: Some(today), best: streak.best.max(count), days }
}

/// The streak as it stands today: a missed day resets it to zero.
pub fn current_streak(streak: &Streak, clock: Clock) -> u32 {
    let today = clock.day();
    match streak.last {
        Some(d) if d == today || d == today - 1 => streak.count,
        _ => 0,
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeckStats {
    pub stages: [usize; 5],
    /// Reviews due on each of the next seven days; today includes overdue cards.
    pub forecast: [usize; 7],
    /// Share of answers correct over the last 30 days, among cards met before that day.
    pub retention: Option<f64>,
    pub answers30: usize,
    pub tricky: Vec<String>,
    pub stopped: usize,
    pub introduced: usize,
    pub total: usize,
}

pub fn deck_stats(deck: &Deck, progress: &Progress, clock: Clock) -> DeckStats {
    let today = clock.day();
    let mut forecast = [0usize; 7];
    let mut stages = [0usize; 5];
    let (mut ok, mut answers, mut introduced, mut stopped) = (0usize, 0usize, 0usize, 0usize);
    for (id, c) in progress {
        if !is_live(deck, id) {
            continue;
        }
        introduced += 1;
        stages[(c.stage.clamp(1, 5) - 1) as usize] += 1;
        if c.suspended {
            stopped += 1;
            continue;
        }
        let due_day = Clock::new(c.due, clock.tz).day();
        let offset = (due_day - today).max(0);
        if offset < 7 {
            forecast[offset as usize] += 1;
        }
        for h in &c.hist {
            if h.day > today - 30 && c.added.is_some_and(|a| a < h.day) {
                answers += 1;
                ok += usize::from(h.ok);
            }
        }
    }
    DeckStats {
        stages,
        forecast,
        retention: if answers > 0 { Some(ok as f64 / answers as f64) } else { None },
        answers30: answers,
        tricky: tricky_cards(deck, progress),
        stopped,
        introduced,
        total: all_cards(deck).len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Outcome, DAY_MS};
    use crate::sample::sample_deck;
    use crate::stages::{apply_outcome, introduce};

    fn clock() -> Clock {
        Clock::new(1_794_300_000_000.0, 120.0)
    }

    #[test]
    fn a_new_lesson_meets_asks_and_follows_up() {
        let deck = sample_deck(0.0);
        let first = deck.units[0].lesson_ids[0].clone();
        let queue = build_lesson_queue(&deck, &Progress::new(), &first, clock());
        // 6 notes: met, asked at once, and asked once more later.
        assert_eq!(queue.len(), 18);
        assert_eq!(queue[0].card_id, queue[1].card_id);
        for id in &deck.lessons[&first].note_ids {
            assert_eq!(queue.iter().filter(|q| &q.card_id == id).count(), 3);
        }
    }

    #[test]
    fn exercises_follow_the_stage() {
        let deck = sample_deck(0.0);
        let first = deck.units[0].lesson_ids[0].clone();
        let id = deck.lessons[&first].note_ids[0].clone();
        let mut progress = Progress::new();
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().kind, "meet");

        progress.insert(id.clone(), introduce(clock()));
        let just = make_exercise(&deck, &progress, &id, true).unwrap();
        assert_eq!(just.kind, "choice");
        assert_eq!(just.options.as_ref().unwrap().len(), 2);
        assert!(just.options.unwrap().contains(&"the apple".to_string()));
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().options.unwrap().len(), 3);

        progress.get_mut(&id).unwrap().stage = 2;
        let four = make_exercise(&deck, &progress, &id, false).unwrap().options.unwrap();
        assert_eq!(four.len(), 4);
        // Early options come from the same lesson: all fruit.
        let fruit = ["the apple", "the pear", "the grape", "the peach", "the orange", "the banana"];
        assert!(four.iter().all(|o| fruit.contains(&o.as_str())), "{four:?}");

        progress.get_mut(&id).unwrap().ok_days = vec![1];
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().options.unwrap().len(), 6);

        progress.get_mut(&id).unwrap().stage = 3;
        let typed = make_exercise(&deck, &progress, &id, false).unwrap();
        assert_eq!((typed.kind, typed.live), ("typed", Some(true)));
        progress.get_mut(&id).unwrap().stage = 4;
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().live, Some(false));
    }

    #[test]
    fn options_never_repeat_or_include_an_accepted_answer() {
        let deck = sample_deck(0.0);
        let mut progress = Progress::new();
        for (id, note) in &deck.notes {
            progress.insert(id.clone(), CardState { stage: 2, ok_days: vec![1, 2], ..introduce(clock()) });
            let options = make_exercise(&deck, &progress, id, false).unwrap().options.unwrap();
            let mut seen = std::collections::BTreeSet::new();
            assert!(options.iter().all(|o| seen.insert(o.clone())), "{options:?}");
            assert_eq!(options.iter().filter(|o| *o == &note.back).count(), 1);
            assert!(note.alts.iter().all(|a| !options.contains(a)));
            assert_eq!(options.len(), 8);
        }
    }

    #[test]
    fn long_answers_are_written_freely() {
        let mut deck = sample_deck(0.0);
        let id = deck.notes.keys().next().unwrap().clone();
        deck.notes.get_mut(&id).unwrap().back =
            "a long explanation that runs on for rather more than forty characters".into();
        let mut progress = Progress::new();
        progress.insert(id.clone(), CardState { stage: 3, ..introduce(clock()) });
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().kind, "free");
    }

    #[test]
    fn missed_notes_return_at_most_twice() {
        let q: Vec<QueueItem> = (0..8).map(|i| item(&format!("n{i}"))).collect();
        let once = requeue(&q, 0, "n0");
        assert_eq!(once[4], QueueItem { card_id: "n0".into(), retry: true });
        let twice = requeue(&once, 4, "n0");
        assert_eq!(requeue(&twice, 8, "n0").len(), twice.len());
    }

    #[test]
    fn the_path_unlocks_in_order_and_reports_due_work() {
        let deck = sample_deck(0.0);
        let order = ordered_lesson_ids(&deck);
        let mut progress = Progress::new();
        let view = deck_view(&deck, &progress, clock());
        assert_eq!(view.next_id.as_ref(), Some(&order[0]));
        assert!(view.lessons[&order[0]].unlocked && !view.lessons[&order[1]].unlocked);

        let c = clock();
        let helped = Outcome { correct: true, assisted: true, saw_red: false, ms: 2000.0, ai_graded: false };
        for id in &deck.lessons[&order[0]].note_ids {
            progress.insert(id.clone(), apply_outcome(&introduce(c), &helped, c, 5).card);
        }
        let view = deck_view(&deck, &progress, c);
        assert_eq!(view.lessons[&order[0]].state, "learned");
        assert!(view.lessons[&order[1]].unlocked);
        assert_eq!(view.due, 0, "nothing is due again on the same day");
        let tomorrow = Clock::new(c.now + DAY_MS, c.tz);
        assert_eq!(deck_view(&deck, &progress, tomorrow).due, 6);
        assert_eq!(build_review_queue(&deck, &progress, tomorrow).len(), 6);
    }

    #[test]
    fn a_whole_card_life_reaches_mastery() {
        let mut c = clock();
        let mut card = introduce(c);
        let mut days = 0;
        while card.stage < 5 && days < 60 {
            let o = Outcome { correct: true, assisted: card.stage <= 3, saw_red: false, ms: 4000.0, ai_graded: false };
            card = apply_outcome(&card, &o, c, 9).card;
            c = Clock::new(card.due.max(c.now + DAY_MS), c.tz);
            days += 1;
        }
        assert_eq!(card.stage, 5);
        assert!(days <= 8, "mastery after {days} review days");
    }

    #[test]
    fn streaks_count_days_in_a_row() {
        let c = clock();
        let one = streak_after(&Streak::default(), c);
        assert_eq!(one.count, 1);
        assert_eq!(streak_after(&one, c).count, 1);
        let next = Clock::new(c.now + DAY_MS, c.tz);
        let two = streak_after(&one, next);
        assert_eq!((two.count, two.best), (2, 2));
        let later = Clock::new(c.now + 4.0 * DAY_MS, c.tz);
        assert_eq!(current_streak(&two, later), 0);
        assert_eq!(streak_after(&two, later).count, 1);
    }

    #[test]
    fn skipped_and_stopped_cards_are_not_asked() {
        let deck = sample_deck(0.0);
        let c = clock();
        let order = ordered_lesson_ids(&deck);
        let mut progress = Progress::new();
        for id in &deck.lessons[&order[0]].note_ids {
            progress.insert(id.clone(), introduce(c));
        }
        let ids: Vec<String> = deck.lessons[&order[0]].note_ids.clone();
        progress.get_mut(&ids[0]).unwrap().suspended = true;
        progress.get_mut(&ids[1]).unwrap().buried = Some(c.day());
        assert_eq!(due_cards(&deck, &progress, c).len(), 4);
        let tomorrow = Clock::new(c.now + DAY_MS, c.tz);
        assert_eq!(due_cards(&deck, &progress, tomorrow).len(), 5, "skipping lasts one day");
        assert_eq!(deck_view(&deck, &progress, c).stopped, 1);
    }

    #[test]
    fn daily_limits_cap_reviews_and_report_the_goal() {
        let mut deck = sample_deck(0.0);
        deck.options.review_cap = 2;
        deck.options.new_lessons_per_day = 1;
        let c = clock();
        let order = ordered_lesson_ids(&deck);
        let mut progress = Progress::new();
        for id in &deck.lessons[&order[0]].note_ids {
            progress.insert(id.clone(), introduce(c));
        }
        let view = deck_view(&deck, &progress, c);
        assert!(view.goal_met);
        assert_eq!(view.due, 2);
        assert_eq!(build_review_queue(&deck, &progress, c).len(), 2);
    }

    #[test]
    fn both_ways_doubles_a_lesson_and_asks_the_reverse() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        let first = deck.units[0].lesson_ids[0].clone();
        let queue = build_lesson_queue(&deck, &Progress::new(), &first, clock());
        assert_eq!(queue.len(), 36);
        let reverse = queue.iter().find(|q| q.card_id.ends_with(":r")).unwrap();
        let ex = make_exercise(&deck, &Progress::new(), &reverse.card_id, false).unwrap();
        assert!(ex.reverse && ex.prompt.starts_with("the "));
        let mut progress = Progress::new();
        progress.insert(reverse.card_id.clone(), CardState { stage: 2, ..introduce(clock()) });
        let options = make_exercise(&deck, &progress, &reverse.card_id, false).unwrap().options.unwrap();
        assert!(options.iter().all(|o| o.starts_with("la ") || o.starts_with("el ")), "{options:?}");
    }

    /// Places between each card and its twin, smallest first.
    fn twin_gaps(queue: &[QueueItem]) -> Vec<usize> {
        let mut gaps = vec![];
        for (i, a) in queue.iter().enumerate() {
            for (j, b) in queue.iter().enumerate().skip(i + 1) {
                if a.card_id != b.card_id && note_of(&a.card_id) == note_of(&b.card_id) {
                    gaps.push(j - i);
                }
            }
        }
        gaps.sort_unstable();
        gaps
    }

    #[test]
    fn spread_twins_keep_apart_in_a_lesson() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        assert_eq!(deck.options.reverse_spacing, "spread");
        let first = deck.units[0].lesson_ids[0].clone();
        let queue = build_lesson_queue(&deck, &Progress::new(), &first, clock());
        assert_eq!(queue.len(), 36);
        // Every forward card is met before any reverse card.
        let first_reverse = queue.iter().position(|q| q.card_id.ends_with(":r")).unwrap();
        let notes = &deck.lessons[&first].note_ids;
        assert!(notes.iter().all(|n| queue.iter().position(|q| &q.card_id == n).unwrap() < first_reverse));
        assert!(twin_gaps(&queue)[0] >= TWIN_GAP, "{:?}", twin_gaps(&queue));
        // Each card is still met, asked and asked again.
        for n in notes {
            assert_eq!(queue.iter().filter(|q| &q.card_id == n).count(), 3);
            assert_eq!(queue.iter().filter(|q| q.card_id == format!("{n}:r")).count(), 3);
        }
    }

    #[test]
    fn together_twins_follow_each_other_as_before() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        deck.options.reverse_spacing = "together".into();
        let first = deck.units[0].lesson_ids[0].clone();
        let queue = build_lesson_queue(&deck, &Progress::new(), &first, clock());
        assert_eq!(queue.len(), 36);
        assert!(twin_gaps(&queue)[0] < TWIN_GAP);
    }

    #[test]
    fn next_day_twins_are_met_among_the_next_days_reviews() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        deck.options.reverse_spacing = "nextDay".into();
        let c = clock();
        let first = deck.units[0].lesson_ids[0].clone();
        let queue = build_lesson_queue(&deck, &Progress::new(), &first, c);
        assert_eq!(queue.len(), 18);
        assert!(queue.iter().all(|q| !q.card_id.ends_with(":r")));
        // Meeting the forward cards finishes the lesson for today, and opens the next.
        let mut progress = Progress::new();
        for n in &deck.lessons[&first].note_ids {
            progress.insert(n.clone(), introduce(c));
        }
        let view = deck_view(&deck, &progress, c);
        assert_eq!(view.lessons[&first].state, "learned");
        assert_ne!(view.next_id.as_deref(), Some(first.as_str()));
        assert!(reverses_to_meet(&deck, &progress, c).is_empty());
        // The next day the reverse cards are met in the review, without starting the lesson again.
        let tomorrow = Clock::new(c.now + DAY_MS, c.tz);
        for card in progress.values_mut() {
            card.due = tomorrow.now + 10.0 * DAY_MS;
        }
        assert_eq!(reverses_to_meet(&deck, &progress, tomorrow).len(), 6);
        assert_eq!(deck_view(&deck, &progress, tomorrow).due, 6);
        let review = build_review_queue(&deck, &progress, tomorrow);
        assert_eq!(review.len(), 18);
        assert!(review.iter().all(|q| q.card_id.ends_with(":r")));
        let r = review[0].card_id.clone();
        assert_eq!(make_exercise(&deck, &progress, &r, false).unwrap().kind, "meet");
        progress.insert(r.clone(), introduce(tomorrow));
        assert_eq!(lessons_started_today(&deck, &progress, tomorrow), 0);
    }

    #[test]
    fn twins_due_the_same_day_are_asked_one_a_day() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        let c = clock();
        let first = deck.units[0].lesson_ids[0].clone();
        let note = deck.lessons[&first].note_ids[0].clone();
        let mut progress = Progress::new();
        progress.insert(note.clone(), CardState { due: c.now - 2.0 * DAY_MS, ..introduce(c) });
        progress.insert(format!("{note}:r"), CardState { due: c.now - DAY_MS, ..introduce(c) });
        assert_eq!(due_cards(&deck, &progress, c), vec![note.clone()]);
        assert_eq!(deck_view(&deck, &progress, c).due, 1);
        // Answering one keeps the other for another day.
        let done = apply_outcome(&progress[&note], &Outcome { correct: true, assisted: true, saw_red: false, ms: 4000.0, ai_graded: false }, c, 5);
        progress.insert(note.clone(), done.card);
        assert!(due_cards(&deck, &progress, c).is_empty());
        deck.options.reverse_spacing = "together".into();
        assert_eq!(due_cards(&deck, &progress, c), vec![format!("{note}:r")]);
    }

    #[test]
    fn sentences_are_built_from_tiles_in_the_first_stages() {
        let mut deck = sample_deck(0.0);
        let first = deck.units[0].lesson_ids[0].clone();
        let id = deck.lessons[&first].note_ids[0].clone();
        deck.notes.get_mut(&id).unwrap().back = "I would like an apple".into();
        let mut progress = Progress::new();
        progress.insert(id.clone(), introduce(clock()));
        let ex = make_exercise(&deck, &progress, &id, false).unwrap();
        assert_eq!(ex.kind, "build");
        assert!(!ex.options.as_ref().unwrap().contains(&ex.answer));
        // Not for this card, not for this deck, and not once it is typed.
        deck.notes.get_mut(&id).unwrap().no_build = true;
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().kind, "choice");
        deck.notes.get_mut(&id).unwrap().no_build = false;
        deck.options.build_sentences = false;
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().kind, "choice");
        deck.options.build_sentences = true;
        progress.get_mut(&id).unwrap().stage = 3;
        assert_eq!(make_exercise(&deck, &progress, &id, false).unwrap().kind, "typed");
    }

    #[test]
    fn practice_picks_tricky_unit_or_weakest_cards() {
        let deck = sample_deck(0.0);
        let c = clock();
        let mut progress = Progress::new();
        for (i, id) in deck.notes.keys().enumerate() {
            progress.insert(id.clone(), CardState { stage: (i % 5) as u8 + 1, lapses: (i % 4) as u32, ..introduce(c) });
        }
        let tricky = build_practice_queue(&deck, &progress, "tricky", "");
        assert!(!tricky.is_empty() && tricky.iter().all(|q| progress[&q.card_id].lapses >= TRICKY_LAPSES));
        let unit = build_practice_queue(&deck, &progress, "unit", &deck.units[1].id);
        assert_eq!(unit.len(), 18);
        let cram = build_practice_queue(&deck, &progress, "cram", "");
        assert_eq!(cram.len(), MAX_PRACTICE);
        assert_eq!(progress[&cram[0].card_id].stage, 1);
        let stats = deck_stats(&deck, &progress, c);
        assert_eq!(stats.introduced, 36);
        assert_eq!(stats.forecast[0], 36);
    }

    #[test]
    fn a_picture_answer_is_still_picked_at_stage_three() {
        let rows: Vec<crate::model::RawNote> = [("kedi", "(picture)", vec!["cat.png"]), ("köpek", "(picture)", vec!["dog.png"]), ("su", "water", vec![]), ("ev", "house", vec![])]
            .iter()
            .map(|(f, b, am)| serde_json::from_value(serde_json::json!({"front": f, "back": b, "amedia": am})).unwrap())
            .collect();
        let deck = crate::split::build_deck("Pictures", &rows, &serde_json::from_str("{\"lessonSize\":8}").unwrap(), 0.0);
        let id = |front: &str| deck.notes.values().find(|n| n.front == front).unwrap().id.clone();
        let mut progress = Progress::new();
        for f in ["kedi", "su"] {
            progress.insert(id(f), CardState { stage: 3, ..introduce(clock()) });
        }
        let cat = make_exercise(&deck, &progress, &id("kedi"), false).unwrap();
        assert_eq!(cat.kind, "choice");
        assert_eq!(cat.answer, "[[picture:cat.png]]");
        assert!(cat.options.unwrap().contains(&"[[picture:dog.png]]".to_string()));
        assert_eq!(make_exercise(&deck, &progress, &id("su"), false).unwrap().kind, "typed");
    }

    #[test]
    fn reading_cards_wait_for_a_firm_meaning_or_start_together() {
        let rows: Vec<crate::model::RawNote> = [("勉強[べんきょう]", "study"), ("学校[がっこう]", "school"), ("先生[せんせい]", "teacher"), ("水", "water")]
            .iter()
            .map(|(f, b)| serde_json::from_value(serde_json::json!({"front": f, "back": b})).unwrap())
            .collect();
        let mut deck = crate::split::build_deck("Japanese", &rows, &serde_json::from_str("{\"lessonSize\":8}").unwrap(), 0.0);
        let id = |front: &str| deck.notes.values().find(|n| n.front == front).unwrap().id.clone();
        let lesson = deck.units[0].lesson_ids[0].clone();
        let c = clock();
        // Off: no reading cards at all.
        assert!(build_lesson_queue(&deck, &Progress::new(), &lesson, c).iter().all(|q| !q.card_id.ends_with(":k")));
        // From the start: one per note with readings, after the cards they read.
        deck.options.look.reading_cards = "start".into();
        let q = build_lesson_queue(&deck, &Progress::new(), &lesson, c);
        let reading: std::collections::BTreeSet<_> = q.iter().filter(|x| x.card_id.ends_with(":k")).map(|x| x.card_id.clone()).collect();
        assert_eq!(reading.len(), 3);
        assert!(!reading.contains(&format!("{}:k", id("水"))));
        // After the meaning is firm: not in the lesson, met among reviews once firm.
        deck.options.look.reading_cards = "firm".into();
        assert!(build_lesson_queue(&deck, &Progress::new(), &lesson, c).iter().all(|q| !q.card_id.ends_with(":k")));
        let mut progress = Progress::new();
        progress.insert(id("勉強[べんきょう]"), CardState { stage: 4, due: c.now + 5.0 * DAY_MS, ..introduce(c) });
        progress.insert(id("学校[がっこう]"), CardState { stage: 3, due: c.now + 5.0 * DAY_MS, ..introduce(c) });
        assert_eq!(reverses_to_meet(&deck, &progress, c), vec![format!("{}:k", id("勉強[べんきょう]"))]);
        let k = format!("{}:k", id("勉強[べんきょう]"));
        assert!(build_review_queue(&deck, &progress, c).iter().any(|q| q.card_id == k));
        // Picked from near readings at first, typed from Firm recall.
        progress.insert(k.clone(), CardState { stage: 2, ..introduce(c) });
        let ex = make_exercise(&deck, &progress, &k, false).unwrap();
        assert_eq!((ex.kind, ex.prompt.as_str(), ex.answer.as_str(), ex.kana), ("choice", "勉強", "べんきょう", true));
        assert!(ex.options.unwrap().len() >= 4);
        progress.insert(k.clone(), CardState { stage: 3, ..introduce(c) });
        assert_eq!(make_exercise(&deck, &progress, &k, false).unwrap().kind, "typed");
        // The meaning card accepts the word written with or without kanji.
        let meaning = make_exercise(&deck, &progress, &id("勉強[べんきょう]"), false).unwrap();
        assert_eq!(crate::text::check_answer("ベンキョウ", &crate::text::accepted_answers(&deck.notes[&id("勉強[べんきょう]")].front, &[]), false), crate::text::Verdict::Correct);
        assert_eq!(meaning.prompt, "勉強[べんきょう]");
    }
}
