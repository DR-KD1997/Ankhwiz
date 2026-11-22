// The door to the Rust core. The core is compiled to WebAssembly
// (ankhwiz_core.wasm, built by scripts/build-core.sh) and carried inside the
// app, so every build runs the same rules. Calls are synchronous once the
// core has started. This file does not carry the core itself (index.ts does),
// so a background worker can use it with a core handed over by the app.

import type {
  AiRequest,
  CardState,
  ChallengeQuestion,
  Deck,
  DeckOptions,
  DeckStats,
  Edit,
  AnkiExport,
  ProposedChanges,
  DeckView,
  Exercise,
  Grade,
  HttpRequest,
  Marked,
  Occlusion,
  TestResult,
  Message,
  Note,
  Outcome,
  Preset,
  Progress,
  Provider,
  QueueItem,
  RawNote,
  Reading,
  Streak,
  Suggestion,
} from './types';

interface Wasm {
  memory: WebAssembly.Memory;
  ankh_alloc(len: number): number;
  ankh_free(ptr: number, len: number): void;
  ankh_call(ptr: number, len: number): number;
  ankh_reply_len(): number;
}

let wasm: Wasm | null = null;
let clock: () => number = () => Date.now();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Limits and names the interface needs, read from the core at start-up. */
export const limits = { minLesson: 3, maxLesson: 12, defaultLesson: 6, reviewFirstAt: 10, stageNames: [] as string[] };

/** The compiled core, kept so a background worker can start its own copy without compiling it again. */
let compiled: WebAssembly.Module | null = null;
export const coreModule = () => compiled;

/** Start the core from a compiled module (the app compiles it; a worker is handed it). */
export async function startCore(module: WebAssembly.Module): Promise<void> {
  if (wasm) return;
  const instance = await WebAssembly.instantiate(module, {});
  wasm = instance.exports as unknown as Wasm;
  compiled = module;
  const seed = Math.floor(Math.random() * 2 ** 52);
  send('seed', { seed });
  Object.assign(limits, send('limits', {}));
}

/** The app's clock, which the testing aid in Settings can move forward. */
export function setClock(fn: () => number): void {
  clock = fn;
}

export class CoreError extends Error {}

function send<T>(cmd: string, args: Record<string, unknown>): T {
  if (!wasm) throw new CoreError('The Ankhwiz core has not been started.');
  const now = clock();
  const tz = -new Date(now).getTimezoneOffset();
  const input = encoder.encode(JSON.stringify({ now, tz, ...args, cmd }));
  const inPtr = wasm.ankh_alloc(input.length);
  new Uint8Array(wasm.memory.buffer, inPtr, input.length).set(input);
  const outPtr = wasm.ankh_call(inPtr, input.length);
  const outLen = wasm.ankh_reply_len();
  const text = decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen));
  wasm.ankh_free(inPtr, input.length);
  wasm.ankh_free(outPtr, outLen);
  const reply = JSON.parse(text) as { ok?: T; err?: string };
  if (reply.err !== undefined) throw new CoreError(reply.err);
  return reply.ok as T;
}

// ---------- decks kept in the core ----------
//
// A large deck is megabytes of text. Rather than send it with every call, the
// core keeps each deck it was given in a slot named after the deck, and later
// calls name the slot. A deck counts as the same only while it is the same
// object: the store replaces a deck object whenever the deck changes, so a
// changed deck is sent again. Progress is kept the same way, and when the
// store changes cards in place it says which (`progressChanged`), and only
// those cards are sent.

const KEEP_DECKS = 4;
const keptDecks = new Map<string, object>();
const keptProgress = new Map<string, object>();
const changedCards = new WeakMap<object, Set<string>>();

/** The store changed these cards of a progress object in place. */
export function progressChanged(progress: object, cardIds: Iterable<string>): void {
  let set = changedCards.get(progress);
  if (!set) changedCards.set(progress, (set = new Set()));
  for (const id of cardIds) set.add(id);
}

/**
 * A deck was replaced by a copy with only its settings changed (options,
 * accents, Anki note types). If the core was keeping the old one, it changes
 * those settings in place instead of reading the whole deck again.
 */
export function deckSettingsChanged(before: object, after: Deck, fields: Partial<Pick<Deck, 'options' | 'strictAccents' | 'anki' | 'links'>>): void {
  if (!wasm || keptDecks.get(after.id) !== before) return;
  try {
    send('patchDeck', { slot: after.id, ...fields });
    keptDecks.set(after.id, after);
  } catch {
    keptDecks.delete(after.id);
  }
}

/**
 * A deck was replaced by a copy that differs only in parts the core does not
 * read (its reading passages, sources, how it was made): the kept copy stands.
 */
export function deckEquivalent(before: object, after: Deck): void {
  if (keptDecks.get(after.id) === before) keptDecks.set(after.id, after);
}

/** Forget a deck the core was keeping (it was deleted). */
export function forgetDeck(id: string): void {
  keptDecks.delete(id);
  keptProgress.delete(id);
  if (wasm) send('dropSlot', { slot: id });
}

/**
 * The deck as the core needs it. Notes from Anki carry their raw fields and
 * the text they had on import, often half of a deck's size; only exporting to
 * Anki reads them, and that call is sent the whole deck. Every other call
 * needs just the note type, so the kept copy leaves the rest out.
 */
function lite(deck: Deck): Deck {
  const notes: Record<string, Note> = {};
  let changed = false;
  for (const [id, n] of Object.entries(deck.notes)) {
    if (n.anki && (n.anki.fields?.length || n.anki.seen?.length)) {
      notes[id] = { ...n, anki: { guid: n.anki.guid, ntid: n.anki.ntid, fields: [], seen: [] } };
      changed = true;
    } else notes[id] = n;
  }
  return changed ? { ...deck, notes } : deck;
}

/**
 * A deck the core changed and gave back: its notes from Anki get their raw
 * fields again, and the parts the core does not keep up to date (readings,
 * sources, how it was made; see `deckEquivalent`) are the app's own.
 */
function withAnki<T extends { deck: Deck }>(before: Deck, result: T): T {
  for (const [id, n] of Object.entries(result.deck.notes)) {
    const was = before.notes[id]?.anki;
    if (n.anki && was && n.anki.ntid === was.ntid) n.anki = was;
  }
  result.deck.readings = before.readings;
  result.deck.sources = before.sources;
  result.deck.made = before.made;
  result.deck.place = before.place;
  result.deck.prep = before.prep;
  for (const k of ['readings', 'sources', 'made', 'place', 'prep'] as const) if (!result.deck[k]) delete result.deck[k];
  return result;
}

function withSlots(args: Record<string, unknown>): Record<string, unknown> {
  const deck = args.deck as { id?: unknown } | undefined;
  if (!deck || typeof deck !== 'object' || typeof deck.id !== 'string') return args;
  const slot = deck.id;
  const out: Record<string, unknown> = { ...args, deck: undefined, deckRef: slot };
  if (keptDecks.get(slot) !== deck) {
    send('loadDeck', { slot, deck: lite(deck as Deck) });
    // A changed deck may number its cards differently: send its progress again too.
    keptProgress.delete(slot);
  }
  // Most recently used last; the oldest slot goes when there are too many.
  keptDecks.delete(slot);
  keptDecks.set(slot, deck);
  if (keptDecks.size > KEEP_DECKS) forgetDeck(keptDecks.keys().next().value as string);
  const progress = args.progress as Record<string, unknown> | undefined;
  if (progress && typeof progress === 'object') {
    if (keptProgress.get(slot) !== progress) {
      send('loadProgress', { slot, progress });
      keptProgress.set(slot, progress);
      changedCards.delete(progress);
    } else {
      const changed = changedCards.get(progress);
      if (changed?.size) {
        const cards: Record<string, unknown> = {};
        for (const id of changed) cards[id] = progress[id] ?? null;
        send('patchProgress', { slot, cards });
        changed.clear();
      }
    }
    out.progress = undefined;
    out.progressRef = slot;
  }
  return out;
}

export function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): T {
  try {
    return send<T>(cmd, withSlots(args));
  } catch (e) {
    // The core lost a slot (it started again, for example): send everything once more.
    if (e instanceof CoreError && e.message.startsWith('not-loaded:')) {
      keptDecks.clear();
      keptProgress.clear();
      return send<T>(cmd, withSlots(args));
    }
    throw e;
  }
}

// ---------- answers ----------

export type Live = 'empty' | 'match' | 'close' | 'off';
export const liveFeedback = (typed: string, accepted: string[], strict: boolean) =>
  call<Live>('liveFeedback', { typed, accepted, strict });
export const checkAnswer = (typed: string, accepted: string[], strict: boolean) =>
  call<'correct' | 'typo' | 'wrong'>('checkAnswer', { typed, accepted, strict });

// ---------- decks ----------

export interface BuildOptions {
  lessonSize?: number;
  prompt?: string;
  strictAccents?: boolean;
  lessonNames?: Record<string, string[]>;
  ai?: boolean;
}
export const sampleDeck = () => call<Deck>('sampleDeck');
export const buildDeck = (name: string, rows: RawNote[], options: BuildOptions = {}) =>
  call<Deck>('buildDeck', { name, rows, options });
export const resplit = (deck: Deck, progress: Progress, lessonSize: number) =>
  withAnki(deck, { deck: call<Deck>('resplit', { deck, progress, lessonSize }) }).deck;
export const addNotes = (deck: Deck, unit: string, rows: RawNote[], ai: boolean) =>
  withAnki(deck, call<{ deck: Deck; noteIds: string[] }>('addNotes', { deck, unit, rows, ai }));
export const lessonTags = (deck: Deck) => call<Record<string, string>>('lessonTags', { deck });
export const deckView = (deck: Deck, progress: Progress) => call<DeckView>('deckView', { deck, progress });
export const pathView = (deck: Deck, progress: Progress) =>
  call<{ view: DeckView; testable: string[] }>('pathView', { deck, progress });
export const noteLessons = (deck: Deck) => call<Record<string, string>>('noteLessons', { deck });
export const deckStats = (deck: Deck, progress: Progress) => call<DeckStats>('deckStats', { deck, progress });
export const defaultOptions = () => call<DeckOptions>('defaultOptions');
export const applyEdits = (deck: Deck, edits: Edit[], ai = false) =>
  withAnki(deck, call<{ deck: Deck; added: string[]; removed: string[]; skipped: number }>('applyEdits', { deck, edits, ai }));
export const noteCards = (deck: Deck, noteId: string) => call<string[]>('noteCards', { deck, noteId });
export const clozeNumbers = (text: string) => call<number[]>('clozeNumbers', { text });
export const clozeFull = (text: string) => call<string>('clozeFull', { text });
export const ankiImport = (name: string, rows: RawNote[], options: BuildOptions, crt: number) =>
  call<{ deck: Deck; progress: Progress }>('ankiImport', { name, rows, options, crt });
// Sent whole, not through the kept copy: exporting needs the raw Anki fields.
export const ankiExport = (deck: Deck, progress: Progress, withProgress: boolean) =>
  send<AnkiExport>('ankiExport', { deck, progress, withProgress });
export const parseOcclusion = (field: string, image: string) => call<Occlusion>('parseOcclusion', { field, image });
export const testOutQuestions = (deck: Deck, unitId: string) => call<Exercise[]>('testOutQuestions', { deck, unitId });
export const canTestOut = (deck: Deck, progress: Progress, unitId: string) =>
  call<boolean>('canTestOut', { deck, progress, unitId });
export const testOutApply = (deck: Deck, progress: Progress, unitId: string, answers: { cardId: string; correct: boolean }[]) =>
  call<TestResult>('testOutApply', { deck, progress, unitId, answers });
export const clampLessonSize = (n: number) =>
  Math.max(limits.minLesson, Math.min(limits.maxLesson, Math.round(n) || limits.defaultLesson));

// ---------- sessions ----------

export const lessonQueue = (deck: Deck, progress: Progress, lessonId: string) =>
  call<QueueItem[]>('lessonQueue', { deck, progress, lessonId });
export const reviewQueue = (deck: Deck, progress: Progress) => call<QueueItem[]>('reviewQueue', { deck, progress });
export const practiceQueue = (deck: Deck, progress: Progress, mode: 'tricky' | 'unit' | 'cram', unitId = '') =>
  call<QueueItem[]>('practiceQueue', { deck, progress, mode, unitId });
export const exercise = (deck: Deck, progress: Progress, cardId: string, justMet: boolean) =>
  call<Exercise | null>('exercise', { deck, progress, cardId, justMet });
export const requeue = (queue: QueueItem[], index: number, cardId: string) =>
  call<QueueItem[]>('requeue', { queue, index, cardId });
export const introduce = () => call<CardState>('introduce');
export const gradeCard = (card: CardState | null, outcome: Outcome, answerLength: number, options?: DeckOptions) =>
  call<{ card: CardState; grade: Grade; promoted: boolean; demoted: boolean }>('grade', { card, outcome, answerLength, options });
export const streakAfter = (streak: Streak) => call<Streak>('streakAfter', { streak });
export const currentStreakOf = (streak: Streak) => call<number>('currentStreak', { streak });
export const today = () => call<number>('today');

// ---------- AI: requests and replies (sending is the platform's job) ----------

export const aiPresets = () => call<Preset[]>('aiPresets');
export const aiRequest = (task: string, deck: Deck, args: Record<string, unknown> = {}) =>
  call<AiRequest>('aiRequest', { task, deck, ...args });
export const aiHttp = (provider: Provider, request: AiRequest) => call<HttpRequest>('aiHttp', { provider, request });
export const aiModelsHttp = (provider: Provider) => call<HttpRequest>('aiModelsHttp', { provider });
export const aiModels = (status: number, body: string) => call<string[]>('aiModels', { status, body });
export const aiReply = <T>(task: string, status: number, body: string, args: Record<string, unknown> = {}) =>
  call<T>('aiReply', { task, status, body, ...args });

export type { ChallengeQuestion, Marked, Message, ProposedChanges, Reading, Suggestion };
