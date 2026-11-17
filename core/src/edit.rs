//! Changes to a deck's contents: the card editor, lesson reordering, and
//! changes Thoth proposes. All of them go through `apply`, so they follow
//! the same rules: lessons never hold a note twice, empty lessons and units
//! are tidied away, and AI changes are marked.

use crate::model::{Deck, Lesson, RawNote, Unit};
use crate::rng::uid;
use crate::split::{add_notes, note_from};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Edit {
    /// Change a note. Fields left out stay as they are.
    #[serde(rename_all = "camelCase")]
    Update {
        note_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        front: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        back: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        extra: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        alts: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrong: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        labels: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        qmedia: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        amedia: Option<Vec<String>>,
        /// Make it a fill-the-gap card (needs gaps in the front) or an ordinary one (needs an answer).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cloze: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        front_more: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        extra_more: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        self_check: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        no_build: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        voices: Option<Vec<crate::model::VoiceMark>>,
        /// The picture and its hidden parts (a picture card only).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occlusion: Option<crate::model::Occlusion>,
    },
    /// Add a note to a lesson, or (without a lesson) as a new lesson in a unit named `unit`.
    #[serde(rename_all = "camelCase")]
    Add {
        #[serde(default)]
        lesson_id: Option<String>,
        #[serde(default)]
        unit: Option<String>,
        note: RawNote,
    },
    #[serde(rename_all = "camelCase")]
    Delete { note_id: String },
    /// Move a note to a lesson (at the end).
    #[serde(rename_all = "camelCase")]
    Move { note_id: String, lesson_id: String },
    #[serde(rename_all = "camelCase")]
    RenameLesson { lesson_id: String, name: String },
    #[serde(rename_all = "camelCase")]
    RenameUnit { unit_id: String, name: String },
    /// Move a lesson up (-1) or down (+1) the path, crossing into the next unit at the edges.
    #[serde(rename_all = "camelCase")]
    ShiftLesson { lesson_id: String, delta: i32 },
    /// A new empty lesson at the end of a unit.
    #[serde(rename_all = "camelCase")]
    AddLesson { unit_id: String, name: String },
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    /// Edits that pointed at something that no longer exists.
    pub skipped: usize,
}

/// More fields keep their places; a note from Anki keeps its blanks too,
/// since each place stands for one of its Anki fields.
fn keep_places(v: &[String], anki: bool) -> Vec<String> {
    let mut out: Vec<String> = v.iter().map(|s| s.trim().to_string()).collect();
    if !anki {
        out.retain(|s| !s.is_empty());
    }
    out
}

fn clean(v: &[String]) -> Vec<String> {
    v.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

fn lesson_of(deck: &Deck, note_id: &str) -> Option<String> {
    deck.lessons.iter().find(|(_, l)| l.note_ids.iter().any(|n| n == note_id)).map(|(id, _)| id.clone())
}

/// Remove lessons emptied by this round of edits (an empty lesson made on
/// purpose stays until something is put in it), then units left with none.
fn tidy(deck: &mut Deck, had_notes: &[String]) {
    let empty: Vec<String> = deck
        .lessons
        .iter()
        .filter(|(id, l)| l.note_ids.is_empty() && had_notes.contains(id))
        .map(|(id, _)| id.clone())
        .collect();
    for id in &empty {
        deck.lessons.remove(id);
    }
    for unit in deck.units.iter_mut() {
        unit.lesson_ids.retain(|l| deck.lessons.contains_key(l));
    }
    let before = deck.units.len();
    deck.units.retain(|u| !u.lesson_ids.is_empty());
    if deck.units.is_empty() && before > 0 {
        deck.units.push(Unit { id: uid("u"), name: deck.name.clone(), lesson_ids: vec![] });
    }
}

pub fn apply(deck: &mut Deck, edits: &[Edit], ai: bool) -> Applied {
    let mut done = Applied::default();
    let had_notes: Vec<String> = deck.lessons.iter().filter(|(_, l)| !l.note_ids.is_empty()).map(|(id, _)| id.clone()).collect();
    for edit in edits {
        match edit {
            Edit::Update { note_id, front, back, extra, alts, wrong, labels, qmedia, amedia, cloze, front_more, extra_more, self_check, no_build, voices, occlusion } => {
                let Some(note) = deck.notes.get_mut(note_id) else {
                    done.skipped += 1;
                    continue;
                };
                // A picture's question (its header) may be left empty.
                if let (Some(v), true) = (front.as_ref(), note.occlusion.is_some()) {
                    note.front = v.trim().to_string();
                } else if let Some(v) = front.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    note.front = v.to_string();
                    if note.cloze && crate::cards::cloze_numbers(v).is_empty() {
                        // The gaps were removed: it becomes an ordinary card if it has an answer.
                        note.cloze = note.back.trim().is_empty();
                    }
                }
                if let Some(v) = back.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    note.back = v.to_string();
                }
                if let Some(v) = extra {
                    note.extra = v.trim().to_string();
                }
                if let Some(v) = alts {
                    note.alts = clean(v);
                }
                if let Some(v) = wrong {
                    note.wrong = clean(v);
                }
                if let Some(v) = labels {
                    note.labels = clean(v);
                }
                if let Some(v) = qmedia {
                    note.qmedia = v.clone();
                }
                if let Some(v) = amedia {
                    note.amedia = v.clone();
                }
                if let Some(v) = front_more {
                    note.front_more = keep_places(v, note.anki.is_some());
                }
                if let Some(v) = extra_more {
                    note.extra_more = keep_places(v, note.anki.is_some());
                }
                if let Some(v) = self_check {
                    note.self_check = *v;
                }
                if let Some(v) = no_build {
                    note.no_build = *v;
                }
                if let Some(v) = voices {
                    note.voices = v.iter().filter(|m| !m.text.trim().is_empty() && !m.lang.trim().is_empty()).cloned().collect();
                }
                if let (Some(o), true) = (occlusion, note.occlusion.is_some()) {
                    if !o.shapes.is_empty() && !o.image.is_empty() {
                        note.occlusion = Some(o.clone());
                    }
                }
                match cloze {
                    Some(true) if !crate::cards::cloze_numbers(&note.front).is_empty() => note.cloze = true,
                    Some(false) if !note.back.trim().is_empty() => note.cloze = false,
                    _ => {}
                }
                if ai {
                    note.ai = true;
                }
            }
            Edit::Add { lesson_id, unit, note } => match lesson_id.as_ref().filter(|l| deck.lessons.contains_key(*l)) {
                Some(lesson_id) => {
                    let Some(n) = note_from(note, ai) else {
                        done.skipped += 1;
                        continue;
                    };
                    done.added.push(n.id.clone());
                    deck.lessons.get_mut(lesson_id).map(|l| l.note_ids.push(n.id.clone()));
                    deck.notes.insert(n.id.clone(), n);
                }
                None => {
                    let name = unit.clone().filter(|u| !u.trim().is_empty()).unwrap_or_else(|| "New cards".into());
                    let ids = add_notes(deck, name.trim(), std::slice::from_ref(note), ai);
                    if ids.is_empty() {
                        done.skipped += 1;
                    }
                    done.added.extend(ids);
                }
            },
            Edit::Delete { note_id } => {
                if deck.notes.remove(note_id).is_none() {
                    done.skipped += 1;
                    continue;
                }
                for lesson in deck.lessons.values_mut() {
                    lesson.note_ids.retain(|n| n != note_id);
                }
                done.removed.push(note_id.clone());
            }
            Edit::Move { note_id, lesson_id } => {
                if !deck.notes.contains_key(note_id) || !deck.lessons.contains_key(lesson_id) {
                    done.skipped += 1;
                    continue;
                }
                if lesson_of(deck, note_id).as_deref() == Some(lesson_id.as_str()) {
                    continue;
                }
                for lesson in deck.lessons.values_mut() {
                    lesson.note_ids.retain(|n| n != note_id);
                }
                deck.lessons.get_mut(lesson_id).map(|l| l.note_ids.push(note_id.clone()));
            }
            Edit::RenameLesson { lesson_id, name } => match deck.lessons.get_mut(lesson_id) {
                Some(l) if !name.trim().is_empty() => l.name = name.trim().chars().take(60).collect(),
                _ => done.skipped += 1,
            },
            Edit::RenameUnit { unit_id, name } => match deck.units.iter_mut().find(|u| &u.id == unit_id) {
                Some(u) if !name.trim().is_empty() => u.name = name.trim().chars().take(60).collect(),
                _ => done.skipped += 1,
            },
            Edit::ShiftLesson { lesson_id, delta } => {
                let Some(ui) = deck.units.iter().position(|u| u.lesson_ids.contains(lesson_id)) else {
                    done.skipped += 1;
                    continue;
                };
                let li = deck.units[ui].lesson_ids.iter().position(|l| l == lesson_id).unwrap_or(0);
                let len = deck.units[ui].lesson_ids.len();
                if *delta < 0 && li > 0 {
                    deck.units[ui].lesson_ids.swap(li, li - 1);
                } else if *delta > 0 && li + 1 < len {
                    deck.units[ui].lesson_ids.swap(li, li + 1);
                } else if *delta < 0 && ui > 0 {
                    let id = deck.units[ui].lesson_ids.remove(li);
                    deck.units[ui - 1].lesson_ids.push(id);
                } else if *delta > 0 && ui + 1 < deck.units.len() {
                    let id = deck.units[ui].lesson_ids.remove(li);
                    deck.units[ui + 1].lesson_ids.insert(0, id);
                }
            }
            Edit::AddLesson { unit_id, name } => {
                let Some(unit) = deck.units.iter_mut().find(|u| &u.id == unit_id) else {
                    done.skipped += 1;
                    continue;
                };
                let lesson = Lesson { id: uid("l"), name: if name.trim().is_empty() { "New lesson".into() } else { name.trim().into() }, note_ids: vec![] };
                unit.lesson_ids.push(lesson.id.clone());
                deck.lessons.insert(lesson.id.clone(), lesson);
            }
        }
    }
    tidy(deck, &had_notes);
    done
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_deck;

    #[test]
    fn updates_adds_moves_and_deletes() {
        let mut deck = sample_deck(0.0);
        let l0 = deck.units[0].lesson_ids[0].clone();
        let l1 = deck.units[0].lesson_ids[1].clone();
        let n0 = deck.lessons[&l0].note_ids[0].clone();
        let n1 = deck.lessons[&l0].note_ids[1].clone();
        let r = apply(
            &mut deck,
            &[
                Edit::Update { note_id: n0.clone(), front: None, back: Some("the red apple".into()), extra: Some("Una manzana al día.".into()), alts: None, wrong: None, labels: Some(vec!["food".into(), " ".into()]), qmedia: None, amedia: None, cloze: None, front_more: None, extra_more: None, self_check: None, no_build: None, voices: None, occlusion: None },
                Edit::Add { lesson_id: Some(l0.clone()), unit: None, note: RawNote { front: "la fresa".into(), back: "the strawberry".into(), ..Default::default() } },
                Edit::Move { note_id: n1.clone(), lesson_id: l1.clone() },
                Edit::Delete { note_id: "missing".into() },
            ],
            true,
        );
        assert_eq!((r.added.len(), r.skipped), (1, 1));
        let n = &deck.notes[&n0];
        assert_eq!((n.back.as_str(), n.extra.as_str(), n.labels.len(), n.ai), ("the red apple", "Una manzana al día.", 1, true));
        assert_eq!(deck.lessons[&l0].note_ids.len(), 6);
        assert!(deck.lessons[&l1].note_ids.contains(&n1));
        let r = apply(&mut deck, &[Edit::Delete { note_id: n0.clone() }], false);
        assert_eq!(r.removed, vec![n0.clone()]);
        assert!(!deck.lessons[&l0].note_ids.contains(&n0));
    }

    #[test]
    fn lessons_can_be_renamed_shifted_and_emptied() {
        let mut deck = sample_deck(0.0);
        let first_unit_last = deck.units[0].lesson_ids[2].clone();
        apply(&mut deck, &[Edit::ShiftLesson { lesson_id: first_unit_last.clone(), delta: 1 }], false);
        assert_eq!(deck.units[1].lesson_ids[0], first_unit_last, "crosses into the next unit");
        apply(&mut deck, &[Edit::RenameLesson { lesson_id: first_unit_last.clone(), name: "Mesa".into() }], false);
        assert_eq!(deck.lessons[&first_unit_last].name, "Mesa");
        let unit = deck.units[0].id.clone();
        apply(&mut deck, &[Edit::AddLesson { unit_id: unit, name: "Spare".into() }], false);
        assert_eq!(deck.units[0].lesson_ids.len(), 3, "an empty lesson made on purpose stays");
        let ids = deck.lessons[&first_unit_last].note_ids.clone();
        let deletes: Vec<Edit> = ids.into_iter().map(|note_id| Edit::Delete { note_id }).collect();
        apply(&mut deck, &deletes, false);
        assert!(!deck.lessons.contains_key(&first_unit_last), "emptied lessons are tidied away");
    }
}
