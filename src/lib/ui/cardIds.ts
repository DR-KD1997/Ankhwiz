// Quick, display-only mirrors of the core's card rules (core/src/cards.rs),
// so long lists do not call the core once per row. The core stays the
// authority for sessions and scheduling.

import type { Deck, Note } from '../core/types';

const GAP = /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;

export function gapNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(GAP)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

export function filledIn(text: string): string {
  return text.replace(GAP, (_w, _n, answer: string) => answer);
}

export function cardIds(deck: Deck, note: Note): string[] {
  if (note.cloze) return gapNumbers(note.front).map((n, i) => (i === 0 ? note.id : `${note.id}:c${n}`));
  return deck.options.bothWays ? [note.id, `${note.id}:r`] : [note.id];
}
