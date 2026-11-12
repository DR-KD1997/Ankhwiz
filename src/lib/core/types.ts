// Data shapes shared with the Rust core (core/src/model.rs). The core owns
// the rules; these types only describe what crosses the boundary.

export type Stage = 1 | 2 | 3 | 4 | 5;

export interface Note {
  id: string;
  /** What the learner is shown. */
  front: string;
  /** The answer the learner must produce. */
  back: string;
  /** Other answers that also count as correct. */
  alts?: string[];
  /** Hand-set wrong options; these take priority in multiple choice. */
  wrong?: string[];
  /** True when AI wrote or changed this note. */
  ai?: boolean;
  /** Shown after answering. */
  extra?: string;
  /** The learner's own labels (Anki tags). */
  labels?: string[];
  /** Media files shown with the question, and with the answer. */
  qmedia?: string[];
  amedia?: string[];
  /** Fill-the-gap note: `front` holds text with {{c1::gaps}}. */
  cloze?: boolean;
  /** What an imported note looked like in Anki, kept for export. */
  anki?: AnkiNote | null;
}

export interface AnkiNote {
  guid: string;
  ntid: string;
  fields: string[];
  seen: string[];
}

export interface AnkiTemplate {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface AnkiNotetype {
  id: string;
  name: string;
  cloze: boolean;
  fields: string[];
  templates: AnkiTemplate[];
  css: string;
  question: number;
  answer: number;
  extra?: number | null;
}

export interface Look {
  size: 's' | 'm' | 'l';
  font: 'default' | 'serif' | 'rounded' | 'mono';
  rtl: boolean;
  hintExtra: boolean;
  lang: string;
  speak: 'off' | 'question' | 'answer';
}

export interface DeckOptions {
  newLessonsPerDay: number;
  reviewCap: number;
  retention: number;
  bothWays: boolean;
  maxInterval: number;
  stageDays: [number, number, number];
  look: Look;
}

export interface Lesson {
  id: string;
  name: string;
  noteIds: string[];
}

export interface Unit {
  id: string;
  name: string;
  lessonIds: string[];
}

export interface ReadingQuestion {
  question: string;
  options: string[];
  /** Position of the correct option. */
  answer: number;
}

export interface Reading {
  id: string;
  title: string;
  passage: string;
  questions: ReadingQuestion[];
  ai?: boolean;
  best?: number | null;
}

export interface Deck {
  id: string;
  name: string;
  /** Optional question wording; `{front}` is replaced by the note's front. */
  prompt?: string | null;
  notes: Record<string, Note>;
  lessons: Record<string, Lesson>;
  units: Unit[];
  lessonSize: number;
  strictAccents: boolean;
  created: number;
  readings?: Reading[];
  options: DeckOptions;
  anki?: { notetypes: Record<string, AnkiNotetype> } | null;
}

export interface CardState {
  stage: Stage;
  /** Local day numbers with a counted correct answer at the current stage. */
  okDays: number[];
  /** True after a wrong answer dropped the card a stage. */
  demoted: boolean;
  lapses: number;
  reps: number;
  /** When the card is next due, in milliseconds. */
  due: number;
  /** What the scheduler remembers. */
  mem: { stability: number; difficulty: number; lastDay: number } | null;
  /** "Stop asking this one" (Anki: suspend). */
  suspended?: boolean;
  /** "Skip for today" (Anki: bury): the local day it was skipped. */
  buried?: number | null;
  /** Local day the card was first met. */
  added?: number | null;
  /** Recent answers, newest last. */
  hist?: { day: number; ok: boolean; stage: Stage }[];
}

/** Progress for one deck: only introduced notes have an entry. */
export type Progress = Record<string, CardState>;

export interface Streak {
  count: number;
  /** Local day number of the last finished session. */
  last: number | null;
  best: number;
  days?: number[];
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/** free: a long answer, written freely and marked by AI or by the learner. */
export type ExerciseKind = 'meet' | 'choice' | 'typed' | 'free';

export interface Exercise {
  kind: ExerciseKind;
  cardId: string;
  noteId: string;
  prompt: string;
  answer: string;
  accepted: string[];
  options?: string[];
  live?: boolean;
  stage: Stage;
  ai: boolean;
  reverse: boolean;
  cloze: boolean;
  extra: string;
  qmedia: string[];
  amedia: string[];
}

export interface Outcome {
  correct: boolean;
  /** Help was given: options visible, colour feedback, or a spelling retry. */
  assisted: boolean;
  /** Typed with colour feedback only: the text turned red at some point. */
  sawRed: boolean;
  /** Time taken to answer, in milliseconds. */
  ms: number;
  /** Marked by AI: counts as Again or Good only. */
  aiGraded?: boolean;
}

export interface QueueItem {
  cardId: string;
  retry?: boolean;
}

export interface RawNote {
  front: string;
  back: string;
  alts?: string[];
  /** Subdeck or tag used to group notes into units. */
  group?: string | null;
  extra?: string;
  wrong?: string[];
  labels?: string[];
  qmedia?: string[];
  amedia?: string[];
  cloze?: boolean;
  anki?: AnkiNote | null;
  lesson?: string | null;
  sched?: AnkiSched[];
}

export interface AnkiSched {
  ord: number;
  ctype: number;
  queue: number;
  due: number;
  ivl: number;
  reps: number;
  lapses: number;
  data: string;
}

export interface LessonStatus {
  state: 'new' | 'started' | 'learned' | 'complete';
  total: number;
  introduced: number;
  /** Average mastery stage of the lesson's notes, 0 to 5. */
  strength: number;
  due: number;
  unlocked: boolean;
}

export interface DeckView {
  total: number;
  introduced: number;
  due: number;
  nextId: string | null;
  reviewFirst: boolean;
  /** Notes at each mastery stage, 1 to 5. */
  stages: number[];
  lessons: Record<string, LessonStatus>;
  startedToday: number;
  goal: number;
  goalMet: boolean;
  reviewsLeft: number;
  tricky: number;
  stopped: number;
}

export interface DeckStats {
  stages: number[];
  forecast: number[];
  retention: number | null;
  answers30: number;
  tricky: string[];
  stopped: number;
  introduced: number;
  total: number;
}

export type Edit =
  | {
      op: 'update';
      noteId: string;
      front?: string;
      back?: string;
      extra?: string;
      alts?: string[];
      wrong?: string[];
      labels?: string[];
      qmedia?: string[];
      amedia?: string[];
      cloze?: boolean;
    }
  | { op: 'add'; lessonId?: string | null; unit?: string | null; note: RawNote }
  | { op: 'delete'; noteId: string }
  | { op: 'move'; noteId: string; lessonId: string }
  | { op: 'renameLesson'; lessonId: string; name: string }
  | { op: 'renameUnit'; unitId: string; name: string }
  | { op: 'shiftLesson'; lessonId: string; delta: number }
  | { op: 'addLesson'; unitId: string; name: string };

export interface ProposedChanges {
  summary: string;
  changes: { edit: Edit; describe: string }[];
}

export interface AnkiExport {
  crt: number;
  models: string;
  decks: string;
  dconf: string;
  conf: string;
  notes: { id: number; guid: string; mid: number; tags: string; flds: string; sfld: string; csum: number }[];
  cards: {
    id: number;
    nid: number;
    did: number;
    ord: number;
    ctype: number;
    queue: number;
    due: number;
    ivl: number;
    factor: number;
    reps: number;
    lapses: number;
    data: string;
  }[];
  revlog: { id: number; cid: number; ease: number; ivl: number; lastIvl: number; factor: number; time: number; rtype: number }[];
  media: string[];
}

// ---------- AI ----------

export interface Provider {
  baseUrl: string;
  key: string;
  fastModel: string;
  strongModel: string;
}

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  needsKey: boolean;
  note: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  task: string;
  messages: Message[];
  json: boolean;
  strong: boolean;
  temperature: number;
  /** Rough size of what will be sent, in tokens. */
  estimate: number;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string;
}

export interface Suggestion {
  noteId: string;
  alts: string[];
  wrong: string[];
  flag: string;
}

export interface ChallengeQuestion extends ReadingQuestion {
  why: string;
}

export interface Marked {
  correct: boolean;
  feedback: string;
}
