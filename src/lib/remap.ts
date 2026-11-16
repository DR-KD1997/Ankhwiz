// Changing which Anki fields become a note type's question, answer and extra
// after its deck was imported (Deck options › Fields).
//
// Every note keeps all its Anki fields, so the cards are simply read again
// under the new choice. Text edited in Ankhwiz is first written back into the
// field it came from, so no edit is lost and export still gives it back.
//
// Progress belongs to what a card asks. Moving the extra fields, or the
// question fields shown under the main one, keeps it. Changing the main
// question or the answer makes them different cards, so the progress of every
// card of that type starts again from the beginning.

import type { AnkiNotetype, Deck, Note, Progress } from './core/types';
import { fieldMedia, readFields, type FieldMap } from './import/apkg';
import { cardIds } from './ui/cardIds';

/** Whether a new field choice keeps the type's progress: the main question and the answer stay put. */
export function keepsProgress(type: AnkiNotetype, next: FieldMap): boolean {
  return type.question === next.question && (type.cloze || type.answer === next.answer);
}

/** The note type's field choice as it stands. */
export function currentMap(type: AnkiNotetype): FieldMap {
  return { question: type.question, answer: type.answer, extra: type.extra ?? null, questionMore: [...(type.questionMore ?? [])], extraMore: [...(type.extraMore ?? [])] };
}

export function sameMap(a: FieldMap, b: FieldMap): boolean {
  const list = (x: number[] | undefined) => (x ?? []).join(',');
  return a.question === b.question && a.answer === b.answer && (a.extra ?? null) === (b.extra ?? null) && list(a.questionMore) === list(b.questionMore) && list(a.extraMore) === list(b.extraMore);
}

const notesOf = (deck: Deck, ntid: string): Note[] => Object.values(deck.notes).filter((n) => n.anki?.ntid === ntid);

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
function withMedia(text: string, media: string[]): string {
  return media.reduce((out, m) => out + (/\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(m) ? `[sound:${m}]` : `<img src="${m.replace(/"/g, '&quot;')}">`), text);
}

/** A note's Anki fields with any text edited in Ankhwiz written back where it came from (as export does). */
function foldEdits(note: Note, type: AnkiNotetype): string[] {
  const a = note.anki!;
  const fields = [...a.fields];
  while (fields.length < type.fields.length) fields.push('');
  const seen = (i: number) => a.seen?.[i] ?? '';
  const last = fields.length - 1;
  if (note.front !== seen(0)) fields[Math.min(type.question, last)] = withMedia(esc(note.front), note.qmedia ?? []);
  if (!type.cloze && note.back !== seen(1)) fields[Math.min(type.answer, last)] = withMedia(esc(note.back), note.amedia ?? []);
  if (type.extra !== null && type.extra !== undefined && (note.extra ?? '') !== seen(2) && type.extra <= last) fields[type.extra] = esc(note.extra ?? '');
  const qm = type.questionMore ?? [];
  qm.forEach((f, i) => {
    const now = note.frontMore?.[i] ?? '';
    if (now !== seen(3 + i) && f <= last) fields[f] = esc(now);
  });
  (type.extraMore ?? []).forEach((f, i) => {
    const now = note.extraMore?.[i] ?? '';
    if (now !== seen(3 + qm.length + i) && f <= last) fields[f] = esc(now);
  });
  return fields;
}

export interface RemapPlan {
  /** Notes of this type. */
  notes: number;
  /** Notes that would have no question or no answer with the new fields. */
  empty: number;
  /** Whether progress is kept. */
  keeps: boolean;
  /** Cards of this type with progress, which would start again when it is not kept. */
  studied: number;
}

/** What a new field choice would do, before it is made. */
export function planRemap(deck: Deck, progress: Progress, ntid: string, next: FieldMap): RemapPlan {
  const type = deck.anki!.notetypes[ntid];
  const notes = notesOf(deck, ntid);
  const empty = notes.filter((n) => !readFields(type, foldEdits(n, type), next, () => true)).length;
  const studied = notes.flatMap((n) => cardIds(deck, n)).filter((id) => progress[id]).length;
  return { notes: notes.length, empty, keeps: keepsProgress(type, next), studied };
}

/**
 * Read every note of a type again under a new field choice, in place.
 * Returns the card ids whose progress must be cleared (none when it is kept),
 * or an error when some note would have no question or answer.
 * `known` says whether a picture or sound is in the deck.
 */
export function applyRemap(deck: Deck, progress: Progress, ntid: string, next: FieldMap, known: (m: string) => boolean): { reset: string[] } | { error: string } {
  const type = deck.anki?.notetypes[ntid];
  if (!type || type.occlusion) return { error: 'These fields cannot be changed.' };
  const notes = notesOf(deck, ntid);
  const read = notes.map((n) => {
    const fields = foldEdits(n, type);
    return { n, fields, r: readFields(type, fields, next, known) };
  });
  const empty = read.filter((x) => !x.r).length;
  if (empty) return { error: `${empty} ${empty === 1 ? 'card' : 'cards'} would have no question or no answer with these fields. Choose other fields.` };

  const keeps = keepsProgress(type, next);
  const reset = keeps ? [] : notes.flatMap((n) => cardIds(deck, n)).filter((id) => progress[id]);
  const qMore = (next.questionMore ?? []).filter((i) => i !== next.question && i !== next.answer);
  const xMore = (next.extraMore ?? []).filter((i) => i !== next.question && i !== next.answer && i !== next.extra && !qMore.includes(i));
  for (const { n, fields, r } of read) {
    const v = r!;
    Object.assign(n, { front: v.front, back: v.back, extra: v.extra, frontMore: v.frontMore, extraMore: v.extraMore, qmedia: v.qmedia, amedia: v.amedia, cloze: v.cloze });
    n.anki = { ...n.anki!, fields, seen: [v.front.trim(), v.back.trim(), v.extra.trim(), ...v.frontMore, ...v.extraMore] };
  }
  Object.assign(type, { question: next.question, answer: next.answer, extra: next.extra ?? null, questionMore: qMore, extraMore: xMore });
  return { reset };
}

/** Every picture and sound the type's fields name, to look up before applying. */
export function mediaNamed(deck: Deck, ntid: string): string[] {
  return [...new Set(notesOf(deck, ntid).flatMap((n) => (n.anki?.fields ?? []).flatMap(fieldMedia)))];
}
