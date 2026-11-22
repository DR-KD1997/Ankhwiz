//! AI features: what to ask a model, and how to read what comes back.
//!
//! The core never talks to the network. It builds a request for any
//! OpenAI-compatible endpoint; the platform shell sends it and hands the
//! reply back to be parsed here. Everything AI writes is returned as a
//! draft for the learner to approve.

use crate::edit::Edit;
use crate::model::{Deck, Progress, RawNote, Reading, ReadingQuestion};
use crate::rng::uid;
use crate::session::ordered_lesson_ids;
use crate::text::{accepted_answers, normalize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

// ---------- providers ----------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Provider {
    /// Address of an OpenAI-compatible API, up to and including its version path.
    pub base_url: String,
    /// The key is held by the device's key storage and passed in per call.
    pub key: String,
    /// Model for quick jobs: explanations, grading, chat.
    pub fast_model: String,
    /// Model for larger jobs: writing cards and passages. Falls back to the fast one.
    pub strong_model: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub needs_key: bool,
    pub note: &'static str,
}

pub fn presets() -> Vec<Preset> {
    vec![
        Preset { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1", needs_key: true, note: "" },
        Preset { id: "gemini", name: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", needs_key: true, note: "Uses Gemini's OpenAI-compatible address." },
        Preset { id: "xai", name: "Grok (xAI)", base_url: "https://api.x.ai/v1", needs_key: true, note: "" },
        Preset { id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", needs_key: true, note: "One key for models from many providers." },
        Preset { id: "ollama", name: "Ollama (this computer)", base_url: "http://localhost:11434/v1", needs_key: false, note: "Runs on your own machine; nothing leaves it." },
        Preset { id: "lmstudio", name: "LM Studio (this computer)", base_url: "http://localhost:1234/v1", needs_key: false, note: "Runs on your own machine; nothing leaves it." },
        Preset { id: "custom", name: "Other endpoint", base_url: "", needs_key: false, note: "Any address that speaks the OpenAI chat format." },
    ]
}

// ---------- requests ----------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub task: String,
    pub messages: Vec<Message>,
    /// The reply must be a JSON object.
    pub json: bool,
    /// Use the stronger model.
    pub strong: bool,
    pub temperature: f64,
    /// Rough size of what will be sent, in tokens, shown before large jobs.
    pub estimate: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: &'static str,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

const PERSONA: &str = "You are Thoth, the scribe who guides learners in the study app Ankhwiz. \
You are calm, precise and encouraging without flattery. Keep answers short and concrete. \
If you are not sure something is true, say so rather than guessing.";

fn estimate(messages: &[Message]) -> usize {
    messages.iter().map(|m| m.content.chars().count()).sum::<usize>().div_ceil(4)
}

fn clip(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

/// The deck as text for a prompt: its path and as many cards as fit.
pub fn deck_context(deck: &Deck, max_chars: usize) -> String {
    let mut out = format!("Deck: {}\n", deck.name);
    let mut left = max_chars;
    let mut skipped = 0usize;
    for unit in &deck.units {
        out.push_str(&format!("\nUnit: {}\n", unit.name));
        for lesson_id in &unit.lesson_ids {
            let Some(lesson) = deck.lessons.get(lesson_id) else { continue };
            out.push_str(&format!("Lesson: {}\n", lesson.name));
            for id in &lesson.note_ids {
                let Some(note) = deck.notes.get(id) else { continue };
                let line = format!("- {} = {}\n", clip(&note.front, 160), clip(&note.back, 240));
                let cost = line.chars().count();
                if cost > left {
                    skipped += 1;
                    continue;
                }
                left -= cost;
                out.push_str(&line);
            }
        }
    }
    if skipped > 0 {
        out.push_str(&format!("\n({skipped} more cards not shown.)\n"));
    }
    out
}

fn sys(extra: &str) -> Message {
    Message { role: "system".into(), content: format!("{PERSONA}\n\n{extra}") }
}

fn user(content: String) -> Message {
    Message { role: "user".into(), content }
}

fn request(task: &str, messages: Vec<Message>, json: bool, strong: bool, temperature: f64) -> AiRequest {
    let estimate = estimate(&messages);
    AiRequest { task: task.to_string(), messages, json, strong, temperature, estimate }
}

const JSON_ONLY: &str = "Reply with one JSON object only, with no text before or after it.";

/// Draft new cards, from pasted source text or from a topic.
pub fn cards_request(deck: &Deck, source: &str, topic: &str, count: usize) -> AiRequest {
    let count = count.clamp(1, 40);
    let style = deck_context(deck, 1500);
    let task = if source.trim().is_empty() {
        format!("Write {count} new flashcards about: {}.", if topic.trim().is_empty() { &deck.name } else { topic.trim() })
    } else {
        format!(
            "Write up to {count} flashcards covering the key facts in the source text below. Use only what the source says.{}\n\nSOURCE:\n{}",
            if topic.trim().is_empty() { String::new() } else { format!(" Focus on: {}.", topic.trim()) },
            clip(source.trim(), 24_000)
        )
    };
    let instructions = format!(
        "You write flashcards for a deck. Match the existing cards in language, direction and style, and do not repeat them. \
Each card has a short `front` (what the learner sees) and a short `back` (the one answer to type, ideally under six words), \
plus optional `alts`: other answers that are equally correct. {JSON_ONLY} \
Shape: {{\"cards\":[{{\"front\":\"…\",\"back\":\"…\",\"alts\":[\"…\"]}}]}}\n\nEXISTING DECK (sample):\n{style}"
    );
    request("cards", vec![sys(&instructions), user(task)], true, true, 0.6)
}

/// Propose a short name for every lesson from the cards in it.
pub fn lessons_request(deck: &Deck) -> AiRequest {
    let mut listing = String::new();
    for (i, id) in ordered_lesson_ids(deck).iter().enumerate() {
        let Some(lesson) = deck.lessons.get(id) else { continue };
        let fronts: Vec<String> = lesson
            .note_ids
            .iter()
            .filter_map(|n| deck.notes.get(n))
            .map(|n| format!("{} = {}", clip(&n.front, 40), clip(&n.back, 40)))
            .collect();
        listing.push_str(&format!("{}: {}\n", i + 1, fronts.join("; ")));
    }
    let instructions = format!(
        "Name each numbered lesson of the deck \"{}\" by what its cards have in common. \
Names are two to four words, in the language of the answers, with no numbering. \
If a lesson has no common theme, name it after its first cards. {JSON_ONLY} \
Shape: {{\"lessons\":[{{\"n\":1,\"name\":\"…\"}}]}}",
        deck.name
    );
    request("lessons", vec![sys(&instructions), user(clip(&listing, 30_000))], true, false, 0.3)
}

/// For chosen cards: more accepted answers, harder wrong options, and a
/// note on any card that is unclear or doubtful.
pub fn improve_request(deck: &Deck, note_ids: &[String]) -> AiRequest {
    let mut listing = String::new();
    for (i, id) in note_ids.iter().take(30).enumerate() {
        let Some(n) = deck.notes.get(id) else { continue };
        listing.push_str(&format!(
            "{}: front: {} | answer: {} | already accepted: {}\n",
            i + 1,
            clip(&n.front, 200),
            clip(&n.back, 200),
            if n.alts.is_empty() { "-".to_string() } else { n.alts.join(", ") }
        ));
    }
    let instructions = format!(
        "Review flashcards from the deck \"{}\". For each numbered card give: \
`alts`: other answers a fair marker would also accept (synonyms, spelling variants), at most 3, often none; \
`wrong`: 3 wrong options for multiple choice that are plausible but clearly incorrect, of the same kind and length as the answer; \
`flag`: one short sentence only if the card is wrong, ambiguous or badly worded, otherwise an empty string. {JSON_ONLY} \
Shape: {{\"notes\":[{{\"n\":1,\"alts\":[],\"wrong\":[\"…\"],\"flag\":\"\"}}]}}",
        deck.name
    );
    request("improve", vec![sys(&instructions), user(listing)], true, true, 0.4)
}

/// Explain one card, in the light of what the learner answered.
pub fn explain_request(deck: &Deck, note_id: &str, given: &str) -> AiRequest {
    // `note_id` may be any card id: a reverse card or a gap is explained as asked.
    let f = crate::cards::face(deck, note_id);
    let (front, back) = f.as_ref().map(|f| (f.prompt.as_str(), f.answer.as_str())).unwrap_or(("", ""));
    let mut ask = format!("Deck: {}\nCard: {front}\nAnswer: {back}\n", deck.name);
    if !given.trim().is_empty() {
        ask.push_str(&format!("I answered: {}\n", clip(given.trim(), 300)));
    }
    ask.push_str("Explain this card so it sticks: why the answer is what it is, and one way to remember it. If I answered wrongly, say what my answer would have meant instead.");
    request("explain", vec![sys("Answer in at most 90 words of plain text, with no headings or lists."), user(ask)], false, false, 0.4)
}

/// A conversation with Thoth, grounded in the open deck.
pub fn chat_request(deck: &Deck, history: &[Message], question: &str) -> AiRequest {
    let grounding = format!(
        "The learner is studying the deck below. Answer questions about its subject. Prefer what the deck says; \
when you go beyond it, say that it is not from the deck. Answer in plain text of at most 150 words unless asked for more.\n\n{}",
        deck_context(deck, 9000)
    );
    let mut messages = vec![sys(&grounding)];
    // Keep the last few turns, to bound the cost of a long conversation.
    let start = history.len().saturating_sub(8);
    for m in &history[start..] {
        if m.role == "user" || m.role == "assistant" {
            messages.push(Message { role: m.role.clone(), content: clip(&m.content, 4000) });
        }
    }
    messages.push(user(clip(question.trim(), 4000)));
    request("chat", messages, false, false, 0.5)
}

/// Fresh questions on the deck's subject that go beyond its cards.
/// Challenge rounds never change the schedule.
pub fn challenge_request(deck: &Deck, progress: &Progress, count: usize) -> AiRequest {
    let count = count.clamp(1, 12);
    // Ground the round in what the learner has already met, when anything has been.
    let mut known = String::new();
    for id in ordered_lesson_ids(deck).iter().flat_map(|l| deck.lessons.get(l).map(|l| l.note_ids.clone()).unwrap_or_default()) {
        if progress.contains_key(&id) {
            if let Some(n) = deck.notes.get(&id) {
                known.push_str(&format!("- {} = {}\n", clip(&n.front, 120), clip(&n.back, 160)));
            }
        }
        if known.chars().count() > 5000 {
            break;
        }
    }
    let material = if known.is_empty() { deck_context(deck, 5000) } else { format!("Deck: {}\n{known}", deck.name) };
    let instructions = format!(
        "Write {count} multiple-choice questions that test the same knowledge as these flashcards in a new way: \
apply it, combine two cards, or use it in context. Do not simply repeat a card. Each question has exactly 4 options, \
one correct; `answer` is the position of the correct option counting from 0; `why` is one sentence. \
Vary the position of the correct option. {JSON_ONLY} \
Shape: {{\"questions\":[{{\"question\":\"…\",\"options\":[\"…\",\"…\",\"…\",\"…\"],\"answer\":0,\"why\":\"…\"}}]}}"
    );
    request("challenge", vec![sys(&instructions), user(material)], true, true, 0.7)
}

/// Judge a freely written answer against the card's answer.
pub fn grade_request(deck: &Deck, note_id: &str, given: &str) -> AiRequest {
    // `note_id` may be any card id: a reverse card or a gap is explained as asked.
    let f = crate::cards::face(deck, note_id);
    let (front, back) = f.as_ref().map(|f| (f.prompt.as_str(), f.answer.as_str())).unwrap_or(("", ""));
    let instructions = format!(
        "Mark a learner's written answer against the expected answer. It is correct if it states the same essential \
content, in any wording; it is wrong if it misses or contradicts a key point. Ignore spelling and style. \
`feedback` is one sentence addressed to the learner. {JSON_ONLY} Shape: {{\"correct\":true,\"feedback\":\"…\"}}"
    );
    let ask = format!("Question: {front}\nExpected answer: {back}\nLearner's answer: {}", clip(given.trim(), 2000));
    request("grade", vec![sys(&instructions), user(ask)], true, false, 0.0)
}

/// A reading passage with questions. With `passage` given, only the
/// questions are written; otherwise the passage is written too.
pub fn reading_request(deck: &Deck, topic: &str, passage: &str, count: usize) -> AiRequest {
    let count = count.clamp(1, 10);
    let shape = "{\"title\":\"…\",\"passage\":\"…\",\"questions\":[{\"question\":\"…\",\"options\":[\"…\",\"…\",\"…\",\"…\"],\"answer\":0}]}";
    let (instructions, ask) = if passage.trim().is_empty() {
        (
            format!(
                "Write a reading passage of 120 to 200 words for a learner of this deck, using its vocabulary and facts where natural \
and written in the language being learned (for a language deck) or about its subject (otherwise). Then write {count} comprehension \
questions that can be answered from the passage alone, each with exactly 4 options and `answer` as the position of the correct one \
counting from 0. {JSON_ONLY} Shape: {shape}\n\n{}",
                deck_context(deck, 4000)
            ),
            if topic.trim().is_empty() { "Choose a fitting topic.".to_string() } else { format!("Topic: {}", clip(topic.trim(), 300)) },
        )
    } else {
        (
            format!(
                "Write {count} comprehension questions that can be answered from the passage alone, each with exactly 4 options and \
`answer` as the position of the correct one counting from 0. Return the passage unchanged in `passage` and give it a short `title`. \
{JSON_ONLY} Shape: {shape}"
            ),
            format!("PASSAGE:\n{}", clip(passage.trim(), 12_000)),
        )
    };
    request("reading", vec![sys(&instructions), user(ask)], true, true, 0.7)
}

/// A short story for a reading round, written mostly in words the learner has
/// studied, with a few new ones, and questions on it.
pub fn story_request(deck: &Deck, known: &[String], count: usize) -> AiRequest {
    let count = count.clamp(1, 6);
    let shape = "{\"title\":\"…\",\"passage\":\"…\",\"questions\":[{\"question\":\"…\",\"options\":[\"…\",\"…\",\"…\"],\"answer\":0}],\"newWords\":[\"…\"]}";
    let mut words: Vec<&str> = known.iter().map(String::as_str).collect();
    words.truncate(600);
    let instructions = format!(
        "Write a short story of 60 to 140 words for a learner of this deck, in the language being learned. Use almost only words from \
the KNOWN list (any grammatical form is fine), plus at most three new words, which you list in `newWords`. Keep sentences short and \
everyday. Then write {count} questions about the story in English, each with exactly 3 options and `answer` as the position of the \
correct one counting from 0. {JSON_ONLY} Shape: {shape}\n\n{}",
        deck_context(deck, 1500)
    );
    let ask = format!("KNOWN:\n{}", clip(&words.join(", "), 6000));
    request("story", vec![sys(&instructions), user(ask)], true, true, 0.8)
}

/// A source as the outline step sees it: its sections' places and openings.
#[derive(serde::Deserialize, Default, Clone)]
#[serde(default)]
pub struct SourceBrief {
    pub id: String,
    pub title: String,
    pub sections: Vec<SectionBrief>,
}

#[derive(serde::Deserialize, Default, Clone)]
#[serde(default)]
pub struct SectionBrief {
    /// Where the section is ("p. 4", "§2 Diffusion").
    pub at: String,
    /// Its opening words.
    pub text: String,
    /// Its length in characters.
    pub size: usize,
}

/// What the learner said before building: what it is for, how much they know, by when.
#[derive(serde::Deserialize, Default, Clone)]
#[serde(default)]
pub struct BuildGoal {
    pub goal: String,
    pub level: String,
    pub days: u32,
    pub notes: String,
}

/// Units and lessons for a new deck, from the shape of its sources.
pub fn outline_request(deck: &Deck, sources: &[SourceBrief], goal: &BuildGoal) -> AiRequest {
    let shape = "{\"units\":[{\"name\":\"…\",\"lessons\":[{\"name\":\"…\",\"from\":[{\"source\":\"s1\",\"at\":\"p. 4\"}],\"kind\":\"qa\",\"cards\":12}]}]}";
    let mut brief = String::new();
    let mut left: usize = 14_000;
    for s in sources {
        brief.push_str(&format!("\nSOURCE {} \"{}\"\n", s.id, clip(&s.title, 120)));
        for sec in &s.sections {
            let line = format!("- [{}] ({} chars) {}\n", clip(&sec.at, 60), sec.size, clip(sec.text.trim(), 220));
            if line.chars().count() > left {
                break;
            }
            left -= line.chars().count();
            brief.push_str(&line);
        }
    }
    let instructions = format!(
        "You plan a flashcard deck from the learner's own sources. Group the material into units (2 to 8) of lessons (each lesson one \
topic, 5 to 30 cards). Follow the order of the sources. For each lesson give `from`: the sections it draws on, by source id and \
section place exactly as given; a `kind`: \"words\" (terms or vocabulary with meanings), \"qa\" (questions and answers), \"dates\" \
(events and years), \"formula\" (formulas and their names) or \"order\" (steps of a process); and `cards`: about how many cards it \
needs. Leave out parts that are not study material (adverts, thanks, contents pages, references). {JSON_ONLY} Shape: {shape}"
    );
    let ask = format!(
        "Deck name: {}\nFor: {}\nAlready knows: {}\nTime: {}\nOther wishes: {}\n{}",
        deck.name,
        if goal.goal.is_empty() { "general study" } else { &goal.goal },
        if goal.level.is_empty() { "unknown" } else { &goal.level },
        if goal.days == 0 { "no deadline".to_string() } else { format!("{} days", goal.days) },
        if goal.notes.trim().is_empty() { "none" } else { goal.notes.trim() },
        brief
    );
    request("outline", vec![sys(&instructions), user(ask)], true, true, 0.4)
}

/// A planned lesson from an outline reply.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLesson {
    pub name: String,
    pub from: Vec<(String, String)>,
    pub kind: String,
    pub cards: usize,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct OutlineUnit {
    pub name: String,
    pub lessons: Vec<OutlineLesson>,
}

pub fn parse_outline(text: &str) -> Result<Vec<OutlineUnit>, String> {
    let v = extract_json(text)?;
    let kinds = ["words", "qa", "dates", "formula", "order"];
    let mut out = Vec::new();
    for u in v["units"].as_array().cloned().unwrap_or_default() {
        let name = text_of(&u["name"]);
        let lessons: Vec<OutlineLesson> = u["lessons"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|l| {
                let name = text_of(&l["name"]);
                if name.is_empty() {
                    return None;
                }
                let from = l["from"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|f| (text_of(&f["source"]), text_of(&f["at"])))
                    .filter(|(s, _)| !s.is_empty())
                    .collect();
                let kind = text_of(&l["kind"]);
                let cards = l["cards"].as_u64().unwrap_or(10).clamp(1, 60) as usize;
                Some(OutlineLesson { name: clip(&name, 80), from, kind: if kinds.contains(&kind.as_str()) { kind } else { "qa".into() }, cards })
            })
            .collect();
        if !lessons.is_empty() {
            out.push(OutlineUnit { name: if name.is_empty() { "Unit".into() } else { clip(&name, 80) }, lessons });
        }
    }
    if out.is_empty() {
        return Err("Thoth did not return a usable outline. Try again.".into());
    }
    Ok(out)
}

/// What the learner asked to change after seeing sample cards.
#[derive(serde::Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CardStyle {
    pub short: bool,
    pub exam: bool,
    pub keep_terms: bool,
    pub notes: String,
}

/// Cards for one lesson from passages of the learner's sources, each citing
/// the sentence it comes from, so the app can check it is really there.
pub fn source_cards_request(deck: &Deck, lesson: &str, kind: &str, count: usize, passages: &str, style: &CardStyle) -> AiRequest {
    let count = count.clamp(1, 40);
    let kind_rule = match kind {
        "words" => "Each card: `front` is the term or word, `back` its meaning in a few words.",
        "dates" => "Each card: `front` is the event, `back` the year or date.",
        "formula" => "Each card: `front` is what the formula gives (its name), `back` the formula written in plain text (E = ½ m v²).",
        "order" => "Each card asks for one step of a process: `front` names the process and step number, `back` the step.",
        _ => "Each card: `front` is a question, `back` its answer.",
    };
    let mut wishes = vec![];
    if style.short {
        wishes.push("Keep answers very short, ideally under five words.");
    }
    if style.exam {
        wishes.push("Phrase questions the way an exam would.");
    }
    if style.keep_terms {
        wishes.push("Keep technical terms and Latin names exactly as the source writes them.");
    }
    let shape = "{\"cards\":[{\"front\":\"…\",\"back\":\"…\",\"extra\":\"…\",\"source\":\"s1\",\"at\":\"p. 4\",\"quote\":\"…\"}]}";
    let instructions = format!(
        "You write flashcards for the lesson \"{}\" from the PASSAGES below, which come from the learner's own sources. Use only facts the \
passages state. {} Give each card `source` and `at` (copied from the passage header it comes from) and `quote`: one sentence copied \
word for word from that passage that supports the card. Add `extra` only for a short example or clarification. Write up to {count} \
cards; fewer is better than padding. {} {JSON_ONLY} Shape: {shape}\n\nEXISTING DECK (sample, do not repeat):\n{}",
        clip(lesson, 120),
        kind_rule,
        wishes.join(" "),
        deck_context(deck, 1200)
    );
    let mut ask = format!("PASSAGES:\n{}", clip(passages, 16_000));
    if !style.notes.trim().is_empty() {
        ask.push_str(&format!("\n\nTHE LEARNER ASKS: {}", clip(style.notes.trim(), 400)));
    }
    request("sourceCards", vec![sys(&instructions), user(ask)], true, true, 0.4)
}

/// A card drafted from a source, with the passage it cites.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct SourceCard {
    pub front: String,
    pub back: String,
    pub extra: String,
    pub source: String,
    pub at: String,
    pub quote: String,
}

pub fn parse_source_cards(deck: &Deck, text: &str) -> Result<Vec<SourceCard>, String> {
    let v = extract_json(text)?;
    let strict = deck.strict_accents;
    let mut seen: BTreeSet<String> = deck.notes.values().map(|n| normalize(&n.front, strict)).collect();
    let mut out = Vec::new();
    for c in v["cards"].as_array().cloned().unwrap_or_default() {
        let front = text_of(&c["front"]);
        let back = text_of(&c["back"]);
        if front.is_empty() || back.is_empty() || !seen.insert(normalize(&front, strict)) {
            continue;
        }
        out.push(SourceCard {
            front: clip(&front, 400),
            back: clip(&back, 400),
            extra: clip(&text_of(&c["extra"]), 400),
            source: text_of(&c["source"]),
            at: clip(&text_of(&c["at"]), 80),
            quote: clip(&text_of(&c["quote"]), 600),
        });
    }
    if out.is_empty() {
        return Err("Thoth did not return any cards for this lesson. Try again.".into());
    }
    Ok(out)
}

// ---------- transport ----------

fn join(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim().trim_end_matches('/'), path)
}

fn headers(provider: &Provider) -> BTreeMap<String, String> {
    let mut h = BTreeMap::new();
    h.insert("Content-Type".to_string(), "application/json".to_string());
    if !provider.key.trim().is_empty() {
        h.insert("Authorization".to_string(), format!("Bearer {}", provider.key.trim()));
    }
    h
}

/// The HTTP call for a request, in the OpenAI chat-completions format.
pub fn http_request(provider: &Provider, req: &AiRequest) -> Result<HttpRequest, String> {
    if provider.base_url.trim().is_empty() {
        return Err("No AI connection is set up yet. Add one in Settings.".into());
    }
    let model = if req.strong && !provider.strong_model.trim().is_empty() {
        provider.strong_model.trim()
    } else {
        provider.fast_model.trim()
    };
    if model.is_empty() {
        return Err("Choose a model for the AI connection in Settings.".into());
    }
    let mut body = json!({ "model": model, "messages": req.messages, "temperature": req.temperature });
    if req.json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    Ok(HttpRequest { url: join(&provider.base_url, "chat/completions"), method: "POST", headers: headers(provider), body: body.to_string() })
}

/// The HTTP call that lists a provider's models.
pub fn models_request(provider: &Provider) -> Result<HttpRequest, String> {
    if provider.base_url.trim().is_empty() {
        return Err("Enter the address of the AI service first.".into());
    }
    Ok(HttpRequest { url: join(&provider.base_url, "models"), method: "GET", headers: headers(provider), body: String::new() })
}

fn api_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            let e = v.get("error")?;
            e.get("message").and_then(Value::as_str).or_else(|| e.as_str()).map(str::to_string)
        })
        .unwrap_or_default();
    let reason = match status {
        0 => "The AI service could not be reached. Check the address and your connection.",
        401 | 403 => "The AI service refused the key.",
        404 => "The AI service did not recognise the address or the model.",
        429 => "The AI service says the limit or balance for this key is used up.",
        500..=599 => "The AI service had a problem of its own. Try again shortly.",
        _ => "The AI service returned an error.",
    };
    if detail.is_empty() {
        format!("{reason} (code {status})")
    } else {
        format!("{reason} It said: {}", clip(&detail, 300))
    }
}

/// The names of a provider's models, sorted.
pub fn models_reply(status: u16, body: &str) -> Result<Vec<String>, String> {
    if !(200..300).contains(&status) {
        return Err(api_error(status, body));
    }
    let v: Value = serde_json::from_str(body).map_err(|_| "The AI service sent a list this app could not read.".to_string())?;
    let list = v.get("data").or_else(|| v.get("models")).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut names: Vec<String> = list
        .iter()
        .filter_map(|m| m.get("id").or_else(|| m.get("name")).and_then(Value::as_str).or_else(|| m.as_str()))
        .map(|s| s.trim_start_matches("models/").to_string())
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

/// The model's text from a chat-completions reply.
pub fn chat_reply(status: u16, body: &str) -> Result<String, String> {
    if !(200..300).contains(&status) {
        return Err(api_error(status, body));
    }
    let v: Value = serde_json::from_str(body).map_err(|_| "The AI service sent a reply this app could not read.".to_string())?;
    let content = &v["choices"][0]["message"]["content"];
    let text = match content {
        Value::String(s) => s.clone(),
        // Some services return the content as a list of parts.
        Value::Array(parts) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(""),
        _ => String::new(),
    };
    if text.trim().is_empty() {
        return Err("The AI service sent an empty reply.".into());
    }
    Ok(text.trim().to_string())
}

// ---------- reading replies ----------

/// Find the JSON object in a model's reply, with or without a code fence
/// or stray words around it.
pub fn extract_json(text: &str) -> Result<Value, String> {
    let bad = || "The AI's reply was not in the expected form. Try again.".to_string();
    if let Ok(v) = serde_json::from_str::<Value>(text.trim()) {
        return Ok(v);
    }
    let start = text.find('{').ok_or_else(bad)?;
    let end = text.rfind('}').ok_or_else(bad)?;
    if end <= start {
        return Err(bad());
    }
    serde_json::from_str::<Value>(&text[start..=end]).map_err(|_| bad())
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Draft cards from a reply, without blanks, repeats or cards the deck already has.
pub fn parse_cards(deck: &Deck, text: &str) -> Result<Vec<RawNote>, String> {
    let v = extract_json(text)?;
    let strict = deck.strict_accents;
    let mut seen: BTreeSet<String> = deck.notes.values().map(|n| normalize(&n.front, strict)).collect();
    let mut out = Vec::new();
    for c in v["cards"].as_array().cloned().unwrap_or_default() {
        let front = text_of(&c["front"]);
        let back = text_of(&c["back"]);
        if front.is_empty() || back.is_empty() || !seen.insert(normalize(&front, strict)) {
            continue;
        }
        let key = normalize(&back, strict);
        let mut alts = strings(&c["alts"]);
        alts.retain(|a| normalize(a, strict) != key);
        alts.truncate(4);
        out.push(RawNote { front, back, alts, ..Default::default() });
    }
    if out.is_empty() {
        return Err("The AI did not return any new cards. Try again, or give it more to work from.".into());
    }
    Ok(out)
}

/// Lesson names from a reply, by lesson id.
pub fn parse_lessons(deck: &Deck, text: &str) -> Result<BTreeMap<String, String>, String> {
    let v = extract_json(text)?;
    let order = ordered_lesson_ids(deck);
    let mut out = BTreeMap::new();
    for l in v["lessons"].as_array().cloned().unwrap_or_default() {
        let n = l["n"].as_u64().unwrap_or(0) as usize;
        let name = clip(&text_of(&l["name"]), 48);
        if n >= 1 && n <= order.len() && !name.is_empty() {
            out.insert(order[n - 1].clone(), name);
        }
    }
    if out.is_empty() {
        return Err("The AI did not return any lesson names. Try again.".into());
    }
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub note_id: String,
    pub alts: Vec<String>,
    pub wrong: Vec<String>,
    pub flag: String,
}

/// Suggestions for the cards sent by `improve_request`, in the same order.
/// Anything that would clash with an accepted answer is dropped.
pub fn parse_improve(deck: &Deck, note_ids: &[String], text: &str) -> Result<Vec<Suggestion>, String> {
    let v = extract_json(text)?;
    let strict = deck.strict_accents;
    let mut out = Vec::new();
    for s in v["notes"].as_array().cloned().unwrap_or_default() {
        let n = s["n"].as_u64().unwrap_or(0) as usize;
        let Some(id) = n.checked_sub(1).and_then(|i| note_ids.get(i)) else { continue };
        let Some(note) = deck.notes.get(id) else { continue };
        let mut accepted: BTreeSet<String> =
            accepted_answers(&note.back, &note.alts).iter().map(|a| normalize(a, strict)).collect();
        let mut alts = Vec::new();
        for a in strings(&s["alts"]).into_iter().take(3) {
            if accepted.insert(normalize(&a, strict)) {
                alts.push(a);
            }
        }
        let mut taken = accepted.clone();
        taken.extend(note.wrong.iter().map(|w| normalize(w, strict)));
        let mut wrong = Vec::new();
        for w in strings(&s["wrong"]).into_iter().take(4) {
            if taken.insert(normalize(&w, strict)) {
                wrong.push(w);
            }
        }
        let flag = clip(&text_of(&s["flag"]), 240);
        if !alts.is_empty() || !wrong.is_empty() || !flag.is_empty() {
            out.push(Suggestion { note_id: id.clone(), alts, wrong, flag });
        }
    }
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub answer: usize,
    pub why: String,
}

fn question_of(q: &Value) -> Option<(String, Vec<String>, usize)> {
    let question = text_of(&q["question"]);
    let options = strings(&q["options"]);
    let answer = q["answer"].as_u64()? as usize;
    let distinct: BTreeSet<&String> = options.iter().collect();
    if question.is_empty() || options.len() < 2 || options.len() > 8 || answer >= options.len() || distinct.len() != options.len() {
        return None;
    }
    Some((question, options, answer))
}

pub fn parse_challenge(text: &str) -> Result<Vec<ChallengeQuestion>, String> {
    let v = extract_json(text)?;
    let out: Vec<ChallengeQuestion> = v["questions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|q| {
            let (question, options, answer) = question_of(q)?;
            Some(ChallengeQuestion { question, options, answer, why: clip(&text_of(&q["why"]), 300) })
        })
        .collect();
    if out.is_empty() {
        return Err("The AI did not return usable questions. Try again.".into());
    }
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Marked {
    pub correct: bool,
    pub feedback: String,
}

pub fn parse_grade(text: &str) -> Result<Marked, String> {
    let v = extract_json(text)?;
    let correct = v["correct"].as_bool().ok_or_else(|| "The AI did not give a clear mark. Compare the answers yourself.".to_string())?;
    Ok(Marked { correct, feedback: clip(&text_of(&v["feedback"]), 300) })
}

// ---------- direct changes ----------

/// Notes in the order they are listed to the model, so replies can refer to them by number.
pub fn edit_scope(deck: &Deck, scope: &str) -> Vec<String> {
    let lessons: Vec<String> = if scope.is_empty() || scope == "deck" {
        ordered_lesson_ids(deck)
    } else if let Some(u) = deck.units.iter().find(|u| u.id == scope) {
        u.lesson_ids.clone()
    } else {
        vec![scope.to_string()]
    };
    lessons.iter().filter_map(|l| deck.lessons.get(l)).flat_map(|l| l.note_ids.iter().cloned()).take(EDIT_LIMIT).collect()
}

/// Most cards one request may change; a bigger deck is changed a unit or lesson at a time.
pub const EDIT_LIMIT: usize = 150;

/// Ask for changes to the deck in the learner's own words: rewrite, add,
/// remove, rename. The reply is a list of changes to preview, never applied directly.
pub fn edit_request(deck: &Deck, scope: &str, instruction: &str) -> AiRequest {
    let ids = edit_scope(deck, scope);
    let mut lessons = String::new();
    let mut listing = String::new();
    let mut n = 0;
    for (li, lesson_id) in ordered_lesson_ids(deck).iter().enumerate() {
        let Some(lesson) = deck.lessons.get(lesson_id) else { continue };
        lessons.push_str(&format!("L{}: {}\n", li + 1, lesson.name));
        for id in &lesson.note_ids {
            if !ids.contains(id) {
                continue;
            }
            let Some(note) = deck.notes.get(id) else { continue };
            n += 1;
            listing.push_str(&format!(
                "{n} [L{}]: front: {} | back: {} | extra: {} | also accepted: {}\n",
                li + 1,
                clip(&note.front, 300),
                if note.cloze { "(fill-the-gap card)".to_string() } else { clip(&note.back, 300) },
                if note.extra.is_empty() { "-".to_string() } else { clip(&note.extra, 300) },
                if note.alts.is_empty() { "-".to_string() } else { note.alts.join(", ") },
            ));
        }
    }
    let instructions = format!(
        "You edit the flashcard deck \"{}\" exactly as the learner asks, and change nothing else. \
Cards are numbered; lessons are L1, L2 and so on. Keep each card's language and style. A fill-the-gap card marks its \
gaps as {{{{c1::answer}}}} in its front; keep that form. List only the changes. {JSON_ONLY} \
Shape: {{\"summary\":\"one sentence\",\"changes\":[\
{{\"op\":\"update\",\"n\":1,\"front\":\"…\",\"back\":\"…\",\"extra\":\"…\",\"alts\":[\"…\"]}},\
{{\"op\":\"add\",\"lesson\":\"L1\",\"front\":\"…\",\"back\":\"…\",\"extra\":\"…\"}},\
{{\"op\":\"delete\",\"n\":2}},\
{{\"op\":\"move\",\"n\":3,\"lesson\":\"L2\"}},\
{{\"op\":\"renameLesson\",\"lesson\":\"L1\",\"name\":\"…\"}}]}}. \
In an update, include only the fields that change.\n\nLESSONS:\n{lessons}",
        deck.name
    );
    let ask = format!("CARDS:\n{listing}\nREQUEST: {}", clip(instruction.trim(), 2000));
    request("edit", vec![sys(&instructions), user(ask)], true, true, 0.3)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proposed {
    pub edit: Edit,
    /// One line for the preview, such as "Card 3 · answer: the pear → the green pear".
    pub describe: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProposedChanges {
    pub summary: String,
    pub changes: Vec<Proposed>,
}

fn lesson_ref(deck: &Deck, v: &Value) -> Option<String> {
    let text = text_of(v);
    let n: usize = text.trim_start_matches(['L', 'l']).parse().ok()?;
    ordered_lesson_ids(deck).get(n.checked_sub(1)?).cloned()
}

fn strings_opt(v: &Value) -> Option<Vec<String>> {
    v.as_array().map(|_| strings(v))
}

fn field_opt(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.trim().to_string()),
        _ => None,
    }
}

/// Changes from a reply to `edit_request` with the same scope, each with a
/// plain description. Changes that refer to unknown cards or lessons are dropped.
pub fn parse_edits(deck: &Deck, scope: &str, text: &str) -> Result<ProposedChanges, String> {
    let v = extract_json(text)?;
    let ids = edit_scope(deck, scope);
    let card = |c: &Value| -> Option<String> {
        let n = c["n"].as_u64()? as usize;
        ids.get(n.checked_sub(1)?).cloned()
    };
    let arrow = |label: &str, before: &str, after: &str| format!("{label}: {} → {}", clip(before, 60), clip(after, 60));
    let mut changes = Vec::new();
    for c in v["changes"].as_array().cloned().unwrap_or_default() {
        let op = c["op"].as_str().unwrap_or("");
        match op {
            "update" => {
                let Some(id) = card(&c) else { continue };
                let note = &deck.notes[&id];
                let (front, back, extra, alts) = (field_opt(&c["front"]), field_opt(&c["back"]), field_opt(&c["extra"]), strings_opt(&c["alts"]));
                let mut parts = Vec::new();
                let front = front.filter(|f| !f.is_empty() && *f != note.front);
                let back = back.filter(|b| !b.is_empty() && *b != note.back && !note.cloze);
                let extra = extra.filter(|e| *e != note.extra);
                let alts = alts.filter(|a| *a != note.alts);
                if let Some(f) = &front {
                    parts.push(arrow("question", &note.front, f));
                }
                if let Some(b) = &back {
                    parts.push(arrow("answer", &note.back, b));
                }
                if let Some(e) = &extra {
                    parts.push(if note.extra.is_empty() { format!("extra: {}", clip(e, 80)) } else { arrow("extra", &note.extra, e) });
                }
                if let Some(a) = &alts {
                    parts.push(format!("also accepted: {}", if a.is_empty() { "none".into() } else { a.join(", ") }));
                }
                if parts.is_empty() {
                    continue;
                }
                changes.push(Proposed {
                    describe: format!("Change “{}” · {}", clip(&crate::cards::cloze_full(&note.front), 40), parts.join(" · ")),
                    edit: Edit::Update { note_id: id, front, back, extra, alts, wrong: None, labels: None, qmedia: None, amedia: None, cloze: None, front_more: None, extra_more: None, self_check: None, no_build: None, voices: None, occlusion: None },
                });
            }
            "add" => {
                let front = text_of(&c["front"]);
                let back = text_of(&c["back"]);
                let cloze = back.is_empty() && !crate::cards::cloze_numbers(&front).is_empty();
                if front.is_empty() || (back.is_empty() && !cloze) {
                    continue;
                }
                let lesson = lesson_ref(deck, &c["lesson"]);
                let place = lesson.as_ref().and_then(|l| deck.lessons.get(l)).map(|l| l.name.clone()).unwrap_or_else(|| "a new lesson".into());
                changes.push(Proposed {
                    describe: format!("Add to {place} · {} = {}", clip(&front, 50), if cloze { "(fill the gap)".into() } else { clip(&back, 50) }),
                    edit: Edit::Add {
                        lesson_id: lesson,
                        unit: Some("Added with Thoth".into()),
                        note: RawNote { front, back, extra: text_of(&c["extra"]), alts: strings(&c["alts"]), cloze, ..Default::default() },
                    },
                });
            }
            "delete" => {
                let Some(id) = card(&c) else { continue };
                let note = &deck.notes[&id];
                changes.push(Proposed {
                    describe: format!("Remove · {} = {}", clip(&crate::cards::cloze_full(&note.front), 50), clip(&note.back, 50)),
                    edit: Edit::Delete { note_id: id },
                });
            }
            "move" => {
                let (Some(id), Some(lesson)) = (card(&c), lesson_ref(deck, &c["lesson"])) else { continue };
                changes.push(Proposed {
                    describe: format!("Move “{}” to {}", clip(&deck.notes[&id].front, 50), deck.lessons[&lesson].name),
                    edit: Edit::Move { note_id: id, lesson_id: lesson },
                });
            }
            "renameLesson" => {
                let (Some(lesson), name) = (lesson_ref(deck, &c["lesson"]), clip(&text_of(&c["name"]), 60)) else { continue };
                if name.is_empty() || deck.lessons[&lesson].name == name {
                    continue;
                }
                changes.push(Proposed {
                    describe: format!("Rename lesson · {} → {}", deck.lessons[&lesson].name, name),
                    edit: Edit::RenameLesson { lesson_id: lesson, name },
                });
            }
            _ => {}
        }
    }
    if changes.is_empty() {
        return Err("Thoth did not propose any changes. Try saying more precisely what should change.".into());
    }
    Ok(ProposedChanges { summary: clip(&text_of(&v["summary"]), 200), changes })
}

pub fn parse_reading(text: &str, fallback_passage: &str) -> Result<Reading, String> {
    let v = extract_json(text)?;
    let mut passage = text_of(&v["passage"]);
    if !fallback_passage.trim().is_empty() {
        // The learner's own passage is kept exactly as they gave it.
        passage = fallback_passage.trim().to_string();
    }
    let questions: Vec<ReadingQuestion> = v["questions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|q| {
            let (question, options, answer) = question_of(q)?;
            Some(ReadingQuestion { question, options, answer })
        })
        .collect();
    if passage.is_empty() || questions.is_empty() {
        return Err("The AI did not return a usable passage and questions. Try again.".into());
    }
    let title = text_of(&v["title"]);
    Ok(Reading {
        id: uid("r"),
        title: if title.is_empty() { "Reading".to_string() } else { clip(&title, 80) },
        passage,
        questions,
        ai: true,
        best: None,
    })
}

// ---------- answers that mean the same ----------

/// A group of notes whose answers mean the same or nearly the same.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkGroup {
    pub kind: String,
    pub notes: Vec<String>,
}

/// Which of the listed cards have answers that mean the same, or nearly the same.
pub fn link_answers_request(deck: &Deck, note_ids: &[String]) -> AiRequest {
    let mut listing = String::new();
    for (i, id) in note_ids.iter().take(200).enumerate() {
        let Some(n) = deck.notes.get(id) else { continue };
        listing.push_str(&format!("{}: {} = {}\n", i + 1, clip(&n.front, 120), clip(&n.back, 160)));
    }
    let instructions = format!(
        "These are flashcards from the deck \"{}\": number, question, answer. Find cards whose answers would be \
confused for each other in multiple choice. Group them as \"same\" when either answer is a fair answer to either \
question (true synonyms, or the same meaning in other words), and as \"close\" when the answers are near in meaning but \
a careful marker would still tell them apart (a different tense, register or nuance). Only group cards that really \
belong together; most cards belong to no group. {JSON_ONLY} Shape: {{\"groups\":[{{\"kind\":\"same\",\"n\":[1,4]}}]}}",
        deck.name
    );
    request("linkAnswers", vec![sys(&instructions), user(listing)], true, true, 0.2)
}

pub fn parse_link_answers(deck: &Deck, note_ids: &[String], text: &str) -> Result<Vec<LinkGroup>, String> {
    let v = extract_json(text)?;
    let strict = deck.strict_accents;
    let mut out: Vec<LinkGroup> = Vec::new();
    let mut used: BTreeSet<(String, String)> = BTreeSet::new();
    for g in v["groups"].as_array().cloned().unwrap_or_default() {
        let kind = match text_of(&g["kind"]).as_str() {
            "same" => "same",
            "close" => "close",
            _ => continue,
        };
        let mut notes: Vec<String> = Vec::new();
        for n in g["n"].as_array().cloned().unwrap_or_default() {
            let Some(id) = n.as_u64().and_then(|n| (n as usize).checked_sub(1)).and_then(|i| note_ids.get(i)) else { continue };
            if deck.notes.contains_key(id) && !notes.contains(id) {
                notes.push(id.clone());
            }
        }
        // Answers already the same need no link: they count for each other anyway.
        let distinct: BTreeSet<String> = notes.iter().filter_map(|id| deck.notes.get(id)).map(|n| normalize(&n.back, strict)).collect();
        if notes.len() < 2 || distinct.len() < 2 {
            continue;
        }
        let key = (kind.to_string(), notes.iter().cloned().collect::<Vec<_>>().join(","));
        if used.insert(key) {
            out.push(LinkGroup { kind: kind.into(), notes });
        }
    }
    Ok(out)
}

/// For close pairs: a short note on how the answers differ.
pub fn contrast_request(deck: &Deck, groups: &[Vec<String>]) -> AiRequest {
    let mut listing = String::new();
    for (i, g) in groups.iter().take(30).enumerate() {
        let cards: Vec<String> = g.iter().filter_map(|id| deck.notes.get(id)).map(|n| format!("{} = {}", clip(&n.front, 80), clip(&n.back, 100))).collect();
        listing.push_str(&format!("{}: {}\n", i + 1, cards.join(" | ")));
    }
    let instructions = format!(
        "Each numbered line holds flashcards from the deck \"{}\" whose answers are easy to mix up. For each line write \
one short note (at most 30 words) that tells them apart: what each means and when each is used. Plain text, no lists. \
{JSON_ONLY} Shape: {{\"notes\":[{{\"n\":1,\"note\":\"…\"}}]}}",
        deck.name
    );
    request("contrast", vec![sys(&instructions), user(listing)], true, false, 0.3)
}

pub fn parse_contrast(text: &str, count: usize) -> Result<Vec<String>, String> {
    let v = extract_json(text)?;
    let mut out = vec![String::new(); count];
    for n in v["notes"].as_array().cloned().unwrap_or_default() {
        if let Some(i) = n["n"].as_u64().and_then(|x| (x as usize).checked_sub(1)) {
            if i < count {
                out[i] = clip(&text_of(&n["note"]), 260);
            }
        }
    }
    Ok(out)
}

/// Is a typed answer that matched nothing on the card still a fair answer?
pub fn judge_request(deck: &Deck, card_id: &str, given: &str) -> AiRequest {
    let f = crate::cards::face(deck, card_id);
    let (front, back, accepted) = f.as_ref().map(|f| (f.prompt.clone(), f.answer.clone(), f.accepted.join(" | "))).unwrap_or_default();
    let instructions = format!(
        "A learner typed an answer to a flashcard from the deck \"{}\" that matches none of the card's accepted answers. \
Decide whether it is still a fair answer: the same meaning in other words, a correct translation, or a common \
equivalent. It is not fair if it changes the meaning, the tense, the person or the number, or is a different word. \
Ignore small spelling slips. `feedback` is one sentence to the learner saying why. {JSON_ONLY} \
Shape: {{\"correct\":true,\"feedback\":\"…\"}}",
        deck.name
    );
    let ask = format!("Question: {front}\nCard's answer: {back}\nAlso accepted: {accepted}\nLearner's answer: {}", clip(given.trim(), 300));
    request("judge", vec![sys(&instructions), user(ask)], true, false, 0.0)
}

/// Cards whose answers mean the same as, or nearly the same as, one card's.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Similar {
    pub same: Vec<String>,
    pub close: Vec<String>,
}

pub fn similar_request(deck: &Deck, note_id: &str, candidates: &[String]) -> AiRequest {
    let (front, back) = deck.notes.get(note_id).map(|n| (n.front.clone(), n.back.clone())).unwrap_or_default();
    let mut listing = String::new();
    for (i, id) in candidates.iter().take(150).enumerate() {
        let Some(n) = deck.notes.get(id) else { continue };
        listing.push_str(&format!("{}: {} = {}\n", i + 1, clip(&n.front, 100), clip(&n.back, 140)));
    }
    let instructions = format!(
        "One flashcard from the deck \"{}\" is followed by numbered others. List the numbers whose answer means the same \
as this card's (\"same\": either answer is fair for either question) and those near in meaning but still \
distinguishable (\"close\"). Most cards are neither. {JSON_ONLY} Shape: {{\"same\":[2],\"close\":[5]}}",
        deck.name
    );
    let ask = format!("The card: {} = {}\n\nOthers:\n{listing}", clip(&front, 120), clip(&back, 160));
    request("similar", vec![sys(&instructions), user(ask)], true, false, 0.2)
}

pub fn parse_similar(candidates: &[String], text: &str) -> Result<Similar, String> {
    let v = extract_json(text)?;
    let pick = |key: &str| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for n in v[key].as_array().cloned().unwrap_or_default() {
            if let Some(id) = n.as_u64().and_then(|x| (x as usize).checked_sub(1)).and_then(|i| candidates.get(i)) {
                if !out.contains(id) {
                    out.push(id.clone());
                }
            }
        }
        out
    };
    let same = pick("same");
    let close: Vec<String> = pick("close").into_iter().filter(|id| !same.contains(id)).collect();
    Ok(Similar { same, close })
}

/// Where a deck belongs in the library: a subject and, if useful, a topic.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub subject: String,
    pub topic: String,
}

pub fn place_request(deck: &Deck, existing: &[String]) -> AiRequest {
    let sample: Vec<String> = deck.notes.values().take(12).map(|n| format!("{} = {}", clip(&n.front, 60), clip(&n.back, 60))).collect();
    let instructions = format!(
        "Sort a flashcard deck into a learner's library. Give a broad subject (such as Languages, Math, Science, History, \
Medicine, Music) and, if it helps, a narrower topic (such as Turkish, Trigonometry, Biology). Reuse one of the \
learner's existing names when it fits: {}. Names are one to three words. {JSON_ONLY} \
Shape: {{\"subject\":\"…\",\"topic\":\"…\"}}",
        if existing.is_empty() { "(none yet)".to_string() } else { existing.join(", ") }
    );
    let ask = format!("Deck: {}\nSome cards:\n{}", deck.name, sample.join("\n"));
    request("place", vec![sys(&instructions), user(ask)], true, false, 0.2)
}

pub fn parse_place(text: &str) -> Result<Place, String> {
    let v = extract_json(text)?;
    let subject = clip(&text_of(&v["subject"]), 40);
    if subject.is_empty() {
        return Err("The AI did not suggest a subject.".into());
    }
    Ok(Place { subject, topic: clip(&text_of(&v["topic"]), 40) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_deck;

    fn provider() -> Provider {
        Provider { base_url: "https://example.test/v1/".into(), key: "sk-test".into(), fast_model: "small".into(), strong_model: "large".into() }
    }

    #[test]
    fn builds_an_openai_style_call() {
        let deck = sample_deck(0.0);
        let req = cards_request(&deck, "", "kitchen words", 8);
        assert!(req.json && req.strong && req.estimate > 50);
        let http = http_request(&provider(), &req).unwrap();
        assert_eq!(http.url, "https://example.test/v1/chat/completions");
        assert_eq!(http.headers["Authorization"], "Bearer sk-test");
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert_eq!(body["model"], "large");
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["messages"][0]["role"], "system");
        assert!(body["messages"][0]["content"].as_str().unwrap().contains("la manzana"));
    }

    #[test]
    fn quick_jobs_use_the_fast_model_and_local_services_need_no_key() {
        let deck = sample_deck(0.0);
        let id = deck.notes.keys().next().unwrap().clone();
        let mut p = provider();
        p.key.clear();
        let http = http_request(&p, &explain_request(&deck, &id, "the pear")).unwrap();
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert_eq!(body["model"], "small");
        assert!(body.get("response_format").is_none());
        assert!(!http.headers.contains_key("Authorization"));
        p.strong_model.clear();
        let body: Value = serde_json::from_str(&http_request(&p, &cards_request(&deck, "", "", 5)).unwrap().body).unwrap();
        assert_eq!(body["model"], "small", "falls back to the fast model");
        p.base_url.clear();
        assert!(http_request(&p, &cards_request(&deck, "", "", 5)).is_err());
    }

    #[test]
    fn reads_replies_and_explains_failures() {
        let ok = r#"{"choices":[{"message":{"role":"assistant","content":" Hello. "}}]}"#;
        assert_eq!(chat_reply(200, ok).unwrap(), "Hello.");
        let parts = r#"{"choices":[{"message":{"content":[{"type":"text","text":"A"},{"type":"text","text":"B"}]}}]}"#;
        assert_eq!(chat_reply(200, parts).unwrap(), "AB");
        let err = chat_reply(401, r#"{"error":{"message":"Incorrect API key"}}"#).unwrap_err();
        assert!(err.contains("refused the key") && err.contains("Incorrect API key"));
        assert!(chat_reply(0, "").unwrap_err().contains("could not be reached"));
        assert_eq!(models_reply(200, r#"{"data":[{"id":"b"},{"id":"a"}]}"#).unwrap(), vec!["a", "b"]);
    }

    #[test]
    fn finds_json_inside_fences_and_chatter() {
        let fenced = "Here you go:\n```json\n{\"correct\": true, \"feedback\": \"Good.\"}\n```";
        assert_eq!(parse_grade(fenced).unwrap(), Marked { correct: true, feedback: "Good.".into() });
        assert!(parse_grade("I think it is right").is_err());
    }

    #[test]
    fn drafts_skip_blanks_repeats_and_existing_cards() {
        let deck = sample_deck(0.0);
        let reply = r#"{"cards":[
            {"front":"el tenedor","back":"the fork","alts":["fork","the fork"]},
            {"front":"La Manzana","back":"the apple"},
            {"front":"el tenedor","back":"the fork"},
            {"front":"","back":"x"},
            {"front":"el cuchillo","back":"the knife"}]}"#;
        let cards = parse_cards(&deck, reply).unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].alts, vec!["fork"]);
        assert!(parse_cards(&deck, r#"{"cards":[]}"#).is_err());
    }

    #[test]
    fn suggestions_never_clash_with_accepted_answers() {
        let deck = sample_deck(0.0);
        let id = deck.notes.values().find(|n| n.back == "the apple").unwrap().id.clone();
        let reply = r#"{"notes":[{"n":1,"alts":["apple","an apple"],"wrong":["the apple","the plum","the plum","the fig"],"flag":""},{"n":9,"alts":["x"]}]}"#;
        let s = parse_improve(&deck, std::slice::from_ref(&id), reply).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].alts, vec!["an apple"]);
        assert_eq!(s[0].wrong, vec!["the plum", "the fig"]);
    }

    #[test]
    fn questions_must_be_well_formed() {
        let reply = r#"{"questions":[
            {"question":"Q1","options":["a","b","c","d"],"answer":2,"why":"w"},
            {"question":"Q2","options":["a","b"],"answer":5},
            {"question":"Q3","options":["a","a","b","c"],"answer":0}]}"#;
        let q = parse_challenge(reply).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].answer, 2);
        let reading = parse_reading(r#"{"title":"T","passage":"P","questions":[{"question":"Q","options":["a","b","c","d"],"answer":0}]}"#, "").unwrap();
        assert!(reading.ai && reading.questions.len() == 1);
        let own = parse_reading(r#"{"passage":"changed","questions":[{"question":"Q","options":["a","b"],"answer":1}]}"#, "My text").unwrap();
        assert_eq!(own.passage, "My text");
    }

    #[test]
    fn names_lessons_by_position_and_bounds_chat_history() {
        let deck = sample_deck(0.0);
        let names = parse_lessons(&deck, r#"{"lessons":[{"n":1,"name":"Fruit"},{"n":99,"name":"x"}]}"#).unwrap();
        assert_eq!(names.len(), 1);
        assert_eq!(names[&deck.units[0].lesson_ids[0]], "Fruit");
        let history: Vec<Message> = (0..20).map(|i| Message { role: "user".into(), content: format!("m{i}") }).collect();
        let req = chat_request(&deck, &history, "What is a pear?");
        assert_eq!(req.messages.len(), 10);
        assert_eq!(req.messages.last().unwrap().content, "What is a pear?");
    }

    #[test]
    fn direct_changes_become_a_preview_of_edits() {
        let deck = sample_deck(0.0);
        let req = edit_request(&deck, "deck", "Add an example sentence to the apple card");
        assert!(req.strong && req.messages[1].content.contains("1 [L1]: front: la manzana"));
        let reply = r#"{"summary":"Added an example.","changes":[
            {"op":"update","n":1,"extra":"Como una manzana."},
            {"op":"update","n":2,"back":"the pear"},
            {"op":"add","lesson":"L1","front":"la fresa","back":"the strawberry"},
            {"op":"delete","n":99},
            {"op":"renameLesson","lesson":"L2","name":"Bebidas"}]}"#;
        let p = parse_edits(&deck, "deck", reply).unwrap();
        assert_eq!(p.changes.len(), 3, "{:?}", p.changes.iter().map(|c| &c.describe).collect::<Vec<_>>());
        assert!(p.changes[0].describe.contains("extra: Como una manzana."));
        let mut copy = deck.clone();
        let edits: Vec<Edit> = p.changes.into_iter().map(|c| c.edit).collect();
        let done = crate::edit::apply(&mut copy, &edits, true);
        assert_eq!(done.added.len(), 1);
        assert_eq!(copy.lessons[&copy.units[0].lesson_ids[1]].name, "Bebidas");
        assert!(parse_edits(&deck, "deck", r#"{"changes":[]}"#).is_err());
    }

    #[test]
    fn outlines_keep_their_sources_and_sensible_kinds() {
        let reply = r#"Here: {"units":[{"name":"The membrane","lessons":[{"name":"Structure","from":[{"source":"s1","at":"p. 2"}],"kind":"qa","cards":12},{"name":"","from":[]},{"name":"Steps","from":[{"source":"s2","at":"§3"}],"kind":"poem","cards":500}]},{"name":"Empty","lessons":[]}]}"#;
        let units = parse_outline(reply).unwrap();
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].lessons.len(), 2);
        assert_eq!(units[0].lessons[0].from, vec![("s1".to_string(), "p. 2".to_string())]);
        assert_eq!(units[0].lessons[1].kind, "qa");
        assert_eq!(units[0].lessons[1].cards, 60);
        assert!(parse_outline("{\"units\":[]}").is_err());
    }

    #[test]
    fn source_cards_carry_their_quote_and_skip_repeats() {
        let deck = crate::sample::sample_deck(0.0);
        let existing = deck.notes.values().next().unwrap().front.clone();
        let reply = format!(r#"{{"cards":[{{"front":"What is a bilayer?","back":"two layers","source":"s1","at":"p. 2","quote":"The membrane is a bilayer."}},{{"front":"{existing}","back":"x"}},{{"front":"What is a bilayer?","back":"again"}}]}}"#);
        let cards = parse_source_cards(&deck, &reply).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].quote, "The membrane is a bilayer.");
        let req = source_cards_request(&deck, "Structure", "qa", 10, "[s1 p. 2] The membrane is a bilayer.", &CardStyle { short: true, ..Default::default() });
        assert!(req.messages[0].content.contains("under five words"));
        let story = story_request(&deck, &["ekmek".into(), "su".into()], 3);
        assert!(story.messages[1].content.contains("ekmek, su"));
    }

    #[test]
    fn link_groups_keep_real_pairs_and_drop_bad_numbers() {
        let rows: Vec<crate::model::RawNote> = [("Anlıyorum.", "I understand."), ("Anladım.", "I got it."), ("Kavrıyorum.", "I grasp it."), ("Su", "water"), ("Sular", "Water")]
            .iter()
            .map(|(f, b)| serde_json::from_value(serde_json::json!({"front": f, "back": b})).unwrap())
            .collect();
        let deck = crate::split::build_deck("T", &rows, &serde_json::from_str("{\"lessonSize\":6}").unwrap(), 0.0);
        let ids: Vec<String> = rows.iter().map(|r| deck.notes.values().find(|n| n.front == r.front).unwrap().id.clone()).collect();
        let reply = r#"{"groups":[{"kind":"close","n":[1,2]},{"kind":"same","n":[1,3,99]},{"kind":"same","n":[4,5]},{"kind":"odd","n":[1,2]},{"kind":"same","n":[2]}]}"#;
        let groups = parse_link_answers(&deck, &ids, reply).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0], LinkGroup { kind: "close".into(), notes: vec![ids[0].clone(), ids[1].clone()] });
        assert_eq!(groups[1].notes, vec![ids[0].clone(), ids[2].clone()]);
        let sim = parse_similar(&ids, r#"{"same":[3,3],"close":[2,3,40]}"#).unwrap();
        assert_eq!(sim.same, vec![ids[2].clone()]);
        assert_eq!(sim.close, vec![ids[1].clone()]);
        assert_eq!(parse_contrast(r#"{"notes":[{"n":2,"note":"Past vs present."}]}"#, 2).unwrap(), vec!["".to_string(), "Past vs present.".to_string()]);
        assert!(parse_place(r#"{"subject":"","topic":"x"}"#).is_err());
        let req = judge_request(&deck, &ids[0], "I understood");
        assert!(req.messages[1].content.contains("I understood"));
    }
}
