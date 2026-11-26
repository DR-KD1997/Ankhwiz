// Decks arranged by subject: each deck may sit under a subject (Languages)
// and a topic within it (Turkish). Decks without a subject are "not sorted
// yet". These helpers group the library for its views.

import type { Deck } from './core/types';

export interface DeckRow<S = { introduced: number; total: number; due: number }> {
  deck: Deck;
  sum: S;
}

export interface TopicGroup<S> {
  /** Empty: decks of the subject with no topic. */
  name: string;
  decks: DeckRow<S>[];
  due: number;
}

export interface SubjectGroup<S> {
  /** Empty: not sorted yet. */
  name: string;
  topics: TopicGroup<S>[];
  decks: DeckRow<S>[];
  due: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** The library grouped by subject, then topic; decks not sorted come last. */
export function groupDecks<S extends { due: number }>(rows: DeckRow<S>[]): SubjectGroup<S>[] {
  const subjects = new Map<string, Map<string, DeckRow<S>[]>>();
  for (const r of rows) {
    const s = r.deck.place?.subject?.trim() ?? '';
    const t = s ? (r.deck.place?.topic?.trim() ?? '') : '';
    if (!subjects.has(s)) subjects.set(s, new Map());
    const topics = subjects.get(s)!;
    topics.set(t, [...(topics.get(t) ?? []), r]);
  }
  const sum = (list: DeckRow<S>[]) => list.reduce((n, r) => n + (r.sum.due || 0), 0);
  return [...subjects.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : byName(a, b)))
    .map(([name, topics]) => {
      const groups = [...topics.entries()]
        .sort(([a], [b]) => (!a ? 1 : !b ? -1 : byName(a, b)))
        .map(([tname, decks]) => ({ name: tname, decks: [...decks].sort((x, y) => (x.deck.place?.order ?? 0) - (y.deck.place?.order ?? 0) || x.deck.created - y.deck.created), due: sum(decks) }));
      const decks = groups.flatMap((g) => g.decks);
      return { name, topics: groups, decks, due: sum(decks) };
    });
}

/** A subject or topic as a path key: "Languages" or "Languages/Turkish". */
export const pathKey = (subject: string, topic = '') => (topic ? `${subject}/${topic}` : subject);

/** The path key of the decks not sorted yet. */
export const UNSORTED = '\u0000';

/** The decks under a path key ("" is every deck). */
export function decksUnder<S>(rows: DeckRow<S>[], key: string): DeckRow<S>[] {
  if (!key) return rows;
  if (key === UNSORTED) return rows.filter((r) => !r.deck.place?.subject?.trim());
  const [subject, topic] = key.split('/');
  return rows.filter((r) => (r.deck.place?.subject ?? '') === subject && (topic === undefined || (r.deck.place?.topic ?? '') === topic));
}

/** Every subject in use, and each subject's topics. */
export function knownPlaces(decks: Deck[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of decks) {
    const s = d.place?.subject?.trim();
    if (!s) continue;
    const t = d.place?.topic?.trim();
    const list = out.get(s) ?? [];
    if (t && !list.includes(t)) list.push(t);
    out.set(s, list);
  }
  return new Map([...out.entries()].sort(([a], [b]) => byName(a, b)).map(([s, ts]) => [s, ts.sort(byName)]));
}
