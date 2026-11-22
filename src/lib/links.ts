// Answers that mean the same. A deck links notes whose answers mean the same
// ('same': either answer counts on any of their cards) or nearly the same
// ('close': never offered as wrong options against each other). The core
// reads the links when it marks answers and picks wrong options; this file
// changes them, and builds the extra practice that links make possible:
// "pick all that fit" questions, and the side-by-side card shown before the
// second of a close pair is met.

import type { AnswerLink, Deck, Note, Progress } from './core/types';
import { fold } from './practice';

/** An answer as compared here: no case, accents, punctuation or extra spaces. */
export function plainAnswer(s: string): string {
  return fold(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[.,!?;:"'“”‘’«»¿¡()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const newId = () => `k${Math.random().toString(36).slice(2, 9)}`;

/** Whether a note can be linked at all (gaps and pictures cannot). */
export const linkable = (n: Note | undefined): n is Note => !!n && !n.cloze && !n.occlusion;

/** The other notes linked to one, with how. */
export function linksOf(deck: Deck, noteId: string): { kind: 'same' | 'close'; other: string; link: AnswerLink }[] {
  const out: { kind: 'same' | 'close'; other: string; link: AnswerLink }[] = [];
  for (const link of deck.links ?? []) {
    if (!link.notes.includes(noteId)) continue;
    for (const other of link.notes) if (other !== noteId && deck.notes[other] && !out.some((o) => o.other === other)) out.push({ kind: link.kind, other, link });
  }
  return out;
}

/** Take two notes apart: wherever they share a link, `b` leaves it (a link of one note is dropped). */
export function removePair(links: AnswerLink[], a: string, b: string): AnswerLink[] {
  return links
    .map((l) => (l.notes.includes(a) && l.notes.includes(b) ? { ...l, notes: l.notes.filter((n) => n !== b) } : l))
    .filter((l) => l.notes.length >= 2);
}

/**
 * Link notes. They first leave links of the other kind that hold any two of
 * them; then they join a link of this kind that already holds one of them,
 * or make a new one.
 */
export function addLink(links: AnswerLink[], ids: string[], kind: 'same' | 'close', by: AnswerLink['by'] = 'you', note = ''): AnswerLink[] {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return links;
  let out = links;
  for (const a of unique)
    for (const b of unique)
      if (a !== b)
        out = out
          .map((l) => (l.kind !== kind && l.notes.includes(a) && l.notes.includes(b) ? { ...l, notes: l.notes.filter((n) => n !== b) } : l))
          .filter((l) => l.notes.length >= 2);
  const at = out.findIndex((l) => l.kind === kind && unique.some((n) => l.notes.includes(n)));
  if (at >= 0) {
    const merged = { ...out[at], notes: [...new Set([...out[at].notes, ...unique])], note: out[at].note || note || undefined };
    if (!merged.note) delete merged.note;
    return out.map((l, i) => (i === at ? merged : l));
  }
  const link: AnswerLink = { id: newId(), kind, notes: unique, by };
  if (note) link.note = note;
  return [...out, link];
}

/** Links without notes that are gone. */
export function cleanLinks(deck: Deck): AnswerLink[] {
  return (deck.links ?? []).map((l) => ({ ...l, notes: l.notes.filter((n) => linkable(deck.notes[n])) })).filter((l) => l.notes.length >= 2);
}

/** The side of a note a card expects. */
export const sideOf = (n: Note, reverse: boolean) => (reverse ? n.front : n.back);

/** Another note whose answer (or, asked the other way, whose question) is the given text. */
export function noteWithAnswer(deck: Deck, text: string, reverse: boolean, except: string): string | null {
  const want = plainAnswer(text);
  if (!want) return null;
  for (const n of Object.values(deck.notes)) {
    if (n.id === except || !linkable(n)) continue;
    if (plainAnswer(sideOf(n, reverse)) === want) return n.id;
  }
  return null;
}

/** A "pick all that fit" question for a note, when its links make one worth asking. */
export interface PickAll {
  prompt: string;
  options: { text: string; right: boolean; why: string }[];
  group: string;
}

/**
 * Asked when a note has at least one other with the same meaning and its
 * links reach three notes or more: every answer that fits is to be picked;
 * close answers and a couple of others from the deck are the ones that don't.
 */
export function pickAllFor(deck: Deck, noteId: string, shuffle = true): PickAll | null {
  const note = deck.notes[noteId];
  if (!linkable(note)) return null;
  const links = linksOf(deck, noteId);
  const same = links.filter((l) => l.kind === 'same').map((l) => deck.notes[l.other]);
  const close = links.filter((l) => l.kind === 'close').map((l) => deck.notes[l.other]);
  if (!same.length || same.length + close.length < 2) return null;
  const options: PickAll['options'] = [];
  const seen = new Set<string>();
  const add = (text: string, right: boolean, why: string) => {
    const k = plainAnswer(text);
    if (!k || seen.has(k)) return;
    seen.add(k);
    options.push({ text, right, why });
  };
  add(note.back, true, 'own');
  for (const n of same) add(n.back, true, 'same');
  for (const n of close) add(n.back, false, n.front);
  const linked = new Set([noteId, ...links.map((l) => l.other)]);
  const others = Object.values(deck.notes).filter((n) => !linked.has(n.id) && linkable(n) && n.back.length < 80);
  for (let i = 0; i < 2 && others.length; i++) {
    const n = others.splice(Math.floor(Math.random() * others.length), 1)[0];
    add(n.back, false, n.front);
  }
  if (options.filter((o) => o.right).length < 2) return null;
  if (shuffle) options.sort(() => Math.random() - 0.5);
  const group = [...linked].sort().join(',');
  return { prompt: note.front, options: options.slice(0, 7), group };
}

/**
 * Before a note is first met: a note close in meaning that the learner has
 * already met, to show the two side by side.
 */
export function contrastFor(deck: Deck, progress: Progress, noteId: string): { other: Note; note: string } | null {
  for (const l of linksOf(deck, noteId)) {
    if (l.kind !== 'close') continue;
    const met = progress[l.other] || progress[`${l.other}:r`];
    if (met) return { other: deck.notes[l.other], note: l.link.note ?? '' };
  }
  return null;
}

/**
 * Links that can be found on this device without AI: notes asking the same
 * question with different answers, and notes with the same answer to
 * different questions (asked the other way round, either question is right).
 * Pairs already linked are left out.
 */
export function deviceLinks(deck: Deck): { kind: 'same'; notes: string[] }[] {
  const byFront = new Map<string, string[]>();
  const byBack = new Map<string, string[]>();
  for (const n of Object.values(deck.notes)) {
    if (!linkable(n)) continue;
    const f = plainAnswer(n.front);
    const b = plainAnswer(n.back);
    if (f) byFront.set(f, [...(byFront.get(f) ?? []), n.id]);
    if (b) byBack.set(b, [...(byBack.get(b) ?? []), n.id]);
  }
  const linked = (a: string, b: string) => (deck.links ?? []).some((l) => l.notes.includes(a) && l.notes.includes(b));
  const out: { kind: 'same'; notes: string[] }[] = [];
  const add = (ids: string[], differ: (n: Note) => string) => {
    const distinct = new Set(ids.map((id) => plainAnswer(differ(deck.notes[id]))));
    if (ids.length < 2 || ids.length > 6 || distinct.size < 2) return;
    if (ids.every((a) => ids.every((b) => a === b || linked(a, b)))) return;
    out.push({ kind: 'same', notes: ids });
  };
  for (const ids of byFront.values()) add(ids, (n) => n.back);
  for (const ids of byBack.values()) add(ids, (n) => n.front);
  return out;
}
