//! Data shapes. Field names are camelCase in JSON so the interface and saved
//! files read naturally.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const DAY_MS: f64 = 86_400_000.0;

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// What the learner is shown.
    pub front: String,
    /// The answer the learner must produce.
    pub back: String,
    /// Other answers that also count as correct.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alts: Vec<String>,
    /// Hand-set wrong options; these take priority in multiple choice.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wrong: Vec<String>,
    /// True when AI wrote or changed this note, so errors can be traced.
    #[serde(default, skip_serializing_if = "is_false")]
    pub ai: bool,
    /// Shown after answering: an example, a note, a mnemonic.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub extra: String,
    /// The learner's own labels (Anki tags), for filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    /// Media files shown with the question, and with the answer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub qmedia: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub amedia: Vec<String>,
    /// Fill-the-gap note: `front` holds text with {{c1::gaps}} and `back` is unused.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cloze: bool,
    /// What an imported note looked like in Anki, kept so export can give it back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anki: Option<AnkiNote>,
    /// More question fields, shown under the question in smaller type.
    /// The first question field (`front`) is the one swapped with the answer
    /// when a deck is asked both ways.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub front_more: Vec<String>,
    /// More extra fields, shown after `extra`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_more: Vec<String>,
    /// The learner checks this card themselves: the answer is shown and they
    /// say how close they were. For cards the app cannot mark.
    #[serde(default, skip_serializing_if = "is_false")]
    pub self_check: bool,
    /// A picture with hidden parts: one card per hidden part number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occlusion: Option<Occlusion>,
}

/// A picture with hidden parts (Anki: Image Occlusion).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Occlusion {
    /// Media file name of the picture.
    pub image: String,
    pub shapes: Vec<Shape>,
    /// Hide every part while asking about one (Anki: "Hide all, guess one").
    /// Otherwise only the part asked about is hidden.
    #[serde(default)]
    pub hide_all: bool,
}

/// One hidden part. Positions are fractions of the picture's width and height.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    /// Part number: shapes with the same number are asked together.
    pub ord: u32,
    /// rect, ellipse or polygon.
    pub kind: String,
    pub left: f64,
    pub top: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    /// Polygon corners as fractions, x then y.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<[f64; 2]>,
    /// The name of the part. With names the app can ask and mark the part;
    /// without, the learner checks it themselves.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNote {
    pub guid: String,
    /// Note type id, a key of `Deck::anki.notetypes`.
    pub ntid: String,
    /// Every field as Anki stored it, with its markup.
    pub fields: Vec<String>,
    /// Question, answer and extra as first imported, to tell whether they were edited since.
    #[serde(default)]
    pub seen: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiTemplate {
    pub name: String,
    pub qfmt: String,
    pub afmt: String,
}

/// An Anki note type, kept from import for export.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNotetype {
    pub id: String,
    pub name: String,
    /// True for Anki's cloze kind.
    #[serde(default)]
    pub cloze: bool,
    pub fields: Vec<String>,
    pub templates: Vec<AnkiTemplate>,
    #[serde(default)]
    pub css: String,
    /// Which fields became question, answer and extra.
    pub question: usize,
    pub answer: usize,
    #[serde(default)]
    pub extra: Option<usize>,
    /// More fields shown with the question, and after the extra.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub question_more: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_more: Vec<usize>,
    /// Anki's Image Occlusion kind.
    #[serde(default, skip_serializing_if = "is_false")]
    pub occlusion: bool,
    /// Ask this type's cards both ways. Unset: follow the deck's Ask both ways
    /// (decks from before 0.4.1 had one setting for every card).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub both_ways: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiDeck {
    #[serde(default)]
    pub notetypes: BTreeMap<String, AnkiNotetype>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    /// Text size: s, m or l.
    pub size: String,
    /// default, serif, rounded or mono.
    pub font: String,
    /// Force right-to-left text (otherwise each text picks its own direction).
    pub rtl: bool,
    /// Show Extra before answering, as a hint.
    pub hint_extra: bool,
    /// Language for reading the question field aloud, such as es-ES. Empty: the device's own.
    pub lang: String,
    /// Language for the answer field, when it differs from the question's. Empty: the same.
    #[serde(default)]
    pub lang_back: String,
    /// Reading aloud: "on" shows a speaker button by the question and the
    /// answer (and lets Settings read them by itself); "off" hides them.
    /// Decks from before 0.4.1 may say "question" or "answer", meaning on.
    pub speak: String,
}

impl Default for Look {
    fn default() -> Self {
        Self { size: "m".into(), font: "default".into(), rtl: false, hint_extra: false, lang: String::new(), lang_back: String::new(), speak: "off".into() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DeckOptions {
    /// New lessons to start per day; 0 means no limit. The goal can always be passed.
    pub new_lessons_per_day: u32,
    /// Reviews offered per day.
    pub review_cap: u32,
    /// Share of cards to remember at review time: higher means more reviews.
    pub retention: f64,
    /// Ask cards both ways: question to answer, and answer to question. Applies
    /// to cards made in Ankhwiz, and to Anki note types without a setting of their own.
    pub both_ways: bool,
    /// Longest gap between reviews, in days.
    pub max_interval: u32,
    /// Separate days with a counted correct answer needed to leave stages 2, 3 and 4.
    pub stage_days: [usize; 3],
    pub look: Look,
}

impl Default for DeckOptions {
    fn default() -> Self {
        Self {
            new_lessons_per_day: 2,
            review_cap: 100,
            retention: 0.9,
            both_ways: false,
            max_interval: 36500,
            stage_days: [2, 2, 2],
            look: Look::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub name: String,
    pub note_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub id: String,
    pub name: String,
    pub lesson_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingQuestion {
    pub question: String,
    pub options: Vec<String>,
    /// Index of the correct option.
    pub answer: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub id: String,
    pub title: String,
    pub passage: String,
    pub questions: Vec<ReadingQuestion>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub ai: bool,
    /// Best score so far, as correct answers.
    #[serde(default)]
    pub best: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: String,
    pub name: String,
    /// Optional question wording; `{front}` is replaced by the note's front.
    #[serde(default)]
    pub prompt: Option<String>,
    pub notes: BTreeMap<String, Note>,
    pub lessons: BTreeMap<String, Lesson>,
    pub units: Vec<Unit>,
    pub lesson_size: usize,
    #[serde(default)]
    pub strict_accents: bool,
    #[serde(default)]
    pub created: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub readings: Vec<Reading>,
    #[serde(default)]
    pub options: DeckOptions,
    /// Note types from an Anki import, kept for export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anki: Option<AnkiDeck>,
}

/// What the scheduler remembers about a card.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub stability: f64,
    pub difficulty: f64,
    /// Day of the last review, as a local day number.
    pub last_day: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CardState {
    pub stage: u8,
    /// Local day numbers with a counted correct answer at the current stage.
    #[serde(default)]
    pub ok_days: Vec<i64>,
    /// True after a wrong answer dropped the card a stage.
    #[serde(default)]
    pub demoted: bool,
    #[serde(default)]
    pub lapses: u32,
    #[serde(default)]
    pub reps: u32,
    /// When the card is next due, in milliseconds.
    pub due: f64,
    #[serde(default)]
    pub mem: Option<Memory>,
    /// "Stop asking this one" (Anki: suspend).
    #[serde(default, skip_serializing_if = "is_false")]
    pub suspended: bool,
    /// "Skip for today" (Anki: bury): the local day it was skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buried: Option<i64>,
    /// Local day the card was first met.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added: Option<i64>,
    /// Recent answers, newest last.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hist: Vec<Seen>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Seen {
    pub day: i64,
    pub ok: bool,
    /// Stage the card was at when answered.
    pub stage: u8,
}

pub const HISTORY: usize = 30;

/// Progress for one deck: only introduced notes have an entry.
pub type Progress = BTreeMap<String, CardState>;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Streak {
    pub count: u32,
    /// Local day number of the last finished session.
    pub last: Option<i64>,
    pub best: u32,
    /// Local days with a finished session, for the calendar.
    #[serde(default)]
    pub days: Vec<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default)]
    pub decks: BTreeMap<String, Deck>,
    #[serde(default)]
    pub progress: BTreeMap<String, Progress>,
    #[serde(default)]
    pub streak: Streak,
}

/// The moment a call is made: time and the device's offset from UTC.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    /// Milliseconds since 1970 UTC.
    pub now: f64,
    /// Minutes east of UTC.
    pub tz: f64,
}

impl Clock {
    pub fn new(now: f64, tz: f64) -> Self {
        Self { now, tz }
    }

    fn local(&self) -> f64 {
        self.now + self.tz * 60_000.0
    }

    /// Local calendar day as a running number.
    pub fn day(&self) -> i64 {
        (self.local() / DAY_MS).floor() as i64
    }

    /// The first millisecond of a local day.
    pub fn start_of(&self, day: i64) -> f64 {
        day as f64 * DAY_MS - self.tz * 60_000.0
    }

    pub fn start_of_tomorrow(&self) -> f64 {
        self.start_of(self.day() + 1)
    }

    pub fn end_of_today(&self) -> f64 {
        self.start_of_tomorrow() - 1.0
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawNote {
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub alts: Vec<String>,
    /// Subdeck or tag used to group notes into units.
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub extra: String,
    #[serde(default)]
    pub wrong: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub qmedia: Vec<String>,
    #[serde(default)]
    pub amedia: Vec<String>,
    #[serde(default)]
    pub cloze: bool,
    #[serde(default)]
    pub anki: Option<AnkiNote>,
    /// Lesson name, when the note says which lesson it belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lesson: Option<String>,
    /// Scheduling of the note's cards in Anki, turned into progress on import.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sched: Vec<AnkiSched>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub front_more: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_more: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub self_check: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occlusion: Option<Occlusion>,
}

/// One Anki card's scheduling, as stored in its collection.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AnkiSched {
    pub ord: u32,
    /// 0 new, 1 learning, 2 review, 3 relearning.
    pub ctype: i32,
    /// -3/-2 buried, -1 suspended, 0 new, 1 learning, 2 review, 3 day learning.
    pub queue: i32,
    pub due: i64,
    pub ivl: i64,
    pub reps: u32,
    pub lapses: u32,
    /// The card's `data` column: FSRS memory and custom data, as JSON.
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub correct: bool,
    /// Help was given: options visible, colour feedback, or a spelling retry.
    #[serde(default)]
    pub assisted: bool,
    /// Typed with colour feedback only: the text turned red at some point.
    #[serde(default)]
    pub saw_red: bool,
    /// Time taken to answer, in milliseconds.
    #[serde(default)]
    pub ms: f64,
    /// AI-graded free text may only count as Again or Good.
    #[serde(default)]
    pub ai_graded: bool,
}
