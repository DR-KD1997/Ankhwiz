//! Furigana: kana readings written over kanji, in Anki's form `日本[にほん]`.
//!
//! A reading in brackets belongs to the run of characters just before it, back
//! to the previous space (or the start, or a `>`). The space only marks where
//! the run starts and is not shown: `毎朝[まいあさ] 日本語[にほんご]を`.
//! Only brackets holding kana count as readings, so "[1]" or "[sic]" stay text.

/// One piece of a text: its characters and, for a word with a reading, the reading.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub base: String,
    pub reading: Option<String>,
}

pub fn is_kana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}')
}

pub fn is_kanji(c: char) -> bool {
    matches!(c, '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' | '\u{F900}'..='\u{FAFF}' | '々' | '〆' | 'ヶ')
}

pub fn has_kanji(s: &str) -> bool {
    s.chars().any(is_kanji)
}

/// The text split into pieces, readings attached to the word they belong to.
pub fn pieces(s: &str) -> Vec<Piece> {
    let chars: Vec<char> = s.chars().collect();
    let mut out: Vec<Piece> = Vec::new();
    let mut plain = String::new();
    // Where the current run (a word that may take a reading) starts in `plain`.
    let mut run_start = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '[' {
            if let Some(len) = chars[i + 1..].iter().position(|&x| x == ']') {
                let reading: String = chars[i + 1..i + 1 + len].iter().collect();
                let run: String = plain[run_start..].to_string();
                if !reading.is_empty() && reading.chars().all(is_kana) && !run.trim().is_empty() {
                    plain.truncate(run_start);
                    // The space that marked the start of the run is not shown.
                    if plain.ends_with(' ') && !run.starts_with(' ') {
                        plain.pop();
                    }
                    if !plain.is_empty() {
                        out.push(Piece { base: std::mem::take(&mut plain), reading: None });
                    }
                    out.push(Piece { base: run.trim_start().to_string(), reading: Some(reading) });
                    run_start = 0;
                    i += len + 2;
                    continue;
                }
            }
        }
        if c == ' ' || c == '>' || c == '\u{3000}' {
            plain.push(c);
            run_start = plain.len();
        } else {
            plain.push(c);
        }
        i += 1;
    }
    if !plain.is_empty() {
        out.push(Piece { base: plain, reading: None });
    }
    out
}

/// Whether the text has any reading in Anki's form.
pub fn has_readings(s: &str) -> bool {
    s.contains('[') && pieces(s).iter().any(|p| p.reading.is_some())
}

/// The text as written, without its readings: `日本[にほん]語` → `日本語`.
pub fn plain(s: &str) -> String {
    if !s.contains('[') {
        return s.to_string();
    }
    pieces(s).into_iter().map(|p| p.base).collect()
}

/// The text as read: each word with a reading replaced by it, `日本[にほん]語` → `にほん語`.
pub fn kana(s: &str) -> String {
    pieces(s).into_iter().map(|p| p.reading.unwrap_or(p.base)).collect()
}

/// Katakana turned into hiragana (other characters as they are).
pub fn to_hiragana(s: &str) -> String {
    s.chars()
        .map(|c| if ('\u{30A1}'..='\u{30F6}').contains(&c) { char::from_u32(c as u32 - 0x60).unwrap_or(c) } else { c })
        .collect()
}

/// Readings that sound almost the same, for wrong options on a reading card:
/// a long vowel dropped or added, a sound voiced or unvoiced, a small つ
/// added or dropped. The reading itself is never among them.
pub fn near_readings(reading: &str) -> Vec<String> {
    let r: Vec<char> = to_hiragana(reading).chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut push = |v: Vec<char>| {
        let s: String = v.into_iter().collect();
        if s != reading && !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    };
    const VOICE: &[(char, char)] = &[
        ('か', 'が'), ('き', 'ぎ'), ('く', 'ぐ'), ('け', 'げ'), ('こ', 'ご'), ('さ', 'ざ'), ('し', 'じ'), ('す', 'ず'), ('せ', 'ぜ'), ('そ', 'ぞ'),
        ('た', 'だ'), ('ち', 'ぢ'), ('つ', 'づ'), ('て', 'で'), ('と', 'ど'), ('は', 'ば'), ('ひ', 'び'), ('ふ', 'ぶ'), ('へ', 'べ'), ('ほ', 'ぼ'),
    ];
    let o_row = |c: char| "おこそとのほもよろごぞどぼぽょ".contains(c);
    let e_row = |c: char| "えけせてねへめれげぜでべぺ".contains(c);
    for i in 0..r.len() {
        // A long vowel dropped: きょう → きょ, せんせい → せんせ.
        if i > 0 && ((r[i] == 'う' && o_row(r[i - 1])) || (r[i] == 'い' && e_row(r[i - 1]))) {
            let mut v = r.clone();
            v.remove(i);
            push(v);
        }
        // A sound voiced or unvoiced.
        if let Some(&(a, b)) = VOICE.iter().find(|(a, b)| *a == r[i] || *b == r[i]) {
            let mut v = r.clone();
            v[i] = if r[i] == a { b } else { a };
            push(v);
        }
        if r[i] == 'っ' {
            let mut v = r.clone();
            v.remove(i);
            push(v);
        }
    }
    // A long vowel added where there was none.
    if let Some(i) = (1..=r.len()).rev().find(|&i| o_row(r[i - 1]) && r.get(i) != Some(&'う')) {
        let mut v = r.clone();
        v.insert(i, 'う');
        push(v);
    }
    // A small つ added before a k, s, t or p sound.
    if let Some(i) = (1..r.len()).find(|&i| "かきくけこさしすせそたちつてとぱぴぷぺぽ".contains(r[i]) && r[i - 1] != 'っ' && r[i - 1] != 'ん') {
        let mut v = r.clone();
        v.insert(i, 'っ');
        push(v);
    }
    out
}

/// Joins a word and its kana-only reading into Anki's form, by matching the
/// kana the word already has: 食べ物 + たべもの → `食[た]べ 物[もの]`.
/// None when the reading does not fit the word.
pub fn align(word: &str, reading: &str) -> Option<String> {
    let word = word.trim();
    let reading = to_hiragana(reading.trim());
    if !has_kanji(word) || reading.is_empty() || !reading.chars().all(is_kana) {
        return None;
    }
    // Runs of kanji and of everything else.
    let mut runs: Vec<(bool, String)> = Vec::new();
    for c in word.chars() {
        let k = is_kanji(c);
        match runs.last_mut() {
            Some((kk, s)) if *kk == k => s.push(c),
            _ => runs.push((k, c.to_string())),
        }
    }
    let r: Vec<char> = reading.chars().collect();
    fn fit(runs: &[(bool, String)], r: &[char], at: usize, out: &mut Vec<String>) -> bool {
        let Some((kanji, text)) = runs.first() else { return at == r.len() };
        if !kanji {
            let t: Vec<char> = to_hiragana(text).chars().collect();
            if r.len() >= at + t.len() && r[at..at + t.len()] == t[..] {
                out.push(text.clone());
                if fit(&runs[1..], r, at + t.len(), out) {
                    return true;
                }
                out.pop();
            }
            return false;
        }
        // A kanji run takes at least one kana, as few as will let the rest fit.
        for end in at + 1..=r.len() {
            let reading: String = r[at..end].iter().collect();
            out.push(format!(" {text}[{reading}]"));
            if fit(&runs[1..], r, end, out) {
                return true;
            }
            out.pop();
        }
        false
    }
    let mut out = Vec::new();
    if !fit(&runs, &r, 0, &mut out) {
        return None;
    }
    Some(out.concat().trim_start().to_string())
}

/// What a reading card asks: the text without readings, the part asked about
/// (empty when it is the whole text) and the reading expected, in hiragana.
pub fn reading_question(front: &str) -> Option<(String, String, String)> {
    let ps = pieces(front);
    let words: Vec<&Piece> = ps.iter().filter(|p| p.reading.is_some()).collect();
    if words.is_empty() {
        return None;
    }
    let shown = plain(front);
    if words.len() <= 2 && shown.chars().count() <= 8 {
        return Some((shown.clone(), String::new(), to_hiragana(&kana(front))));
    }
    // A sentence: its longest word with a reading (the first, if several).
    let key = words.iter().fold(words[0], |best, p| if p.base.chars().count() > best.base.chars().count() { p } else { best });
    Some((shown, key.base.clone(), to_hiragana(key.reading.as_deref().unwrap_or(""))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readings_split_at_spaces_as_in_anki() {
        let s = "毎朝[まいあさ] 日本語[にほんご]を 勉強[べんきょう]しています。";
        assert_eq!(plain(s), "毎朝日本語を勉強しています。");
        assert_eq!(kana(s), "まいあさにほんごをべんきょうしています。");
        let p = pieces(s);
        assert_eq!(p[0], Piece { base: "毎朝".into(), reading: Some("まいあさ".into()) });
        assert_eq!(p[1], Piece { base: "日本語".into(), reading: Some("にほんご".into()) });
        assert_eq!(p[2].base, "を");
        assert!(has_readings(s));
        assert!(!has_readings("see note [1] and [sic]"));
        assert_eq!(plain("see note [1]"), "see note [1]");
        // As in Anki, the space before a word with a reading only marks where it starts.
        assert_eq!(plain("I like 日本[にほん]."), "I like日本.");
    }

    #[test]
    fn readings_are_aligned_with_the_kana_a_word_has() {
        assert_eq!(align("食べ物", "たべもの").as_deref(), Some("食[た]べ 物[もの]"));
        assert_eq!(align("勉強", "ベンキョウ").as_deref(), Some("勉強[べんきょう]"));
        assert_eq!(align("お茶", "おちゃ").as_deref(), Some("お 茶[ちゃ]"));
        assert_eq!(plain(&align("食べ物", "たべもの").unwrap()), "食べ物");
        assert_eq!(align("食べ物", "のみもの"), None);
        assert_eq!(align("たべもの", "たべもの"), None);
    }

    #[test]
    fn near_readings_differ_by_one_sound() {
        let n = near_readings("べんきょう");
        assert!(n.contains(&"べんきょ".to_string()), "{n:?}");
        assert!(n.contains(&"へんきょう".to_string()), "{n:?}");
        assert!(!n.contains(&"べんきょう".to_string()));
        assert!(near_readings("がっこう").contains(&"がこう".to_string()));
    }

    #[test]
    fn a_reading_card_asks_a_word_or_a_sentences_longest_word() {
        assert_eq!(reading_question("勉強[べんきょう]").unwrap(), ("勉強".into(), String::new(), "べんきょう".into()));
        let (shown, mark, reading) = reading_question("毎朝[まいあさ] 日本語[にほんご]を 勉強[べんきょう]しています。").unwrap();
        assert_eq!(shown, "毎朝日本語を勉強しています。");
        assert_eq!(mark, "日本語");
        assert_eq!(reading, "にほんご");
        assert_eq!(reading_question("no readings"), None);
    }
}
