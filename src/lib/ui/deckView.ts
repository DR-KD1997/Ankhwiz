import { deckView } from '../core';
import { dueLine, line } from '../core/thoth';
import type { Deck, DeckView, Progress } from '../core/types';

export interface DeckSummary extends DeckView {
  /** What to do next, most important first. Shown by Thoth or as a plain list. */
  suggestions: string[];
}

/** `_time` is read by callers so the summary refreshes when the app's date changes. */
export function summarise(deck: Deck, progress: Progress, _time: number): DeckSummary {
  const view = deckView(deck, progress);
  const suggestions: string[] = [];
  if (view.due > 0) suggestions.push(dueLine(view.due, view.reviewFirst));
  if (view.nextId) suggestions.push(view.due > 0 ? `Next new lesson: ${deck.lessons[view.nextId].name}.` : line('pathNext'));
  else if (view.due === 0) suggestions.push(line('pathAllLearned'));
  if (!suggestions.length) suggestions.push(line('nothingDue'));
  return { ...view, suggestions };
}
