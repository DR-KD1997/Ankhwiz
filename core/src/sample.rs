//! A small built-in deck for trying the app without importing anything.

use crate::model::{Deck, RawNote};
use crate::split::{build_deck, BuildOptions};
use std::collections::BTreeMap;

type Words = &'static [(&'static str, &'static str, &'static str)];

const DATA: &[(&str, &[(&str, Words)])] = &[
    (
        "Food",
        &[
            ("Fruit", &[
                ("la manzana", "the apple", ""),
                ("la pera", "the pear", ""),
                ("la uva", "the grape", ""),
                ("el melocotón", "the peach", ""),
                ("la naranja", "the orange", ""),
                ("el plátano", "the banana", ""),
            ]),
            ("Drinks", &[
                ("el agua", "the water", ""),
                ("la leche", "the milk", ""),
                ("el café", "the coffee", ""),
                ("el té", "the tea", ""),
                ("el jugo", "the juice", ""),
                ("el vino", "the wine", ""),
            ]),
            ("At the table", &[
                ("el pan", "the bread", ""),
                ("el queso", "the cheese", ""),
                ("la sal", "the salt", ""),
                ("el plato", "the plate", ""),
                ("el vaso", "the glass", ""),
                ("la cuchara", "the spoon", ""),
            ]),
        ],
    ),
    (
        "Everyday",
        &[
            ("Greetings", &[
                ("hola", "hello", "hi"),
                ("adiós", "goodbye", "bye"),
                ("gracias", "thank you", "thanks"),
                ("por favor", "please", ""),
                ("buenos días", "good morning", ""),
                ("buenas noches", "good night", ""),
            ]),
            ("Numbers 1 to 6", &[
                ("uno", "one", ""),
                ("dos", "two", ""),
                ("tres", "three", ""),
                ("cuatro", "four", ""),
                ("cinco", "five", ""),
                ("seis", "six", ""),
            ]),
            ("Colours", &[
                ("rojo", "red", ""),
                ("azul", "blue", ""),
                ("verde", "green", ""),
                ("amarillo", "yellow", ""),
                ("negro", "black", ""),
                ("blanco", "white", ""),
            ]),
        ],
    ),
];

pub fn sample_deck(now: f64) -> Deck {
    let mut rows = Vec::new();
    let mut lesson_names: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (unit, lessons) in DATA {
        lesson_names.insert(unit.to_string(), lessons.iter().map(|(name, _)| name.to_string()).collect());
        for (_, words) in *lessons {
            for (front, back, alt) in *words {
                let mut alts = Vec::new();
                if !alt.is_empty() {
                    alts.push(alt.to_string());
                }
                // "the apple" is also accepted as "apple".
                if let Some(bare) = back.strip_prefix("the ") {
                    alts.push(bare.to_string());
                }
                rows.push(RawNote {
                    front: front.to_string(),
                    back: back.to_string(),
                    alts,
                    group: Some(unit.to_string()),
                    ..Default::default()
                });
            }
        }
    }
    build_deck(
        "Spanish basics (sample)",
        &rows,
        &BuildOptions {
            lesson_size: Some(6.0),
            prompt: Some("What does “{front}” mean?".to_string()),
            lesson_names,
            ..Default::default()
        },
        now,
    )
}
