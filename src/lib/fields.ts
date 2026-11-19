// Fields of an Anki note type that a deck does not use: not the question,
// the answer or the extra, nor any of the fields shown beside them. Their
// text is kept so a deck can go back to Anki as it came, but it can be
// deleted to make the deck smaller.

import type { AnkiNotetype, Deck } from './core/types';

/** Positions of a note type's fields that no part of a card shows. */
export function unusedFields(type: AnkiNotetype): number[] {
  if (type.occlusion) return [];
  const used = new Set<number>([type.question, type.answer, ...(type.questionMore ?? []), ...(type.extraMore ?? [])]);
  if (type.extra !== null && type.extra !== undefined) used.add(type.extra);
  return type.fields.map((_, i) => i).filter((i) => !used.has(i));
}

export interface UnusedReport {
  ntid: string;
  type: string;
  /** Names of the unused fields that hold text in some note. */
  names: string[];
  /** Notes with text in an unused field. */
  notes: number;
  /** Characters of text in unused fields. */
  size: number;
}

/** What each note type of a deck holds in fields it does not use. Types with nothing to delete are left out. */
export function unusedReport(deck: Deck): UnusedReport[] {
  const types = deck.anki?.notetypes ?? {};
  const out = new Map<string, UnusedReport & { idx: Set<number> }>();
  const unused = new Map(Object.values(types).map((t) => [t.id, unusedFields(t)]));
  for (const n of Object.values(deck.notes)) {
    const a = n.anki;
    const idx = a ? unused.get(a.ntid) : undefined;
    if (!a || !idx?.length) continue;
    let any = false;
    for (const i of idx) {
      const v = a.fields[i];
      if (!v) continue;
      any = true;
      let r = out.get(a.ntid);
      if (!r) out.set(a.ntid, (r = { ntid: a.ntid, type: types[a.ntid].name, names: [], notes: 0, size: 0, idx: new Set() }));
      r.size += v.length;
      r.idx.add(i);
    }
    if (any) out.get(a.ntid)!.notes++;
  }
  return [...out.values()].map(({ idx, ...r }) => ({ ...r, names: [...idx].sort((x, y) => x - y).map((i) => types[r.ntid].fields[i]) }));
}

/** The deck with the text of its unused fields deleted, and how many notes changed. */
export function dropUnused(deck: Deck): { deck: Deck; changed: number } {
  const types = deck.anki?.notetypes ?? {};
  const unused = new Map(Object.values(types).map((t) => [t.id, unusedFields(t)]));
  let changed = 0;
  const notes = { ...deck.notes };
  for (const [id, n] of Object.entries(notes)) {
    const a = n.anki;
    const idx = a ? unused.get(a.ntid) : undefined;
    if (!a || !idx?.length || !idx.some((i) => a.fields[i])) continue;
    const fields = a.fields.map((f, i) => (idx.includes(i) ? '' : f));
    notes[id] = { ...n, anki: { ...a, fields } };
    changed++;
  }
  return changed ? { deck: { ...deck, notes }, changed } : { deck, changed };
}
