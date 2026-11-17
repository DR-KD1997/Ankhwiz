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
  /** More question fields, shown under the question in smaller type. `front`
   *  is the main one, swapped with the answer when a deck is asked both ways. */
  frontMore?: string[];
  /** More extra fields, shown after `extra`. */
  extraMore?: string[];
  /** The learner checks this card themselves. */
  selfCheck?: boolean;
  /** Never asked by building the answer from word tiles. */
  noBuild?: boolean;
  /** Words read aloud in their own language, wherever they appear in the note. */
  voices?: { text: string; lang: string }[];
  /** A picture with hidden parts. */
  occlusion?: Occlusion | null;
}

export interface Shape {
  /** Part number: shapes with the same number are asked together. */
  ord: number;
  kind: 'rect' | 'ellipse' | 'polygon';
  /** Fractions of the picture's width and height. */
  left: number;
  top: number;
  width: number;
  height: number;
  points?: [number, number][];
  /** The part's name; without one the learner checks the card themselves. */
  label?: string;
}

export interface Occlusion {
  image: string;
  shapes: Shape[];
  /** Hide every part while asking about one. */
  hideAll: boolean;
}

/** One part as a card shows it: `ask` is asked about, `hidden` covered, `open` visible. */
export interface Mask {
  kind: Shape['kind'];
  left: number;
  top: number;
  width: number;
  height: number;
  points?: [number, number][];
  state: 'ask' | 'hidden' | 'open';
  label?: string;
}

export interface Picture {
  image: string;
  masks: Mask[];
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
  questionMore?: number[];
  extraMore?: number[];
  occlusion?: boolean;
  /** Ask this type's cards both ways. Unset: follow the deck's Ask both ways. */
  bothWays?: boolean | null;
}

export interface Look {
  size: 's' | 'm' | 'l';
  font: 'default' | 'serif' | 'rounded' | 'mono';
  rtl: boolean;
  hintExtra: boolean;
  lang: string;
  /** Language of the answer field, when it differs from the question's. */
  langBack?: string;
  /** 'on' shows speaker buttons by the question and the answer. */
  speak: 'off' | 'on';
  /** Words in quotes are read in this language; the rest in the field's own. Empty or missing: off. */
  quoteLang?: string;
}

export interface DeckOptions {
  newLessonsPerDay: number;
  reviewCap: number;
  retention: number;
  bothWays: boolean;
  /** When a card's other-way-round twin is asked. Missing in decks saved before 0.5.0: spread. */
  reverseSpacing?: 'spread' | 'nextDay' | 'together';
  /** Answers of three words or more are built from word tiles in stages 1 and 2. Missing before 0.5.0: on. */
  buildSentences?: boolean;
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
export type ExerciseKind = 'meet' | 'build' | 'choice' | 'typed' | 'free' | 'self';

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
  frontMore: string[];
  /** Shown with the answer once given. */
  answerMore: string[];
  extraMore: string[];
  picture?: Picture;
}

export interface TestResult {
  passed: boolean;
  correct: number;
  total: number;
  passMark: number;
  progress: Progress;
  relearn: string[];
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
  frontMore?: string[];
  extraMore?: string[];
  selfCheck?: boolean;
  noBuild?: boolean;
  voices?: { text: string; lang: string }[];
  occlusion?: Occlusion | null;
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
      frontMore?: string[];
      extraMore?: string[];
      selfCheck?: boolean;
      noBuild?: boolean;
      voices?: { text: string; lang: string }[];
      occlusion?: Occlusion;
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
