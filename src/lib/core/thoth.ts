// Thoth's built-in lines. Calm and scholarly: a scribe noting progress.
// These work offline; nothing here needs AI. The words themselves live in
// the translatable text (i18n/en.ts, keys thoth_*).

import { variants } from '../i18n';

export type ThothMode = 'full' | 'quiet' | 'hidden';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

const KEYS = [
  'meet',
  'justMet',
  'choiceFew',
  'build',
  'typedLive',
  'typedPlain',
  'self',
  'selfCheck',
  'testOut',
  'testPassed',
  'testFailed',
  'milestone',
  'milestoneBig',
  'freeAi',
  'typo',
  'correct',
  'promoted',
  'wrong',
  'lessonGood',
  'lessonMixed',
  'lessonHard',
  'reviewDone',
  'welcome',
  'pathNext',
  'pathAllLearned',
  'nothingDue',
] as const;

export type LineKey = (typeof KEYS)[number];

let turn = 0;

/** One of Thoth's lines for a moment, rotating so he does not repeat himself. */
export function line(key: LineKey): string {
  const options = variants(`thoth_${key}`);
  turn++;
  return options[turn % options.length];
}
export function choiceLine(count: number, justMet: boolean): string {
  if (justMet) return line('justMet');
  if (count < 4) return line('choiceFew');
  return `${WORDS[count][0].toUpperCase()}${WORDS[count].slice(1)} choices this time. Take your time.`;
}

export function dueLine(count: number, reviewFirst: boolean): string {
  const cards = count === 1 ? '1 card is' : `${count} cards are`;
  return reviewFirst
    ? `${cards} due. I suggest a review before anything new.`
    : `${cards} due for review today.`;
}

export function streakLine(days: number): string {
  if (days <= 1) return 'First day recorded.';
  return `${days} days in a row.`;
}

export function lessonEndLine(correct: number, total: number, review: boolean): string {
  if (total === 0) return line('lessonGood');
  const ratio = correct / total;
  if (review && ratio >= 0.8) return line('reviewDone');
  if (ratio >= 0.9) return line('lessonGood');
  if (ratio >= 0.6) return line('lessonMixed');
  return line('lessonHard');
}
