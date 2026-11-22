// Turn the translators' files (src/lib/i18n/lang/<code>.txt: lines
// "index|text", or "index|{"one":"…","other":"…"}" for text that changes with
// a count) into dictionaries keyed by the English (src/lib/i18n/dict/<code>.json).
// Indexes are those of scripts/i18n-strings.json. Checks that every
// placeholder is kept and reports what is missing.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/i18n-strings.json'), 'utf8'));
const en = fs.readFileSync(path.join(ROOT, 'src/lib/i18n/en.ts'), 'utf8');
const keys = new Set([...en.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));
// Not translated: keys into en.ts, samples already in their own language, code.
const SAMPLES = new Set(['Hola, ¿qué tal?', 'Bonjour, comment ça va ?', 'Hallo, wie geht es dir?', 'Ciao, come stai?', 'Olá, tudo bem?', 'Hallo, hoe gaat het?', 'Привет, как дела?', 'Merhaba, nasılsın?', 'Cześć, jak się masz?', 'Hello, how are you?', '{{Field}}', '{{#Field}}…{{/Field}}', '{{FrontSide}}', 'Ankhwiz', 'Ankhwiz {VERSION}', 'https://…/v1', 'ok', 'open_link']);
const skip = (x) => keys.has(x.text) || SAMPLES.has(x.text);
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const edge = (en, tr) => { const lead = en.match(/^\s*/)[0], trail = en.match(/\s*$/)[0]; return lead + tr.trim() + trail; };
const LANG = path.join(ROOT, 'src/lib/i18n/lang');
// A language may be split into parts: tr.txt, tr.2.txt, tr.3.txt…
const partsOf = (code) => fs.readdirSync(LANG).filter((f) => f.split('.')[0] === code && f.endsWith('.txt')).sort();
const codes = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set(fs.readdirSync(LANG).filter((f) => f.endsWith('.txt')).map((f) => f.split('.')[0]))];
fs.mkdirSync(path.join(ROOT, 'src/lib/i18n/dict'), { recursive: true });
let bad = 0;
for (const code of codes) {
  const parts = partsOf(code);
  if (!parts.length) continue;
  const dict = {};
  const seen = new Set();
  const problems = [];
  for (const [ln, line] of parts.map((f) => fs.readFileSync(path.join(LANG, f), 'utf8')).join('\n').split('\n').entries()) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = line.match(/^(\d+)\|(.*)$/);
    if (!m) { problems.push(`line ${ln + 1}: not "index|text"`); continue; }
    const i = +m[1], x = src[i];
    if (!x) { problems.push(`line ${ln + 1}: no string ${i}`); continue; }
    if (seen.has(i)) problems.push(`line ${ln + 1}: ${i} given twice`);
    seen.add(i);
    if (skip(x)) continue;
    let val = m[2];
    const plural = x.kind.startsWith('plural:');
    if (val.trim().startsWith('{"')) {
      let obj;
      try { obj = JSON.parse(val); } catch { problems.push(`${i}: bad JSON`); continue; }
      for (const [form, s] of Object.entries(obj)) {
        if (holes(s).replace(/(^|,)n(?=,|$)/, '') !== holes(x.text).replace(/(^|,)n(?=,|$)/, '') && holes(s) !== holes(x.text)) problems.push(`${i} [${form}]: placeholders ${holes(s)} ≠ ${holes(x.text)}`);
        obj[form] = edge(x.text, s);
      }
      if (!obj.other) problems.push(`${i}: plural without "other"`);
      dict[x.text] = obj;
    } else {
      if (holes(val) !== holes(x.text) && !(plural && holes(val).replace(/(^|,)n(?=,|$)/, '') === holes(x.text).replace(/(^|,)n(?=,|$)/, ''))) problems.push(`${i}: placeholders {${holes(val)}} ≠ {${holes(x.text)}}  «${x.text}» → «${val}»`);
      dict[x.text] = edge(x.text, val);
    }
  }
  const missing = src.map((x, i) => (!skip(x) && !seen.has(i) ? i : -1)).filter((i) => i >= 0);
  fs.writeFileSync(path.join(ROOT, 'src/lib/i18n/dict', code + '.json'), JSON.stringify(dict));
  console.log(`${code}: ${Object.keys(dict).length} translated, ${missing.length} missing${missing.length ? ' (' + missing.slice(0, 30).join(' ') + (missing.length > 30 ? ' …' : '') + ')' : ''}`);
  if (problems.length) { bad++; console.log('  ' + problems.join('\n  ')); }
}
process.exitCode = bad ? 1 : 0;
