// Timings for large decks (run with --ignored --nocapture). Not part of the normal tests.
use ankhwiz_core::model::*;
use ankhwiz_core::{distract, session, split, stages};
use std::time::Instant;

#[test]
#[ignore]
fn timings() {
    let n = 30000;
    let rows: Vec<RawNote> = (0..n).map(|i| serde_json::from_value(serde_json::json!({"front": format!("palabra número {i} del mazo"), "back": format!("word number {i} of the deck"), "extra": format!("Example {i}.")})).unwrap()).collect();
    let clock = Clock::new(1_794_300_000_000.0, 120.0);
    let deck = split::build_deck("Big", &rows, &serde_json::from_str("{\"lessonSize\":8}").unwrap(), clock.now);
    let mut progress = Progress::new();
    for (i, id) in deck.notes.keys().enumerate() { if i < n * 6 / 10 { let mut c = stages::introduce(clock); c.stage = 2 + (i % 3) as u8; progress.insert(id.clone(), c); } }
    let t = |name: &str, f: &dyn Fn()| { let s = Instant::now(); for _ in 0..3 { f(); } println!("{name}: {:.1} ms", s.elapsed().as_secs_f64() * 1000.0 / 3.0); };
    t("deck_view", &|| { session::deck_view(&deck, &progress, clock); });
    t("due_cards", &|| { session::due_cards(&deck, &progress, clock); });
    t("lessons_started_today", &|| { session::lessons_started_today(&deck, &progress, clock); });
    t("next_lesson_id", &|| { session::next_lesson_id(&deck, &progress); });
    t("index_deck", &|| { distract::index_deck(&deck); });
    let id = deck.notes.keys().next().unwrap().clone();
    t("pick_options", &|| { distract::pick_options(&deck, &id, 4, true); });
    t("make_exercise", &|| { session::make_exercise(&deck, &progress, &id, false); });
    t("deck_stats", &|| { session::deck_stats(&deck, &progress, clock); });
    let json = serde_json::to_string(&deck).unwrap();
    t("parse deck json", &|| { let _: Deck = serde_json::from_str(&json).unwrap(); });
}
