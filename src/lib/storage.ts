// How decks are laid out on the device (since 0.6.0).
//
// A deck is stored as a small head (its name, options, lessons and so on,
// everything but the notes) and its notes in chunks. Each note goes to a
// chunk picked from its id, so an edit to a few notes rewrites a few chunks,
// and a change of options rewrites only the head. A chunk is kept under a name
// made from its contents, so a backup that holds the same notes as the deck
// shares its chunks instead of copying them.
//
// Notes are also stored more compactly than they are used: the text a note
// had when it came from Anki (`anki.seen`) is mostly the same as the note's
// own fields, and Anki's raw fields often too, so those are written as
// references; labels are written as numbers into a table kept in the head.
// None of this is visible outside this file: notes come back exactly as they went in.

import type { Deck, Note } from './core/types';

/** A deck without its notes. */
export type DeckHead = Omit<Deck, 'notes'>;

/** What the head entry holds. */
export interface StoredHead {
  /** The deck without its notes. */
  deck: DeckHead;
  /** Note ids in the deck's order. */
  order: string[];
  /** How many chunks the notes are spread over (a power of two). */
  k: number;
  /** The chunks, by number: each one's name (a hash of its contents). */
  chunks: string[];
  /** Labels used by notes, numbered by position. Only ever added to. */
  labels: string[];
  /** Counts for the library while the deck's notes are not loaded. */
  sum?: { total: number };
}

/** A deck's notes as chunks, ready to write. */
export interface Encoded {
  /** The notes object this was made from: while the deck keeps it, nothing changed. */
  notes: Record<string, Note>;
  order: string[];
  k: number;
  chunks: string[];
  labels: string[];
  /** Chunk contents by name, for chunks that may not be stored yet. */
  texts: Map<string, string>;
}

// ---------- hashing ----------

/** A 32-bit FNV-1a hash of a string. */
function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A name for a chunk from its contents: two 32-bit hashes and the length. */
export function chunkName(text: string): string {
  return fnv(text, 2166136261).toString(36) + fnv(text, 0x9747b28c).toString(36) + text.length.toString(36);
}

/** Which chunk a note goes in. */
export function bucketOf(id: string, k: number): number {
  return k <= 1 ? 0 : fnv(id, 2166136261) & (k - 1);
}

/** About 250 notes to a chunk, as a power of two, at most 256 chunks. */
export function chunkCount(notes: number, previous = 0): number {
  let ideal = 1;
  while (ideal < 256 && ideal * 250 < notes) ideal *= 2;
  // Keep the old count unless the deck has grown or shrunk a lot, so most chunks stay as they are.
  if (previous && ideal <= previous * 2 && ideal >= previous / 2) return previous;
  return ideal;
}

// ---------- notes ----------

/** The fields of a note as shown, in the order `anki.seen` keeps them. */
function shown(n: Note): string[] {
  return [n.front.trim(), n.back.trim(), (n.extra ?? '').trim(), ...(n.frontMore ?? []), ...(n.extraMore ?? [])];
}

type Packed = Record<string, unknown>;

/** A note as it is written: seen-text and raw fields that repeat the note's own text become numbers. */
export function packNote(n: Note, labelIndex: Map<string, number>, labels: string[]): Packed {
  const out: Packed = { ...n };
  if (n.labels?.length) {
    out.labels = n.labels.map((l) => {
      let i = labelIndex.get(l);
      if (i === undefined) {
        i = labels.length;
        labels.push(l);
        labelIndex.set(l, i);
      }
      return i;
    });
  }
  if (n.anki) {
    const d = shown(n);
    const at = new Map<string, number>();
    d.forEach((s, i) => {
      if (s && !at.has(s)) at.set(s, i);
    });
    const seen = (n.anki.seen ?? []).map((s, i) => (s && s === d[i] ? 0 : s));
    const fields = (n.anki.fields ?? []).map((f) => {
      const i = f ? at.get(f) : undefined;
      return i === undefined ? f : i + 1;
    });
    out.anki = { ...n.anki, seen, fields };
  }
  return out;
}

/** The note again, exactly as it was before `packNote`. */
export function unpackNote(p: Packed, labels: string[]): Note {
  const n = p as unknown as Note;
  if (Array.isArray(p.labels) && p.labels.some((l) => typeof l === 'number')) {
    n.labels = (p.labels as (number | string)[]).map((l) => (typeof l === 'number' ? (labels[l] ?? '') : l));
  }
  if (n.anki) {
    const d = shown(n);
    const a = n.anki as unknown as { seen?: (string | number)[]; fields?: (string | number)[] };
    if (a.seen) n.anki.seen = a.seen.map((s, i) => (s === 0 ? (d[i] ?? '') : String(s)));
    if (a.fields) n.anki.fields = a.fields.map((f) => (typeof f === 'number' ? (d[f - 1] ?? '') : f));
  }
  return n;
}

// ---------- decks ----------

/** A deck without its notes. */
export function headOf(deck: Deck): DeckHead {
  const { notes: _notes, ...head } = deck;
  return head;
}

/**
 * A deck's notes as chunks. `prev` is what was written last time: when the
 * deck still holds the same notes object, it is returned as it is.
 */
export function encodeNotes(notes: Record<string, Note>, prev?: Pick<Encoded, 'notes' | 'k' | 'labels'> | null): Encoded {
  if (prev && prev.notes === notes) return prev as Encoded;
  const order = Object.keys(notes);
  const k = chunkCount(order.length, prev?.k ?? 0);
  const labels = [...(prev?.labels ?? [])];
  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  const buckets: string[][] = Array.from({ length: k }, () => []);
  for (const id of order) buckets[bucketOf(id, k)].push(JSON.stringify(packNote(notes[id], labelIndex, labels)));
  const texts = new Map<string, string>();
  const chunks = buckets.map((b) => {
    const text = `[${b.join(',')}]`;
    const name = chunkName(text);
    texts.set(name, text);
    return name;
  });
  return { notes, order, k, chunks, labels, texts };
}

/** Notes back from their chunks (by name), in the deck's order. Missing chunks are an error. */
export function decodeNotes(head: Pick<StoredHead, 'order' | 'chunks' | 'labels'>, texts: (string | undefined)[]): Record<string, Note> {
  const byId = new Map<string, Note>();
  texts.forEach((text, i) => {
    if (text === undefined) throw new Error(`A part of this deck is missing (${head.chunks[i]}).`);
    for (const p of JSON.parse(text) as Packed[]) {
      const n = unpackNote(p, head.labels);
      byId.set(n.id, n);
    }
  });
  const notes: Record<string, Note> = {};
  for (const id of head.order) {
    const n = byId.get(id);
    if (n) notes[id] = n;
  }
  // Notes the order does not know (it should know them all) still come back.
  for (const [id, n] of byId) if (!notes[id]) notes[id] = n;
  return notes;
}
