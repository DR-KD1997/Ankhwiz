//! Anki's Image Occlusion field, read and written.
//!
//! Anki keeps the hidden parts as cloze markers in the note's Occlusion field:
//!
//! ```text
//! {{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}
//! {{c2::image-occlusion:polygon:points=.1,.1 .2,.3 .05,.4:oi=1}}
//! ```
//!
//! `oi=1` means every part is hidden while one is asked ("Hide all, guess
//! one"). Ankhwiz adds `label=` for a part's name; Anki keeps the property and
//! ignores it when drawing. Text shapes (Anki's visible notes on the picture)
//! are not hidden parts and are left out.

use crate::cards::gaps;
use crate::model::{Occlusion, Shape};

fn num(v: &str) -> f64 {
    v.trim().parse().unwrap_or(0.0)
}

/// Undo the escaping `label_out` applies (colons and braces would end the marker).
fn label_in(v: &str) -> String {
    v.replace("%3A", ":").replace("%7D", "}").replace("%7B", "{").replace("%25", "%")
}

fn label_out(v: &str) -> String {
    v.trim().replace('%', "%25").replace(':', "%3A").replace('}', "%7D").replace('{', "%7B")
}

fn trim_num(v: f64) -> String {
    let s = format!("{:.4}", v.clamp(0.0, 1.0));
    let s = s.trim_end_matches('0').trim_end_matches('.');
    let s = s.strip_prefix('0').unwrap_or(s);
    if s.is_empty() { "0".to_string() } else { s.to_string() }
}

/// The hidden parts in an Occlusion field, and the image file named in the Image field.
pub fn parse(field: &str, image_field: &str) -> Occlusion {
    let mut shapes = Vec::new();
    let mut hide_all = false;
    for g in gaps(&field.replace("&nbsp;", " ")) {
        let Some(spec) = g.answer.strip_prefix("image-occlusion:") else { continue };
        // The answer may hold "::" from a hint split; rejoin it.
        let spec = if g.hint.is_empty() { spec.to_string() } else { format!("{spec}::{}", g.hint) };
        let mut parts = spec.split(':');
        let kind = parts.next().unwrap_or("").to_string();
        if !matches!(kind.as_str(), "rect" | "ellipse" | "polygon") {
            continue;
        }
        let mut s = Shape { ord: g.n, kind, ..Default::default() };
        for p in parts {
            let Some((k, v)) = p.split_once('=') else { continue };
            match k {
                "left" => s.left = num(v),
                "top" => s.top = num(v),
                "width" => s.width = num(v),
                "height" => s.height = num(v),
                "rx" => s.width = num(v) * 2.0,
                "ry" => s.height = num(v) * 2.0,
                "points" => {
                    s.points = v
                        .split_whitespace()
                        .filter_map(|xy| xy.split_once(',').map(|(x, y)| [num(x), num(y)]))
                        .collect();
                }
                "oi" => hide_all |= v.trim() == "1",
                "label" => s.label = label_in(v),
                _ => {}
            }
        }
        if s.kind == "polygon" && !s.points.is_empty() {
            let (xs, ys): (Vec<f64>, Vec<f64>) = s.points.iter().map(|p| (p[0], p[1])).unzip();
            let min = |v: &[f64]| v.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = |v: &[f64]| v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            s.left = min(&xs);
            s.top = min(&ys);
            s.width = max(&xs) - s.left;
            s.height = max(&ys) - s.top;
        }
        shapes.push(s);
    }
    Occlusion { image: image_name(image_field), shapes, hide_all }
}

/// The file name in `<img src="…">`, or the field itself when it holds a bare name.
pub fn image_name(field: &str) -> String {
    if let Some(i) = field.find("src=") {
        let rest = &field[i + 4..];
        let quote = rest.chars().next().unwrap_or('"');
        if quote == '"' || quote == '\'' {
            if let Some(end) = rest[1..].find(quote) {
                return rest[1..1 + end].to_string();
            }
        }
        return rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string();
    }
    field.trim().to_string()
}

/// The Occlusion field for a set of parts, one marker per line.
pub fn write(o: &Occlusion) -> String {
    let oi = if o.hide_all { 1 } else { 0 };
    o.shapes
        .iter()
        .map(|s| {
            let geo = if s.kind == "polygon" && !s.points.is_empty() {
                format!("points={}", s.points.iter().map(|p| format!("{},{}", trim_num(p[0]), trim_num(p[1]))).collect::<Vec<_>>().join(" "))
            } else {
                format!("left={}:top={}:width={}:height={}", trim_num(s.left), trim_num(s.top), trim_num(s.width), trim_num(s.height))
            };
            let label = if s.label.trim().is_empty() { String::new() } else { format!(":label={}", label_out(&s.label)) };
            let kind = if s.kind.is_empty() { "rect" } else { &s.kind };
            format!("{{{{c{}::image-occlusion:{kind}:{geo}:oi={oi}{label}}}}}", s.ord.max(1))
        })
        .collect::<Vec<_>>()
        .join("<br>")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_anki_writes_and_writes_it_back() {
        let field = "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1:label=Radius}}<br>\
                     {{c2::image-occlusion:ellipse:left=.5:top=.2:width=.2:height=.1:oi=1}}<br>\
                     {{c3::image-occlusion:polygon:points=.1,.1 .2,.3 .05,.4:oi=1}}<br>\
                     {{c4::image-occlusion:text:left=.1:top=.9:text=Note:scale=1}}";
        let o = parse(field, "<img src=\"arm.png\">");
        assert_eq!(o.image, "arm.png");
        assert!(o.hide_all);
        assert_eq!(o.shapes.len(), 3, "text shapes are not hidden parts");
        assert_eq!((o.shapes[0].kind.as_str(), o.shapes[0].label.as_str(), o.shapes[0].width), ("rect", "Radius", 0.3));
        assert_eq!(o.shapes[2].points.len(), 3);
        assert!((o.shapes[2].height - 0.3).abs() < 1e-9);
        let again = parse(&write(&o), "arm.png");
        assert_eq!(again, o);
    }

    #[test]
    fn names_with_colons_survive() {
        let o = Occlusion {
            image: "x.png".into(),
            shapes: vec![Shape { ord: 1, kind: "rect".into(), left: 0.1, top: 0.1, width: 0.1, height: 0.1, label: "Ratio 1:2 {a}".into(), ..Default::default() }],
            hide_all: false,
        };
        assert_eq!(parse(&write(&o), "x.png").shapes[0].label, "Ratio 1:2 {a}");
    }
}
