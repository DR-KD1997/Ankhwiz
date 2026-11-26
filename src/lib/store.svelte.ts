// App state, saved on the device. Nothing here talks to a server.

import { delMany, get, getMany, keys, setMany } from 'idb-keyval';
import {
  addNotes,
  applyEdits,
  buildDeck,
  defaultOptions,
  practiceQueue,
  today,
  clampLessonSize,
  currentStreakOf,
  exercise,
  gradeCard,
  deckSettingsChanged,
  deckEquivalent,
  forgetDeck,
  initCore,
  introduce,
  progressChanged,
  lessonQueue,
  limits,
  requeue,
  resplit,
  reviewQueue,
  sampleDeck,
  setClock,
  streakAfter,
  testOutApply,
  testOutQuestions,
} from './core';
import type { ThothMode } from './core/thoth';
import type { SoundSet } from './sounds';
import type { AnkiNotetype, AnswerLink, CardState, Deck, DeckOptions, Edit, Exercise, Note, Outcome, Progress, QueueItem, RawNote, Streak, TestResult } from './core/types';
import { hasMedia, putMedia, removeDeckMedia } from './media';
import { applyRemap, mediaNamed } from './remap';
import type { FieldMap } from './import/apkg';
import { decodeNotes, encodeNotes, headOf, type DeckHead, type Encoded, type StoredHead } from './storage';
import { dropUnused } from './fields';
import { deckWithType, KINDS, reshapeFields, typeForOwnNotes, type KindId } from './cardTypes';
import { removeDeckSources } from './sources';
import { addLink, removePair } from './links';
import { setLanguage, shownName } from './i18n';
import { t } from './i18n';

const DAY = 86_400_000;

const KEY = 'ankhwiz-prototype-v1';

export type Theme = 'system' | 'light' | 'dark';
/** What is read aloud by itself in decks with reading aloud on. */
export type AutoRead = 'off' | 'question' | 'answer' | 'both';

/** The AI connection. The key is not here: it lives in the device's key storage. */
export interface AiSettings {
  preset: string;
  baseUrl: string;
  fastModel: string;
  strongModel: string;
  /** The learner has read what is sent to the AI service. */
  noticeSeen: boolean;
}

/** The version of the stored data. Raise it with a step in MIGRATIONS whenever the shape changes. */
export const DATA_VERSION = 5;

export interface Reminder {
  on: boolean;
  /** Local time, HH:MM. */
  time: string;
  /** Days of the week it may come, 0 = Sunday. */
  days: number[];
}

export interface AppData {
  v: number;
  decks: Record<string, Deck>;
  progress: Record<string, Progress>;
  settings: {
    theme: Theme;
    thoth: ThothMode;
    lessonSize: number;
    /** Thoth's animation; missing means on. */
    motion?: boolean;
    /** Downloaded Piper voices chosen to read a language, by language (lower case, such as es-es). */
    piperVoices?: Record<string, string>;
    /** Thoth's feature tutorials appear by themselves the first time each part is opened. Missing means on. */
    tips?: boolean;
    /** Thoth's portrait style. Missing means classic. */
    thothStyle?: 'classic' | 'bright';
    /** Answer sounds: a set's id, or 'off'. Missing means Reed marimba. */
    sounds?: SoundSet | 'off';
    /** Read aloud by itself, in decks with reading aloud on: the question as a card opens, the answer once checked. */
    autoRead?: AutoRead;
    /** The deck opened last, read ahead of time when Ankhwiz opens. */
    lastDeck?: string;
    /** The app's own language: a code, or 'system' (missing) for the device's. */
    appLang?: string;
    /** The language Thoth explains things in: 'app' (missing) for the app's, or a code. */
    thothLang?: string;
    /** Thoth looks again at typed answers that matched nothing (with the AI connection). Missing means on. */
    thothChecks?: boolean;
    /** How the library is shown: by subject (one level per screen), as lists that fold, or every deck (search and shelves). Missing: by subject. */
    libraryView?: 'subjects' | 'lists' | 'all';
    /** Subjects folded away in the library's lists. */
    folded?: string[];
    /** Topics opened in the library's lists ("Subject/Topic"); the rest stay folded. */
    openTopics?: string[];
    /** When each deck was last opened, for the library's Recent strip. */
    opened?: Record<string, number>;
    /** Decks pinned to the top of All decks. */
    pinned?: string[];
    /** The library strip's tab. */
    strip?: 'due' | 'recent';
  };
  ai: AiSettings;
  streak: Streak;
  /** Copies of decks from before larger changes, newest first, by deck. */
  backups: Record<string, Backup[]>;
  /** Testing aid: days added to the clock, to try tomorrow's reviews today. */
  dayOffset: number;
  /** Tour parts already shown (tour:basics, tour:options…), and older first-time tips. */
  tips: string[];
  /** Day of the last test-out attempt, by deck and unit (one try a day). */
  testOuts: Record<string, Record<string, number>>;
  /** A lesson or review left part way, to pick up again. */
  paused: Session | null;
  reminder: Reminder;
  /** When the whole library was last backed up, in milliseconds. */
  lastBackup: number | null;
  /** Streak lengths already celebrated. */
  celebrated: number[];
  /** The newest release seen by the last update check; whether to check when Ankhwiz opens. */
  updates: {
    checked: number | null;
    latest: string | null;
    /** Check at launch (at most once a day). Missing: not yet asked. */
    atLaunch?: boolean;
    /** A version the learner chose to skip. */
    skipped?: string | null;
  };
}

/**
 * A copy of a deck from before a larger change. Since 0.6.0 it holds the
 * deck's head and the names of its note chunks, which it shares with the deck
 * (and other backups) wherever the notes are the same, instead of a full copy.
 */
export interface Backup {
  id: string;
  /** When it was made, in milliseconds. */
  t: number;
  label: string;
  head: DeckHead;
  order: string[];
  k: number;
  chunks: string[];
  labels: string[];
  progress: Progress;
}

const MAX_BACKUPS = 5;

export type Panel = 'path' | 'ai' | 'options' | 'contents' | 'progress' | 'practice' | 'dictation' | 'recall' | 'reading' | 'types' | 'sources' | 'builder' | 'prepare';

export type SessionKind = 'lesson' | 'review' | 'practice' | 'all' | 'testout';

/** A queue entry; in a session across decks each entry names its deck. */
export type SessionItem = QueueItem & { deckId?: string };

export interface Session {
  kind: SessionKind;
  /** The deck of the card on screen. */
  deckId: string;
  lessonId: string | null;
  queue: SessionItem[];
  index: number;
  exercise: Exercise | null;
  /** Note met in the item just before this one. */
  lastMet: string | null;
  graded: number;
  correct: number;
  promoted: number;
  introduced: number;
  finished: boolean;
  /** Practice: answers are marked but the schedule is not changed. */
  practice: boolean;
  /** Test out: the unit, its fixed questions, the answers so far, and the result at the end. */
  testOut?: { unitId: string; questions: Exercise[]; answers: { cardId: string; correct: boolean }[]; result?: TestResult } | null;
  /** Study all decks: the decks taking part, and the subject or topic they were chosen by. */
  decks?: string[];
  title?: string;
}

// ---------- decks and progress as plain data ----------
//
// Decks, their progress and their backups can be tens of megabytes. Kept as
// ordinary reactive state, every read went through a proxy and every hand-off
// to the core made a full copy, which made large decks slow. Instead they live
// in "shelves": objects without a prototype, which Svelte leaves alone. A
// change replaces the shelf (so the screens that show it update) and, for a
// deck, the deck object itself, so the core knows to read it again. Progress
// changes one card at a time in place, and the core is told which cards.

/** A record Svelte does not make reactive inside; replace it to show a change. */
function shelf<T>(from: Record<string, T> = {}): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, from);
}
const PLAIN = new WeakSet<object>();
function plain<T>(value: T): T {
  if (value && typeof value === 'object') PLAIN.add(value as object);
  return value;
}
function setDeck(id: string, deck: Deck): void {
  data.decks = shelf({ ...data.decks, [id]: plain(deck) });
}
function setProgress(id: string, progress: Progress): void {
  data.progress = shelf({ ...data.progress, [id]: plain(progress) });
}
/** Progress was changed in place: show it, and tell the core which cards changed. */
function touchProgress(id: string, cardIds: string[]): void {
  const p = data.progress[id];
  if (p) progressChanged(p, cardIds);
  data.progress = shelf(data.progress);
}
function setBackups(id: string, list: Backup[] | null): void {
  const next = shelf({ ...data.backups });
  if (list) next[id] = plain(list);
  else delete next[id];
  data.backups = next;
}
/** A deck's progress, created empty if it has none yet. */
function progressOf(id: string): Progress {
  if (!data.progress[id]) setProgress(id, {});
  return data.progress[id];
}
/** A deck with some of its settings changed: a new deck object, with the core told just what changed. */
function withSettings(deck: Deck, fields: Partial<Pick<Deck, 'options' | 'strictAccents' | 'anki' | 'links'>>): Deck {
  const next = { ...deck, ...fields };
  deckSettingsChanged(deck, next, fields);
  return next;
}
const withOptions = (deck: Deck, options: DeckOptions): Deck => withSettings(deck, { options });

/** Change parts of a deck the core does not read (readings, sources, how it was made, its place, preparing), and save them. */
export function setDeckExtras(id: string, fields: Partial<Pick<Deck, 'readings' | 'sources' | 'made' | 'place' | 'prep'>>): void {
  const before = data.decks[id];
  if (!before) return;
  const next = { ...before, ...fields };
  deckEquivalent(before, next);
  setDeck(id, next);
  save({ deck: id });
}

/** Replace a deck's answer links (the core changes them in place). */
export function setDeckLinks(id: string, links: AnswerLink[]): void {
  const deck = data.decks[id];
  if (!deck) return;
  setDeck(id, withSettings(deck, { links }));
  save({ deck: id });
}

/** Link notes whose answers mean the same, or nearly the same. */
export function linkAnswers(deckId: string, noteIds: string[], kind: 'same' | 'close', by: AnswerLink['by'] = 'you'): void {
  const deck = data.decks[deckId];
  if (deck) setDeckLinks(deckId, addLink(deck.links ?? [], noteIds, kind, by));
}

/** Take two linked notes apart. */
export function unlinkAnswers(deckId: string, a: string, b: string): void {
  const deck = data.decks[deckId];
  if (deck) setDeckLinks(deckId, removePair(deck.links ?? [], a, b));
}

/** Accept another answer on a note from now on (or stop accepting it). */
export function acceptAnswer(deckId: string, noteId: string, text: string, on = true): void {
  const note = data.decks[deckId]?.notes[noteId];
  const t = text.trim();
  if (!note || !t) return;
  const alts = note.alts ?? [];
  const next = on ? (alts.includes(t) ? alts : [...alts, t]) : alts.filter((a) => a !== t);
  if (next !== alts) editDeck(deckId, [{ op: 'update', noteId, alts: next }]);
}

/** Put a deck under a subject and topic (both empty: not sorted). */
export function setDeckPlace(deckId: string, subject: string, topic = ''): void {
  const s = subject.trim();
  setDeckExtras(deckId, { place: s ? { subject: s, topic: topic.trim() || undefined } : null });
}

/** Missed cards come back tomorrow instead of waiting for their date (after unit recall, say). */
export function bringForward(deckId: string, cardIds: string[]): number {
  const progress = data.progress[deckId];
  if (!progress) return 0;
  const t = new Date(now());
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 4).getTime();
  const moved: string[] = [];
  for (const id of cardIds) {
    const c = progress[id];
    if (!c || c.suspended || c.due <= tomorrow) continue;
    progress[id] = { ...c, due: tomorrow };
    moved.push(id);
  }
  if (moved.length) {
    touchProgress(deckId, moved);
    save({ cards: { deck: deckId, ids: moved } });
  }
  return moved.length;
}

function fresh(): AppData {
  return {
    v: DATA_VERSION,
    decks: shelf(),
    progress: shelf(),
    settings: { theme: 'system', thoth: 'full', lessonSize: limits.defaultLesson },
    ai: { preset: '', baseUrl: '', fastModel: '', strongModel: '', noticeSeen: false },
    streak: { count: 0, last: null, best: 0, days: [] },
    backups: shelf(),
    dayOffset: 0,
    tips: [],
    testOuts: {},
    paused: null,
    reminder: { on: false, time: '19:30', days: [0, 1, 2, 3, 4, 5, 6] },
    lastBackup: null,
    celebrated: [],
    updates: { checked: null, latest: null },
  };
}

export const data = $state<AppData>(fresh());

/** Replace a deck after the core or the learner changed it. */
export function putDeck(deck: Deck): void {
  setDeck(deck.id, deck);
  save({ deck: deck.id });
}

export const ui = $state({
  ready: false,
  screen: 'library' as 'library' | 'deck' | 'settings',
  deckId: null as string | null,
  session: null as Session | null,
  /** False when the device refused storage; progress then lasts only until the app closes. */
  persistent: true,
  /** Set when the learning core failed to start; the app cannot run without it. */
  failed: '',
  /** What the deck screen shows beside (or instead of) the path. */
  panel: 'path' as Panel,
  /** A card to open in the editor when Deck contents opens. */
  editNote: null as string | null,
  /** Which Study with Thoth tab to open, and with which cards. */
  aiTab: 'ask' as 'ask' | 'cards' | 'improve' | 'challenge' | 'reading',
  aiNotes: [] as string[],
  /** Set when a deck's notes could not be read. */
  loadError: '',
  /** The app language in use; the screens are drawn again when it changes. */
  lang: 'en' as string,
  /** A subject or topic page open in the library ("Languages" or "Languages/Turkish"). */
  topic: null as string | null,
});

export function now(): number {
  return Date.now() + data.dayOffset * DAY;
}

// ---------- saving ----------
//
// The library is stored in parts: the settings and everything small in one
// entry, and for each deck a head (everything but its notes), its notes in
// chunks (see storage.ts), its progress, a journal of recent answers, and its
// backups. An answer rewrites a small journal; a change of options rewrites
// the head; an edit rewrites the chunks it touched. Every save that does not
// say what changed writes all the small parts, in one transaction.
//
// Decks are read in two steps. When Ankhwiz opens it reads only heads and
// progress, which is enough for the library; a deck's notes are read when it
// is opened (`ensureDeck`). Until then the deck holds an empty notes object
// that marks it as not loaded.

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const META = `${KEY}:meta`;
/** Version of the layout of the stored parts. 2: whole decks (0.5); 3: heads and chunks (0.6). */
const LAYOUT = 3;
type PartKind = 'head' | 'progress' | 'backups' | 'journal';
const part = (kind: PartKind | 'deck', id: string) => `${KEY}:${kind}:${id}`;
const chunkKey = (id: string, name: string) => `${KEY}:chunk:${id}:${name}`;
const BIG = new Set(['decks', 'progress', 'backups']);
type Scope = { deck?: string; progress?: string; cards?: { deck: string; ids: string[] } };
let pending = { all: true, decks: new Set<string>(), progress: new Set<string>(), cards: new Map<string, Set<string>>() };

// Answers change a card or two of a deck that may have tens of thousands.
// Rather than rewrite all of its progress after each one, the changed cards
// go into a small journal entry beside it; the full progress is written again
// at the end of a session, or once the journal has grown.
const JOURNAL_MAX = 400;
const journals = new Map<string, Record<string, CardState | null>>();

/** Each deck's notes as last written (or read): while the deck keeps the same notes object, its chunks are unchanged. */
const written = new Map<string, Encoded>();
/** Chunk contents not yet written, by deck. */
const unwritten = new Map<string, Map<string, string>>();
/** Chunks known to be stored, by deck. */
const stored = new Map<string, Set<string>>();
/** Decks whose backups have been read (or that are new): only theirs are written, and only their chunks are tidied. */
const backupsRead = new Set<string>();
/** Notes objects that stand in for notes not yet read. */
const STUBS = new WeakSet<object>();
/** Card totals for the library, by deck, from the last time the deck's view was worked out. */
const totals = new Map<string, number>();

/** Whether a deck's notes have been read. */
export function deckLoaded(id: string): boolean {
  const deck = data.decks[id];
  return !!deck && !STUBS.has(deck.notes);
}

/** The deck's notes as chunks, noting any chunk that still has to be written. */
function encoded(id: string): Encoded {
  const prev = written.get(id);
  const enc = encodeNotes(data.decks[id].notes, prev);
  if (enc !== prev) {
    written.set(id, enc);
    queueChunks(id, enc);
  }
  return enc;
}

function queueChunks(id: string, enc: Pick<Encoded, 'chunks' | 'texts'>): void {
  const have = stored.get(id);
  let todo = unwritten.get(id);
  for (const name of enc.chunks) {
    if (have?.has(name) || todo?.has(name)) continue;
    const text = enc.texts.get(name);
    if (text === undefined) continue;
    if (!todo) unwritten.set(id, (todo = new Map()));
    todo.set(name, text);
  }
}

/** Record how many cards a deck has, for the library while it is not loaded. */
export function noteTotal(id: string, total: number): void {
  totals.set(id, total);
}

/** The small parts of the library, with the list of decks. */
function metaSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = { layout: LAYOUT, deckIds: Object.keys(data.decks) };
  for (const [k, v] of Object.entries(data)) if (!BIG.has(k)) out[k] = $state.snapshot(v);
  return out;
}

function headEntry(id: string): string {
  const deck = data.decks[id];
  const enc = encoded(id);
  const head: StoredHead = { deck: headOf(deck), order: enc.order, k: enc.k, chunks: enc.chunks, labels: enc.labels };
  const total = totals.get(id);
  if (total !== undefined) head.sum = { total };
  return JSON.stringify(head);
}

async function flush(): Promise<void> {
  const p = pending;
  pending = { all: false, decks: new Set(), progress: new Set(), cards: new Map() };
  const ids = Object.keys(data.decks);
  const deckIds = p.all ? ids : [...p.decks].filter((id) => data.decks[id]);
  const progressIds = new Set(p.all ? ids : [...p.progress].filter((id) => data.decks[id]));
  // Changed cards go to the journal, unless it is full: then the whole progress is written.
  const journalIds: string[] = [];
  for (const [id, cards] of p.cards) {
    if (progressIds.has(id) || !data.decks[id]) continue;
    const j = journals.get(id) ?? {};
    for (const c of cards) j[c] = data.progress[id]?.[c] ?? null;
    journals.set(id, j);
    if (Object.keys(j).length > JOURNAL_MAX) progressIds.add(id);
    else journalIds.push(id);
  }
  const entries: [string, unknown][] = [[META, metaSnapshot()]];
  const chunksOut: [string, string, string][] = [];
  for (const id of deckIds) {
    entries.push([part('head', id), headEntry(id)]);
    if (backupsRead.has(id)) entries.push([part('backups', id), JSON.stringify(data.backups[id] ?? [])]);
  }
  for (const [id, todo] of unwritten) {
    if (!data.decks[id]) continue;
    for (const [name, text] of todo) {
      entries.push([chunkKey(id, name), text]);
      chunksOut.push([id, name, text]);
    }
  }
  // Progress is written as text: the store would refuse an object it cannot copy.
  for (const id of progressIds) {
    entries.push([part('progress', id), JSON.stringify(data.progress[id] ?? {})]);
    entries.push([part('journal', id), '{}']);
    journals.delete(id);
  }
  for (const id of journalIds) entries.push([part('journal', id), JSON.stringify(journals.get(id))]);
  try {
    await setMany(entries);
    for (const [id, name] of chunksOut) {
      unwritten.get(id)?.delete(name);
      let have = stored.get(id);
      if (!have) stored.set(id, (have = new Set()));
      have.add(name);
    }
    await tidy(p.all ? ids : deckIds, p.all);
    ui.persistent = true;
  } catch {
    // Keep what was not written for the next save. (Chunks not written stay queued.)
    pending.all ||= p.all;
    deckIds.forEach((d) => pending.decks.add(d));
    progressIds.forEach((d) => pending.progress.add(d));
    journalIds.forEach((d) => pending.progress.add(d));
    ui.persistent = false;
  }
}

/**
 * Remove what nothing needs any more: chunks of these decks that neither the
 * deck nor its backups use, and, after a full save, every part of decks no
 * longer in the library and parts in the layout from before 0.6.
 */
async function tidy(deckIds: string[], all: boolean): Promise<void> {
  const drop: string[] = [];
  const used = (id: string) => new Set([...(written.get(id)?.chunks ?? []), ...(data.backups[id] ?? []).flatMap((b) => b.chunks)]);
  if (all) {
    const live = new Set(Object.keys(data.decks));
    const keep = new Map<string, Set<string>>();
    for (const k of await keys()) {
      if (typeof k !== 'string' || (k !== KEY && !k.startsWith(`${KEY}:`))) continue;
      if (k === KEY) {
        drop.push(k);
        continue;
      }
      const [, kind, id, name] = k.split(':');
      if (kind === 'meta') continue;
      if (kind === 'deck' || !live.has(id)) {
        drop.push(k);
        continue;
      }
      if (kind === 'chunk' && backupsRead.has(id)) {
        let u = keep.get(id);
        if (!u) keep.set(id, (u = used(id)));
        if (!u.has(name)) drop.push(k);
        else stored.get(id)?.add(name) ?? stored.set(id, new Set([name]));
      }
    }
  } else {
    for (const id of deckIds) {
      if (!backupsRead.has(id)) continue;
      const have = stored.get(id);
      if (!have) continue;
      const u = used(id);
      for (const name of [...have]) {
        if (u.has(name) || unwritten.get(id)?.has(name)) continue;
        drop.push(chunkKey(id, name));
        have.delete(name);
      }
    }
  }
  if (drop.length) await delMany(drop);
}

/**
 * Save the library shortly. Without a scope everything is written; with one,
 * only the small parts and the named deck's cards or progress.
 */
export function save(scope?: Scope): void {
  if (newer.found) return;
  if (!scope) pending.all = true;
  else {
    if (scope.deck) pending.decks.add(scope.deck);
    if (scope.progress) pending.progress.add(scope.progress);
    if (scope.cards) {
      const set = pending.cards.get(scope.cards.deck) ?? new Set<string>();
      scope.cards.ids.forEach((c) => set.add(c));
      pending.cards.set(scope.cards.deck, set);
    }
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 250);
}

/** Write everything waiting now (before the app is hidden or closed). */
export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  await flush();
}

const parsed = <T>(v: unknown): T | undefined => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T | undefined));

/** Read the library: heads and progress since 0.6; whole decks from 0.5; or the single entry from before. */
async function readStored(): Promise<unknown> {
  const meta = (await get(META)) as (Record<string, unknown> & { deckIds?: string[]; layout?: number }) | undefined;
  if (!meta) {
    pending.all = true;
    return get(KEY);
  }
  const ids = meta.deckIds ?? [];
  const old = (meta.layout ?? 2) < LAYOUT;
  const kinds: (PartKind | 'deck')[] = old ? ['deck', 'progress', 'backups', 'journal'] : ['head', 'progress', 'journal'];
  const values = await getMany(ids.flatMap((id) => kinds.map((k) => part(k, id))));
  const decks: Record<string, unknown> = {};
  const progress: Record<string, unknown> = {};
  const backups: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    const row = values.slice(i * kinds.length, (i + 1) * kinds.length);
    const [first, prog, ...more] = row;
    const journal = parsed<Record<string, unknown>>(old ? more[1] : more[0]);
    if (!first) return;
    if (old) {
      decks[id] = first;
      const back = more[0] as unknown[] | undefined;
      if (back?.length) backups[id] = back;
    } else {
      const head = parsed<StoredHead>(first)!;
      const notes = Object.create(null) as Record<string, never>;
      STUBS.add(notes);
      decks[id] = { ...head.deck, notes };
      written.set(id, { notes, order: head.order, k: head.k, chunks: head.chunks, labels: head.labels, texts: new Map() });
      stored.set(id, new Set(head.chunks));
      if (head.sum) totals.set(id, head.sum.total);
    }
    const cards = (parsed<Record<string, unknown>>(prog) ?? {}) as Record<string, unknown>;
    // Answers saved since the progress was last written in full.
    const changes = Object.entries(journal ?? {});
    for (const [c, state] of changes) {
      if (state) cards[c] = state;
      else delete cards[c];
    }
    if (prog || changes.length) progress[id] = cards;
    if (changes.length) journals.set(id, journal as Record<string, CardState | null>);
  });
  const { layout: _layout, deckIds: _ids, ...rest } = meta;
  // A library in the 0.5 layout is written again in the new one, and its old parts removed.
  pending.all = old;
  return { ...rest, decks, progress, backups };
}

const loading = new Map<string, Promise<void>>();

/** Read the chunks of a deck by name, from those waiting to be written or from storage. */
async function readChunks(id: string, names: string[]): Promise<(string | undefined)[]> {
  const todo = unwritten.get(id);
  const out: (string | undefined)[] = names.map((n) => todo?.get(n));
  const missing = names.map((n, i) => (out[i] === undefined ? i : -1)).filter((i) => i >= 0);
  if (missing.length) {
    const got = await getMany(missing.map((i) => chunkKey(id, names[i])));
    missing.forEach((i, j) => (out[i] = got[j] as string | undefined));
  }
  return out;
}

/** Read a deck's notes and backups, if they are not read yet. */
export function ensureDeck(id: string): Promise<void> {
  if (!data.decks[id] || deckLoaded(id)) return Promise.resolve();
  let p = loading.get(id);
  if (p) return p;
  p = (async () => {
    const enc = written.get(id)!;
    const [texts, back] = await Promise.all([readChunks(id, enc.chunks), get(part('backups', id))]);
    const notes = decodeNotes(enc, texts);
    const stub = data.decks[id];
    if (!stub) return;
    // The head may have changed while the notes were read (options, say): keep it.
    written.set(id, { ...enc, notes });
    const list = parsed<Backup[]>(back) ?? [];
    backupsRead.add(id);
    for (const b of list) b.chunks.forEach((c) => stored.get(id)?.add(c));
    setBackups(id, list.length ? list : null);
    setDeck(id, { ...data.decks[id], notes });
  })().finally(() => loading.delete(id));
  loading.set(id, p);
  return p;
}

/** Read every deck's notes (to export the library, say). */
export async function ensureAll(): Promise<void> {
  for (const id of Object.keys(data.decks)) await ensureDeck(id);
}

/**
 * Counts for the library for a deck whose notes are not read: cards met so
 * far, and cards due now. They follow the core's rules closely but not in every
 * detail; the deck's own screen works them out exactly.
 */
export function quickCounts(id: string, at: number): { total: number; introduced: number; due: number } {
  const deck = data.decks[id];
  const progress = data.progress[id] ?? {};
  const day = Math.floor((at - new Date(at).getTimezoneOffset() * 60_000) / DAY);
  let introduced = 0;
  let due = 0;
  let doneToday = 0;
  for (const c of Object.values(progress)) {
    introduced++;
    if (c.hist?.some((h) => h.day === day && h.stage > 1)) doneToday++;
    if (c.suspended || c.buried === day || c.due > at) continue;
    due++;
  }
  const cap = deck?.options.reviewCap ?? 0;
  if (cap > 0) due = Math.min(due, Math.max(0, cap - doneToday));
  const total = totals.get(id) ?? written.get(id)?.order.length ?? introduced;
  return { total: Math.max(total, introduced), introduced, due };
}

type Saved = Record<string, unknown>;

/**
 * Steps that bring stored data up to the current shape, one version at a
 * time. A step only reshapes what it must; fields it does not know about are
 * filled with defaults when the data is adopted.
 */
const MIGRATIONS: Record<number, (saved: Saved) => void> = {
  // 1 → 2: the first prototype kept days as date strings and its own scheduler fields.
  1: (saved) => {
    const dayOf = (key: string): number => {
      const [y, m, d] = key.split('-').map(Number);
      return Math.floor(Date.UTC(y, m - 1, d) / DAY);
    };
    const progress = (saved.progress ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    for (const cards of Object.values(progress)) {
      for (const card of Object.values(cards)) {
        card.okDays = ((card.okDays as string[]) ?? []).map(dayOf);
        const old = card.fsrs as { stability?: number; difficulty?: number; last_review?: string } | undefined;
        card.mem =
          old?.stability && old.difficulty
            ? {
                stability: old.stability,
                difficulty: old.difficulty,
                lastDay: Math.floor((old.last_review ? Date.parse(old.last_review) : Date.now()) / DAY),
              }
            : null;
        delete card.fsrs;
      }
    }
    const streak = saved.streak as { last?: unknown } | undefined;
    if (streak && typeof streak.last === 'string') streak.last = dayOf(streak.last);
  },
  // 2 → 3 (0.4): tips, test-out attempts, a paused session, reminders, library backups and update checks.
  // All are new fields with defaults; a session saved by 0.3 (none were) would lack a kind.
  2: (saved) => {
    saved.paused = null;
  },
  // 3 → 4 (0.4.1): reading aloud became a deck switch (speaker buttons) plus an
  // app-wide choice of what is read by itself. A deck that read the question or
  // the answer by itself keeps doing so.
  3: (saved) => {
    const decks = Object.values((saved.decks ?? {}) as Record<string, { options?: { look?: { speak?: string } } }>);
    const ways = new Set<string>();
    for (const d of decks) {
      const look = d.options?.look;
      if (!look?.speak) continue;
      if (look.speak === 'question' || look.speak === 'answer') ways.add(look.speak);
      look.speak = look.speak === 'off' ? 'off' : 'on';
    }
    if (ways.size) {
      const settings = ((saved.settings ??= {}) as Record<string, unknown>);
      settings.autoRead = ways.size > 1 ? 'both' : [...ways][0];
    }
  },
  // 4 → 5 (0.6): decks are stored as heads and chunks (see storage.ts); the
  // stored layout is converted on reading, so nothing changes here. The
  // version goes up so an older Ankhwiz, which cannot read the new layout,
  // leaves the library alone instead of saving over it.
  4: () => {},
};

/** Bring stored data up to DATA_VERSION. False when it is from a newer Ankhwiz. */
export function migrate(saved: Saved): boolean {
  let v = typeof saved.v === 'number' ? saved.v : 0;
  if (v > DATA_VERSION) return false;
  while (v < DATA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return false;
    step(saved);
    v++;
    saved.v = v;
  }
  return true;
}

/** A backup as 0.5 kept it: a whole copy of the deck. */
interface OldBackup {
  id: string;
  t: number;
  label: string;
  deck: Deck;
  progress: Progress;
}

/** A backup in the 0.6 form from a whole copy of a deck, sharing chunks with the deck where the notes match. */
function backupFrom(id: string, current: Deck, b: OldBackup): Backup {
  const base = written.get(id) ?? encodeNotes(current.notes, written.get(id));
  if (!written.has(id) && !STUBS.has(current.notes)) {
    written.set(id, base);
    queueChunks(id, base);
  }
  const enc = encodeNotes(b.deck.notes, { notes: {}, k: base.k, labels: base.labels });
  queueChunks(id, enc);
  return { id: b.id, t: b.t, label: b.label, head: headOf(b.deck), order: enc.order, k: enc.k, chunks: enc.chunks, labels: enc.labels, progress: b.progress };
}

function adopt(saved: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false;
  if (!migrate(saved as Saved)) return false;
  const base = fresh();
  const s = saved as Partial<AppData>;
  // Decks saved before deck options existed get the defaults.
  const defaults = defaultOptions();
  const decks = (s.decks ?? {}) as Record<string, Deck>;
  for (const deck of Object.values(decks)) {
    deck.options = { ...defaults, ...deck.options, look: { ...defaults.look, ...deck.options?.look } };
    plain(deck);
    // A deck read whole (from 0.5, or a backup file) has its backups with it.
    if (!STUBS.has(deck.notes)) backupsRead.add(deck.id);
  }
  const progress = (s.progress ?? {}) as Record<string, Progress>;
  Object.values(progress).forEach(plain);
  const backups = (s.backups ?? {}) as Record<string, (Backup | OldBackup)[]>;
  for (const [id, list] of Object.entries(backups)) {
    if (decks[id]) backups[id] = plain(list.map((b) => ('deck' in b ? backupFrom(id, decks[id], b) : b)));
  }
  Object.assign(data, base, s, {
    decks: shelf(decks),
    progress: shelf(progress),
    backups: shelf(backups),
    settings: { ...base.settings, ...s.settings },
    ai: { ...base.ai, ...s.ai },
    streak: { ...base.streak, ...s.streak },
    reminder: { ...base.reminder, ...s.reminder },
    updates: { ...base.updates, ...s.updates },
  });
  if (data.paused && (!data.decks[data.paused.deckId] || !data.paused.kind)) data.paused = null;
  return true;
}

/** Stored data from a newer version of Ankhwiz, kept aside rather than overwritten. */
export const newer = $state({ found: false });

export async function load(): Promise<void> {
  try {
    await initCore();
  } catch (e) {
    ui.failed = e instanceof Error ? t(e.message) : String(e);
    return;
  }
  setClock(now);
  Object.assign(data, fresh());
  let saved: unknown;
  try {
    saved = await readStored();
  } catch {
    /* fall through to localStorage */
  }
  if (!saved) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* start empty */
    }
  }
  if (saved && !adopt(saved)) {
    // Data from a newer Ankhwiz: start empty without saving over it.
    newer.found = true;
  } else if (saved && pending.all) {
    // A library from before 0.5.0: store it in parts now.
    save();
  }
  applyTheme();
  ui.lang = setLanguage(data.settings.appLang ?? 'system');
  ui.ready = true;
}

export function exportBackup(): string {
  return JSON.stringify($state.snapshot(data));
}

export function importBackup(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!adopt(parsed)) return false;
  ui.session = null;
  ui.screen = 'library';
  ui.deckId = null;
  applyTheme();
  save();
  return true;
}

/**
 * Put a library from an .ankhlib file on this device. `replace` swaps the
 * whole library (decks, progress and settings) for the one in the file;
 * otherwise only decks not already here are added. Returns how many decks came in.
 */
export async function restoreLibrary(
  lib: { settings: Partial<AppData>; decks: { deck: Deck; progress: Progress | null; media: Record<string, Uint8Array> }[] },
  replace: boolean,
): Promise<{ added: number; skipped: number }> {
  if (replace) {
    for (const id of Object.keys(data.decks)) {
      void removeDeckMedia(id);
      forgetDeck(id);
    }
    written.clear();
    unwritten.clear();
    stored.clear();
    journals.clear();
    const keepAi = data.ai;
    Object.assign(data, fresh(), lib.settings, { decks: {}, progress: {}, backups: {} });
    // The AI connection in the file points at a service; its key never travels, so the setup is kept only if one exists here.
    if (!lib.settings.ai) data.ai = keepAi;
    data.reminder = { ...fresh().reminder, ...lib.settings.reminder };
    // Stay on Settings, where the restore was started, so its message can be read.
    ui.session = null;
    ui.deckId = null;
    applyTheme();
  }
  let added = 0;
  let skipped = 0;
  for (const d of lib.decks) {
    if (!replace && data.decks[d.deck.id]) {
      skipped++;
      continue;
    }
    for (const [name, bytes] of Object.entries(d.media)) await putMedia(d.deck.id, name, bytes);
    addDeck(d.deck, d.progress ?? {});
    added++;
  }
  save();
  return { added, skipped };
}

export function markBackedUp(): void {
  data.lastBackup = Date.now();
  save();
}

export async function eraseAll(): Promise<void> {
  Object.assign(data, fresh());
  ui.session = null;
  ui.screen = 'library';
  ui.deckId = null;
  applyTheme();
  clearTimeout(saveTimer);
  written.clear();
  unwritten.clear();
  stored.clear();
  backupsRead.clear();
  journals.clear();
  try {
    const all = (await keys()).filter((k) => typeof k === 'string' && (k === KEY || k.startsWith(`${KEY}:`)));
    await delMany(all);
  } catch {
    /* nothing stored */
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

// ---------- settings ----------

export function applyTheme(): void {
  const root = document.documentElement;
  if (data.settings.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', data.settings.theme);
}

/** The app's own language: a code, or 'system' for the device's. */
export function setAppLanguage(code: string): void {
  data.settings.appLang = code === 'system' ? undefined : code;
  ui.lang = setLanguage(code);
  save();
}

/** The language Thoth explains things in: 'app' for the app's, or a code. */
export function setThothLanguage(code: string): void {
  data.settings.thothLang = code === 'app' ? undefined : code;
  save();
}

/** Whether Thoth looks again at typed answers that matched nothing. */
export function setThothChecks(on: boolean): void {
  data.settings.thothChecks = on;
  save();
}

export function setTheme(theme: Theme): void {
  data.settings.theme = theme;
  applyTheme();
  save();
}

export function setThoth(mode: ThothMode): void {
  data.settings.thoth = mode;
  save();
}

/** Read a language with a downloaded Piper voice, or with the device's own (null). */
export function setPiperVoice(lang: string, voiceId: string | null): void {
  const all = { ...(data.settings.piperVoices ?? {}) };
  const key = lang.replace('_', '-').toLowerCase();
  if (voiceId) all[key] = voiceId;
  else delete all[key];
  data.settings.piperVoices = all;
  save();
}

export function setThothStyle(style: 'classic' | 'bright'): void {
  data.settings.thothStyle = style;
  save();
}

export function setMotion(on: boolean): void {
  data.settings.motion = on;
  save();
}

export function setSounds(set: SoundSet | 'off'): void {
  data.settings.sounds = set;
  save();
}

export function setAutoRead(how: AutoRead): void {
  data.settings.autoRead = how;
  save();
}

/** Check for a newer Ankhwiz whenever it opens (at most once a day), or not. */
export function setUpdateAtLaunch(on: boolean): void {
  data.updates.atLaunch = on;
  save();
}

export function skipVersion(version: string): void {
  data.updates.skipped = version;
  save();
}

export function setLessonSize(size: number): void {
  data.settings.lessonSize = clampLessonSize(size);
  save();
}

export function skipDays(days: number): void {
  data.dayOffset = days === 0 ? 0 : data.dayOffset + days;
  save();
}

// ---------- decks ----------

export function addDeck(deck: Deck, progress: Progress = {}): string {
  const defaults = defaultOptions();
  deck.options = { ...defaults, ...deck.options, look: { ...defaults.look, ...deck.options?.look } };
  setDeck(deck.id, deck);
  setProgress(deck.id, progress);
  backupsRead.add(deck.id);
  save({ deck: deck.id, progress: deck.id });
  return deck.id;
}

/** Add an imported deck with its progress and media files. */
export async function addImported(deck: Deck, progress: Progress, media: Record<string, Uint8Array>, onMedia?: (done: number) => void | Promise<void>): Promise<string> {
  while (data.decks[deck.id]) deck.id = `d${Math.random().toString(36).slice(2, 10)}`;
  let done = 0;
  for (const [name, bytes] of Object.entries(media)) {
    await putMedia(deck.id, name, bytes);
    await onMedia?.(++done);
  }
  return addDeck(deck, progress);
}

/** A new deck for the deck builder: no cards yet, one card type for its kind, and its languages if it has them. */
export function addBuiltDeck(name: string, kindId: KindId, langs: { lang: string; langBack: string } | null = null): string {
  const kind = KINDS.find((k) => k.id === kindId) ?? KINDS[0];
  const empty = buildDeck(name.trim() || kind.name, [], { lessonSize: data.settings.lessonSize });
  const deck = deckWithType(empty, kind);
  if (langs?.lang) {
    const defaults = defaultOptions();
    deck.options = { ...defaults, ...deck.options, look: { ...defaults.look, ...deck.options?.look, speak: 'on', lang: langs.lang, langBack: langs.langBack } };
  }
  return addDeck(deck);
}

/** A new deck with no cards yet, to be filled by the deck builder or from sources. */
export function addEmptyDeck(name: string, made: NonNullable<Deck['made']>): string {
  const deck = buildDeck(name.trim() || t('New deck'), [], { lessonSize: data.settings.lessonSize });
  deck.made = made;
  return addDeck(deck);
}

/**
 * A deck after cards were added from its sources: replaced, and the cards
 * whose quote was not found in the source switched off until the learner
 * looks at them.
 */
export function putBuiltDeck(deckId: string, deck: Deck, offCards: string[]): void {
  setDeck(deckId, plain(deck));
  if (offCards.length) {
    const progress = progressOf(deckId);
    for (const id of offCards) progress[id] = { ...(progress[id] ?? introduce()), suspended: true };
    touchProgress(deckId, offCards);
  }
  save({ deck: deckId, progress: deckId });
}

/** Cards back to new: their progress is forgotten (a switched-off card the learner chose to keep, say). */
export function clearCards(deckId: string, cardIds: string[]): void {
  const progress = data.progress[deckId];
  if (!progress) return;
  const gone = cardIds.filter((id) => progress[id]);
  for (const id of gone) delete progress[id];
  if (gone.length) {
    touchProgress(deckId, gone);
    save({ cards: { deck: deckId, ids: gone } });
  }
}

export function addSample(): string {
  return addDeck(sampleDeck());
}

export function addFromRows(name: string, rows: RawNote[]): string {
  return addDeck(buildDeck(name, rows, { lessonSize: data.settings.lessonSize }));
}

export function removeDeck(id: string): void {
  const decks = shelf(data.decks);
  delete decks[id];
  const progress = shelf(data.progress);
  delete progress[id];
  data.decks = decks;
  data.progress = progress;
  setBackups(id, null);
  journals.delete(id);
  written.delete(id);
  unwritten.delete(id);
  stored.delete(id);
  totals.delete(id);
  forgetDeck(id);
  void removeDeckMedia(id);
  void removeDeckSources(id);
  if (ui.deckId === id) {
    ui.deckId = null;
    ui.screen = 'library';
    ui.session = null;
  }
  save();
}

export function setDeckLessonSize(id: string, size: number): void {
  setDeck(id, resplit(data.decks[id], data.progress[id] ?? {}, size));
  save({ deck: id });
}

export function setDeckAccents(id: string, strict: boolean): void {
  setDeck(id, withSettings(data.decks[id], { strictAccents: strict }));
  save({ deck: id });
}

export function setDeckOptions(id: string, patch: Partial<DeckOptions>): void {
  const deck = data.decks[id];
  setDeck(id, withOptions(deck, { ...deck.options, ...patch, look: { ...deck.options.look, ...patch.look } }));
  save({ deck: id });
}

/** Ask the cards of one Anki note type both ways, or not ('' means cards made in Ankhwiz). */
export function setTypeBothWays(id: string, ntid: string, on: boolean): void {
  const deck = data.decks[id];
  const type = ntid ? deck.anki?.notetypes[ntid] : null;
  if (type && deck.anki) setDeck(id, withSettings(deck, { anki: { ...deck.anki, notetypes: { ...deck.anki.notetypes, [ntid]: { ...type, bothWays: on } } } }));
  else setDeck(id, withOptions(deck, { ...deck.options, bothWays: on }));
  save({ deck: id });
}

/** Copy a deck's options (not its lesson size) to every other deck. */
export function copyOptionsToAll(id: string): number {
  const options = data.decks[id].options;
  let n = 0;
  for (const deck of Object.values(data.decks)) {
    if (deck.id === id) continue;
    setDeck(deck.id, withOptions(deck, structuredClone(options)));
    pending.decks.add(deck.id);
    n++;
  }
  save({});
  return n;
}

// ---------- editing and backups ----------

export function makeBackup(deckId: string, label: string): void {
  // The backup names the deck's chunks as they are now; chunks are never
  // changed, only replaced, so it shares them with the deck. Progress is
  // changed in place, so it holds a copy (its cards are replaced, not changed).
  const deck = data.decks[deckId];
  if (!deckLoaded(deckId)) return;
  const enc = encoded(deckId);
  const b: Backup = {
    id: `b${Date.now().toString(36)}`,
    t: Date.now(),
    label,
    head: headOf(deck),
    order: enc.order,
    k: enc.k,
    chunks: enc.chunks,
    labels: enc.labels,
    progress: { ...(data.progress[deckId] ?? {}) },
  };
  setBackups(deckId, [b, ...(data.backups[deckId] ?? [])].slice(0, MAX_BACKUPS));
  save({ deck: deckId });
}

/**
 * Choose other Anki fields for a note type's question, answer and extra.
 * A backup is made first. When the main question or the answer changes, the
 * type's cards start again from the beginning. Returns an error to show, or null.
 */
export async function remapFields(deckId: string, ntid: string, next: FieldMap): Promise<string | null> {
  const names = mediaNamed(data.decks[deckId], ntid);
  const have = new Set<string>();
  await Promise.all(names.map(async (m) => (await hasMedia(deckId, m)) && have.add(m)));
  const deck = structuredClone(data.decks[deckId]) as Deck;
  const progress = structuredClone(data.progress[deckId] ?? {}) as Progress;
  const type = deck.anki?.notetypes[ntid];
  const r = applyRemap(deck, progress, ntid, next, (m) => have.has(m));
  if ('error' in r) return r.error;
  makeBackup(deckId, t('Before changing the fields of {x}', { x: type?.name ?? t('a note type') }));
  for (const id of r.reset) delete progress[id];
  setDeck(deckId, deck);
  setProgress(deckId, progress);
  // A lesson left part way holds the cards as they were.
  if (data.paused?.deckId === deckId) data.paused = null;
  save({ deck: deckId, progress: deckId });
  return null;
}

export async function restoreBackup(deckId: string, backupId: string): Promise<boolean> {
  const backup = data.backups[deckId]?.find((b) => b.id === backupId);
  if (!backup) return false;
  let notes: Record<string, Note>;
  try {
    notes = decodeNotes(backup, await readChunks(deckId, backup.chunks));
  } catch {
    return false;
  }
  // The deck as it is now becomes a backup itself, so a restore can be undone.
  makeBackup(deckId, t('Before restoring an earlier copy'));
  const deck = plain({ ...structuredClone(backup.head), notes } as Deck);
  written.set(deckId, { notes, order: backup.order, k: backup.k, chunks: backup.chunks, labels: backup.labels, texts: new Map() });
  setDeck(deckId, deck);
  setProgress(deckId, { ...backup.progress });
  // A lesson left part way holds the cards as they were.
  if (data.paused?.deckId === deckId) data.paused = null;
  save({ deck: deckId, progress: deckId });
  return true;
}

export function deleteBackup(deckId: string, backupId: string): void {
  setBackups(deckId, (data.backups[deckId] ?? []).filter((b) => b.id !== backupId));
  save({ deck: deckId });
}

// ---------- card types ----------

/** Change a card type's name, layout or settings (not its fields). */
export function updateType(deckId: string, ntid: string, patch: Partial<Pick<AnkiNotetype, 'name' | 'templates' | 'css' | 'showLayout' | 'bothWays'>>): void {
  const deck = data.decks[deckId];
  const type = deck.anki?.notetypes[ntid];
  if (!type || !deck.anki) return;
  setDeck(deckId, withSettings(deck, { anki: { ...deck.anki, notetypes: { ...deck.anki.notetypes, [ntid]: { ...type, ...patch } } } }));
  save({ deck: deckId });
}

/** Rename, add, remove or reorder a card type's fields (a backup is made first). */
export function reshapeType(deckId: string, ntid: string, plan: { from: number; name: string }[]): string | null {
  try {
    const next = reshapeFields(data.decks[deckId], ntid, plan);
    makeBackup(deckId, t('Before changing the fields of {x}', { x: data.decks[deckId].anki?.notetypes[ntid]?.name ?? t('a card type') }));
    setDeck(deckId, plain(next));
    save({ deck: deckId });
    return null;
  } catch (e) {
    return e instanceof Error ? t(e.message) : t('The fields could not be changed.');
  }
}

/** Give the deck's cards made in Ankhwiz a card type, so their layout can be designed. */
export function giveOwnType(deckId: string): void {
  const next = typeForOwnNotes(data.decks[deckId]);
  if (next === data.decks[deckId]) return;
  makeBackup(deckId, t('Before giving cards a card type'));
  setDeck(deckId, plain(next));
  save({ deck: deckId });
}

/** Add new cards at the end of a unit: the last lesson is filled up first if no card of it has been met. */
export function addRows(deckId: string, rows: RawNote[], unit: string): number {
  if (!rows.length) return 0;
  let deck = data.decks[deckId];
  const progress = data.progress[deckId] ?? {};
  const u = deck.units.find((x) => x.name === unit) ?? deck.units.at(-1);
  const last = u?.lessonIds.at(-1);
  const lesson = last ? deck.lessons[last] : null;
  let room = lesson && !lesson.noteIds.some((n) => progress[n]) ? Math.max(0, deck.lessonSize - lesson.noteIds.length) : 0;
  const first = rows.slice(0, room);
  if (first.length && lesson) deck = applyEdits(deck, first.map((note) => ({ op: 'add' as const, lessonId: lesson.id, note }))).deck;
  const rest = rows.slice(first.length);
  if (rest.length) deck = addNotes(deck, u?.name ?? unit, rest, false).deck;
  room = 0;
  setDeck(deckId, plain(deck));
  save({ deck: deckId });
  return rows.length;
}

/** Delete the text of fields no card shows (a backup is made first). Returns how many notes changed. */
export function deleteUnusedFields(deckId: string): number {
  const before = data.decks[deckId];
  const r = dropUnused(before);
  if (!r.changed) return 0;
  makeBackup(deckId, t('Before deleting the text of unused fields'));
  setDeck(deckId, plain(r.deck));
  save({ deck: deckId });
  return r.changed;
}

/** Apply changes to a deck's contents. Progress of removed notes goes with them. */
export function editDeck(deckId: string, edits: Edit[], ai = false, backupLabel = ''): { added: string[]; skipped: number } {
  if (backupLabel) makeBackup(deckId, backupLabel);
  const result = applyEdits(data.decks[deckId], edits, ai);
  setDeck(deckId, result.deck);
  const removed = new Set(result.removed);
  const before = data.progress[deckId] ?? {};
  if (Object.keys(before).some((id) => removed.has(id.split(':')[0]))) {
    setProgress(deckId, Object.fromEntries(Object.entries(before).filter(([id]) => !removed.has(id.split(':')[0]))));
  }
  save({ deck: deckId, progress: deckId });
  return { added: result.added, skipped: result.skipped };
}

/** "Skip for today" and "Stop asking this one", outside a session. */
export function flagCard(deckId: string, cardId: string, flag: 'skip' | 'stop' | 'resume'): void {
  const progress = progressOf(deckId);
  const card = { ...(progress[cardId] ?? introduce()) };
  if (flag === 'skip') card.buried = today();
  else if (flag === 'stop') card.suspended = true;
  else {
    card.suspended = false;
    card.buried = null;
  }
  progress[cardId] = card;
  touchProgress(deckId, [cardId]);
  save({ cards: { deck: deckId, ids: [cardId] } });
}

export function openDeck(id: string): void {
  ui.deckId = id;
  ui.screen = 'deck';
  ui.session = null;
  ui.panel = 'path';
  data.settings.opened = { ...(data.settings.opened ?? {}), [id]: Date.now() };
  data.settings.lastDeck = id;
  save({});
  void ensureDeck(id).catch((e) => (ui.loadError = e instanceof Error ? t(e.message) : String(e)));
}

/**
 * Once the library is on screen and nothing else is happening, read the deck
 * opened last and let the core take it in, so opening it again is quick.
 */
export function readAhead(warm: (deck: Deck, progress: Progress) => void): void {
  const id = data.settings.lastDeck;
  if (!id || !data.decks[id] || deckLoaded(id)) return;
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1200));
  idle(() => {
    void ensureDeck(id)
      .then(() => idle(() => !ui.session && data.decks[id] && warm(data.decks[id], data.progress[id] ?? {})))
      .catch(() => {});
  });
}

export function openPanel(panel: Panel): void {
  ui.session = null;
  ui.panel = panel;
}

export function goLibrary(): void {
  ui.screen = 'library';
  ui.session = null;
}

// ---------- sessions ----------

function begin(kind: SessionKind, deckId: string, lessonId: string | null, queue: SessionItem[], extra: Partial<Session> = {}): void {
  if (!queue.length) return;
  ui.panel = 'path';
  ui.session = {
    kind,
    deckId,
    lessonId,
    queue,
    index: 0,
    exercise: null,
    lastMet: null,
    graded: 0,
    correct: 0,
    promoted: 0,
    introduced: 0,
    finished: false,
    practice: kind === 'practice',
    testOut: null,
    ...extra,
  };
  present();
}

export function startLesson(deckId: string, lessonId: string): void {
  begin('lesson', deckId, lessonId, lessonQueue(data.decks[deckId], data.progress[deckId] ?? {}, lessonId));
}

export function startReview(deckId: string): void {
  begin('review', deckId, null, reviewQueue(data.decks[deckId], data.progress[deckId] ?? {}));
}

/** Returns false when there was nothing to practise. */
export function startPractice(deckId: string, mode: 'tricky' | 'unit' | 'cram', unitId = ''): boolean {
  const queue = practiceQueue(data.decks[deckId], data.progress[deckId] ?? {}, mode, unitId);
  begin('practice', deckId, null, queue);
  return queue.length > 0;
}

/** How many reviews are due in each deck (decks with none left out). Decks not yet read are counted from their progress. */
export function allDue(): { deckId: string; n: number }[] {
  const at = now();
  return Object.values(data.decks)
    .map((d) => ({ deckId: d.id, n: deckLoaded(d.id) ? reviewQueue(d, data.progress[d.id] ?? {}).length : quickCounts(d.id, at).due }))
    .filter((d) => d.n);
}

/** Study all decks (or the decks of one subject or topic): due reviews from each, mixed. Returns false when nothing is due. */
export async function startAll(only: string[] | null = null, title = ''): Promise<boolean> {
  const within = (id: string) => !only || only.includes(id);
  for (const d of allDue()) if (within(d.deckId)) await ensureDeck(d.deckId);
  const lists = Object.values(data.decks)
    .filter((d) => within(d.id))
    .map((d) => ({ deckId: d.id, queue: reviewQueue(d, data.progress[d.id] ?? {}) }))
    .filter((d) => d.queue.length);
  if (!lists.length) return false;
  const queue: SessionItem[] = [];
  for (let i = 0; lists.some((l) => i < l.queue.length); i++) {
    for (const l of lists) if (i < l.queue.length) queue.push({ ...l.queue[i], deckId: l.deckId });
  }
  ui.deckId = lists[0].deckId;
  ui.screen = 'deck';
  begin('all', lists[0].deckId, null, queue, { decks: lists.map((l) => l.deckId), ...(title ? { title } : {}) });
  return true;
}

/** Whether a unit may be tested out of today: it has unmet cards and was not tried today. */
export function testOutTried(deckId: string, unitId: string): boolean {
  return data.testOuts[deckId]?.[unitId] === today();
}

/** Test out of a unit: a short quiz without help. Returns false when there is nothing to ask. */
export function startTestOut(deckId: string, unitId: string): boolean {
  const questions = testOutQuestions(data.decks[deckId], unitId);
  if (!questions.length) return false;
  begin(
    'testout',
    deckId,
    null,
    questions.map((q) => ({ cardId: q.cardId })),
    { testOut: { unitId, questions, answers: [] } },
  );
  return true;
}

function present(): void {
  const s = ui.session;
  if (!s) return;
  if (s.index >= s.queue.length) {
    finish();
    return;
  }
  const item = s.queue[s.index];
  if (s.testOut) {
    s.exercise = s.testOut.questions[s.index] ?? null;
    return;
  }
  const deckId = item.deckId ?? s.deckId;
  if (!data.decks[deckId]) {
    s.index++;
    present();
    return;
  }
  s.deckId = deckId;
  if (s.kind === 'all') ui.deckId = deckId;
  const ex = exercise(data.decks[deckId], data.progress[deckId] ?? {}, item.cardId, s.lastMet === item.cardId);
  if (!ex) {
    // The card was deleted or switched off since the session started.
    s.index++;
    present();
    return;
  }
  s.exercise = ex;
  keepPaused();
}

/** Lessons and reviews left part way can be picked up again later. */
function keepPaused(): void {
  const s = ui.session;
  if (!s || s.kind === 'practice' || s.kind === 'testout') return;
  data.paused = s.finished ? null : ({ ...snap(s), exercise: null } as Session);
  save({});
}

/** Pick up a lesson or review left part way. */
export async function resumePaused(): Promise<boolean> {
  const p = data.paused;
  if (!p || !data.decks[p.deckId]) {
    data.paused = null;
    return false;
  }
  for (const id of new Set([p.deckId, ...(p.decks ?? [])])) await ensureDeck(id);
  ui.deckId = p.deckId;
  ui.screen = 'deck';
  ui.panel = 'path';
  ui.session = structuredClone(snap(p));
  present();
  return true;
}

export function dropPaused(): void {
  data.paused = null;
  save();
}

/** The paused session in words: deck, lesson and how far it got. */
export function pausedSummary(): { deck: string; what: string; done: number; total: number } | null {
  const p = data.paused;
  if (!p || !data.decks[p.deckId]) return null;
  const deck = data.decks[p.deckId];
  const what =
    p.kind === 'all' ? p.title || t('All decks') : p.lessonId && deck.lessons[p.lessonId] ? `${deck.name} · ${shownName(deck.lessons[p.lessonId].name)}` : `${deck.name} · ${t('Review')}`;
  return { deck: deck.name, what, done: p.index, total: p.queue.length };
}

/** The learner has read a new note: it joins their progress at stage 1. */
export function met(): void {
  const s = ui.session;
  if (!s?.exercise) return;
  const id = s.exercise.cardId;
  progressOf(s.deckId)[id] = introduce();
  touchProgress(s.deckId, [id]);
  s.lastMet = id;
  s.introduced++;
  save({ cards: { deck: s.deckId, ids: [id] } });
  s.index++;
  present();
}

/** A missed card comes back a few items later, at most twice (kept here so entries keep their deck). */
function requeueItem(queue: SessionItem[], index: number, item: SessionItem): SessionItem[] {
  const retries = queue.filter((q) => q.cardId === item.cardId && q.deckId === item.deckId && q.retry).length;
  const out = [...queue];
  if (retries < 2) out.splice(Math.min(index + 4, out.length), 0, { ...item, retry: true });
  return out;
}

/** The last answer marked, as things were before, so the mark can be overruled ("I was right too"). */
let lastGrade: { deckId: string; cardId: string; index: number; before: CardState | null; queue: SessionItem[]; graded: number; correct: number; promoted: number; outcome: Outcome } | null = null;

/**
 * Mark the answer on screen again, the other way: the card's schedule, the
 * session's counts and its queue go back to how they were, and the answer
 * is marked anew. Returns whether the card moved up a stage, or null when
 * there is nothing to overrule.
 */
export function overrule(correct: boolean): { promoted: boolean } | null {
  const s = ui.session;
  const g = lastGrade;
  if (!s?.exercise || !g || g.cardId !== s.exercise.cardId || g.index !== s.index || g.deckId !== s.deckId) return null;
  if (!s.practice) {
    const progress = progressOf(s.deckId);
    if (g.before) progress[g.cardId] = g.before;
    else delete progress[g.cardId];
    touchProgress(s.deckId, [g.cardId]);
  }
  s.queue = g.queue;
  s.graded = g.graded;
  s.correct = g.correct;
  s.promoted = g.promoted;
  return grade({ ...g.outcome, correct, assisted: true });
}

/** Record a graded answer. Returns whether the card moved up a stage. */
export function grade(outcome: Outcome): { promoted: boolean } {
  const s = ui.session;
  if (!s?.exercise) return { promoted: false };
  const ex = s.exercise;
  if (!s.testOut)
    lastGrade = { deckId: s.deckId, cardId: ex.cardId, index: s.index, before: data.progress[s.deckId]?.[ex.cardId] ?? null, queue: snap(s.queue), graded: s.graded, correct: s.correct, promoted: s.promoted, outcome };
  if (s.testOut) {
    // Testing out changes nothing until the end, and nothing comes back.
    s.testOut.answers.push({ cardId: ex.cardId, correct: outcome.correct });
    s.graded++;
    if (outcome.correct) s.correct++;
    return { promoted: false };
  }
  const progress = progressOf(s.deckId);
  const card = progress[ex.cardId] ?? null;
  const applied = gradeCard(card, outcome, ex.answer.length, data.decks[s.deckId].options);
  // Practice never changes the schedule.
  if (!s.practice) {
    progress[ex.cardId] = applied.card;
    touchProgress(s.deckId, [ex.cardId]);
  }
  s.graded++;
  if (outcome.correct) s.correct++;
  else if (s.kind === 'all') s.queue = requeueItem(snap(s.queue), s.index, s.queue[s.index]);
  else s.queue = requeue(snap(s.queue), s.index, ex.cardId);
  if (applied.promoted && !s.practice) s.promoted++;
  if (!s.practice) markStudied();
  save({ cards: { deck: s.deckId, ids: [ex.cardId] } });
  return { promoted: applied.promoted && !s.practice };
}

export function next(): void {
  const s = ui.session;
  if (!s) return;
  s.lastMet = null;
  s.index++;
  present();
}

function finish(): void {
  const s = ui.session;
  if (!s) return;
  s.finished = true;
  s.exercise = null;
  if (s.testOut) {
    const t = s.testOut;
    const result = testOutApply(data.decks[s.deckId], data.progress[s.deckId] ?? {}, t.unitId, snap(t.answers));
    t.result = result;
    if (result.passed) {
      setProgress(s.deckId, result.progress);
      // A lesson of this unit left part way is now done with.
      const unit = data.decks[s.deckId].units.find((u) => u.id === t.unitId);
      if (data.paused?.deckId === s.deckId && data.paused.lessonId && unit?.lessonIds.includes(data.paused.lessonId)) data.paused = null;
    }
    data.testOuts[s.deckId] ??= {};
    data.testOuts[s.deckId][t.unitId] = today();
  }
  if (s.graded > 0) data.streak = streakAfter(snap(data.streak));
  keepPaused();
  // The end of a session writes its decks' progress in full and empties their journals.
  for (const id of s.decks ?? [s.deckId]) pending.progress.add(id);
  save({});
}

export function closeSession(): void {
  ui.session = null;
}

/** Streak lengths worth a word from Thoth. */
const MILESTONES = [7, 14, 30, 50, 100, 150, 200, 365, 500, 730, 1000];

/** A streak milestone reached and not yet celebrated; marks it celebrated. */
export function takeMilestone(): number | null {
  const n = currentStreak();
  const m = MILESTONES.filter((x) => x <= n && !data.celebrated.includes(x)).pop() ?? null;
  if (m === null) return null;
  // Every smaller milestone counts as celebrated too, so they are not shown one by one later.
  for (const x of MILESTONES) if (x <= m && !data.celebrated.includes(x)) data.celebrated.push(x);
  save();
  return m;
}

/** Whether a first-time tip should show, and marking it seen. */
export function tipDue(id: string): boolean {
  return !data.tips.includes(id);
}
export function tipSeen(id: string): void {
  if (!data.tips.includes(id)) data.tips.push(id);
  save();
}

/** Tell the reminder that today has been studied (Android checks this when the alarm comes). */
let studiedHook: (day: number) => void = () => {};
export function onStudied(fn: (day: number) => void): void {
  studiedHook = fn;
}
function markStudied(): void {
  studiedHook(today());
}

/** Skip or stop the card on screen, and drop its other showings from this session. */
export function setAsideCurrent(flag: 'skip' | 'stop'): void {
  const s = ui.session;
  if (!s?.exercise) return;
  const id = s.exercise.cardId;
  if (!s.practice || flag === 'stop') flagCard(s.deckId, id, flag);
  s.queue = s.queue.filter((q, i) => i <= s.index || q.cardId !== id);
  next();
}

/** The streak as it stands today: a missed day resets it to zero. */
export function currentStreak(): number {
  return currentStreakOf(snap(data.streak));
}

/** A plain copy of reactive state, to hand to the core. Decks and progress are plain already. */
function snap<T>(value: T): T {
  if (value && typeof value === 'object' && PLAIN.has(value as object)) return value;
  return $state.snapshot(value) as T;
}
export { snap };

/** Step back one screen (the Android back button). False when there is nowhere to go. */
export function goBack(): boolean {
  if (ui.screen === 'settings') ui.screen = ui.deckId && data.decks[ui.deckId] ? 'deck' : 'library';
  else if (ui.session) ui.session = null;
  else if (ui.panel === 'dictation' || ui.panel === 'recall' || ui.panel === 'reading') ui.panel = 'practice';
  else if (ui.panel !== 'path') ui.panel = 'path';
  else if (ui.screen === 'deck') goLibrary();
  else if (ui.topic) ui.topic = null;
  else return false;
  return true;
}
