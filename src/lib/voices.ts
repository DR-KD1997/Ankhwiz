// Reading one field in more than one voice. A card's text is split wherever
// the language changes: words marked in the card editor first, then words in
// quotes under the deck's rule, then the rest in the field's own language.
// Quote marks stay on screen but are not read.

export interface Mark {
  /** The words, exactly as they appear in the field. */
  text: string;
  lang: string;
}

export interface Piece {
  text: string;
  lang: string;
  /** How the language was chosen: the field's own, a mark, or the quote rule. */
  from: 'base' | 'mark' | 'quote';
}

/** A run of the displayed text, for underlining what is read in another voice. */
export interface Run {
  text: string;
  from: Piece['from'];
  lang: string;
}

const PAIRS: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '„': '“', '‚': '‘', '‹': '›', '「': '」' };
const OPENERS = Object.keys(PAIRS);

/** Character-by-character language and source, then grouped into runs. */
function label(text: string, base: string, marks: Mark[], quoteLang: string): { lang: string[]; from: Piece['from'][]; quiet: boolean[] } {
  const n = text.length;
  const lang = new Array<string>(n).fill(base);
  const from = new Array<Piece['from']>(n).fill('base');
  const quiet = new Array<boolean>(n).fill(false);
  // Marked words: every place the words appear, longest marks first so they win.
  for (const m of [...marks].filter((m) => m.text.trim()).sort((a, b) => b.text.length - a.text.length)) {
    let at = text.indexOf(m.text);
    while (at >= 0) {
      // Whole words only, in text written with spaces: "la" is not marked inside "lasagna".
      const edge = (c: string | undefined) => !c || !/[\p{L}\p{N}]/u.test(c) || !/\s/.test(text);
      const whole = (!/^[\p{L}\p{N}]/u.test(m.text) || edge(text[at - 1])) && (!/[\p{L}\p{N}]$/u.test(m.text) || edge(text[at + m.text.length]));
      if (whole && from.slice(at, at + m.text.length).every((f) => f === 'base')) {
        for (let i = at; i < at + m.text.length; i++) {
          lang[i] = m.lang;
          from[i] = 'mark';
        }
      }
      at = text.indexOf(m.text, at + m.text.length);
    }
  }
  if (quoteLang) {
    // A quote opens at the start or after a space or bracket, and closes before
    // the end, a space or punctuation, so apostrophes ("don't") are left alone.
    for (let i = 0; i < n; i++) {
      const open = text[i];
      if (!OPENERS.includes(open) || from[i] !== 'base') continue;
      if (i > 0 && !/[\s(\[{:—–-]/.test(text[i - 1])) continue;
      const close = PAIRS[open];
      let j = i + 1;
      for (; j < n; j++) if (text[j] === close && (j + 1 === n || /[\s.,;:!?)\]}…—–-]/.test(text[j + 1]))) break;
      if (j >= n || j === i + 1 || from[j] !== 'base') continue;
      quiet[i] = quiet[j] = true;
      // Marked words inside the quotes keep their own language.
      for (let k = i + 1; k < j; k++) {
        if (from[k] !== 'base') continue;
        lang[k] = quoteLang;
        from[k] = 'quote';
      }
      i = j;
    }
  }
  return { lang, from, quiet };
}

/** How a text is read: pieces in order, each with its language. Empty pieces and bare punctuation are dropped. */
export function pieces(text: string, base: string, marks: Mark[] = [], quoteLang = ''): Piece[] {
  if (!marks.length && !quoteLang) return text.trim() ? [{ text: text.trim(), lang: base, from: 'base' }] : [];
  const { lang, from, quiet } = label(text, base, marks, quoteLang);
  const out: Piece[] = [];
  let cur: Piece | null = null;
  for (let i = 0; i < text.length; i++) {
    if (quiet[i]) {
      cur = null;
      continue;
    }
    if (cur && cur.lang === lang[i] && cur.from === from[i]) cur.text += text[i];
    else {
      cur = { text: text[i], lang: lang[i], from: from[i] };
      out.push(cur);
    }
  }
  // Merge neighbours in the same language (a mark beside its own language reads as one).
  const merged: Piece[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && last.lang === p.lang) {
      last.text += p.text;
      if (p.from !== 'base') last.from = p.from;
    } else merged.push({ ...p });
  }
  return merged.map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').trim() })).filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

/** The displayed text in runs, so words read in another voice can be underlined. Quote marks stay. */
export function runs(text: string, base: string, marks: Mark[] = [], quoteLang = ''): Run[] {
  if (!marks.length && !quoteLang) return [{ text, from: 'base', lang: base }];
  const { lang, from } = label(text, base, marks, quoteLang);
  const out: Run[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.from === from[i] && last.lang === lang[i]) last.text += text[i];
    else out.push({ text: text[i], from: from[i], lang: lang[i] });
  }
  return out;
}

// ---------- reading marks out of Anki fields ----------

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Anki writes languages as es_ES; the web and Ankhwiz as es-ES. */
export const webLang = (l: string) => l.trim().replace(/_/g, '-');

/**
 * Words given their own language in an Anki field: `<span lang="es-ES">…</span>`
 * (web text) and `[anki:tts lang=es_ES]…[/anki:tts]` (Anki's reading tag).
 */
export function marksInField(html: string): Mark[] {
  const out: Mark[] = [];
  const add = (lang: string, inner: string) => {
    const text = decode(inner);
    if (text && lang && !out.some((m) => m.text === text && m.lang === lang)) out.push({ text, lang: webLang(lang) });
  };
  for (const m of html.matchAll(/<(\w+)[^>]*?\slang\s*=\s*["']?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)["']?[^>]*>([\s\S]*?)<\/\1>/gi)) add(m[2], m[3]);
  for (const m of html.matchAll(/\[anki:tts\b[^\]]*?\blang\s*=\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)[^\]]*\]([\s\S]*?)\[\/anki:tts\]/gi)) add(m[1], m[2]);
  return out;
}

/** The fields a card template reads aloud with `{{tts es_ES:Field}}`, and their languages. */
export function ttsFields(template: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of template.matchAll(/\{\{\s*tts\s+([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)\b[^:}]*:(?:[^:}]+:)*([^:}]+)\}\}/gi)) out[m[2].trim()] = webLang(m[1]);
  return out;
}
