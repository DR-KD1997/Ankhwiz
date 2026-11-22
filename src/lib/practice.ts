// The rules behind three practice rounds: dictation, unit recall and the
// reading round. All of it works from the deck and its progress, on the
// device, with no AI; the reading round can carry a story by Thoth instead
// when one has been written. Nothing here changes the schedule.

import type { Deck, Note, Progress, ReadingQuestion } from './core/types';
import { isAudio } from './media';
import { t } from './i18n';

// ---------- words ----------

/** Lower case, without accents or the dotless i, for comparing what was typed. */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

/** Words of a text, keeping letters, digits, apostrophes inside words and hyphens. */
export function words(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((w) => w.toLocaleLowerCase());
}

/** Edit distance, capped: anything above `max` is reported as max + 1. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** How close a typed word is to the right one. */
export function wordMatch(target: string, typed: string): 'ok' | 'close' | 'off' {
  const t = target.toLocaleLowerCase();
  const y = typed.toLocaleLowerCase();
  if (t === y) return 'ok';
  if (fold(t) === fold(y)) return 'close';
  if (t.length >= 5 && distance(fold(t), fold(y), 1) <= 1) return 'close';
  return 'off';
}

// ---------- which side is heard ----------

/** Plain text of a field, without gaps markup. */
const plainText = (s: string) => s.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1').trim();

/**
 * The side of a deck that is in the language being learned, with its
 * language: the side with sound files, otherwise the side not in English.
 */
export function heardSide(deck: Deck): { side: 'front' | 'back'; lang: string } {
  const look = deck.options.look;
  const front = look.lang ?? '';
  const back = look.langBack || front;
  const notes = Object.values(deck.notes).slice(0, 400);
  const sound = (list?: string[]) => (list ?? []).some(isAudio);
  const qs = notes.filter((n) => sound(n.qmedia)).length;
  const as = notes.filter((n) => sound(n.amedia)).length;
  if (qs !== as) return qs > as ? { side: 'front', lang: front } : { side: 'back', lang: back };
  const english = (l: string) => !l || l.toLowerCase().startsWith('en');
  if (english(front) && !english(back)) return { side: 'back', lang: back };
  return { side: 'front', lang: front };
}

/** Whether a note has been met, and its forward card is not stopped. */
const met = (progress: Progress, n: Note) => !!progress[n.id] && !progress[n.id].suspended;

function shuffle<T>(list: T[], seed = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seed() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- dictation ----------

export interface DictationItem {
  noteId: string;
  /** What is heard and must be written. */
  text: string;
  lang: string;
  /** A sound file of the note, played instead of a voice. */
  audio: string | null;
  /** The other side, shown once answered. */
  meaning: string;
}

/**
 * Cards to write from hearing: met cards of up to twelve words, from a unit
 * or the whole deck. `canSpeak` says whether a voice can read the language
 * when a card has no sound file of its own.
 */
export function dictationItems(deck: Deck, progress: Progress, opts: { unitId?: string; count?: number; canSpeak: boolean }): DictationItem[] {
  const { side, lang } = heardSide(deck);
  const ids = opts.unitId ? unitNoteIds(deck, opts.unitId) : Object.keys(deck.notes);
  const out: DictationItem[] = [];
  for (const id of ids) {
    const n = deck.notes[id];
    if (!n || n.cloze || n.occlusion || !met(progress, n)) continue;
    const text = plainText(side === 'front' ? n.front : n.back);
    const count = words(text).length;
    if (!count || count > 12) continue;
    const audio = (side === 'front' ? n.qmedia : n.amedia)?.find(isAudio) ?? null;
    if (!audio && !opts.canSpeak) continue;
    out.push({ noteId: id, text, lang, audio, meaning: plainText(side === 'front' ? n.back : n.front) });
  }
  return shuffle(out).slice(0, opts.count ?? 10);
}

export interface WordResult {
  word: string;
  /** What was typed in its place, if anything. */
  typed: string;
  state: 'ok' | 'close' | 'off' | 'missing';
}

/**
 * A written answer checked word by word, in order, so one wrong word does not
 * fail the sentence. Words typed that are not in the sentence are listed too.
 */
export function compareWords(target: string, typed: string): { words: WordResult[]; extra: string[]; score: number } {
  const t = words(target);
  const y = words(typed);
  const n = t.length;
  const m = y.length;
  // Line the two lists up for the most points: a right word 2, a nearly right
  // one 1; a wrong word in a sentence word's place, a missing word and an
  // extra word score nothing. On a tie a wrong word in place is preferred.
  const val = (i: number, j: number) => ({ ok: 2, close: 1, off: 0 })[wordMatch(t[i], y[j])];
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) best[i][j] = Math.max(best[i + 1][j + 1] + val(i, j), best[i + 1][j], best[i][j + 1]);
  }
  const out: WordResult[] = [];
  const extra: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && best[i][j] === best[i + 1][j + 1] + val(i, j) && (val(i, j) > 0 || (n - i === m - j))) {
      const state = wordMatch(t[i], y[j]);
      out.push({ word: t[i], typed: y[j], state });
      i++;
      j++;
    } else if (i < n && (j >= m || best[i][j] === best[i + 1][j])) {
      out.push({ word: t[i], typed: '', state: 'missing' });
      i++;
    } else {
      extra.push(y[j]);
      j++;
    }
  }
  const points = out.reduce((sum, w) => sum + (w.state === 'ok' ? 1 : w.state === 'close' ? 0.75 : 0), 0);
  return { words: out, extra, score: n ? Math.max(0, points - extra.length * 0.25) / n : 0 };
}

// ---------- unit recall ----------

function unitNoteIds(deck: Deck, unitId: string): string[] {
  const unit = deck.units.find((u) => u.id === unitId);
  return unit ? unit.lessonIds.flatMap((l) => deck.lessons[l]?.noteIds ?? []) : [];
}

export interface RecallTarget {
  noteId: string;
  text: string;
  hint: string;
  met: boolean;
}

/** What a unit asks to be remembered: the heard side of each note (pictures and gaps left out). */
export function recallTargets(deck: Deck, progress: Progress, unitId: string): RecallTarget[] {
  const { side } = heardSide(deck);
  return unitNoteIds(deck, unitId)
    .map((id) => deck.notes[id])
    .filter((n): n is Note => !!n && !n.cloze && !n.occlusion)
    .map((n) => ({
      noteId: n.id,
      text: plainText(side === 'front' ? n.front : n.back),
      hint: plainText(side === 'front' ? n.back : n.front),
      met: met(progress, n),
    }))
    .filter((t) => t.text);
}

export interface RecallResult {
  /** Notes of the unit that were remembered, exactly or nearly. */
  found: { target: RecallTarget; typed: string; exact: boolean }[];
  /** Notes of the unit not remembered. */
  missed: RecallTarget[];
  /** Entries that belong to another unit of the deck. */
  elsewhere: { typed: string; unit: string; text: string }[];
  /** Entries not found in the deck. */
  unknown: string[];
}

/** Split what was typed (one per line, or separated by commas) into entries. */
export const recallEntries = (typed: string) => [...new Set(typed.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];

function similar(a: string, b: string): 'ok' | 'close' | 'off' {
  const x = fold(a).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const y = fold(b).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  if (!x || !y) return 'off';
  if (a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()) return 'ok';
  if (x === y) return 'close';
  const allowed = x.length >= 10 ? 2 : x.length >= 5 ? 1 : 0;
  return allowed && distance(x, y, allowed) <= allowed ? 'close' : 'off';
}

/** Compare remembered entries with a unit, recognising entries from the deck's other units too. */
export function compareRecall(deck: Deck, progress: Progress, unitId: string, typed: string): RecallResult {
  const targets = recallTargets(deck, progress, unitId);
  const entries = recallEntries(typed);
  const found: RecallResult['found'] = [];
  const used = new Set<string>();
  const left: string[] = [];
  for (const e of entries) {
    let hit: { t: RecallTarget; exact: boolean } | null = null;
    for (const t of targets) {
      if (used.has(t.noteId)) continue;
      const s = similar(t.text, e);
      if (s === 'ok') {
        hit = { t, exact: true };
        break;
      }
      if (s === 'close' && !hit) hit = { t, exact: false };
    }
    if (hit) {
      used.add(hit.t.noteId);
      found.push({ target: hit.t, typed: e, exact: hit.exact });
    } else left.push(e);
  }
  const elsewhere: RecallResult['elsewhere'] = [];
  const unknown: string[] = [];
  const others = deck.units.filter((u) => u.id !== unitId).map((u) => ({ u, list: recallTargets(deck, progress, u.id) }));
  for (const e of left) {
    let where: RecallResult['elsewhere'][number] | null = null;
    for (const { u, list } of others) {
      const t = list.find((x) => similar(x.text, e) !== 'off');
      if (t) {
        where = { typed: e, unit: u.name, text: t.text };
        break;
      }
    }
    if (where) elsewhere.push(where);
    else unknown.push(e);
  }
  return { found, missed: targets.filter((t) => !used.has(t.noteId)), elsewhere, unknown };
}

// ---------- the reading round ----------

/** Words the learner has studied: every word on the heard side of cards they have met. */
export function knownWords(deck: Deck, progress: Progress): Set<string> {
  const { side } = heardSide(deck);
  const out = new Set<string>();
  for (const n of Object.values(deck.notes)) {
    if (!met(progress, n)) continue;
    for (const w of words(plainText(side === 'front' ? n.front : n.back))) out.add(fold(w));
  }
  return out;
}

/** The words the learner has studied as their cards write them (for Thoth's stories), most recently met first. */
export function studiedWords(deck: Deck, progress: Progress, max = 600): string[] {
  const { side } = heardSide(deck);
  const seen = new Set<string>();
  const out: string[] = [];
  const notes = Object.values(deck.notes)
    .filter((n) => met(progress, n))
    .sort((a, b) => (progress[b.id]?.added ?? 0) - (progress[a.id]?.added ?? 0));
  for (const n of notes) {
    for (const w of words(plainText(side === 'front' ? n.front : n.back))) {
      const k = fold(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** The share of a text's words the learner has studied (0 to 1). */
export function knownShare(text: string, known: Set<string>): number {
  const w = words(text);
  return w.length ? w.filter((x) => known.has(fold(x))).length / w.length : 0;
}

export interface ReadingSentence {
  text: string;
  translation: string;
  noteId: string;
  /** Share of its words already studied. */
  known: number;
}

export interface OfflineRound {
  sentences: ReadingSentence[];
  questions: (ReadingQuestion & { kind: 'translation' | 'gap' | 'truth' })[];
}

/** Example sentences an Anki note carries in fields of their own (Example, Example English…). */
function examplePair(deck: Deck, n: Note): { text: string; translation: string } | null {
  const type = n.anki ? deck.anki?.notetypes[n.anki.ntid] : null;
  if (!type || !n.anki) return null;
  const at = (re: RegExp, not?: RegExp) => type.fields.findIndex((f) => re.test(f) && !(not && not.test(f)));
  const ex = at(/example|sentence|beispiel|ejemplo/i, /english|translation|meaning|audio|sound/i);
  const tr = at(/(example|sentence).*(english|translation|meaning)|(english|translation).*(example|sentence)/i);
  if (ex < 0 || tr < 0) return null;
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\[sound:[^\]]+\]/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const text = strip(n.anki.fields[ex] ?? '');
  const translation = strip(n.anki.fields[tr] ?? '');
  return text && translation ? { text, translation } : null;
}

/**
 * A reading round made from the deck alone: sentences from sentence cards and
 * from word cards' example fields, kept when at least 80% of their words have
 * been studied, easiest first; and questions built from their translations.
 */
export function offlineRound(deck: Deck, progress: Progress, opts: { unitId?: string; count?: number; seed?: () => number } = {}): OfflineRound | null {
  const known = knownWords(deck, progress);
  if (known.size < 8) return null;
  const { side } = heardSide(deck);
  const ids = opts.unitId ? unitNoteIds(deck, opts.unitId) : Object.keys(deck.notes);
  const seen = new Set<string>();
  const pool: ReadingSentence[] = [];
  for (const id of ids) {
    const n = deck.notes[id];
    if (!n || n.cloze || n.occlusion) continue;
    const own = { text: plainText(side === 'front' ? n.front : n.back), translation: plainText(side === 'front' ? n.back : n.front) };
    for (const s of [own, examplePair(deck, n)]) {
      if (!s || words(s.text).length < 3 || words(s.text).length > 24 || seen.has(fold(s.text))) continue;
      const share = knownShare(s.text, known);
      if (share < 0.8) continue;
      seen.add(fold(s.text));
      pool.push({ ...s, noteId: id, known: share });
    }
  }
  if (pool.length < 3) return null;
  const rand = opts.seed ?? Math.random;
  const sentences = shuffle(pool, rand)
    .slice(0, opts.count ?? 8)
    .sort((a, b) => b.known - a.known || words(a.text).length - words(b.text).length);
  const questions: OfflineRound['questions'] = [];
  const others = (s: ReadingSentence) => shuffle(sentences.filter((x) => x !== s), rand);
  sentences.forEach((s, i) => {
    const kind = (['translation', 'gap', 'truth'] as const)[i % 3];
    if (kind === 'translation') {
      const wrong = others(s).slice(0, 2).map((x) => x.translation);
      const options = shuffle([s.translation, ...wrong], rand);
      questions.push({ kind, question: t('What does “{text}” mean?', { text: s.text }), options, answer: options.indexOf(s.translation) });
    } else if (kind === 'gap') {
      const ws = words(s.text).filter((w) => w.length >= 3 && known.has(fold(w)));
      const word = ws[Math.floor(rand() * ws.length)];
      const pool2 = [...known].filter((w) => w.length >= 3 && w !== fold(word ?? ''));
      if (!word || pool2.length < 2) return;
      const options = shuffle([word, ...shuffle(pool2, rand).slice(0, 2)], rand);
      const gapped = s.text.replace(new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu'), '$1____');
      questions.push({ kind, question: t('Which word fills the gap? “{gapped}”', { gapped }), options, answer: options.indexOf(word) });
    } else {
      const lie = rand() < 0.5 && sentences.length > 1;
      const shown = lie ? others(s)[0].translation : s.translation;
      questions.push({ kind, question: t('True or false: “{text}” means “{shown}”.', { text: s.text, shown }), options: [t('True'), t('False')], answer: lie ? 1 : 0 });
    }
  });
  return { sentences, questions: questions.slice(0, 6) };
}

/** What a word means on the learner's cards: the other side of a card that is just that word. */
export function lookUp(deck: Deck, word: string): { text: string; meaning: string } | null {
  const { side } = heardSide(deck);
  const w = fold(word);
  for (const n of Object.values(deck.notes)) {
    const text = plainText(side === 'front' ? n.front : n.back);
    if (words(text).length <= 3 && words(text).some((x) => fold(x) === w)) return { text, meaning: plainText(side === 'front' ? n.back : n.front) };
  }
  return null;
}
