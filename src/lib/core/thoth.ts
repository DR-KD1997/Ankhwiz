// Thoth's built-in lines. Calm and scholarly: a scribe noting progress.
// These work offline; nothing here needs AI.

export type ThothMode = 'full' | 'quiet' | 'hidden';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

const LINES = {
  meet: [
    'Something new. Read it once; I shall ask in a moment.',
    'A new entry for the scroll. Look it over.',
    'Here is the next one. Take it in before we go on.',
  ],
  justMet: ['Two choices to begin with.', 'You have just seen it. Which is it?'],
  choiceFew: ['A short list this time.', 'Choose with care.'],
  typedLive: [
    'Now write it yourself. The colours will guide you.',
    'Type it out. Green means you are on the right path.',
  ],
  typedPlain: [
    'No colours now. Trust what you know.',
    'Write it from memory. I will check when you are done.',
  ],
  self: ['Write your answer, then compare it with mine. Answer honestly.'],
  freeAi: ['Write it in your own words. I will read it.', 'No fixed wording here. Tell me what you know.'],
  typo: ['Nearly. Check your spelling and try once more.'],
  correct: ['Correct.', 'Just so.', 'Well remembered.', 'That is right.'],
  promoted: ['Correct. That one moves up a stage.', 'Well done. I have marked it as stronger.'],
  wrong: [
    'Not this time. It will come round again shortly.',
    'Not quite. Note the answer; we shall return to it.',
  ],
  lessonGood: [
    'A clean lesson. The scroll is longer than it was this morning.',
    'Carefully done. That is how knowledge is kept.',
  ],
  lessonMixed: [
    'Good work. The ones you missed will return until they stay.',
    'A fair lesson. What slipped today will be asked again.',
  ],
  lessonHard: [
    'A hard one, and you finished it. That counts.',
    'These will take a few more passes. That is how it goes.',
  ],
  reviewDone: ['Your earlier lessons are in good order again.', 'Reviewed and recorded.'],
  welcome: ['Welcome. Add a deck and we can begin.'],
  pathNext: ['Your next lesson is ready when you are.'],
  pathAllLearned: ['Every lesson here has been introduced. Reviews will keep them strong.'],
  nothingDue: ['Nothing is due. Come back tomorrow, or start the next lesson.'],
} as const;

export type LineKey = keyof typeof LINES;

let turn = 0;

/** One of Thoth's lines for a moment, rotating so he does not repeat himself. */
export function line(key: LineKey): string {
  const options = LINES[key];
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
