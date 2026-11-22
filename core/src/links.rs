//! Answers that mean the same. A deck can link notes whose answers mean the
//! same ("same") or nearly the same ("close"). On a card of a linked note:
//!
//! - "same": the other notes' answers count as right too (their backs on a
//!   forward card, their fronts on a reverse card), so they are never offered
//!   as wrong options either;
//! - "close": nothing more is accepted, but the other notes' answers are
//!   never offered as wrong options, so a fair near-synonym is never a trap.
//!
//! Gaps and pictures are not linked: their answers are parts of one note.

use crate::model::{Deck, Note};
use std::collections::BTreeSet;

pub const SAME: &str = "same";
pub const CLOSE: &str = "close";

/// Other notes linked to this one by links of the given kind.
pub fn linked<'a>(deck: &'a Deck, note_id: &str, kind: &str) -> Vec<&'a Note> {
    let mut ids: BTreeSet<&str> = BTreeSet::new();
    for l in deck.links.iter().filter(|l| l.kind == kind && l.notes.iter().any(|n| n == note_id)) {
        for n in &l.notes {
            if n != note_id {
                ids.insert(n.as_str());
            }
        }
    }
    ids.into_iter().filter_map(|id| deck.notes.get(id)).filter(|n| !n.cloze && n.occlusion.is_none()).collect()
}

/// The side of a note a card expects: its back, or its front when asked the other way.
pub fn side(note: &Note, reverse: bool) -> &str {
    if reverse {
        &note.front
    } else {
        &note.back
    }
}

/// Answers that count on a card because of "same" links, each note's answer
/// and (forward only) its own extra answers.
pub fn same_answers(deck: &Deck, note_id: &str, reverse: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in linked(deck, note_id, SAME) {
        let mut add = |s: &str| {
            let t = s.trim();
            if !t.is_empty() && !out.iter().any(|o| o == t) {
                out.push(t.to_string());
            }
        };
        add(side(n, reverse));
        if !reverse {
            for a in &n.alts {
                add(a);
            }
        }
    }
    out
}

/// Answers never offered as wrong options on a card because of "close" links.
pub fn close_answers(deck: &Deck, note_id: &str, reverse: bool) -> Vec<String> {
    linked(deck, note_id, CLOSE).into_iter().map(|n| side(n, reverse).trim().to_string()).filter(|s| !s.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::distract::pick_options;
    use crate::model::AnswerLink;
    use crate::rng::seed;

    fn deck() -> Deck {
        let rows: Vec<crate::model::RawNote> = [
            ("Anlıyorum.", "I understand."),
            ("Anladım.", "I got it."),
            ("Kavrıyorum.", "I grasp it."),
            ("Geliyorum.", "I'm coming."),
            ("Biliyorum.", "I know."),
            ("Bekliyorum.", "I'm waiting."),
        ]
        .iter()
        .map(|(f, b)| serde_json::from_value(serde_json::json!({"front": f, "back": b})).unwrap())
        .collect();
        crate::split::build_deck("T", &rows, &serde_json::from_str("{\"lessonSize\":6}").unwrap(), 0.0)
    }

    fn id_of(d: &Deck, front: &str) -> String {
        d.notes.values().find(|n| n.front == front).unwrap().id.clone()
    }

    #[test]
    fn same_links_are_accepted_both_ways_and_close_links_only_kept_apart() {
        let mut d = deck();
        let a = id_of(&d, "Anlıyorum.");
        let b = id_of(&d, "Anladım.");
        let c = id_of(&d, "Kavrıyorum.");
        d.options.both_ways = true;
        d.links.push(AnswerLink { id: "l1".into(), kind: SAME.into(), notes: vec![a.clone(), c.clone()], ..Default::default() });
        d.links.push(AnswerLink { id: "l2".into(), kind: CLOSE.into(), notes: vec![a.clone(), b.clone()], ..Default::default() });
        let f = crate::cards::face(&d, &a).unwrap();
        assert!(f.accepted.contains(&"I grasp it.".to_string()));
        assert!(!f.accepted.contains(&"I got it.".to_string()));
        assert_eq!(f.linked, vec!["I grasp it.".to_string()]);
        let r = crate::cards::face(&d, &format!("{a}:r")).unwrap();
        assert!(r.accepted.contains(&"Kavrıyorum.".to_string()));
        for s in 0..40 {
            seed(s);
            let opts = pick_options(&d, &a, 6, s % 2 == 0);
            assert!(opts.contains(&"I understand.".to_string()));
            assert!(!opts.contains(&"I got it.".to_string()), "{opts:?}");
            assert!(!opts.contains(&"I grasp it.".to_string()), "{opts:?}");
            let ropts = pick_options(&d, &format!("{a}:r"), 6, true);
            assert!(!ropts.contains(&"Anladım.".to_string()) && !ropts.contains(&"Kavrıyorum.".to_string()), "{ropts:?}");
        }
        // The other way: the close note does not accept "I understand." either.
        let fb = crate::cards::face(&d, &b).unwrap();
        assert!(!fb.accepted.contains(&"I understand.".to_string()));
    }
}
