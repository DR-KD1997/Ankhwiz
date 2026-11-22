// Building a deck from the learner's sources with Thoth: read the sources,
// plan units and lessons from their shape, write a few sample cards, then
// write each lesson's cards from the passages it draws on. Every card cites
// a sentence of its source; a card whose sentence cannot be found in the
// source is added switched off, for the learner to look at.

import { ask } from './ai.svelte';
import { addNotes, applyEdits } from './core';
import type { Deck, DeckSource, NoteSource, OutlineLesson, OutlineUnit, RawNote, SourceCard } from './core/types';
import { briefs, passagesFor, putSourceText, quoteFound, removeSourceText, sourceText, type ReadSource, type Section } from './sources';
import { cardIds } from './ui/cardIds';
import { t } from './i18n';

export interface Goal {
  goal: string;
  level: string;
  days: number;
  notes: string;
}

export interface Style {
  short: boolean;
  exam: boolean;
  keepTerms: boolean;
  notes: string;
}

/** A source added to a deck: its text stored, and the deck's list entry. */
export async function storeSource(deckId: string, read: ReadSource): Promise<DeckSource> {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await putSourceText(deckId, id, read.sections);
  return {
    id,
    title: read.title.slice(0, 160) || 'Untitled',
    kind: read.kind,
    url: read.url,
    sections: read.sections.length,
    chars: read.sections.reduce((t, s) => t + s.text.length, 0),
    added: Date.now(),
  };
}

export const forgetSource = removeSourceText;

/** The text of every source in use, by id. */
export async function textsOf(deck: Deck): Promise<Map<string, Section[]>> {
  const out = new Map<string, Section[]>();
  for (const s of deck.sources ?? []) if (!s.off) out.set(s.id, await sourceText(deck.id, s.id));
  return out;
}

/** Ask Thoth for units and lessons from the sources' shape. */
export async function planOutline(deck: Deck, texts: Map<string, Section[]>, goal: Goal): Promise<OutlineUnit[]> {
  const list = (deck.sources ?? []).filter((s) => !s.off && texts.has(s.id)).map((source) => ({ source, sections: texts.get(source.id)! }));
  return ask<OutlineUnit[]>('outline', deck, { sources: briefs(list), goal });
}

/** Rough number of characters a plan sends: the openings of every section. */
export function outlineSize(texts: Map<string, Section[]>): number {
  let n = 0;
  for (const list of texts.values()) for (const s of list) n += Math.min(260, s.text.length) + s.at.length + 20;
  return n;
}

/** The card a source-drafted card becomes, with its quote checked against the source. */
export function toRow(c: SourceCard, lesson: OutlineLesson, unit: string, texts: Map<string, Section[]>): RawNote {
  const sections = texts.get(c.source) ?? [];
  const section = sections.find((s) => s.at === c.at) ?? sections.find((s) => s.at.startsWith(`${c.at} (`));
  // The quote may sit in any of the passages the lesson drew on.
  const pool = section ? [section] : lesson.from.flatMap(([id, at]) => (texts.get(id) ?? []).filter((s) => s.at === at || s.at.startsWith(`${at} (`)));
  const found = !!c.quote && pool.some((s) => quoteFound(c.quote, s.text));
  const where = pool.find((s) => quoteFound(c.quote, s.text))?.at ?? c.at;
  const source: NoteSource = { id: c.source || lesson.from[0]?.[0] || '', at: where, quote: c.quote, found };
  return {
    front: c.front,
    back: c.back,
    extra: c.extra,
    group: unit,
    lesson: lesson.name,
    // Formulas and steps are hard to type exactly: the learner checks them.
    selfCheck: lesson.kind === 'formula' || lesson.kind === 'order',
    noBuild: lesson.kind === 'formula',
    source,
  };
}

/** Thoth's cards for one lesson, from the passages it draws on. */
export async function draftLesson(deck: Deck, lesson: OutlineLesson, unit: string, texts: Map<string, Section[]>, style: Style, count?: number): Promise<RawNote[]> {
  const passages = passagesFor(lesson, texts);
  if (!passages.trim()) throw new Error(t('The sections “{name}” draws on were not found in the sources.', { name: lesson.name }));
  const cards = await ask<SourceCard[]>('sourceCards', deck, { lesson: lesson.name, kind: lesson.kind, count: count ?? lesson.cards, passages, style });
  return cards.map((c) => toRow(c, lesson, unit, texts));
}

/** About how many characters one lesson's request sends. */
export const lessonSize = (lesson: OutlineLesson, texts: Map<string, Section[]>) => passagesFor(lesson, texts).length + 2500;

/**
 * Add a lesson's cards to a deck: in the unit of that name (made if needed),
 * as lessons named after the outline's lesson. Returns the new deck, the new
 * notes' ids, and the card ids to switch off (cards whose quote was not found).
 */
export function addLesson(deck: Deck, unit: string, lessonName: string, rows: RawNote[]): { deck: Deck; noteIds: string[]; off: string[] } {
  if (!rows.length) return { deck, noteIds: [], off: [] };
  const r = addNotes(deck, unit, rows, true);
  const made = new Set(r.noteIds);
  // The new lessons are the ones holding the new notes; they get the outline's name.
  const lessons = Object.values(r.deck.lessons).filter((l) => l.noteIds.some((n) => made.has(n)));
  const renames = lessons.map((l, i) => ({ op: 'renameLesson' as const, lessonId: l.id, name: lessons.length > 1 ? `${lessonName} (${i + 1})` : lessonName }));
  const named = renames.length ? applyEdits(r.deck, renames).deck : r.deck;
  const off = r.noteIds.filter((id) => named.notes[id]?.source && !named.notes[id].source!.found).flatMap((id) => cardIds(named, named.notes[id]));
  return { deck: named, noteIds: r.noteIds, off };
}
