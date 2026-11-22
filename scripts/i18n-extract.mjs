// List every interface text to translate: the English of each t('…') and
// plural('…', '…') call, and the values in i18n/en.ts. Writes
// scripts/i18n-strings.json (ordered, unique). Used to make and check the
// dictionaries in src/lib/i18n/.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (!/node_modules|fonts/.test(p)) walk(p); }
    else if (/\.(svelte|ts)$/.test(f) && !/\.test\.ts$|wasm\.generated|i18n\/translations|i18n\/[a-z]{2}(-\w+)?\.ts$/.test(p) || /i18n\/en\.ts$/.test(p)) files.push(p);
  }
})(path.join(ROOT, 'src'));

function readString(s, i) {
  const q = s[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { const n = s[j + 1]; out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)) : n; j += n === 'u' ? 5 : 1; continue; }
    if (q === '`' && c === '$' && s[j + 1] === '{') return { bad: true };
    if (c === q) return { text: out, end: j + 1 };
    out += c;
  }
  return null;
}
const skipWs = (s, i) => { while (/\s/.test(s[i])) i++; return i; };
const seen = new Map();
const bad = [];
const add = (text, where, kind = 'text') => { if (!seen.has(text)) seen.set(text, { text, kind, where }); };
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  if (/i18n\/en\.ts$/.test(f)) {
    for (const m of s.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const prev = s.slice(Math.max(0, m.index - 2), m.index);
      const after = s.slice(m.index + m[0].length).trimStart();
      if (after.startsWith(':')) continue; // a key
      const r = readString(s, m.index); if (r && !r.bad && /\p{L}/u.test(r.text)) add(r.text, rel, 'line');
    }
    continue;
  }
  for (const m of s.matchAll(/(?<![\w$.])(t|plural)\(/g)) {
    let i = skipWs(s, m.index + m[0].length);
    const a = readString(s, i);
    if (!a) continue;
    if (a.bad) { bad.push(`${rel}: ${s.slice(m.index, m.index + 80)}`); continue; }
    if (m[1] === 't') { add(a.text, rel); continue; }
    i = skipWs(s, a.end); if (s[i] !== ',') continue; i = skipWs(s, i + 1);
    const b = readString(s, i);
    if (!b || b.bad) { bad.push(`${rel}: ${s.slice(m.index, m.index + 80)}`); continue; }
    add(b.text, rel, 'plural:' + a.text);
  }
}
// Keep the numbering of an earlier list (translations refer to it); new text goes at the end.
const out = path.join(ROOT, 'scripts/i18n-strings.json');
const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
const list = before.map((x) => ({ ...x, unused: !seen.has(x.text) || undefined }));
const known = new Set(before.map((x) => x.text));
for (const x of seen.values()) if (!known.has(x.text)) list.push(x);
fs.writeFileSync(out, JSON.stringify(list, null, 1));
console.log('new', list.length - before.length, 'no longer used', list.filter((x) => x.unused).length);
console.log('strings', list.length, 'words', list.reduce((n, x) => n + x.text.split(/\s+/).length, 0), 'plurals', list.filter((x) => x.kind.startsWith('plural')).length);
if (bad.length) console.log('NOT LITERAL\n' + bad.join('\n'));
