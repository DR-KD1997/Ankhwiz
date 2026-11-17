//! Moving decks between Ankhwiz and Anki.
//!
//! Import: an Anki card's scheduling becomes Ankhwiz progress. A card that
//! went out from Ankhwiz carries its exact stage in Anki's custom data
//! (`cd.ankh`); any other card's stage is estimated from its interval.
//!
//! Export: a deck becomes the rows of an Anki collection (note types, notes,
//! cards, review log), which the interface writes into an .apkg. Imported
//! notes go back under their own note type with their own fields, so an
//! unchanged note returns to Anki exactly as it came. Units become subdecks
//! and lessons travel as `ankh::` tags.

use crate::cards::{cards_of, cloze_numbers, note_of, part_numbers};
use crate::model::{AnkiSched, CardState, Clock, Deck, Memory, Note, Progress, RawNote, DAY_MS};
use crate::split::{build_deck, lesson_tag, BuildOptions};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

// ---------- import ----------

fn custom_stage(data: &Value) -> Option<(u8, usize)> {
    // Anki keeps custom data as a JSON object written into a string.
    let cd = data.get("cd")?;
    let parsed: Value = match cd {
        Value::String(s) => serde_json::from_str(s).ok()?,
        other => other.clone(),
    };
    let raw = parsed.get("ankh")?.as_str()?;
    let (stage, days) = raw.split_once('.').unwrap_or((raw, "0"));
    let stage: u8 = stage.trim_start_matches('s').parse().ok()?;
    Some((stage.clamp(1, 5), days.trim_end_matches('d').parse().unwrap_or(0)))
}

/// Progress for one Anki card, or None for a card never studied.
/// `crt_day` is the local day the Anki collection was created.
pub fn card_state(s: &AnkiSched, crt_day: i64, clock: Clock) -> Option<CardState> {
    if s.ctype == 0 || s.queue == 0 {
        return None;
    }
    let today = clock.day();
    let data: Value = serde_json::from_str(&s.data).unwrap_or(Value::Null);
    // Review and day-learning cards count days from the collection's creation;
    // learning cards hold a timestamp in seconds.
    let due = if s.ctype == 2 || s.queue == 3 || s.queue == -1 && s.due < 1_000_000 {
        clock.start_of(crt_day + s.due)
    } else {
        s.due as f64 * 1000.0
    };
    let ivl = s.ivl.max(1);
    let last_day = data
        .get("lrt")
        .and_then(Value::as_f64)
        .map(|secs| Clock::new(secs * 1000.0, clock.tz).day())
        .unwrap_or_else(|| Clock::new(due, clock.tz).day() - ivl)
        .min(today);
    let (stage, ok) = custom_stage(&data).unwrap_or_else(|| {
        let stage = if s.ctype != 2 {
            2
        } else if ivl >= 21 {
            5
        } else if ivl >= 7 {
            4
        } else if ivl >= 3 {
            3
        } else {
            2
        };
        (stage, 0)
    });
    let stability = data.get("s").and_then(Value::as_f64).unwrap_or(ivl as f64);
    let difficulty = data.get("d").and_then(Value::as_f64).unwrap_or(5.0);
    Some(CardState {
        stage,
        ok_days: (0..ok as i64).map(|i| last_day - i).collect(),
        demoted: false,
        lapses: s.lapses,
        reps: s.reps,
        due,
        mem: Some(Memory { stability, difficulty, last_day }),
        suspended: s.queue == -1,
        buried: None,
        added: Some(last_day.min(today - 1)),
        hist: vec![],
    })
}

/// Build a deck from imported rows, with progress from their Anki scheduling.
pub fn build_with_progress(name: &str, rows: &[RawNote], options: &BuildOptions, crt_secs: f64, clock: Clock) -> (Deck, Progress) {
    let deck = build_deck(name, rows, options, clock.now);
    let crt_day = Clock::new(crt_secs * 1000.0, clock.tz).day();
    // build_deck keeps rows in order within their lessons; match notes back to rows by content.
    // Rows from Anki are matched by their note's guid; others by content.
    let key = |front: &str, back: &str, guid: Option<&str>| match guid {
        Some(g) if !g.is_empty() => (g.to_string(), String::new()),
        _ => (front.trim().to_string(), back.trim().to_string()),
    };
    let mut by_row: BTreeMap<(String, String), Vec<&RawNote>> = BTreeMap::new();
    for row in rows.iter().filter(|r| !r.sched.is_empty()) {
        by_row.entry(key(&row.front, &row.back, row.anki.as_ref().map(|a| a.guid.as_str()))).or_default().push(row);
    }
    let mut progress = Progress::new();
    let notes: Vec<&Note> = deck.units.iter().flat_map(|u| &u.lesson_ids).filter_map(|l| deck.lessons.get(l)).flat_map(|l| &l.note_ids).filter_map(|n| deck.notes.get(n)).collect();
    for note in notes {
        let Some(list) = by_row.get_mut(&key(&note.front, &note.back, note.anki.as_ref().map(|a| a.guid.as_str()))) else { continue };
        if list.is_empty() {
            continue;
        }
        let row = list.remove(0);
        let gaps = cloze_numbers(&note.front);
        let parts = note.occlusion.as_ref().map(part_numbers).unwrap_or_default();
        for s in &row.sched {
            let card_id = if note.occlusion.is_some() {
                let n = s.ord + 1;
                match parts.first() {
                    Some(first) if *first == n => note.id.clone(),
                    _ if parts.contains(&n) => format!("{}:o{n}", note.id),
                    _ => continue,
                }
            } else if note.cloze {
                let n = s.ord + 1;
                match gaps.first() {
                    Some(first) if *first == n => note.id.clone(),
                    _ if gaps.contains(&n) => format!("{}:c{n}", note.id),
                    _ => continue,
                }
            } else if s.ord == 0 {
                note.id.clone()
            } else if s.ord == 1 {
                format!("{}:r", note.id)
            } else {
                continue;
            };
            if let Some(state) = card_state(s, crt_day, clock) {
                progress.insert(card_id, state);
            }
        }
    }
    (deck, progress)
}

// ---------- export ----------

/// The tag that marks a card the learner checks themselves.
pub const SELF_CHECK_TAG: &str = "ankh::self-check";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNoteRow {
    pub id: i64,
    pub guid: String,
    pub mid: i64,
    pub tags: String,
    pub flds: String,
    pub sfld: String,
    pub csum: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnkiCardRow {
    pub id: i64,
    pub nid: i64,
    pub did: i64,
    pub ord: u32,
    pub ctype: i32,
    pub queue: i32,
    pub due: i64,
    pub ivl: i64,
    pub factor: i64,
    pub reps: u32,
    pub lapses: u32,
    pub data: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnkiRevRow {
    pub id: i64,
    pub cid: i64,
    pub ease: i32,
    pub ivl: i64,
    pub last_ivl: i64,
    pub factor: i64,
    pub time: i64,
    pub rtype: i32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnkiExport {
    /// Collection creation, in seconds.
    pub crt: i64,
    /// JSON for the `col` table's `models`, `decks`, `dconf` and `conf` columns.
    pub models: String,
    pub decks: String,
    pub dconf: String,
    pub conf: String,
    pub notes: Vec<AnkiNoteRow>,
    pub cards: Vec<AnkiCardRow>,
    pub revlog: Vec<AnkiRevRow>,
    /// Media file names the notes refer to.
    pub media: Vec<String>,
}

const CSS: &str = ".card { font-family: system-ui, sans-serif; font-size: 22px; text-align: center; color: black; background-color: white; }\n.extra { margin-top: 1em; font-size: 0.8em; color: #6b5a3a; }\n.more { font-size: 0.8em; color: #4a4030; margin-top: .3em; }\n.more2 { font-size: 0.7em; }\n.more3 { font-size: 0.62em; }\n";

fn esc(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\n', "<br>")
}

/// Escaped text with marked words wrapped as web text Anki keeps:
/// `<span lang="es-ES">la manzana</span>`.
fn voiced(text: &str, marks: &[crate::model::VoiceMark]) -> String {
    let mut out = esc(text);
    if marks.is_empty() {
        return out;
    }
    let mut order: Vec<&crate::model::VoiceMark> = marks.iter().filter(|m| !m.text.trim().is_empty()).collect();
    order.sort_by_key(|m| std::cmp::Reverse(m.text.len()));
    // Placeholders first, so a shorter mark never lands inside a longer one's span.
    let mut spans = Vec::new();
    for m in order {
        let from = esc(&m.text);
        if out.contains(&from) {
            let token = format!("\u{E000}{}\u{E001}", spans.len());
            out = out.replace(&from, &token);
            spans.push(format!("<span lang=\"{}\">{from}</span>", m.lang.replace(['"', '<', '>', '&'], "")));
        }
    }
    for (i, span) in spans.iter().enumerate() {
        out = out.replace(&format!("\u{E000}{i}\u{E001}"), span);
    }
    out
}

/// The first field without markup, as Anki's sort field and checksum use it.
fn strip(html: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for c in html.chars() {
        match c {
            '<' => tag = true,
            '>' => tag = false,
            _ if !tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim().to_string()
}

fn checksum(text: &str) -> i64 {
    let hex = sha1_smol::Sha1::from(strip(text)).digest().to_string();
    i64::from_str_radix(&hex[..8], 16).unwrap_or(0)
}

fn with_media(text: &str, media: &[String]) -> String {
    let mut out = text.to_string();
    for m in media {
        let lower = m.to_lowercase();
        let sound = [".mp3", ".ogg", ".wav", ".m4a", ".opus", ".flac", ".aac", ".webm"].iter().any(|e| lower.ends_with(e));
        out.push_str(&if sound { format!("[sound:{m}]") } else { format!("<img src=\"{}\">", m.replace('"', "&quot;")) });
    }
    out
}

fn field(name: &str, ord: usize) -> Value {
    json!({"name": name, "ord": ord, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": []})
}

fn template(name: &str, ord: usize, qfmt: &str, afmt: &str) -> Value {
    json!({"name": name, "ord": ord, "qfmt": qfmt, "afmt": afmt, "bqfmt": "", "bafmt": "", "did": null, "bfont": "", "bsize": 0})
}

fn model(id: i64, name: &str, cloze: bool, fields: &[String], templates: Vec<Value>, css: &str, did: i64, now: i64) -> Value {
    json!({
        "id": id, "name": name, "type": if cloze { 1 } else { 0 }, "mod": now, "usn": -1, "sortf": 0, "did": did,
        "tmpls": templates,
        "flds": fields.iter().enumerate().map(|(i, f)| field(f, i)).collect::<Vec<_>>(),
        "css": css,
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}", "latexsvg": false, "req": [[0, "any", [0]]], "tags": [], "vers": []
    })
}

/// Every card the note had in Anki or gets now, as (Ankhwiz card id, Anki template ord).
fn card_ords(deck: &Deck, note: &Note, templates: usize) -> Vec<(String, u32)> {
    if let Some(o) = &note.occlusion {
        return cards_of(deck, note).into_iter().zip(part_numbers(o)).map(|(id, n)| (id, n.saturating_sub(1))).collect();
    }
    if note.cloze {
        return cards_of(deck, note)
            .into_iter()
            .zip(cloze_numbers(&note.front))
            .map(|(id, n)| (id, n.saturating_sub(1)))
            .collect();
    }
    (0..templates.max(1) as u32)
        .map(|ord| (if ord == 0 { note.id.clone() } else if ord == 1 { format!("{}:r", note.id) } else { format!("{}:t{ord}", note.id) }, ord))
        .collect()
}

pub fn export(deck: &Deck, progress: &Progress, include_progress: bool, clock: Clock) -> AnkiExport {
    let now_s = (clock.now / 1000.0) as i64;
    let today = clock.day();
    let earliest = progress.values().filter_map(|c| c.added).chain(progress.values().filter_map(|c| c.hist.first().map(|h| h.day))).min().unwrap_or(today).min(today);
    let crt_day = earliest - 1;
    let crt = (clock.start_of(crt_day) / 1000.0) as i64;
    let base = clock.now as i64;
    let mut next_id = base;
    let mut id = || {
        next_id += 1;
        next_id
    };

    // Decks: the deck itself, and a subdeck per unit when there is more than one.
    let mut decks = serde_json::Map::new();
    let deck_json = |did: i64, name: &str| {
        json!({"id": did, "name": name, "mod": now_s, "usn": -1, "lrnToday": [0, 0], "revToday": [0, 0], "newToday": [0, 0], "timeToday": [0, 0],
               "collapsed": false, "browserCollapsed": false, "desc": "", "dyn": 0, "conf": 1, "extendNew": 0, "extendRev": 0})
    };
    decks.insert("1".into(), deck_json(1, "Default"));
    let top = id();
    decks.insert(top.to_string(), deck_json(top, &deck.name));
    let mut unit_deck: BTreeMap<String, i64> = BTreeMap::new();
    for unit in &deck.units {
        let did = if deck.units.len() > 1 {
            let did = id();
            decks.insert(did.to_string(), deck_json(did, &format!("{}::{}", deck.name, unit.name.replace("::", " "))));
            did
        } else {
            top
        };
        for l in &unit.lesson_ids {
            if let Some(lesson) = deck.lessons.get(l) {
                for n in &lesson.note_ids {
                    unit_deck.insert(n.clone(), did);
                }
            }
        }
    }

    // Note types: Ankhwiz's own, plus every note type kept from an import.
    let mut models = serde_json::Map::new();
    // More question and extra fields add "Question 2", "Extra 2" and so on,
    // after the five fields every earlier export had.
    let native = || deck.notes.values().filter(|n| n.anki.is_none() && !n.cloze && n.occlusion.is_none());
    let q_more = native().map(|n| n.front_more.len()).max().unwrap_or(0);
    let x_more = native().map(|n| n.extra_more.len()).max().unwrap_or(0);
    let mut basic_fields: Vec<String> = ["Question", "Answer", "Extra", "Also accepted", "Wrong options"].map(String::from).to_vec();
    basic_fields.extend((0..q_more).map(|i| format!("Question {}", i + 2)));
    basic_fields.extend((0..x_more).map(|i| format!("Extra {}", i + 2)));
    let q_block: String = (0..q_more)
        .map(|i| {
            let f = format!("Question {}", i + 2);
            let size = if i == 0 { "" } else if i == 1 { " more2" } else { " more3" };
            format!("\n{{{{#{f}}}}}<div class=\"more{size}\">{{{{{f}}}}}</div>{{{{/{f}}}}}")
        })
        .collect();
    let x_block: String = (0..x_more)
        .map(|i| {
            let f = format!("Extra {}", i + 2);
            format!("\n{{{{#{f}}}}}<div class=extra>{{{{{f}}}}}</div>{{{{/{f}}}}}")
        })
        .collect();
    let answer = format!("{{{{FrontSide}}}}\n\n<hr id=answer>\n\n{{{{Answer}}}}\n{{{{#Extra}}}}<div class=extra>{{{{Extra}}}}</div>{{{{/Extra}}}}{x_block}");
    let mut basic_templates = vec![template("Card 1", 0, &format!("{{{{Question}}}}{q_block}"), &answer)];
    if deck.options.both_ways {
        basic_templates.push(template(
            "Other way round",
            1,
            "{{Answer}}",
            &format!("{{{{FrontSide}}}}\n\n<hr id=answer>\n\n{{{{Question}}}}{q_block}\n{{{{#Extra}}}}<div class=extra>{{{{Extra}}}}</div>{{{{/Extra}}}}{x_block}"),
        ));
    }
    let io_id = id();
    let mut used_io = false;
    let basic_id = id();
    let basic_name = if deck.options.both_ways { "Ankhwiz Basic (both ways)" } else { "Ankhwiz Basic" };
    let cloze_id = id();
    let cloze_fields: Vec<String> = ["Text", "Extra", "Also accepted"].map(String::from).to_vec();
    let mut used_basic = false;
    let mut used_cloze = false;
    let kept = deck.anki.as_ref().map(|a| a.notetypes.clone()).unwrap_or_default();
    let mut kept_used: BTreeMap<String, bool> = BTreeMap::new();

    let mut notes = Vec::new();
    let mut cards = Vec::new();
    let mut revlog = Vec::new();
    let mut media: Vec<String> = Vec::new();
    let mut new_pos = 0i64;
    let ordered: Vec<&Note> = deck.units.iter().flat_map(|u| &u.lesson_ids).filter_map(|l| deck.lessons.get(l)).flat_map(|l| &l.note_ids).filter_map(|n| deck.notes.get(n)).collect();

    for note in ordered {
        for m in note.qmedia.iter().chain(&note.amedia) {
            if !media.contains(m) {
                media.push(m.clone());
            }
        }
        let mut tags: Vec<String> = note.labels.iter().map(|l| l.replace(' ', "_")).collect();
        if let Some(t) = lesson_tag(deck, &note.id) {
            tags.push(t);
        }
        if note.self_check {
            tags.push(SELF_CHECK_TAG.to_string());
        }
        // Fields: the original note type's when the note came from Anki, otherwise Ankhwiz's.
        let original = note.anki.as_ref().and_then(|a| kept.get(&a.ntid).map(|nt| (a, nt)));
        let (mid, flds, templates, guid) = match original {
            Some((a, nt)) => {
                kept_used.insert(nt.id.clone(), true);
                let mut fields = a.fields.clone();
                fields.resize(nt.fields.len().max(1), String::new());
                let seen = |i: usize| a.seen.get(i).cloned().unwrap_or_default();
                let last = fields.len() - 1;
                if note.front != seen(0) {
                    fields[nt.question.min(last)] = with_media(&voiced(&note.front, &note.voices), &note.qmedia);
                }
                if !nt.cloze && note.back != seen(1) {
                    fields[nt.answer.min(last)] = with_media(&voiced(&note.back, &note.voices), &note.amedia);
                }
                if let Some(x) = nt.extra {
                    if note.extra != seen(2) && x < fields.len() {
                        fields[x] = esc(&note.extra);
                    }
                }
                // More question fields come after the first three in `seen`, then more extra fields.
                for (i, &f) in nt.question_more.iter().enumerate() {
                    let now = note.front_more.get(i).cloned().unwrap_or_default();
                    if now != seen(3 + i) && f < fields.len() {
                        fields[f] = esc(&now);
                    }
                }
                for (i, &f) in nt.extra_more.iter().enumerate() {
                    let now = note.extra_more.get(i).cloned().unwrap_or_default();
                    if now != seen(3 + nt.question_more.len() + i) && f < fields.len() {
                        fields[f] = esc(&now);
                    }
                }
                if let (true, Some(o)) = (nt.occlusion, &note.occlusion) {
                    let find = |name: &str, or: usize| nt.fields.iter().position(|f| f == name).unwrap_or(or);
                    let (of, imf) = (find("Occlusion", 0), find("Image", 1));
                    let before = crate::occlusion::parse(fields.get(of).map(String::as_str).unwrap_or(""), fields.get(imf).map(String::as_str).unwrap_or(""));
                    if &before != o {
                        if before.shapes != o.shapes || before.hide_all != o.hide_all {
                            fields[of.min(last)] = crate::occlusion::write(o);
                        }
                        if before.image != o.image {
                            fields[imf.min(last)] = format!("<img src=\"{}\">", o.image.replace('"', "&quot;"));
                        }
                    }
                    if !media.contains(&o.image) {
                        media.push(o.image.clone());
                    }
                }
                (nt.id.parse::<i64>().unwrap_or(basic_id), fields, if nt.cloze { 1 } else { nt.templates.len() }, a.guid.clone())
            }
            None if note.occlusion.is_some() => {
                used_io = true;
                let o = note.occlusion.as_ref().unwrap();
                if !media.contains(&o.image) {
                    media.push(o.image.clone());
                }
                let fields = vec![
                    crate::occlusion::write(o),
                    format!("<img src=\"{}\">", o.image.replace('"', "&quot;")),
                    with_media(&esc(&note.front), &note.qmedia),
                    esc(&note.extra),
                    esc(&note.extra_more.join("\n")),
                ];
                (io_id, fields, 1, note.id.clone())
            }
            None if note.cloze => {
                used_cloze = true;
                let fields = vec![with_media(&voiced(&note.front, &note.voices), &note.qmedia), esc(&note.extra), esc(&note.alts.join(", "))];
                (cloze_id, fields, 1, note.id.clone())
            }
            None => {
                used_basic = true;
                let mut fields = vec![
                    with_media(&voiced(&note.front, &note.voices), &note.qmedia),
                    with_media(&voiced(&note.back, &note.voices), &note.amedia),
                    voiced(&note.extra, &note.voices),
                    esc(&note.alts.join(", ")),
                    esc(&note.wrong.join(", ")),
                ];
                fields.extend((0..q_more).map(|i| esc(note.front_more.get(i).map(String::as_str).unwrap_or(""))));
                fields.extend((0..x_more).map(|i| esc(note.extra_more.get(i).map(String::as_str).unwrap_or(""))));
                (basic_id, fields, basic_templates.len(), note.id.clone())
            }
        };
        let nid = id();
        notes.push(AnkiNoteRow {
            id: nid,
            guid,
            mid,
            tags: if tags.is_empty() { String::new() } else { format!(" {} ", tags.join(" ")) },
            sfld: strip(&flds[0]),
            csum: checksum(&flds[0]),
            flds: flds.join("\u{1f}"),
        });
        let did = unit_deck.get(&note.id).copied().unwrap_or(top);
        for (card_id, ord) in card_ords(deck, note, templates) {
            let cid = id();
            let state = if include_progress { progress.get(&card_id) } else { None };
            match state {
                None => {
                    new_pos += 1;
                    cards.push(AnkiCardRow { id: cid, nid, did, ord, ctype: 0, queue: 0, due: new_pos, ivl: 0, factor: 0, reps: 0, lapses: 0, data: "{}".into() });
                }
                Some(c) => {
                    let due_day = Clock::new(c.due, clock.tz).day();
                    let last = c.mem.map(|m| m.last_day).or(c.hist.last().map(|h| h.day)).unwrap_or(today);
                    let ivl = (due_day - last).max(1);
                    let custom = json!({"ankh": format!("{}.{}{}", c.stage, c.ok_days.len(), if c.demoted { "d" } else { "" })});
                    let mut data = json!({"cd": custom.to_string()});
                    if let Some(m) = c.mem {
                        data["s"] = json!((m.stability * 1000.0).round() / 1000.0);
                        data["d"] = json!((m.difficulty * 1000.0).round() / 1000.0);
                        data["dr"] = json!(deck.options.retention);
                        data["lrt"] = json!((clock.start_of(m.last_day) / 1000.0) as i64 + 43200);
                    }
                    cards.push(AnkiCardRow {
                        id: cid,
                        nid,
                        did,
                        ord,
                        ctype: 2,
                        queue: if c.suspended { -1 } else { 2 },
                        due: due_day - crt_day,
                        ivl,
                        factor: 2500,
                        reps: c.reps,
                        lapses: c.lapses,
                        data: data.to_string(),
                    });
                    for (i, h) in c.hist.iter().enumerate() {
                        revlog.push(AnkiRevRow {
                            id: clock.start_of(h.day) as i64 + 43_200_000 + (cid % 1000) * 10 + i as i64,
                            cid,
                            ease: if h.ok { 3 } else { 1 },
                            ivl: 0,
                            last_ivl: 0,
                            factor: 2500,
                            time: 6000,
                            rtype: if h.stage <= 1 { 0 } else { 1 },
                        });
                    }
                }
            }
        }
    }

    if used_basic {
        models.insert(basic_id.to_string(), model(basic_id, basic_name, false, &basic_fields, basic_templates.clone(), CSS, top, now_s));
    }
    if used_io {
        let mut m: Value = serde_json::from_str(include_str!("anki_io.json")).unwrap_or(json!({}));
        m["id"] = json!(io_id);
        m["mod"] = json!(now_s);
        m["usn"] = json!(-1);
        m["did"] = json!(top);
        m["tags"] = json!([]);
        m["vers"] = json!([]);
        models.insert(io_id.to_string(), m);
    }
    if used_cloze {
        let t = vec![template("Cloze", 0, "{{cloze:Text}}", "{{cloze:Text}}\n{{#Extra}}<div class=extra>{{Extra}}</div>{{/Extra}}")];
        models.insert(cloze_id.to_string(), model(cloze_id, "Ankhwiz Cloze", true, &cloze_fields, t, CSS, top, now_s));
    }
    for (ntid, nt) in kept.iter().filter(|(k, _)| kept_used.contains_key(*k)) {
        let templates = nt.templates.iter().enumerate().map(|(i, t)| template(&t.name, i, &t.qfmt, &t.afmt)).collect();
        let mid = nt.id.parse::<i64>().unwrap_or_else(|_| ntid.parse().unwrap_or(0));
        models.insert(mid.to_string(), model(mid, &nt.name, nt.cloze, &nt.fields, templates, &nt.css, top, now_s));
    }

    let mut dconf: Value = serde_json::from_str(include_str!("anki_dconf.json")).unwrap_or(json!({}));
    dconf["id"] = json!(1);
    dconf["maxIvl"] = json!(deck.options.max_interval);
    let conf = json!({"activeDecks": [1], "curDeck": top, "newSpread": 0, "collapseTime": 1200, "timeLim": 0, "estTimes": true,
                      "dueCounts": true, "curModel": null, "nextPos": new_pos + 1, "sortType": "noteFld", "sortBackwards": false, "addToCur": true});
    let _ = DAY_MS;
    AnkiExport {
        crt,
        models: Value::Object(models).to_string(),
        decks: Value::Object(decks).to_string(),
        dconf: json!({"1": dconf}).to_string(),
        conf: conf.to_string(),
        notes,
        cards,
        revlog,
        media,
    }
}

/// The card id an exported card came from, when it carries one; used by tests.
pub fn note_id_of(card_id: &str) -> &str {
    note_of(card_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_deck;
    use crate::stages::introduce;

    #[test]
    fn marked_words_go_to_anki_as_web_text() {
        let marks = vec![
            crate::model::VoiceMark { text: "la manzana".into(), lang: "es-ES".into() },
            crate::model::VoiceMark { text: "la".into(), lang: "fr-FR".into() },
        ];
        assert_eq!(voiced("What does la manzana mean? <3", &marks), "What does <span lang=\"es-ES\">la manzana</span> mean? &lt;3");
    }

    fn clock() -> Clock {
        Clock::new(1_794_300_000_000.0, 120.0)
    }

    #[test]
    fn exports_notes_cards_subdecks_and_lesson_tags() {
        let mut deck = sample_deck(0.0);
        deck.options.both_ways = true;
        let c = clock();
        let mut progress = Progress::new();
        let first = deck.lessons[&deck.units[0].lesson_ids[0]].note_ids[0].clone();
        let mut state = CardState { stage: 3, ok_days: vec![c.day()], ..introduce(c) };
        state.mem = Some(Memory { stability: 4.0, difficulty: 5.0, last_day: c.day() });
        state.due = c.now + 4.0 * DAY_MS;
        progress.insert(first.clone(), state);
        let out = export(&deck, &progress, true, c);
        assert_eq!(out.notes.len(), 36);
        assert_eq!(out.cards.len(), 72);
        let decks: Value = serde_json::from_str(&out.decks).unwrap();
        assert_eq!(decks.as_object().unwrap().len(), 4, "Default, the deck, and one per unit");
        assert!(out.notes[0].tags.contains("ankh::01-food::01-fruit"));
        let studied: Vec<&AnkiCardRow> = out.cards.iter().filter(|c| c.ctype == 2).collect();
        assert_eq!(studied.len(), 1);
        assert_eq!(studied[0].ivl, 4);
        assert!(studied[0].data.contains(r#""cd":"{\"ankh\":\"3.1\"}""#), "{}", studied[0].data);
        let models: Value = serde_json::from_str(&out.models).unwrap();
        assert_eq!(models.as_object().unwrap().values().next().unwrap()["tmpls"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn progress_survives_the_round_trip() {
        let c = clock();
        let crt_secs = c.start_of(c.day() - 10) / 1000.0;
        let sched = AnkiSched { ord: 0, ctype: 2, queue: 2, due: 14, ivl: 4, reps: 5, lapses: 1, data: r#"{"s":4.2,"d":6.1,"cd":"{\"ankh\":\"4.1\"}"}"#.into() };
        let fresh = AnkiSched { ord: 1, ctype: 0, queue: 0, due: 3, ..Default::default() };
        let rows = vec![
            RawNote { front: "la pera".into(), back: "the pear".into(), sched: vec![sched.clone(), fresh], ..Default::default() },
            RawNote { front: "la uva".into(), back: "the grape".into(), sched: vec![AnkiSched { data: "{}".into(), ivl: 30, ..sched.clone() }], ..Default::default() },
            RawNote { front: "el higo".into(), back: "the fig".into(), ..Default::default() },
        ];
        let (deck, progress) = build_with_progress("Fruit", &rows, &BuildOptions::default(), crt_secs, c);
        assert_eq!(progress.len(), 2);
        let pear = deck.notes.values().find(|n| n.front == "la pera").unwrap();
        let p = &progress[&pear.id];
        assert_eq!((p.stage, p.ok_days.len(), p.lapses), (4, 1, 1));
        assert_eq!(Clock::new(p.due, c.tz).day(), c.day() + 4);
        assert!((p.mem.unwrap().stability - 4.2).abs() < 1e-9);
        let grape = deck.notes.values().find(|n| n.front == "la uva").unwrap();
        assert_eq!(progress[&grape.id].stage, 5, "a 30-day interval reads as mastered");
    }
}
