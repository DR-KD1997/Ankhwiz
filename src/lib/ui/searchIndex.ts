// The card list's search: each note's text, lower-cased once and kept until
// the deck's notes change, so typing in the search box only compares strings.

import type { Note } from '../core/types';

const indexes = new WeakMap<object, Map<string, string>>();

/** Everything a search looks through for one note, lower-cased. */
function haystack(n: Note): string {
  return [n.front, n.back, n.extra ?? '', ...(n.alts ?? []), ...(n.labels ?? []), ...(n.frontMore ?? []), ...(n.extraMore ?? [])]
    .join('\u0001')
    .toLowerCase();
}

/** The search text of every note in a deck, made the first time it is needed. */
export function searchIndex(notes: Record<string, Note>): Map<string, string> {
  let index = indexes.get(notes);
  if (!index) {
    index = new Map();
    for (const [id, n] of Object.entries(notes)) index.set(id, haystack(n));
    indexes.set(notes, index);
  }
  return index;
}

/** Whether a note's text holds the query (already trimmed and lower-cased). */
export function noteHas(notes: Record<string, Note>, n: Note, q: string): boolean {
  return !q || (searchIndex(notes).get(n.id) ?? haystack(n)).includes(q);
}
