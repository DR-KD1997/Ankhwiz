//! One entry point for every shell. A call is a JSON object with a `cmd`,
//! the current time (`now`, in milliseconds) and the device's offset from
//! UTC (`tz`, in minutes); the answer is `{"ok": …}` or `{"err": "…"}`.

use crate::ai::{self, AiRequest, Message, Provider};
use crate::model::{CardState, Clock, Deck, DeckOptions, Outcome, Progress, RawNote, Streak};
use crate::session::{self, QueueItem};
use crate::split::{self, BuildOptions};
use crate::text::accepted_answers;
use crate::{anki, cards, distract, edit, occlusion, rng, sample, stages, testout, text};
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn arg<T: DeserializeOwned>(v: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(v.get(name).cloned().unwrap_or(Value::Null)).map_err(|e| format!("bad `{name}`: {e}"))
}

fn opt<T: DeserializeOwned + Default>(v: &Value, name: &str) -> T {
    v.get(name).cloned().and_then(|x| serde_json::from_value(x).ok()).unwrap_or_default()
}

// ---------- reading decks and progress once ----------
//
// Most calls carry a whole deck and its progress, which for a large deck is
// megabytes of JSON. The core keeps the last few it read, with their exact
// text, and reuses one when the same text arrives again: any change to a deck
// changes its text, so a kept deck is never stale.

const KEEP: usize = 3;

struct Kept<T> {
    text: String,
    value: Rc<T>,
}

thread_local! {
    static DECKS: RefCell<Vec<Kept<Deck>>> = const { RefCell::new(Vec::new()) };
    static PROGRESS: RefCell<Vec<Kept<Progress>>> = const { RefCell::new(Vec::new()) };
}

fn kept<T: DeserializeOwned>(store: &'static std::thread::LocalKey<RefCell<Vec<Kept<T>>>>, text: &str) -> Result<Rc<T>, serde_json::Error> {
    if let Some(hit) = store.with(|s| {
        let mut s = s.borrow_mut();
        let i = s.iter().position(|k| k.text == text)?;
        let k = s.remove(i);
        let value = k.value.clone();
        s.insert(0, k);
        Some(value)
    }) {
        return Ok(hit);
    }
    let value = Rc::new(serde_json::from_str::<T>(text)?);
    store.with(|s| {
        let mut s = s.borrow_mut();
        s.insert(0, Kept { text: text.to_string(), value: value.clone() });
        s.truncate(KEEP);
    });
    Ok(value)
}

/// The arguments of one call: big ones (`deck`, `progress`) kept as text until
/// needed, the rest as ordinary JSON values.
struct Call<'a> {
    raw: &'a serde_json::Map<String, Value>,
    deck: Option<&'a RawValue>,
    progress: Option<&'a RawValue>,
}

impl Call<'_> {
    fn deck(&self) -> Result<Rc<Deck>, String> {
        let text = self.deck.map(RawValue::get).unwrap_or("null");
        kept(&DECKS, text).map_err(|e| format!("bad `deck`: {e}"))
    }
    /// Missing or unreadable progress counts as none, as before.
    fn progress(&self) -> Rc<Progress> {
        match self.progress {
            Some(raw) => kept(&PROGRESS, raw.get()).unwrap_or_default(),
            None => Rc::default(),
        }
    }
    fn owned_deck(&self) -> Result<Deck, String> {
        Ok((*self.deck()?).clone())
    }
}

fn out<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn run(c: &Call) -> Result<Value, String> {
    let v = &Value::Object(c.raw.clone());
    let cmd = v.get("cmd").and_then(Value::as_str).ok_or("missing `cmd`")?;
    let clock = Clock::new(opt::<f64>(v, "now"), opt::<f64>(v, "tz"));
    match cmd {
        "version" => out(VERSION),
        "seed" => {
            rng::seed(opt::<f64>(v, "seed") as u64 ^ (clock.now as u64).rotate_left(21));
            out(true)
        }
        "limits" => out(json!({
            "minLesson": split::MIN_LESSON, "maxLesson": split::MAX_LESSON, "defaultLesson": split::DEFAULT_LESSON,
            "reviewFirstAt": session::REVIEW_FIRST_AT,
            "stageNames": (1..=5).map(stages::stage_name).collect::<Vec<_>>(),
        })),

        // ----- answers -----
        "liveFeedback" => out(text::live_feedback(&opt::<String>(v, "typed"), &arg::<Vec<String>>(v, "accepted")?, opt(v, "strict")).as_str()),
        "checkAnswer" => out(text::check_answer(&opt::<String>(v, "typed"), &arg::<Vec<String>>(v, "accepted")?, opt(v, "strict")).as_str()),

        // ----- decks -----
        "sampleDeck" => out(sample::sample_deck(clock.now)),
        "buildDeck" => out(split::build_deck(&arg::<String>(v, "name")?, &arg::<Vec<RawNote>>(v, "rows")?, &opt::<BuildOptions>(v, "options"), clock.now)),
        "resplit" => out(split::resplit(&*c.deck()?, &*c.progress(), arg(v, "lessonSize")?)),
        "addNotes" => {
            let mut deck: Deck = c.owned_deck()?;
            let ids = split::add_notes(&mut deck, &arg::<String>(v, "unit")?, &arg::<Vec<RawNote>>(v, "rows")?, opt(v, "ai"));
            out(json!({ "deck": deck, "noteIds": ids }))
        }
        "lessonTags" => {
            let deck = c.deck()?;
            let tags: std::collections::BTreeMap<&String, String> =
                deck.notes.keys().filter_map(|id| Some((id, split::lesson_tag(&deck, id)?))).collect();
            out(tags)
        }
        "deckView" => out(session::deck_view(&*c.deck()?, &*c.progress(), clock)),
        "noteLessons" => out(distract::index_deck(&*c.deck()?).lesson_of),
        "deckStats" => out(session::deck_stats(&*c.deck()?, &*c.progress(), clock)),
        "defaultOptions" => out(DeckOptions::default()),
        "applyEdits" => {
            let mut deck: Deck = c.owned_deck()?;
            let done = edit::apply(&mut deck, &arg::<Vec<edit::Edit>>(v, "edits")?, opt(v, "ai"));
            out(json!({ "deck": deck, "added": done.added, "removed": done.removed, "skipped": done.skipped }))
        }
        // Progress entries whose card no longer exists (deleted notes, a direction switched off) are kept,
        // so switching back restores them; this lists the cards of a note for the editor.
        "noteCards" => {
            let deck = c.deck()?;
            let id: String = arg(v, "noteId")?;
            out(deck.notes.get(&id).map(|n| cards::cards_of(&deck, n)).unwrap_or_default())
        }
        "clozeNumbers" => out(cards::cloze_numbers(&opt::<String>(v, "text"))),
        "clozeFull" => out(cards::cloze_full(&opt::<String>(v, "text"))),
        "ankiImport" => {
            let (deck, progress) = anki::build_with_progress(&arg::<String>(v, "name")?, &arg::<Vec<RawNote>>(v, "rows")?, &opt::<BuildOptions>(v, "options"), opt(v, "crt"), clock);
            out(json!({ "deck": deck, "progress": progress }))
        }
        "parseOcclusion" => out(occlusion::parse(&opt::<String>(v, "field"), &opt::<String>(v, "image"))),
        "testOutQuestions" => out(testout::questions(&*c.deck()?, &arg::<String>(v, "unitId")?)),
        "canTestOut" => out(testout::can_test_out(&*c.deck()?, &*c.progress(), &arg::<String>(v, "unitId")?)),
        "testOutApply" => out(testout::apply(&*c.deck()?, &*c.progress(), &arg::<String>(v, "unitId")?, &arg::<Vec<testout::Answer>>(v, "answers")?, clock)),
        "ankiExport" => out(anki::export(&*c.deck()?, &*c.progress(), opt(v, "withProgress"), clock)),

        // ----- sessions -----
        "lessonQueue" => out(session::build_lesson_queue(&*c.deck()?, &*c.progress(), &arg::<String>(v, "lessonId")?, clock)),
        "reviewQueue" => out(session::build_review_queue(&*c.deck()?, &*c.progress(), clock)),
        "practiceQueue" => out(session::build_practice_queue(&*c.deck()?, &*c.progress(), &opt::<String>(v, "mode"), &opt::<String>(v, "unitId"))),
        "exercise" => out(session::make_exercise(&*c.deck()?, &*c.progress(), &arg::<String>(v, "cardId")?, opt(v, "justMet"))),
        "requeue" => out(session::requeue(&arg::<Vec<QueueItem>>(v, "queue")?, arg(v, "index")?, &arg::<String>(v, "cardId")?)),
        "introduce" => out(stages::introduce(clock)),
        "grade" => {
            let card: Option<CardState> = opt(v, "card");
            let card = card.unwrap_or_else(|| stages::introduce(clock));
            let options: DeckOptions = opt(v, "options");
            let a = stages::apply_with(&card, &arg::<Outcome>(v, "outcome")?, clock, opt::<f64>(v, "answerLength") as usize, &options);
            out(json!({ "card": a.card, "grade": a.grade.as_str(), "promoted": a.promoted, "demoted": a.demoted }))
        }
        "streakAfter" => out(session::streak_after(&opt::<Streak>(v, "streak"), clock)),
        "currentStreak" => out(session::current_streak(&opt::<Streak>(v, "streak"), clock)),
        "today" => out(clock.day()),

        // ----- AI -----
        "aiPresets" => out(ai::presets()),
        "aiRequest" => {
            let deck = c.deck()?;
            let task: String = arg(v, "task")?;
            let s = |name: &str| opt::<String>(v, name);
            let n = |name: &str, default: usize| v.get(name).and_then(Value::as_u64).map(|x| x as usize).unwrap_or(default);
            out(match task.as_str() {
                "cards" => ai::cards_request(&deck, &s("source"), &s("topic"), n("count", 10)),
                "lessons" => ai::lessons_request(&deck),
                "improve" => ai::improve_request(&deck, &arg::<Vec<String>>(v, "noteIds")?),
                "explain" => ai::explain_request(&deck, &s("noteId"), &s("given")),
                "chat" => ai::chat_request(&deck, &opt::<Vec<Message>>(v, "history"), &s("question")),
                "challenge" => ai::challenge_request(&deck, &*c.progress(), n("count", 5)),
                "grade" => ai::grade_request(&deck, &s("noteId"), &s("given")),
                "reading" => ai::reading_request(&deck, &s("topic"), &s("passage"), n("count", 4)),
                "edit" => ai::edit_request(&deck, &s("scope"), &s("instruction")),
                other => return Err(format!("unknown AI task `{other}`")),
            })
        }
        "aiHttp" => out(ai::http_request(&arg::<Provider>(v, "provider")?, &arg::<AiRequest>(v, "request")?)?),
        "aiModelsHttp" => out(ai::models_request(&arg::<Provider>(v, "provider")?)?),
        "aiModels" => out(ai::models_reply(opt::<f64>(v, "status") as u16, &opt::<String>(v, "body"))?),
        "aiReply" => {
            let text = ai::chat_reply(opt::<f64>(v, "status") as u16, &opt::<String>(v, "body"))?;
            let task: String = arg(v, "task")?;
            match task.as_str() {
                "explain" | "chat" => out(text),
                "challenge" => out(ai::parse_challenge(&text)?),
                "grade" => out(ai::parse_grade(&text)?),
                "reading" => out(ai::parse_reading(&text, &opt::<String>(v, "passage"))?),
                "edit" => out(ai::parse_edits(&*c.deck()?, &opt::<String>(v, "scope"), &text)?),
                "cards" => out(ai::parse_cards(&*c.deck()?, &text)?),
                "lessons" => out(ai::parse_lessons(&*c.deck()?, &text)?),
                "improve" => out(ai::parse_improve(&*c.deck()?, &arg::<Vec<String>>(v, "noteIds")?, &text)?),
                other => Err(format!("unknown AI task `{other}`")),
            }
        }
        "accepted" => out(accepted_answers(&arg::<String>(v, "back")?, &opt::<Vec<String>>(v, "alts"))),
        other => Err(format!("unknown command `{other}`")),
    }
}

/// Run one call. Never panics on bad input: errors come back as `{"err": …}`.
pub fn call(input: &str) -> String {
    let result = serde_json::from_str::<std::collections::HashMap<&str, &RawValue>>(input)
        .map_err(|e| format!("bad call: {e}"))
        .and_then(|fields| {
            let mut raw = serde_json::Map::new();
            for (k, val) in fields.iter() {
                if *k != "deck" && *k != "progress" {
                    raw.insert(k.to_string(), serde_json::from_str::<Value>(val.get()).map_err(|e| format!("bad `{k}`: {e}"))?);
                }
            }
            run(&Call { raw: &raw, deck: fields.get("deck").copied(), progress: fields.get("progress").copied() })
        });
    match result {
        Ok(ok) => json!({ "ok": ok }).to_string(),
        Err(err) => json!({ "err": err }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(input: Value) -> Value {
        let reply: Value = serde_json::from_str(&call(&input.to_string())).unwrap();
        assert!(reply.get("err").is_none(), "{reply}");
        reply["ok"].clone()
    }

    #[test]
    fn a_lesson_runs_end_to_end_through_the_json_api() {
        let now = 1_794_300_000_000.0f64;
        ok(json!({"cmd":"seed","seed":42,"now":now}));
        let deck = ok(json!({"cmd":"sampleDeck","now":now}));
        let lesson = deck["units"][0]["lessonIds"][0].clone();
        let queue = ok(json!({"cmd":"lessonQueue","deck":deck,"progress":{},"lessonId":lesson,"now":now,"tz":120}));
        let mut progress = json!({});
        let mut graded = 0;
        for item in queue.as_array().unwrap() {
            let id = item["cardId"].as_str().unwrap();
            let ex = ok(json!({"cmd":"exercise","deck":deck,"progress":progress,"cardId":id,"now":now,"tz":120}));
            if ex["kind"] == "meet" {
                progress[id] = ok(json!({"cmd":"introduce","now":now,"tz":120}));
            } else {
                assert_eq!(ex["kind"], "choice");
                let r = ok(json!({"cmd":"grade","card":progress[id],"outcome":{"correct":true,"assisted":true,"ms":2000},"answerLength":9,"now":now,"tz":120}));
                progress[id] = r["card"].clone();
                graded += 1;
            }
        }
        assert_eq!(graded, 12);
        let view = ok(json!({"cmd":"deckView","deck":deck,"progress":progress,"now":now,"tz":120}));
        assert_eq!(view["introduced"], 6);
        assert_eq!(view["lessons"][lesson.as_str().unwrap()]["state"], "learned");
        assert_eq!(view["stages"][1], 6);
    }

    #[test]
    fn a_kept_deck_is_reused_only_while_its_text_is_unchanged() {
        let now = 1_794_300_000_000.0f64;
        let mut deck = ok(json!({"cmd":"sampleDeck","now":now}));
        let first = ok(json!({"cmd":"deckView","deck":deck,"progress":{},"now":now,"tz":120}));
        let again = ok(json!({"cmd":"deckView","deck":deck,"progress":{},"now":now,"tz":120}));
        assert_eq!(first, again);
        // A changed deck is read afresh: drop a lesson's notes and the total falls.
        let lesson = deck["units"][0]["lessonIds"][0].as_str().unwrap().to_string();
        let gone = deck["lessons"][&lesson]["noteIds"].as_array().unwrap().len();
        deck["lessons"][&lesson]["noteIds"] = json!([]);
        let changed = ok(json!({"cmd":"deckView","deck":deck,"progress":{},"now":now,"tz":120}));
        assert_eq!(changed["total"].as_u64().unwrap() + gone as u64, first["total"].as_u64().unwrap());
        // Progress too: a card met shows straight away.
        let id = deck["notes"].as_object().unwrap().keys().next().unwrap().clone();
        let card = ok(json!({"cmd":"introduce","now":now,"tz":120}));
        let met = ok(json!({"cmd":"deckView","deck":deck,"progress":{id: card},"now":now,"tz":120}));
        assert_eq!(met["introduced"], 1);
        // Calls without a deck still fail as before.
        let reply: Value = serde_json::from_str(&call(r#"{"cmd":"deckView"}"#)).unwrap();
        assert!(reply["err"].is_string());
    }

    #[test]
    fn bad_calls_report_an_error_instead_of_failing() {
        for input in ["not json", "{}", r#"{"cmd":"nope"}"#, r#"{"cmd":"exercise"}"#] {
            let reply: Value = serde_json::from_str(&call(input)).unwrap();
            assert!(reply["err"].is_string(), "{input}");
        }
    }

    #[test]
    fn an_ai_round_trip_goes_request_http_reply() {
        let deck = ok(json!({"cmd":"sampleDeck"}));
        let req = ok(json!({"cmd":"aiRequest","task":"challenge","deck":deck,"count":3}));
        let http = ok(json!({"cmd":"aiHttp","provider":{"baseUrl":"http://localhost:1234/v1","fastModel":"m"},"request":req}));
        assert_eq!(http["url"], "http://localhost:1234/v1/chat/completions");
        let content = r#"{"questions":[{"question":"Q","options":["a","b","c","d"],"answer":1,"why":"w"}]}"#;
        let body = json!({"choices":[{"message":{"content":content}}]}).to_string();
        let parsed = ok(json!({"cmd":"aiReply","task":"challenge","status":200,"body":body}));
        assert_eq!(parsed[0]["answer"], 1);
    }
}
