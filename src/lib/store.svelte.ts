// App state, saved on the device. Nothing here talks to a server.

import { del, delMany, get, getMany, keys, setMany } from 'idb-keyval';
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
  testOutApply,
  testOutQuestions,
} from './core';
import type { ThothMode } from './core/thoth';
import type { SoundSet } from './sounds';
import type { CardState, Deck, DeckOptions, Edit, Exercise, Outcome, Progress, QueueItem, RawNote, Streak, TestResult } from './core/types';
import { hasMedia, putMedia, removeDeckMedia } from './media';
import { applyRemap, mediaNamed } from './remap';
import type { FieldMap } from './import/apkg';

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
export const DATA_VERSION = 4;

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
  /** Study all decks: the decks taking part. */
  decks?: string[];
}

function fresh(): AppData {
  return {
    v: DATA_VERSION,
    decks: {},
    progress: {},
    settings: { theme: 'system', thoth: 'full', lessonSize: limits.defaultLesson },
    ai: { preset: '', baseUrl: '', fastModel: '', strongModel: '', noticeSeen: false },
    streak: { count: 0, last: null, best: 0, days: [] },
    backups: {},
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
//
// Since 0.5.0 the library is stored in parts: the settings and everything
// small in one entry, and each deck's cards, progress and backups in entries
// of their own. An answer then rewrites one deck's progress instead of the
// whole library. Every save that does not say what changed writes all parts,
// as before, in one transaction, so a part is never written without the rest.

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const META = `${KEY}:meta`;
const part = (kind: 'deck' | 'progress' | 'backups', id: string) => `${KEY}:${kind}:${id}`;
const BIG = new Set(['decks', 'progress', 'backups']);
type Scope = { deck?: string; progress?: string };
let pending = { all: true, decks: new Set<string>(), progress: new Set<string>() };

/** The small parts of the library, with the list of decks. */
function metaSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = { layout: 2, deckIds: Object.keys(data.decks) };
  for (const [k, v] of Object.entries(data)) if (!BIG.has(k)) out[k] = $state.snapshot(v);
  return out;
}

async function flush(): Promise<void> {
  const p = pending;
  pending = { all: false, decks: new Set(), progress: new Set() };
  const ids = Object.keys(data.decks);
  const deckIds = p.all ? ids : [...p.decks].filter((id) => data.decks[id]);
  const progressIds = p.all ? ids : [...p.progress].filter((id) => data.decks[id]);
  const entries: [string, unknown][] = [[META, metaSnapshot()]];
  for (const id of deckIds) {
    entries.push([part('deck', id), $state.snapshot(data.decks[id])]);
    entries.push([part('backups', id), $state.snapshot(data.backups[id] ?? [])]);
  }
  for (const id of progressIds) entries.push([part('progress', id), $state.snapshot(data.progress[id] ?? {})]);
  try {
    await setMany(entries);
    if (p.all) {
      // Parts of decks no longer in the library, and the pre-0.5 single entry.
      const written = new Set(entries.map(([k]) => k));
      const stale = (await keys()).filter((k) => typeof k === 'string' && (k === KEY || (k.startsWith(`${KEY}:`) && !written.has(k))));
      if (stale.length) await delMany(stale);
    }
    ui.persistent = true;
  } catch {
    // Keep what was not written for the next save, and try the browser's simpler storage.
    pending.all ||= p.all;
    p.decks.forEach((d) => pending.decks.add(d));
    p.progress.forEach((d) => pending.progress.add(d));
    try {
      localStorage.setItem(KEY, JSON.stringify($state.snapshot(data)));
      ui.persistent = true;
    } catch {
      ui.persistent = false;
    }
  }
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
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 250);
}

/** Read the library: the parts written since 0.5.0, or the single entry from before. */
async function readStored(): Promise<unknown> {
  const meta = (await get(META)) as (Record<string, unknown> & { deckIds?: string[] }) | undefined;
  if (!meta) {
    pending.all = true;
    return get(KEY);
  }
  const ids = meta.deckIds ?? [];
  const values = await getMany(ids.flatMap((id) => [part('deck', id), part('progress', id), part('backups', id)]));
  const decks: Record<string, unknown> = {};
  const progress: Record<string, unknown> = {};
  const backups: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    const [deck, prog, back] = values.slice(i * 3, i * 3 + 3);
    if (!deck) return;
    decks[id] = deck;
    if (prog) progress[id] = prog;
    if (back && (back as unknown[]).length) backups[id] = back;
  });
  const { layout: _layout, deckIds: _ids, ...rest } = meta;
  pending.all = false;
  return { ...rest, decks, progress, backups };
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

function adopt(saved: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false;
  if (!migrate(saved as Saved)) return false;
  const base = fresh();
  const s = saved as Partial<AppData>;
  Object.assign(data, base, s, {
    settings: { ...base.settings, ...s.settings },
    ai: { ...base.ai, ...s.ai },
    streak: { ...base.streak, ...s.streak },
    backups: s.backups ?? {},
    reminder: { ...base.reminder, ...s.reminder },
    updates: { ...base.updates, ...s.updates },
  });
  // Decks saved before deck options existed get the defaults.
  const defaults = defaultOptions();
  for (const deck of Object.values(data.decks)) {
    deck.options = { ...defaults, ...deck.options, look: { ...defaults.look, ...deck.options?.look } };
  }
  if (data.paused && (!data.decks[data.paused.deckId] || !data.paused.kind)) data.paused = null;
  return true;
}

/** Stored data from a newer version of Ankhwiz, kept aside rather than overwritten. */
export const newer = $state({ found: false });

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
    for (const id of Object.keys(data.decks)) void removeDeckMedia(id);
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
  data.decks[deck.id] = deck;
  data.progress[deck.id] = progress;
  save();
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

/** Ask the cards of one Anki note type both ways, or not ('' means cards made in Ankhwiz). */
export function setTypeBothWays(id: string, ntid: string, on: boolean): void {
  const deck = data.decks[id];
  const type = ntid ? deck.anki?.notetypes[ntid] : null;
  if (type) type.bothWays = on;
  else deck.options = { ...deck.options, bothWays: on };
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

/**
 * Choose other Anki fields for a note type's question, answer and extra.
 * A backup is made first. When the main question or the answer changes, the
 * type's cards start again from the beginning. Returns an error to show, or null.
 */
export async function remapFields(deckId: string, ntid: string, next: FieldMap): Promise<string | null> {
  const names = mediaNamed(snap(data.decks[deckId]), ntid);
  const have = new Set<string>();
  await Promise.all(names.map(async (m) => (await hasMedia(deckId, m)) && have.add(m)));
  const deck = structuredClone(snap(data.decks[deckId])) as Deck;
  const progress = structuredClone(snap(data.progress[deckId] ?? {})) as Progress;
  const type = deck.anki?.notetypes[ntid];
  const r = applyRemap(deck, progress, ntid, next, (m) => have.has(m));
  if ('error' in r) return r.error;
  makeBackup(deckId, `Before changing the fields of ${type?.name ?? 'a note type'}`);
  for (const id of r.reset) delete progress[id];
  data.decks[deckId] = deck;
  data.progress[deckId] = progress;
  // A lesson left part way holds the cards as they were.
  if (data.paused?.deckId === deckId) data.paused = null;
  save();
  return null;
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
  begin('lesson', deckId, lessonId, lessonQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {}), lessonId));
}

export function startReview(deckId: string): void {
  begin('review', deckId, null, reviewQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {})));
}

/** Returns false when there was nothing to practise. */
export function startPractice(deckId: string, mode: 'tricky' | 'unit' | 'cram', unitId = ''): boolean {
  const queue = practiceQueue(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {}), mode, unitId);
  begin('practice', deckId, null, queue);
  return queue.length > 0;
}

/** Reviews due in every deck, as one session that takes a deck at a time in turn. */
export function allDue(): { deckId: string; queue: QueueItem[] }[] {
  return Object.values(data.decks)
    .map((d) => ({ deckId: d.id, queue: reviewQueue(snap(d), snap(data.progress[d.id] ?? {})) }))
    .filter((d) => d.queue.length);
}

/** Study all decks: due reviews from every deck, mixed. Returns false when nothing is due. */
export function startAll(): boolean {
  const lists = allDue();
  if (!lists.length) return false;
  const queue: SessionItem[] = [];
  for (let i = 0; lists.some((l) => i < l.queue.length); i++) {
    for (const l of lists) if (i < l.queue.length) queue.push({ ...l.queue[i], deckId: l.deckId });
  }
  ui.deckId = lists[0].deckId;
  ui.screen = 'deck';
  begin('all', lists[0].deckId, null, queue, { decks: lists.map((l) => l.deckId) });
  return true;
}

/** Whether a unit may be tested out of today: it has unmet cards and was not tried today. */
export function testOutTried(deckId: string, unitId: string): boolean {
  return data.testOuts[deckId]?.[unitId] === today();
}

/** Test out of a unit: a short quiz without help. Returns false when there is nothing to ask. */
export function startTestOut(deckId: string, unitId: string): boolean {
  const questions = testOutQuestions(snap(data.decks[deckId]), unitId);
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
  const ex = exercise(snap(data.decks[deckId]), snap(data.progress[deckId] ?? {}), item.cardId, s.lastMet === item.cardId);
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
export function resumePaused(): boolean {
  const p = data.paused;
  if (!p || !data.decks[p.deckId]) {
    data.paused = null;
    return false;
  }
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
    p.kind === 'all' ? 'All decks' : p.lessonId && deck.lessons[p.lessonId] ? `${deck.name} · ${deck.lessons[p.lessonId].name}` : `${deck.name} · Review`;
  return { deck: deck.name, what, done: p.index, total: p.queue.length };
}

/** The learner has read a new note: it joins their progress at stage 1. */
export function met(): void {
  const s = ui.session;
  if (!s?.exercise) return;
  data.progress[s.deckId] ??= {};
  data.progress[s.deckId][s.exercise.cardId] = introduce();
  s.lastMet = s.exercise.cardId;
  s.introduced++;
  save({ progress: s.deckId });
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

/** Record a graded answer. Returns whether the card moved up a stage. */
export function grade(outcome: Outcome): { promoted: boolean } {
  const s = ui.session;
  if (!s?.exercise) return { promoted: false };
  const ex = s.exercise;
  if (s.testOut) {
    // Testing out changes nothing until the end, and nothing comes back.
    s.testOut.answers.push({ cardId: ex.cardId, correct: outcome.correct });
    s.graded++;
    if (outcome.correct) s.correct++;
    return { promoted: false };
  }
  data.progress[s.deckId] ??= {};
  const progress = data.progress[s.deckId];
  const card = progress[ex.cardId] ? (snap(progress[ex.cardId]) as CardState) : null;
  const applied = gradeCard(card, outcome, ex.answer.length, snap(data.decks[s.deckId].options));
  // Practice never changes the schedule.
  if (!s.practice) progress[ex.cardId] = applied.card;
  s.graded++;
  if (outcome.correct) s.correct++;
  else if (s.kind === 'all') s.queue = requeueItem(snap(s.queue), s.index, s.queue[s.index]);
  else s.queue = requeue(snap(s.queue), s.index, ex.cardId);
  if (applied.promoted && !s.practice) s.promoted++;
  if (!s.practice) markStudied();
  save({ progress: s.deckId });
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
    const result = testOutApply(snap(data.decks[s.deckId]), snap(data.progress[s.deckId] ?? {}), t.unitId, snap(t.answers));
    t.result = result;
    if (result.passed) {
      data.progress[s.deckId] = result.progress;
      // A lesson of this unit left part way is now done with.
      const unit = data.decks[s.deckId].units.find((u) => u.id === t.unitId);
      if (data.paused?.deckId === s.deckId && data.paused.lessonId && unit?.lessonIds.includes(data.paused.lessonId)) data.paused = null;
    }
    data.testOuts[s.deckId] ??= {};
    data.testOuts[s.deckId][t.unitId] = today();
  }
  if (s.graded > 0) data.streak = streakAfter(snap(data.streak));
  keepPaused();
  save();
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
