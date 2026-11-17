// English: the source text of the interface. Keys are grouped by where they
// appear. Thoth's lines are lists: he rotates through them.

export const en = {
  // ----- Thoth -----
  thoth_meet: [
    'Something new. Read it once; I shall ask in a moment.',
    'A new entry for the scroll. Look it over.',
    'Here is the next one. Take it in before we go on.',
  ],
  thoth_justMet: ['Two choices to begin with.', 'You have just seen it. Which is it?'],
  thoth_choiceFew: ['A short list this time.', 'Choose with care.'],
  thoth_typedLive: [
    'Now write it yourself. The colours will guide you.',
    'Type it out. Green means you are on the right path.',
  ],
  thoth_build: [
    'Put the words in order. Some of them do not belong.',
    'Build the answer word by word. Leave out the strays.',
    'A scribe sets each sign in its place. Tap the words in order.',
  ],
  thoth_typedPlain: [
    'No colours now. Trust what you know.',
    'Write it from memory. I will check when you are done.',
  ],
  thoth_self: ['Write your answer, then compare it with mine. Answer honestly.'],
  thoth_selfCheck: [
    'You judge this one. Think of the answer, then look. An honest mark helps you most.',
    'I cannot mark this card myself. Recall it, show the answer, and say how close you were.',
  ],
  thoth_testOut: ['No hints in a test. Answer what you know.', 'Take your time. This is only to see what you know already.'],
  thoth_testPassed: ['You knew this already. I have opened the unit for you.', 'Well known. The scroll moves ahead.'],
  thoth_testFailed: ['Not yet. The lessons will build it up properly.', 'Some of this is still new to you. That is what the lessons are for.'],
  thoth_milestone: ['A good stretch of days. Habit is the scribe’s best tool.', 'Day after day. That is how scrolls get written.'],
  thoth_milestoneBig: ['A whole month and more. Even the scribes of Thebes took days off.', 'Remarkable steadiness. I have noted it twice.'],
  thoth_freeAi: ['Write it in your own words. I will read it.', 'No fixed wording here. Tell me what you know.'],
  thoth_typo: ['Nearly. Check your spelling and try once more.'],
  thoth_correct: ['Correct.', 'Just so.', 'Well remembered.', 'That is right.'],
  thoth_promoted: ['Correct. That one moves up a stage.', 'Well done. I have marked it as stronger.'],
  thoth_wrong: [
    'Not this time. It will come round again shortly.',
    'Not quite. Note the answer; we shall return to it.',
  ],
  thoth_lessonGood: [
    'A clean lesson. The scroll is longer than it was this morning.',
    'Carefully done. That is how knowledge is kept.',
  ],
  thoth_lessonMixed: [
    'Good work. The ones you missed will return until they stay.',
    'A fair lesson. What slipped today will be asked again.',
  ],
  thoth_lessonHard: [
    'A hard one, and you finished it. That counts.',
    'These will take a few more passes. That is how it goes.',
  ],
  thoth_reviewDone: ['Your earlier lessons are in good order again.', 'Reviewed and recorded.'],
  thoth_welcome: ['Welcome. Add a deck and we can begin.'],
  thoth_pathNext: ['Your next lesson is ready when you are.'],
  thoth_pathAllLearned: ['Every lesson here has been introduced. Reviews will keep them strong.'],
  thoth_nothingDue: ['Nothing is due. Come back tomorrow, or start the next lesson.'],

  // ----- lessons -----
  check: 'Check',
  continue: 'Continue',
  correct: 'Correct',
  notQuite: 'Not quite',
  answerIs: 'Answer: {answer}',
  movedUp: 'Moved up a stage',
  practiceUnchanged: 'Practice: the schedule is unchanged',
  showAnswer: 'Show the answer',
  howClose: 'How close were you?',
  missedIt: 'Missed it',
  partly: 'Partly',
  gotIt: 'Got it',
  lessonComplete: 'Lesson complete',
  reviewComplete: 'Review complete',
  practiceComplete: 'Practice complete',
  allDecksDone: 'All decks done',
  unitPassed: 'Unit passed',
  notThisTime: 'Not this time',
  daysInARow: '{n} days in a row',
  card_one: '{n} card',
  card_other: '{n} cards',
  review_one: '{n} review',
  review_other: '{n} reviews',
} as const;

export type Messages = { [K in keyof typeof en]: (typeof en)[K] extends readonly string[] ? readonly string[] : string };
