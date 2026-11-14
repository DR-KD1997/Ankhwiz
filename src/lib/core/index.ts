// The door to the Rust core. The core is compiled to WebAssembly
// (ankhwiz_core.wasm, built by scripts/build-core.sh) and carried inside the
// app, so every build runs the same rules. Calls are synchronous once
// `initCore` has finished.

import { CORE_WASM_BASE64 } from './wasm.generated';
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

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Limits and names the interface needs, read from the core at start-up. */
export const limits = { minLesson: 3, maxLesson: 12, defaultLesson: 6, reviewFirstAt: 10, stageNames: [] as string[] };

export async function initCore(): Promise<void> {
  if (wasm) return;
  const module = await WebAssembly.compile(bytesOf(CORE_WASM_BASE64) as BufferSource);
  const instance = await WebAssembly.instantiate(module, {});
  wasm = instance.exports as unknown as Wasm;
  const seed = Math.floor(Math.random() * 2 ** 52);
  call('seed', { seed });
  Object.assign(limits, call('limits'));
}

/** The app's clock, which the testing aid in Settings can move forward. */
export function setClock(fn: () => number): void {
  clock = fn;
}

export class CoreError extends Error {}

export function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): T {
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
  call<Deck>('resplit', { deck, progress, lessonSize });
export const addNotes = (deck: Deck, unit: string, rows: RawNote[], ai: boolean) =>
  call<{ deck: Deck; noteIds: string[] }>('addNotes', { deck, unit, rows, ai });
export const lessonTags = (deck: Deck) => call<Record<string, string>>('lessonTags', { deck });
export const deckView = (deck: Deck, progress: Progress) => call<DeckView>('deckView', { deck, progress });
export const noteLessons = (deck: Deck) => call<Record<string, string>>('noteLessons', { deck });
export const deckStats = (deck: Deck, progress: Progress) => call<DeckStats>('deckStats', { deck, progress });
export const defaultOptions = () => call<DeckOptions>('defaultOptions');
export const applyEdits = (deck: Deck, edits: Edit[], ai = false) =>
  call<{ deck: Deck; added: string[]; removed: string[]; skipped: number }>('applyEdits', { deck, edits, ai });
export const noteCards = (deck: Deck, noteId: string) => call<string[]>('noteCards', { deck, noteId });
export const clozeNumbers = (text: string) => call<number[]>('clozeNumbers', { text });
export const clozeFull = (text: string) => call<string>('clozeFull', { text });
export const ankiImport = (name: string, rows: RawNote[], options: BuildOptions, crt: number) =>
  call<{ deck: Deck; progress: Progress }>('ankiImport', { name, rows, options, crt });
export const ankiExport = (deck: Deck, progress: Progress, withProgress: boolean) =>
  call<AnkiExport>('ankiExport', { deck, progress, withProgress });
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
