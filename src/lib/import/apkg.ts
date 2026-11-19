// Reading an Anki .apkg file in the web view.
//
// An .apkg is a zip holding an SQLite collection and its media. Older
// exports store the collection as `collection.anki2` or `collection.anki21`
// with a JSON media list; current ones as `collection.anki21b`, compressed
// with zstd, with a protobuf media list and zstd-compressed files.
//
// Reading happens in two steps, so the learner can choose which Anki fields
// become the question, the answer and the extra: `readPackage` lists the
// note types and their fields with a mapping worked out from each type's
// card templates (or its known layout), then `packageRows` turns the notes
// into rows for the core under the chosen mapping. Note types, raw fields
// and Anki's scheduling are kept, so the deck can go back to Anki with its
// progress.

import { unzipSync } from 'fflate';
import { decompress as unzstd } from 'fzstd';
import { parseOcclusion } from '../core/bridge';
import type { AnkiNotetype, AnkiSched, AnkiTemplate, RawNote } from '../core/types';
import { decodeEntities, fieldText } from './html';
import { marksInField, ttsFields, type Mark } from '../voices';
import { openInBrowser, rowsOf, type Database, type OpenDatabase } from './sql';

export type { OpenDatabase };

export interface PackageNotetype extends AnkiNotetype {
  /** Notes of this type in the package. */
  count: number;
  /** Each field of the first note, as text, to help choose the mapping. */
  sample: string[];
  /** How the mapping was worked out: a known layout, the card templates, or field names. */
  matched: 'ankhwiz' | 'occlusion' | 'cloze' | 'template' | 'names';
  /** The templates use scripts or drawing that Ankhwiz cannot show the same way. */
  custom: boolean;
  /** Anki asks this type both ways (it has a reverse card). */
  reverse: boolean;
  questionMore: number[];
  extraMore: number[];
  selfCheck: boolean;
}

interface PackageNote {
  guid: string;
  ntid: string;
  fields: string[];
  tags: string[];
  group?: string;
  order: number;
  sched: AnkiSched[];
}

export interface AnkiPackage {
  name: string;
  /** Collection creation, in seconds. */
  crt: number;
  notetypes: PackageNotetype[];
  notes: PackageNote[];
  media: Record<string, Uint8Array>;
  /** Some cards have been studied. */
  studied: boolean;
}

export interface Mapping {
  /** The main question field: swapped with the answer when a deck is asked both ways. */
  question: number;
  /** More fields shown with the question, in smaller type. */
  questionMore: number[];
  answer: number;
  extra: number | null;
  extraMore: number[];
  /** The learner checks these cards themselves. */
  selfCheck: boolean;
  /** Ask this type's cards both ways. */
  bothWays?: boolean | null;
}

/** How notes are grouped into units. */
export type SplitBy = 'subdeck' | 'tag' | 'size';

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => b.length > 4 && ZSTD.every((v, i) => b[i] === v);

// ---------- a little protobuf, for the current format's note types and media list ----------

function varint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 1;
  for (;;) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * shift;
    if (byte < 0x80) return [result, pos];
    shift *= 128;
  }
}

/** Fields of a protobuf message as [number, value]; strings and messages come back as bytes. */
function fields(buf: Uint8Array): [number, number | Uint8Array][] {
  const out: [number, number | Uint8Array][] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = varint(buf, pos);
    const wire = tag & 7;
    const field = Math.floor(tag / 8);
    if (wire === 0) {
      const [v, p2] = varint(buf, p1);
      out.push([field, v]);
      pos = p2;
    } else if (wire === 2) {
      const [len, p2] = varint(buf, p1);
      out.push([field, buf.subarray(p2, p2 + len)]);
      pos = p2 + len;
    } else if (wire === 5) {
      pos = p1 + 4;
    } else if (wire === 1) {
      pos = p1 + 8;
    } else {
      break;
    }
  }
  return out;
}

const text = new TextDecoder();
const str = (v: number | Uint8Array | undefined) => (v instanceof Uint8Array ? text.decode(v) : '');
const bytesOf = (v: SqlLike) => (v instanceof Uint8Array ? v : new Uint8Array());
type SqlLike = number | string | Uint8Array | null;

// ---------- reading ----------

function deckNames(db: Database): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, name] of rowsOf(db, 'SELECT id, name FROM decks')) {
    names.set(String(id), String(name).split('\x1f').join('::'));
  }
  if (names.size) return names;
  const json = rowsOf(db, 'SELECT decks FROM col')[0]?.[0];
  if (typeof json === 'string' && json) {
    try {
      for (const [id, deck] of Object.entries(JSON.parse(json) as Record<string, { name?: string }>)) {
        if (deck?.name) names.set(id, deck.name);
      }
    } catch {
      /* no deck names; card order is used instead */
    }
  }
  return names;
}

type Auto = Pick<PackageNotetype, 'question' | 'answer' | 'extra' | 'questionMore' | 'extraMore' | 'matched' | 'custom' | 'reverse' | 'selfCheck'>;

/** Field names a template uses, in order, without repeats: {{Front}}, {{type:Back}}, {{furigana:Reading}}… */
export function templateFields(fmt: string, fields: string[]): string[] {
  const out: string[] = [];
  for (const m of fmt.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const inner = m[1].trim();
    if (/^[#^/]/.test(inner)) continue; // section markers
    const name = inner.split(':').pop()!.trim();
    if (fields.includes(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Fields that hold labels: few different short values, repeated across many notes. */
export function labelFields(rows: string[][], width: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < width; i++) {
    const values = rows.map((r) => fieldText(r[i] ?? '').trim()).filter(Boolean);
    if (values.length < Math.max(10, rows.length / 2)) continue;
    const distinct = new Set(values).size;
    const avg = values.reduce((t, v) => t + v.length, 0) / values.length;
    if (distinct <= Math.max(12, values.length * 0.03) && avg <= 24) out.add(i);
  }
  return out;
}

/** A mapping whose question or answer is a label field moves to the next field that is not, keeping the label beside it. */
export function avoidLabels<T extends Pick<Mapping, 'question' | 'answer' | 'questionMore' | 'extraMore'> & { extra?: number | null; cloze?: boolean; occlusion?: boolean; matched?: string; fields: string[] }>(
  t: T,
  rows: string[][],
): Partial<T> {
  if (t.cloze || t.occlusion || t.matched === 'ankhwiz') return {};
  const labels = labelFields(rows, t.fields.length);
  if (!labels.size) return {};
  const out: Partial<T> = {};
  if (labels.has(t.question)) {
    const next = t.questionMore.find((i) => !labels.has(i));
    if (next !== undefined) {
      out.question = next;
      out.questionMore = [...t.questionMore.filter((i) => i !== next), t.question];
    }
  }
  if (labels.has(t.answer) && t.answer !== t.question) {
    const pool = [t.extra, ...t.extraMore].filter((i): i is number => i !== null && i !== undefined && !labels.has(i));
    if (pool.length) {
      const next = pool[0];
      out.answer = next;
      if (t.extra === next) out.extra = t.answer;
      else out.extraMore = [...t.extraMore.filter((i) => i !== next), t.answer];
    }
  }
  return out;
}

/** The mapping for a note type, worked out from its known layout or its card templates. */
export function autoMapping(type: { name: string; fields: string[]; templates: AnkiTemplate[]; cloze: boolean; occlusion?: boolean }): Auto {
  const f = type.fields;
  const at = (name: string) => f.indexOf(name);
  const find = (re: RegExp, not: number[] = []) => f.findIndex((x, i) => re.test(x) && !not.includes(i));
  const scripted = type.templates.some((t) => /<script|<canvas/i.test(t.qfmt + t.afmt));
  const reverse = !type.cloze && type.templates.length > 1;
  const base = { custom: scripted && !type.occlusion, reverse, selfCheck: scripted && !type.occlusion };
  const numbered = (prefix: string) =>
    f.map((x, i) => [x, i] as const).filter(([x]) => new RegExp(`^${prefix} \\d+$`).test(x)).sort((a, b) => parseInt(a[0].slice(prefix.length)) - parseInt(b[0].slice(prefix.length))).map(([, i]) => i);

  if (type.occlusion) {
    const header = at('Header');
    const extra = at('Back Extra');
    const comments = at('Comments');
    return { ...base, matched: 'occlusion', question: header >= 0 ? header : 0, answer: Math.max(0, at('Occlusion')), extra: extra >= 0 ? extra : null, questionMore: [], extraMore: comments >= 0 ? [comments] : [] };
  }
  if (type.name.startsWith('Ankhwiz')) {
    const q = Math.max(0, at(type.cloze ? 'Text' : 'Question'));
    const x = at('Extra');
    return { ...base, matched: 'ankhwiz', question: q, answer: type.cloze ? q : Math.max(0, at('Answer')), extra: x >= 0 ? x : null, questionMore: numbered('Question'), extraMore: numbered('Extra') };
  }
  if (type.cloze) {
    const q = Math.max(0, find(/^text$/i));
    const shown = type.templates[0] ? templateFields(type.templates[0].afmt, f).map(at).filter((i) => i !== q) : [];
    const x = shown.length ? shown[0] : find(/extra/i, [q]);
    return { ...base, matched: 'cloze', question: q, answer: q, extra: x >= 0 ? x : null, questionMore: [], extraMore: shown.slice(1) };
  }
  const t = type.templates[0];
  if (t) {
    const q = templateFields(t.qfmt, f).map(at);
    const a = templateFields(t.afmt, f).map(at).filter((i) => !q.includes(i));
    if (q.length && a.length) {
      return { ...base, matched: 'template', question: q[0], questionMore: q.slice(1), answer: a[0], extra: a.length > 1 ? a[1] : null, extraMore: a.slice(2) };
    }
  }
  // No usable template: go by the fields' names, then their order.
  let q = find(/^(front|question|expression|word|term|vocab|kanji|prompt)/i);
  if (q < 0) q = 0;
  let a = find(/^(back|answer|meaning|definition|translation|english)/i, [q]);
  if (a < 0) a = f.length > 1 ? (q === 0 ? 1 : 0) : q;
  const x = find(/(extra|notes?|comments?|example)/i, [q, a]);
  return { ...base, matched: 'names', question: q, answer: a, extra: x >= 0 ? x : f.length > 2 ? [0, 1, 2].find((i) => i !== q && i !== a) ?? null : null, questionMore: [], extraMore: [] };
}

function notetypes(db: Database): Omit<PackageNotetype, 'count' | 'sample'>[] {
  const out: Omit<PackageNotetype, 'count' | 'sample'>[] = [];
  // Current layout: separate tables, with settings in protobuf.
  const rows = rowsOf(db, 'SELECT id, name, config FROM notetypes');
  if (rows.length) {
    for (const [id, name, config] of rows) {
      const cfg = fields(bytesOf(config));
      const cloze = cfg.some(([f, v]) => f === 1 && v === 1);
      const css = str(cfg.find(([f]) => f === 3)?.[1]);
      // original_stock_kind (9) is 6 for Anki's Image Occlusion.
      const stock = cfg.find(([f]) => f === 9)?.[1];
      const flds = rowsOf(db, `SELECT name FROM fields WHERE ntid = ${Number(id)} ORDER BY ord`).map((r) => String(r[0]));
      const templates: AnkiTemplate[] = rowsOf(db, `SELECT name, config FROM templates WHERE ntid = ${Number(id)} ORDER BY ord`).map(
        ([tname, tcfg]) => {
          const t = fields(bytesOf(tcfg));
          return { name: String(tname), qfmt: str(t.find(([f]) => f === 1)?.[1]), afmt: str(t.find(([f]) => f === 2)?.[1]) };
        },
      );
      const occlusion = stock === 6 || (cloze && flds.includes('Occlusion') && flds.includes('Image'));
      const t = { id: String(id), name: String(name), cloze, fields: flds, templates, css, occlusion };
      out.push({ ...t, ...autoMapping(t) });
    }
    return out;
  }
  // Older layout: one JSON object in the `col` table.
  const json = rowsOf(db, 'SELECT models FROM col')[0]?.[0];
  if (typeof json !== 'string') return out;
  try {
    type Model = { name: string; type: number; flds: { name: string }[]; tmpls: { name: string; qfmt: string; afmt: string }[]; css?: string; originalStockKind?: number };
    for (const [id, m] of Object.entries(JSON.parse(json) as Record<string, Model>)) {
      const flds = m.flds.map((f) => f.name);
      const cloze = m.type === 1;
      const t = {
        id,
        name: m.name,
        cloze,
        fields: flds,
        templates: m.tmpls.map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
        css: m.css ?? '',
        occlusion: m.originalStockKind === 6 || (cloze && flds.includes('Occlusion') && flds.includes('Image')),
      };
      out.push({ ...t, ...autoMapping(t) });
    }
  } catch {
    /* unreadable note types: every note is read with the default mapping */
  }
  return out;
}

function readMedia(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const list = files['media'];
  if (!list) return out;
  const names: [string, string][] = [];
  if (isZstd(list)) {
    // Current format: MediaEntries { repeated MediaEntry { string name = 1; …; uint32 legacy_zip_filename = 255 } }
    fields(unzstd(list)).forEach(([f, entry], i) => {
      if (f !== 1 || !(entry instanceof Uint8Array)) return;
      const e = fields(entry);
      const legacy = e.find(([n]) => n === 255)?.[1];
      names.push([typeof legacy === 'number' ? String(legacy) : String(i), str(e.find(([n]) => n === 1)?.[1])]);
    });
  } else {
    try {
      for (const [k, name] of Object.entries(JSON.parse(text.decode(list)) as Record<string, string>)) names.push([k, name]);
    } catch {
      return out;
    }
  }
  for (const [k, name] of names) {
    const data = files[k];
    if (!data || !name) continue;
    out[name] = isZstd(data) ? unzstd(data) : data;
  }
  return out;
}

function commonPrefix(names: string[]): string[] {
  if (!names.length) return [];
  const split = names.map((n) => n.split('::'));
  const prefix: string[] = [];
  for (let i = 0; i < split[0].length; i++) {
    const part = split[0][i];
    if (split.every((s) => s[i] === part)) prefix.push(part);
    else break;
  }
  return prefix;
}

export function readCollection(db: Database, fallbackName: string, media: Record<string, Uint8Array> = {}): AnkiPackage {
  const noteRows = rowsOf(db, 'SELECT id, guid, mid, flds, tags FROM notes ORDER BY id');
  if (!noteRows.length) throw new Error('This deck has no notes.');
  const crt = Number(rowsOf(db, 'SELECT crt FROM col')[0]?.[0] ?? 0);

  const deckOf = new Map<string, string>();
  const orderOf = new Map<string, number>();
  const sched = new Map<string, AnkiSched[]>();
  let studied = false;
  for (const [nid, did, ord, ctype, queue, due, ivl, reps, lapses, data] of rowsOf(
    db,
    'SELECT nid, did, ord, type, queue, due, ivl, reps, lapses, data FROM cards ORDER BY ord DESC',
  )) {
    const key = String(nid);
    deckOf.set(key, String(did));
    if (Number(ctype) === 0) orderOf.set(key, Number(due));
    else studied = true;
    const list = sched.get(key) ?? [];
    list.push({
      ord: Number(ord),
      ctype: Number(ctype),
      queue: Number(queue),
      due: Number(due),
      ivl: Number(ivl),
      reps: Number(reps),
      lapses: Number(lapses),
      data: typeof data === 'string' ? data : '',
    });
    sched.set(key, list);
  }
  const names = deckNames(db);
  const used = [...new Set(deckOf.values())].map((id) => names.get(id)).filter((n): n is string => !!n && n !== 'Default');
  const prefix = commonPrefix(used);
  const name = prefix.join('::') || (used.length === 1 ? used[0] : '') || fallbackName;

  const types = notetypes(db);
  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const notes: PackageNote[] = [];
  for (const [id, guid, mid, flds, tags] of noteRows) {
    const fields = String(flds ?? '').split('\x1f');
    const ntid = String(mid);
    counts.set(ntid, (counts.get(ntid) ?? 0) + 1);
    if (!samples.has(ntid)) samples.set(ntid, fields.map((f) => fieldText(f).slice(0, 60)));
    const full = names.get(deckOf.get(String(id)) ?? '');
    const rest = full ? full.split('::').slice(prefix.length) : [];
    notes.push({
      guid: String(guid ?? ''),
      ntid,
      fields,
      tags: String(tags ?? '').split(/\s+/).filter(Boolean),
      group: rest.join(' · ') || undefined,
      // New cards keep Anki's order; studied ones follow in the order they were added.
      order: orderOf.get(String(id)) ?? 1e9 + notes.length,
      sched: sched.get(String(id)) ?? [],
    });
  }
  // Once some cards are studied, Anki's new-card positions no longer describe the
  // whole deck; the order notes were added in does.
  if (studied) notes.forEach((n, i) => (n.order = i));
  // Note types the notes use but the collection did not describe get a plain two-field reading.
  for (const ntid of counts.keys()) {
    if (types.some((t) => t.id === ntid)) continue;
    const n = samples.get(ntid)?.length ?? 2;
    const flds = Array.from({ length: n }, (_, i) => `Field ${i + 1}`);
    const t = { id: ntid, name: 'Notes', cloze: false, fields: flds, templates: [], css: '' };
    types.push({ ...t, ...autoMapping(t) });
  }
  // A template that starts with a short label ({{Kind}}: "Sentence", "Verb"…)
  // would make that label the question. Fields whose values are a handful of
  // short words repeated across the notes are labels, not questions.
  for (const t of types) {
    const own = notes.filter((n) => n.ntid === t.id).slice(0, 3000);
    if (own.length >= 20) Object.assign(t, avoidLabels(t, own.map((n) => n.fields)));
  }
  return {
    name,
    crt,
    notetypes: types
      .filter((t) => counts.has(t.id))
      .map((t) => ({ ...t, count: counts.get(t.id) ?? 0, sample: samples.get(t.id) ?? [] })),
    notes,
    media,
    studied,
  };
}

const FILES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

/** The SQLite bytes of the collection inside an .apkg, and its media. */
export function unpack(apkg: Uint8Array): { collection: Uint8Array; media: Record<string, Uint8Array> } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(apkg);
  } catch {
    throw new Error('This file is not a readable .apkg package.');
  }
  const media = readMedia(files);
  if (files['collection.anki21b']) return { collection: unzstd(files['collection.anki21b']), media };
  const plain = files[FILES[1]] ?? files[FILES[2]];
  if (!plain) throw new Error('No Anki collection was found inside this file.');
  return { collection: plain, media };
}

/**
 * Current collections declare some text columns with Anki's own `unicase`
 * collation, which plain SQLite does not have, and refuse to be read. A
 * copy with the collation taken out of the schema reads normally; nothing
 * here looks rows up by those columns.
 */
async function readable(db: Database, open: OpenDatabase): Promise<Database> {
  const uses = rowsOf(db, "SELECT count(*) FROM sqlite_master WHERE sql LIKE '%unicase%'")[0]?.[0];
  if (!uses) return db;
  try {
    db.exec('PRAGMA writable_schema = ON');
    db.exec("UPDATE sqlite_master SET sql = replace(replace(sql, ' COLLATE unicase', ''), ' collate unicase', '') WHERE type = 'table' AND sql LIKE '%unicase%'");
    db.exec("DELETE FROM sqlite_master WHERE type = 'index' AND (sql LIKE '%unicase%' OR tbl_name IN ('fields', 'templates', 'notetypes', 'decks', 'deck_config', 'tags'))");
    db.exec('PRAGMA writable_schema = OFF');
    const bytes = db.export();
    db.close();
    return await open(bytes);
  } catch {
    return db;
  }
}

export async function readPackage(apkg: Uint8Array, fileName: string, open: OpenDatabase = openInBrowser): Promise<AnkiPackage> {
  const { collection, media } = unpack(apkg);
  const db = await readable(await open(collection), open);
  try {
    return readCollection(db, fileName.replace(/\.(apkg|colpkg)$/i, ''), media);
  } finally {
    db.close();
  }
}

// ---------- turning notes into rows ----------

/** Words marked with a language in the fields a note uses, for reading aloud. */
function voicesOf(fields: string[], used: (number | null)[]): Mark[] | undefined {
  const out: Mark[] = [];
  for (const i of used) {
    if (i === null || i < 0) continue;
    for (const m of marksInField(fields[i] ?? '')) if (!out.some((o) => o.text === m.text && o.lang === m.lang)) out.push(m);
  }
  return out.length ? out : undefined;
}

/**
 * Languages a package's card templates read fields in, with Anki's
 * `{{tts es_ES:Field}}`: the question's and the answer's, to suggest when importing.
 */
export function readingLanguages(pkg: AnkiPackage): { lang: string; langBack: string } | null {
  for (const t of pkg.notetypes) {
    if (!t.count) continue;
    const langs: Record<string, string> = {};
    for (const tpl of t.templates) Object.assign(langs, ttsFields(tpl.qfmt + tpl.afmt));
    const q = langs[t.fields[t.question]];
    const a = t.answer !== undefined ? langs[t.fields[t.answer]] : undefined;
    if (q || a) return { lang: q ?? '', langBack: a ?? '' };
  }
  return null;
}

/** Media files a field refers to: pictures and [sound:…] markers. */
export function fieldMedia(html: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    let name = decodeEntities(raw.trim());
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep as written */
    }
    if (name && !/^(https?:|data:)/i.test(name) && !out.includes(name)) out.push(name);
  };
  for (const m of html.matchAll(/<img[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) add(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) add(m[1]);
  return out;
}

const pretty = (slug: string) => {
  const s = slug.replace(/^\d+-/, '').replace(/-/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

export interface PackageRows {
  rows: RawNote[];
  skipped: number;
  notetypes: Record<string, AnkiNotetype>;
  /** Media files the kept notes use. */
  media: string[];
}

export interface RowOptions {
  withProgress: boolean;
  splitBy?: SplitBy;
}

const SELF_CHECK_TAG = /^ankh::self-check$/i;
const isSound = (x: string) => /\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(x);

/** Which Anki fields become the question, answer and extra. */
export type FieldMap = Pick<Mapping, 'question' | 'answer' | 'extra' | 'questionMore' | 'extraMore'>;

/** A note's text and media read from its Anki fields under a field map. */
export interface ReadNote {
  front: string;
  back: string;
  extra: string;
  frontMore: string[];
  extraMore: string[];
  qmedia: string[];
  amedia: string[];
  cloze: boolean;
}

/**
 * Read a question-and-answer or fill-the-gap note from its Anki fields.
 * Null when it would have no question, or no answer. `known` says whether a
 * picture or sound is in the deck. Used when importing and when the fields
 * of a note type are changed later in Deck options.
 */
export function readFields(type: { cloze: boolean }, fields: string[], map: FieldMap, known: (m: string) => boolean): ReadNote | null {
  const qMore = (map.questionMore ?? []).filter((i) => i !== map.question && i !== map.answer);
  const xMore = (map.extraMore ?? []).filter((i) => i !== map.question && i !== map.answer && i !== map.extra && !qMore.includes(i));
  const raw = (i: number | null | undefined) => (i === null || i === undefined ? '' : (fields[i] ?? ''));
  const qraw = raw(map.question);
  const araw = type.cloze ? '' : raw(map.answer);
  // Pictures and sounds in any question field show with the question; in answer and extra fields, with the answer.
  const qmedia = [qraw, ...qMore.map(raw)].flatMap(fieldMedia).filter(known);
  const amedia = [araw, ...(map.extra === null ? [] : [raw(map.extra)]), ...xMore.map(raw)]
    .flatMap(fieldMedia)
    .filter(known)
    .filter((m) => !qmedia.includes(m));
  const missingText = (m: string[]) => (m.length === 0 ? '' : m.some(isSound) ? '(listen)' : '(picture)');
  let front = fieldText(qraw) || missingText(qmedia);
  const extra = map.extra === null || map.extra === map.question || map.extra === map.answer ? '' : fieldText(raw(map.extra));
  const back = type.cloze ? '' : fieldText(araw) || missingText(amedia);
  const cloze = type.cloze && /\{\{c\d+::/.test(front);
  if (type.cloze && !cloze) front = '';
  if (!front || (!cloze && !back)) return null;
  return { front, back, extra, frontMore: qMore.map((i) => fieldText(raw(i))), extraMore: xMore.map((i) => fieldText(raw(i))), qmedia, amedia, cloze };
}

export function packageRows(pkg: AnkiPackage, mappings: Record<string, Partial<Mapping>>, options: RowOptions | boolean): PackageRows {
  const opts: RowOptions = typeof options === 'boolean' ? { withProgress: options } : options;
  const splitBy = opts.splitBy ?? 'subdeck';
  const types = new Map(pkg.notetypes.map((t) => [t.id, t]));
  const rows: (RawNote & { order: number })[] = [];
  const kept: Record<string, AnkiNotetype> = {};
  const media = new Set<string>();
  let skipped = 0;
  for (const note of pkg.notes) {
    const type = types.get(note.ntid);
    if (!type) continue;
    const map: Mapping = { ...type, extra: type.extra ?? null, ...(mappings[type.id] ?? {}) };
    const qMore = (map.questionMore ?? []).filter((i) => i !== map.question && i !== map.answer);
    const xMore = (map.extraMore ?? []).filter((i) => i !== map.question && i !== map.answer && i !== map.extra && !qMore.includes(i));
    const raw = (i: number) => note.fields[i] ?? '';
    let front = '';
    let back = '';
    let extra = '';
    let frontMore: string[] = [];
    let extraMore: string[] = [];
    let qmedia: string[] = [];
    let amedia: string[] = [];
    let cloze = false;
    let occlusion: RawNote['occlusion'] = null;
    if (type.occlusion) {
      const of = type.fields.indexOf('Occlusion');
      const imf = type.fields.indexOf('Image');
      const o = parseOcclusion(raw(of >= 0 ? of : 0), raw(imf >= 0 ? imf : 1));
      if (!o.shapes.length || !pkg.media[o.image]) {
        skipped++;
        continue;
      }
      occlusion = o;
      media.add(o.image);
      front = fieldText(raw(map.question));
      extra = map.extra === null ? '' : fieldText(raw(map.extra));
      frontMore = qMore.map((i) => fieldText(raw(i)));
      extraMore = xMore.map((i) => fieldText(raw(i)));
    } else {
      const r = readFields(type, note.fields, map, (m) => !!pkg.media[m]);
      if (!r) {
        skipped++;
        continue;
      }
      ({ front, back, extra, frontMore, extraMore, qmedia, amedia, cloze } = r);
    }
    // Lessons that went out from Ankhwiz come back as they were.
    const tag = note.tags.find((t) => /^ankh::/i.test(t) && !SELF_CHECK_TAG.test(t));
    const [, unitSlug, lessonSlug] = tag ? tag.split('::') : [];
    const labels = note.tags.filter((t) => !/^ankh::/i.test(t) && !/^(leech|marked)$/i.test(t));
    kept[type.id] = {
      id: type.id,
      name: type.name,
      cloze: type.cloze,
      fields: type.fields,
      templates: type.templates,
      css: type.css,
      question: map.question,
      answer: map.answer,
      extra: map.extra,
      questionMore: qMore,
      extraMore: xMore,
      occlusion: !!type.occlusion,
      bothWays: !type.cloze && !type.occlusion ? (map.bothWays ?? type.reverse) : false,
    };
    // Decks that went out from Ankhwiz carry their other right answers and wrong options in fields of their own.
    const named = (name: string) => {
      const i = type.fields.indexOf(name);
      return i < 0 ? [] : fieldText(note.fields[i] ?? '').split(/\s*,\s*/).filter(Boolean);
    };
    const alts = type.name.startsWith('Ankhwiz') ? named('Also accepted') : [];
    const wrong = type.name.startsWith('Ankhwiz') ? named('Wrong options') : [];
    qmedia.forEach((m) => media.add(m));
    amedia.forEach((m) => media.add(m));
    const topTag = labels[0]?.split('::')[0]?.replace(/_/g, ' ');
    const group =
      splitBy === 'size' ? undefined : splitBy === 'tag' ? (topTag ? topTag[0].toUpperCase() + topTag.slice(1) : 'Other cards') : (note.group ?? (unitSlug ? pretty(unitSlug) : undefined));
    rows.push({
      front,
      back,
      extra,
      alts,
      wrong,
      labels,
      qmedia,
      amedia,
      cloze,
      frontMore,
      extraMore,
      selfCheck: map.selfCheck || note.tags.some((t) => SELF_CHECK_TAG.test(t)),
      voices: voicesOf(note.fields, [map.question, map.answer, map.extra, ...qMore, ...xMore]),
      occlusion,
      group,
      lesson: lessonSlug && splitBy === 'subdeck' ? pretty(lessonSlug) : null,
      anki: { guid: note.guid, ntid: type.id, fields: note.fields, seen: [front.trim(), back.trim(), extra.trim(), ...frontMore, ...extraMore] },
      sched: opts.withProgress ? note.sched : [],
      order: note.order,
    });
  }
  if (!rows.length) throw new Error('No notes with a readable question and answer were found. Try other fields for the question and answer.');

  // Keep groups together, in the order their first note appears, and keep
  // the deck's own card order inside each.
  const firstSeen = new Map<string, number>();
  rows.forEach((r, i) => {
    const g = r.group ?? '';
    if (!firstSeen.has(g)) firstSeen.set(g, i);
  });
  rows.sort((a, b) => firstSeen.get(a.group ?? '')! - firstSeen.get(b.group ?? '')! || a.order - b.order);
  return { rows: rows.map(({ order: _order, ...r }) => r), skipped, notetypes: kept, media: [...media] };
}
