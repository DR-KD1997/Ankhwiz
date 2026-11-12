// App state, saved on the device. Nothing here talks to a server.

import { del, get, set } from 'idb-keyval';
import {
  applyEdits,
  buildDeck,
  defaultOptions,
  practiceQueue,
  today,
  clampLessonSize,
  currentStreakOf,
  exercise,
  gradeCard,
  initCore,
  introduce,
  lessonQueue,
  limits,
  requeue,
  resplit,
  reviewQueue,
  sampleDeck,
  setClock,
  streakAfter,
} from './core';
import type { ThothMode } from './core/thoth';
import type { CardState, Deck, DeckOptions, Edit, Exercise, Outcome, Progress, QueueItem, RawNote, Streak } from './core/types';
import { putMedia, removeDeckMedia } from './media';

const DAY = 86_400_000;

const KEY = 'ankhwiz-prototype-v1';

export type Theme = 'system' | 'light' | 'dark';

/** The AI connection. The key is not here: it lives in the device's key storage. */
export interface AiSettings {
  preset: string;
  baseUrl: string;
  fastModel: string;
  strongModel: string;
  /** The learner has read what is sent to the AI service. */
  noticeSeen: boolean;
}

export interface AppData {
  v: 2;
  decks: Record<string, Deck>;
  progress: Record<string, Progress>;
  settings: { theme: Theme; thoth: ThothMode; lessonSize: number };
  ai: AiSettings;
  streak: Streak;
  /** Copies of decks from before larger changes, newest first, by deck. */
  backups: Record<string, Backup[]>;
  /** Testing aid: days added to the clock, to try tomorrow's reviews today. */
  dayOffset: number;
}

export interface Backup {
  id: string;
  /** When it was made, in milliseconds. */
  t: number;
  label: string;
  deck: Deck;
  progress: Progress;
}

const MAX_BACKUPS = 5;

export type Panel = 'path' | 'ai' | 'options' | 'contents' | 'progress' | 'practice';

export interface Session {
  deckId: string;
  lessonId: string | null;
  queue: QueueItem[];
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
}

function fresh(): AppData {
  return {
    v: 2,
    decks: {},
    progress: {},
    settings: { theme: 'system', thoth: 'full', lessonSize: limits.defaultLesson },
    ai: { preset: '', baseUrl: '', fastModel: '', strongModel: '', noticeSeen: false },
    streak: { count: 0, last: null, best: 0, days: [] },
    backups: {},
    dayOffset: 0,
  };
}

export const data = $state<AppData>(fresh());

/** Replace a deck after the core or the learner changed it. */
export function putDeck(deck: Deck): void {
  data.decks[deck.id] = deck;
  save();
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
});

export function now(): number {
  return Date.now() + data.dayOffset * DAY;
}

// ---------- saving ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function write(snapshot: AppData): Promise<void> {
  try {
    await set(KEY, snapshot);
    ui.persistent = true;
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      ui.persistent = true;
    } catch {
      ui.persistent = false;
    }
  }
}

export function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void write($state.snapshot(data) as AppData), 250);
}

/** Bring data saved by the first prototype (v1) up to the current shape. */
function migrate(saved: Record<string, unknown>): void {
  if (saved.v !== 1) return;
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
  saved.v = 2;
}

function adopt(saved: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false;
  migrate(saved as Record<string, unknown>);
  if ((saved as AppData).v !== 2) return false;
  const base = fresh();
  const s = saved as Partial<AppData>;
  Object.assign(data, base, s, {
    settings: { ...base.settings, ...s.settings },
    ai: { ...base.ai, ...s.ai },
    streak: { ...base.streak, ...s.streak },
    backups: s.backups ?? {},
  });
  // Decks saved before deck options existed get the defaults.
  const defaults = defaultOptions();
  for (const deck of Object.values(data.decks)) {
    deck.options = { ...defaults, ...deck.options, look: { ...defaults.look, ...deck.options?.look } };
  }
  return true;
}

export async function load(): Promise<void> {
  try {
    await initCore();
  } catch (e) {
    ui.failed = e instanceof Error ? e.message : String(e);
    return;
  }
  setClock(now);
  Object.assign(data, fresh());
  let saved: unknown;
  try {
    saved = await get(KEY);
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
  adopt(saved);
  applyTheme();
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

export async function eraseAll(): Promise<void> {
  Object.assign(data, fresh());
  ui.session = null;
  ui.screen = 'library';
  ui.deckId = null;
  applyTheme();
  try {
    await del(KEY);
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

export function setTheme(theme: Theme): void {
  data.settings.theme = theme;
  applyTheme();
  save();
}

export function setThoth(mode: ThothMode): void {
  data.settings.thoth = mode;
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
  data.decks[deck.id] = deck;
  data.progress[deck.id] = progress;
  save();
  return deck.id;
}

/** Add an imported deck with its progress and media files. */
export async function addImported(deck: Deck, progress: Progress, media: Record<string, Uint8Array>): Promise<string> {
  while (data.decks[deck.id]) deck.id = `d${Math.random().toString(36).slice(2, 10)}`;
  for (const [name, bytes] of Object.entries(media)) await putMedia(deck.id, name, bytes);
  return addDeck(deck, progress);
}

export function addSample(): string {
  return addDeck(sampleDeck());
}

export function addFromRows(name: string, rows: RawNote[]): string {
  return addDeck(buildDeck(name, rows, { lessonSize: data.settings.lessonSize }));
}

export function removeDeck(id: string): void {
  delete data.decks[id];
  delete data.progress[id];
  delete data.backups[id];
  void removeDeckMedia(id);
  if (ui.deckId === id) {
    ui.deckId = null;
    ui.screen = 'library';
    ui.session = null;
  }
  save();
}

export function setDeckLessonSize(id: string, size: number): void {
  data.decks[id] = resplit(snap(data.decks[id]), snap(data.progress[id] ?? {}), size);
  save();
}

export function setDeckAccents(id: string, strict: boolean): void {
  data.decks[id].strictAccents = strict;
  save();
}

export function setDeckOptions(id: string, patch: Partial<DeckOptions>): void {
  const deck = data.decks[id];
  deck.options = { ...deck.options, ...patch, look: { ...deck.options.look, ...patch.look } };
  save();
}

/** Copy a deck's options (not its lesson size) to every other deck. */
export function copyOptionsToAll(id: string): number {
  const options = snap(data.decks[id].options);
  let n = 0;
  for (const deck of Object.values(data.decks)) {
    if (deck.id === id) continue;
    deck.options = structuredClone(options);
    n++;
  }
  save();
  return n;
}

// ---------- editing and backups ----------

export function makeBackup(deckId: string, label: string): void {
  // Read back through the state proxy: `??=` hands back the plain array.
  data.backups[deckId] ??= [];
  const list = data.backups[deckId];
  list.unshift({
    id: `b${Date.now().toString(36)}`,
    t: Date.now(),
    label,
    deck: snap(data.decks[deckId]),
    progress: snap(data.progress[deckId] ?? {}),
  });
  list.splice(MAX_BACKUPS);
  save();
}

export function restoreBackup(deckId: string, backupId: string): boolean {
  const backup = data.backups[deckId]?.find((b) => b.id === backupId);
  if (!backup) return false;
  // The deck as it is now becomes a backup itself, so a restore can be undone.
  makeBackup(deckId, 'Before restoring an earlier copy');
  data.decks[deckId] = structuredClone(snap(backup.deck));
  data.progress[deckId] = structuredClone(snap(backup.progress));
  save();
  return true;
}

export function deleteBackup(deckId: string, backupId: string): void {
  data.backups[deckId] = (data.backups[deckId] ?? []).filter((b) => b.id !== backupId);
  save();
}

/** Apply changes to a deck's contents. Progress of removed notes goes with them. */
export function editDeck(deckId: string, edits: Edit[], ai = false, backupLabel = ''): { added: string[]; skipped: number } {
  if (backupLabel) makeBackup(deckId, backupLabel);
  const result = applyEdits(snap(data.decks[deckId]), edits, ai);
  data.decks[deckId] = result.deck;
  const progress = data.progress[deckId] ?? {};
  for (const id of Object.keys(progress)) {
    if (result.removed.includes(id.split(':')[0])) delete progress[id];
  }
  save();
  return { added: result.added, skipped: result.skipped };
}

/** "Skip for today" and "Stop asking this one", outside a session. */
export function flagCard(deckId: string, cardId: string, flag: 'skip' | 'stop' | 'resume'): void {
  data.progress[deckId] ??= {};
  const progress = data.progress[deckId];
  progress[cardId] ??= introduce();
  const card = progress[cardId];
  if (flag === 'skip') card.buried = today();
  else if (flag === 'stop') card.suspended = true;
  else {
    card.suspended = false;
    card.buried = null;
  }
  save();
}

export function openDeck(id: string): void {
  ui.deckId = id;
  ui.screen = 'deck';
  ui.session = null;
  ui.panel = 'path';
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

function begin(deckId: string, lessonId: string | null, queue: QueueItem[], practice = false): void {
  if (!queue.length) return;
  ui.panel = 'path';
  ui.session = {
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
    practice,
  };
  present();
}

export function startLesson(deckId: string, lessonId: string): void {
  begin(deckId, lessonId, lessonQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {}), lessonId));
}

export function startReview(deckId: string): void {
  begin(deckId, null, reviewQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {})));
}

/** Returns false when there was nothing to practise. */
export function startPractice(deckId: string, mode: 'tricky' | 'unit' | 'cram', unitId = ''): boolean {
  const queue = practiceQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {}), mode, unitId);
  begin(deckId, null, queue, true);
  return queue.length > 0;
}

function present(): void {
  const s = ui.session;
  if (!s) return;
  if (s.index >= s.queue.length) {
    finish();
    return;
  }
  const item = s.queue[s.index];
  const ex = exercise(snap(data.decks[s.deckId]), snap(data.progress[s.deckId] ?? {}), item.cardId, s.lastMet === item.cardId);
  if (!ex) {
    // The card was deleted or switched off since the session started.
    s.index++;
    present();
    return;
  }
  s.exercise = ex;
}

/** The learner has read a new note: it joins their progress at stage 1. */
export function met(): void {
  const s = ui.session;
  if (!s?.exercise) return;
  data.progress[s.deckId] ??= {};
  data.progress[s.deckId][s.exercise.cardId] = introduce();
  s.lastMet = s.exercise.cardId;
  s.introduced++;
  save();
  s.index++;
  present();
}

/** Record a graded answer. Returns whether the card moved up a stage. */
export function grade(outcome: Outcome): { promoted: boolean } {
  const s = ui.session;
  if (!s?.exercise) return { promoted: false };
  const ex = s.exercise;
  data.progress[s.deckId] ??= {};
  const progress = data.progress[s.deckId];
  const card = progress[ex.cardId] ? (snap(progress[ex.cardId]) as CardState) : null;
  const applied = gradeCard(card, outcome, ex.answer.length, snap(data.decks[s.deckId].options));
  // Practice never changes the schedule.
  if (!s.practice) progress[ex.cardId] = applied.card;
  s.graded++;
  if (outcome.correct) s.correct++;
  else s.queue = requeue(snap(s.queue), s.index, ex.cardId);
  if (applied.promoted && !s.practice) s.promoted++;
  save();
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
  if (s.graded > 0) data.streak = streakAfter(snap(data.streak));
  save();
}

export function closeSession(): void {
  ui.session = null;
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

/** A plain copy of reactive state, to hand to the core. */
function snap<T>(value: T): T {
  return $state.snapshot(value) as T;
}
export { snap };

/** Step back one screen (the Android back button). False when there is nowhere to go. */
export function goBack(): boolean {
  if (ui.screen === 'settings') ui.screen = ui.deckId && data.decks[ui.deckId] ? 'deck' : 'library';
  else if (ui.session) ui.session = null;
  else if (ui.panel !== 'path') ui.panel = 'path';
  else if (ui.screen === 'deck') goLibrary();
  else return false;
  return true;
}
