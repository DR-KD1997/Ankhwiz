//! Answer checking: normalising, typo distance, live colour feedback.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

const PUNCT: &[char] = &[
    '.', '!', '?', '¡', '¿', ',', ';', ':', '"', '“', '”', '‘', '’', '\'', '`', '(', ')', '[', ']',
];

pub fn strip_accents(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).nfc().collect()
}

/// Lower-case, trim, collapse spaces, drop punctuation and (unless strict) accents.
pub fn normalize(s: &str, strict_accents: bool) -> String {
    let lowered: String = s.nfkc().collect::<String>().to_lowercase();
    let cleaned: String = lowered.chars().filter(|c| !PUNCT.contains(c)).collect();
    let spaced = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if strict_accents {
        spaced
    } else {
        strip_accents(&spaced)
    }
}

/// Edit distance where a swap of two neighbouring letters counts as one edit.
pub fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (m, n) = (a.len(), b.len());
    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }
    let mut prev2: Vec<usize> = vec![0; n + 1];
    let mut prev: Vec<usize> = (0..=n).collect();
    for i in 1..=m {
        let mut cur = vec![i; n + 1];
        for j in 1..=n {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(prev2[j - 2] + 1);
            }
            cur[j] = v;
        }
        prev2 = prev;
        prev = cur;
    }
    prev[n]
}

fn remove_parentheticals(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Every answer that counts as correct: the answer, listed alternatives,
/// forms without a parenthetical, and either side of "a / b".
pub fn accepted_answers(back: &str, alts: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |s: &str| {
        let t = s.trim();
        if !t.is_empty() && !out.iter().any(|o| o == t) {
            out.push(t.to_string());
        }
    };
    for base in std::iter::once(back).chain(alts.iter().map(String::as_str)) {
        add(base);
        let bare = remove_parentheticals(base);
        if bare != base.trim() {
            add(&bare);
        }
        let parts: Vec<&str> = bare.split(['/', ';', '|']).collect();
        if parts.len() > 1 {
            for p in parts {
                add(p);
            }
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Live {
    Empty,
    Match,
    Close,
    Off,
}

impl Live {
    pub fn as_str(self) -> &'static str {
        match self {
            Live::Empty => "empty",
            Live::Match => "match",
            Live::Close => "close",
            Live::Off => "off",
        }
    }
}

fn prefix(s: &str, chars: usize) -> String {
    s.chars().take(chars).collect()
}

/// Colour for the text typed so far: an exact start of an answer (green),
/// within a slip or two of one (yellow), or diverged (red).
pub fn live_feedback(typed: &str, accepted: &[String], strict: bool) -> Live {
    let t = normalize(typed, strict);
    if t.is_empty() {
        return Live::Empty;
    }
    let answers: Vec<String> = accepted.iter().map(|a| normalize(a, strict)).collect();
    if answers.iter().any(|a| a.starts_with(&t)) {
        return Live::Match;
    }
    if strict {
        let bare = strip_accents(&t);
        if answers.iter().any(|a| strip_accents(a).starts_with(&bare)) {
            return Live::Close;
        }
    }
    let len = t.chars().count();
    let tol = if len < 3 {
        0
    } else if len < 6 {
        1
    } else {
        2
    };
    if tol == 0 {
        return Live::Off;
    }
    for a in &answers {
        let a_len = a.chars().count();
        let lo = len.saturating_sub(tol);
        let hi = a_len.min(len + tol);
        for k in lo..=hi {
            if distance(&t, &prefix(a, k)) <= tol {
                return Live::Close;
            }
        }
    }
    Live::Off
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Correct,
    Typo,
    Wrong,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Correct => "correct",
            Verdict::Typo => "typo",
            Verdict::Wrong => "wrong",
        }
    }
}

/// Judge a submitted answer. A typo is one edit away from an answer of four
/// or more letters; the interface offers one spelling retry for it.
pub fn check_answer(typed: &str, accepted: &[String], strict: bool) -> Verdict {
    let t = normalize(typed, strict);
    if t.is_empty() {
        return Verdict::Wrong;
    }
    let mut typo = false;
    for raw in accepted {
        let a = normalize(raw, strict);
        if a == t {
            return Verdict::Correct;
        }
        if strict && strip_accents(&a) == strip_accents(&t) {
            typo = true;
        } else if a.chars().count() >= 4 && distance(&t, &a) == 1 {
            typo = true;
        }
    }
    if typo {
        Verdict::Typo
    } else {
        Verdict::Wrong
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerKind {
    Number,
    Short,
    Long,
}

/// Rough answer type, so a word is never offered beside a date or a paragraph.
pub fn answer_kind(s: &str) -> AnswerKind {
    let t = s.trim();
    let numeric = !t.is_empty()
        && t.chars().any(|c| c.is_ascii_digit())
        && t.chars().all(|c| c.is_ascii_digit() || " .,:/%+-–".contains(c));
    if numeric {
        AnswerKind::Number
    } else if t.chars().count() > 40 || t.split_whitespace().count() > 6 {
        AnswerKind::Long
    } else {
        AnswerKind::Short
    }
}

/// Whether an answer is short enough to ask the learner to type it exactly.
pub fn is_typeable(answer: &str) -> bool {
    answer_kind(answer) != AnswerKind::Long
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn normalises_case_spaces_punctuation_and_accents() {
        assert_eq!(normalize("  The   Apple! ", false), "the apple");
        assert_eq!(normalize("Melocotón", false), "melocoton");
        assert_eq!(normalize("Melocotón", true), "melocotón");
    }

    #[test]
    fn counts_a_swap_as_one_edit() {
        assert_eq!(distance("manzana", "manzana"), 0);
        assert_eq!(distance("manzna", "manzana"), 1);
        assert_eq!(distance("maznana", "manzana"), 1);
        assert!(distance("mesa", "manzana") > 2);
    }

    #[test]
    fn accepts_alternatives_bare_forms_and_slash_parts() {
        assert_eq!(accepted_answers("the apple", &v(&["apple"])), v(&["the apple", "apple"]));
        assert!(accepted_answers("to be (permanent)", &[]).contains(&"to be".to_string()));
        let both = accepted_answers("hello / hi", &[]);
        assert!(both.contains(&"hello".to_string()) && both.contains(&"hi".to_string()));
    }

    #[test]
    fn colours_typing() {
        let a = v(&["manzana"]);
        assert_eq!(live_feedback("", &a, false), Live::Empty);
        assert_eq!(live_feedback("manz", &a, false), Live::Match);
        assert_eq!(live_feedback("MANZANA", &a, false), Live::Match);
        assert_eq!(live_feedback("manzna", &a, false), Live::Close);
        assert_eq!(live_feedback("mesa", &a, false), Live::Off);
        assert_eq!(live_feedback("x", &a, false), Live::Off);
    }

    #[test]
    fn accents_matter_only_when_strict() {
        let a = v(&["melocotón"]);
        assert_eq!(live_feedback("melocoton", &a, false), Live::Match);
        assert_eq!(live_feedback("melocoton", &a, true), Live::Close);
        assert_eq!(check_answer("melocoton", &a, false), Verdict::Correct);
        assert_eq!(check_answer("melocoton", &a, true), Verdict::Typo);
    }

    #[test]
    fn judges_submitted_answers() {
        let a = v(&["the apple", "apple"]);
        assert_eq!(check_answer("The apple", &a, false), Verdict::Correct);
        assert_eq!(check_answer("apple", &a, false), Verdict::Correct);
        assert_eq!(check_answer("the aple", &v(&["the apple"]), false), Verdict::Typo);
        assert_eq!(check_answer("the pear", &v(&["the apple"]), false), Verdict::Wrong);
        assert_eq!(check_answer("tee", &v(&["tea"]), false), Verdict::Wrong);
        assert_eq!(check_answer("", &v(&["tea"]), false), Verdict::Wrong);
    }

    #[test]
    fn sorts_answers_into_kinds() {
        assert_eq!(answer_kind("1492"), AnswerKind::Number);
        assert_eq!(answer_kind("the apple"), AnswerKind::Short);
        assert_eq!(
            answer_kind("a long explanation that runs on for rather more than forty characters"),
            AnswerKind::Long
        );
    }
}
