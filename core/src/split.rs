//! Turning a flat list of notes into a deck of units and lessons.
//! Grouping uses the best signal available: the note's group (a subdeck or
//! tag from the import) when there is more than one, otherwise card order.

use crate::model::{Deck, Lesson, Note, Progress, RawNote, Unit};
use crate::rng::uid;
use crate::text::strip_accents;
use serde::Deserialize;
use std::collections::BTreeMap;

pub const MIN_LESSON: usize = 3;
pub const MAX_LESSON: usize = 12;
pub const DEFAULT_LESSON: usize = 6;

pub fn clamp_lesson_size(n: f64) -> usize {
    if !n.is_finite() || n.round() < 1.0 {
        return DEFAULT_LESSON;
    }
    (n.round() as usize).clamp(MIN_LESSON, MAX_LESSON)
}

fn chunk<T: Clone>(items: &[T], size: usize) -> Vec<Vec<T>> {
    let mut out: Vec<Vec<T>> = items.chunks(size.max(1)).map(<[T]>::to_vec).collect();
    // Avoid a final lesson of one or two notes: fold it into the one before.
    if out.len() > 1 && out[out.len() - 1].len() < MIN_LESSON {
        if let Some(last) = out.pop() {
            let n = out.len();
            out[n - 1].extend(last);
        }
    }
    out
}

#[derive(Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct BuildOptions {
    pub lesson_size: Option<f64>,
    pub prompt: Option<String>,
    pub strict_accents: bool,
    /// Names for lessons, by unit name then lesson position.
    pub lesson_names: BTreeMap<String, Vec<String>>,
    /// Marks every note as written by AI.
    pub ai: bool,
}

/// A note from an imported or written row; None when a side is empty.
/// A fill-the-gap note needs only its text, with at least one gap.
pub fn note_from(row: &RawNote, ai: bool) -> Option<Note> {
    let front = row.front.trim();
    let back = row.back.trim();
    let occlusion = row.occlusion.clone().filter(|o| !o.shapes.is_empty() && !o.image.is_empty());
    let cloze = occlusion.is_none() && (row.cloze || (back.is_empty() && !crate::cards::cloze_numbers(front).is_empty()));
    if occlusion.is_none() && (front.is_empty() || (back.is_empty() && !cloze) || (cloze && crate::cards::cloze_numbers(front).is_empty())) {
        return None;
    }
    let clean = |v: &[String]| v.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect::<Vec<_>>();
    // Extra question and extra fields keep their places (they line up with
    // Anki fields on export); only trailing blanks are dropped.
    let keep = |v: &[String]| {
        let mut out: Vec<String> = v.iter().map(|a| a.trim().to_string()).collect();
        while out.last().is_some_and(|x| x.is_empty()) && row.anki.is_none() {
            out.pop();
        }
        out
    };
    Some(Note {
        id: uid("n"),
        front: front.to_string(),
        back: back.to_string(),
        alts: clean(&row.alts),
        wrong: clean(&row.wrong),
        ai,
        extra: row.extra.trim().to_string(),
        labels: clean(&row.labels),
        qmedia: row.qmedia.clone(),
        amedia: row.amedia.clone(),
        cloze,
        anki: row.anki.clone(),
        front_more: keep(&row.front_more),
        extra_more: keep(&row.extra_more),
        self_check: row.self_check,
        occlusion,
    })
}

pub fn build_deck(name: &str, rows: &[RawNote], options: &BuildOptions, now: f64) -> Deck {
    let lesson_size = clamp_lesson_size(options.lesson_size.unwrap_or(DEFAULT_LESSON as f64));
    let mut notes: BTreeMap<String, Note> = BTreeMap::new();
    let mut lessons: BTreeMap<String, Lesson> = BTreeMap::new();
    let mut units: Vec<Unit> = Vec::new();

    // Keep groups in the order they first appear.
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    let mut all: Vec<String> = Vec::new();
    let mut lesson_of: BTreeMap<String, String> = BTreeMap::new();
    for row in rows {
        let Some(note) = note_from(row, options.ai) else { continue };
        if let Some(l) = row.lesson.as_ref().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            lesson_of.insert(note.id.clone(), l.to_string());
        }
        let key = row.group.as_deref().unwrap_or("").trim().to_string();
        match groups.iter_mut().find(|(g, _)| *g == key) {
            Some((_, list)) => list.push(note.id.clone()),
            None => groups.push((key, vec![note.id.clone()])),
        }
        all.push(note.id.clone());
        notes.insert(note.id.clone(), note);
    }

    let use_groups = groups.len() > 1;
    let buckets: Vec<(String, Vec<String>)> = if use_groups { groups } else { vec![(String::new(), all)] };
    let mut lesson_number = 0;
    for (group, list) in buckets {
        let unit_name = if !use_groups {
            name.to_string()
        } else if group.is_empty() {
            "Other".to_string()
        } else {
            group
        };
        let mut unit = Unit { id: uid("u"), name: unit_name.clone(), lesson_ids: vec![] };
        // Notes that name their lesson (an Ankhwiz deck coming back from Anki) keep it;
        // the rest are divided by size.
        let mut parts: Vec<(Option<String>, Vec<String>)> = Vec::new();
        let mut loose: Vec<String> = Vec::new();
        for id in &list {
            match lesson_of.get(id) {
                Some(name) => match parts.iter_mut().find(|(n, _)| n.as_deref() == Some(name.as_str())) {
                    Some((_, ids)) => ids.push(id.clone()),
                    None => parts.push((Some(name.clone()), vec![id.clone()])),
                },
                None => loose.push(id.clone()),
            }
        }
        parts.extend(chunk(&loose, lesson_size).into_iter().map(|p| (None, p)));
        for (i, (given, part)) in parts.into_iter().enumerate() {
            lesson_number += 1;
            let named = given.or_else(|| options.lesson_names.get(&unit_name).and_then(|n| n.get(i)).cloned());
            let lesson = Lesson {
                id: uid("l"),
                name: named.unwrap_or_else(|| format!("Lesson {lesson_number}")),
                note_ids: part,
            };
            unit.lesson_ids.push(lesson.id.clone());
            lessons.insert(lesson.id.clone(), lesson);
        }
        if !unit.lesson_ids.is_empty() {
            units.push(unit);
        }
    }

    Deck {
        id: uid("d"),
        name: name.to_string(),
        prompt: options.prompt.clone(),
        notes,
        lessons,
        units,
        lesson_size,
        strict_accents: options.strict_accents,
        created: now,
        readings: vec![],
        options: crate::model::DeckOptions::default(),
        anki: None,
    }
}

/// Change the lesson size. Lessons the learner has started keep their notes;
/// only lessons with nothing introduced yet are divided again.
pub fn resplit(deck: &Deck, progress: &Progress, lesson_size: f64) -> Deck {
    let size = clamp_lesson_size(lesson_size);
    let mut lessons: BTreeMap<String, Lesson> = BTreeMap::new();
    let mut number = 0;
    let mut units = Vec::new();
    for unit in &deck.units {
        let mut lesson_ids = Vec::new();
        let mut loose: Vec<String> = Vec::new();
        for id in &unit.lesson_ids {
            let Some(lesson) = deck.lessons.get(id) else { continue };
            if lesson.note_ids.iter().any(|n| progress.contains_key(n)) {
                number += 1;
                lessons.insert(id.clone(), lesson.clone());
                lesson_ids.push(id.clone());
            } else {
                loose.extend(lesson.note_ids.iter().cloned());
            }
        }
        for part in chunk(&loose, size) {
            number += 1;
            let lesson = Lesson { id: uid("l"), name: format!("Lesson {number}"), note_ids: part };
            lesson_ids.push(lesson.id.clone());
            lessons.insert(lesson.id.clone(), lesson);
        }
        units.push(Unit { lesson_ids, ..unit.clone() });
    }
    Deck { lessons, units, lesson_size: size, ..deck.clone() }
}

/// Add notes to a deck as new lessons in a unit of their own (or an existing
/// unit with the same name). Returns the ids of the notes added.
pub fn add_notes(deck: &mut Deck, unit_name: &str, rows: &[RawNote], ai: bool) -> Vec<String> {
    let mut ids = Vec::new();
    for row in rows {
        let Some(note) = note_from(row, ai) else { continue };
        ids.push(note.id.clone());
        deck.notes.insert(note.id.clone(), note);
    }
    if ids.is_empty() {
        return ids;
    }
    let mut number = deck.lessons.len();
    let mut new_lessons = Vec::new();
    for part in chunk(&ids, deck.lesson_size.clamp(MIN_LESSON, MAX_LESSON)) {
        number += 1;
        let lesson = Lesson { id: uid("l"), name: format!("Lesson {number}"), note_ids: part };
        new_lessons.push(lesson.id.clone());
        deck.lessons.insert(lesson.id.clone(), lesson);
    }
    match deck.units.iter_mut().find(|u| u.name == unit_name) {
        Some(unit) => unit.lesson_ids.extend(new_lessons),
        None => deck.units.push(Unit { id: uid("u"), name: unit_name.to_string(), lesson_ids: new_lessons }),
    }
    ids
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in strip_accents(s).to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "x".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The hierarchical tag that records a note's place on the path, such as
/// `ankh::02-food::03-fruit`. This is how lessons survive a round trip
/// through an Anki .apkg file.
pub fn lesson_tag(deck: &Deck, note_id: &str) -> Option<String> {
    for (u, unit) in deck.units.iter().enumerate() {
        for (l, lesson_id) in unit.lesson_ids.iter().enumerate() {
            let lesson = deck.lessons.get(lesson_id)?;
            if lesson.note_ids.iter().any(|n| n == note_id) {
                return Some(format!("ankh::{:02}-{}::{:02}-{}", u + 1, slug(&unit.name), l + 1, slug(&lesson.name)));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Clock;
    use crate::stages::introduce;

    fn rows(n: usize, group: Option<&str>) -> Vec<RawNote> {
        (0..n)
            .map(|i| RawNote {
                front: format!("f{i}"),
                back: format!("b{i}"),
                alts: vec![],
                group: group.map(str::to_string),
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn splits_by_size_and_folds_a_short_tail() {
        let deck = build_deck("D", &rows(13, None), &BuildOptions { lesson_size: Some(6.0), ..Default::default() }, 0.0);
        let sizes: Vec<usize> = deck.units[0].lesson_ids.iter().map(|id| deck.lessons[id].note_ids.len()).collect();
        assert_eq!(sizes, vec![6, 7]);
        assert_eq!(deck.units.len(), 1);
    }

    #[test]
    fn groups_become_units_in_first_seen_order() {
        let mut all = rows(6, Some("B"));
        all.extend(rows(6, Some("A")));
        let deck = build_deck("D", &all, &BuildOptions::default(), 0.0);
        let names: Vec<&str> = deck.units.iter().map(|u| u.name.as_str()).collect();
        assert_eq!(names, vec!["B", "A"]);
    }

    #[test]
    fn skips_blank_rows_and_clamps_size() {
        let mut r = rows(4, None);
        r.push(RawNote { front: " ".into(), back: "x".into(), ..Default::default() });
        let deck = build_deck("D", &r, &BuildOptions { lesson_size: Some(99.0), ..Default::default() }, 0.0);
        assert_eq!(deck.notes.len(), 4);
        assert_eq!(deck.lesson_size, MAX_LESSON);
    }

    #[test]
    fn resplit_keeps_started_lessons() {
        let deck = build_deck("D", &rows(24, None), &BuildOptions { lesson_size: Some(6.0), ..Default::default() }, 0.0);
        let first = deck.units[0].lesson_ids[0].clone();
        let mut progress = Progress::new();
        progress.insert(deck.lessons[&first].note_ids[0].clone(), introduce(Clock::new(0.0, 0.0)));
        let again = resplit(&deck, &progress, 9.0);
        assert_eq!(again.lessons[&first].note_ids.len(), 6);
        let sizes: Vec<usize> = again.units[0].lesson_ids.iter().map(|id| again.lessons[id].note_ids.len()).collect();
        assert_eq!(sizes, vec![6, 9, 9]);
        assert_eq!(again.notes.len(), 24);
    }

    #[test]
    fn writes_path_tags() {
        let mut r = rows(3, Some("Food & Drink"));
        r.extend(rows(3, Some("Café")));
        let deck = build_deck("D", &r, &BuildOptions::default(), 0.0);
        let id = deck.lessons[&deck.units[1].lesson_ids[0]].note_ids[0].clone();
        assert_eq!(lesson_tag(&deck, &id).as_deref(), Some("ankh::02-cafe::01-lesson-2"));
    }

    #[test]
    fn adds_notes_as_new_lessons() {
        let mut deck = build_deck("D", &rows(6, None), &BuildOptions::default(), 0.0);
        let ids = add_notes(&mut deck, "Added by AI", &rows(7, None), true);
        assert_eq!(ids.len(), 7);
        assert_eq!(deck.units.len(), 2);
        assert!(deck.notes[&ids[0]].ai);
    }
}
