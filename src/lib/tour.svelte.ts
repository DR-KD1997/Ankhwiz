// Thoth's welcome tour and feature tutorials. Part 1 (the basics) runs once
// at first launch, on the real app: it adds the real sample deck and walks
// through the first real lesson. The other parts wait until the learner first
// opens that part of the app; a "?" beside each plays it again.
//
// Each step names the control it points at (a data-tour attribute), Thoth's
// line and mood, and either shows Next or waits for the learner to use the
// control itself. What has been seen is kept with the settings (in `tips`).

import { data, save } from './store.svelte';

export type Part = 'basics' | 'options' | 'import' | 'editor' | 'testout' | 'thoth';
export type Mood = 'nod' | 'happy' | 'cheer' | 'encourage';
/** Things the learner does that a step can wait for. */
export type Signal = 'sample' | 'lesson' | 'met' | 'pick' | 'check' | 'finished' | 'closed';

export interface Step {
  /** The control to point at: `[data-tour="…"]`. None: Thoth speaks in the middle. */
  at?: string;
  text: string;
  mood?: Mood;
  /** Wait for the learner to do this, instead of showing Next. */
  wait?: Signal;
  /** Wait out of sight (for example while the rest of the lesson is done). */
  hidden?: boolean;
}

export const PARTS: Record<Part, { name: string; steps: Step[] }> = {
  basics: {
    name: 'Welcome',
    steps: [
      { text: "Welcome. I'm Thoth, scribe of the gods and keeper of your cards. Shall I show you the basics? It takes about a minute.", mood: 'happy' },
      { at: 'sample', text: "Let's begin with a sample deck of everyday Spanish. Tap Add the sample deck.", wait: 'sample' },
      { at: 'lesson1', text: 'Every deck is split into units, and units into short lessons that open one after another. Start Lesson 1.', wait: 'lesson', mood: 'happy' },
      { at: 'act', text: 'First you meet each new card: the question with its answer. No pressure yet. Tap Continue when you have read it.', wait: 'met' },
      { at: 'answers', text: 'Now I ask it. Tap the answer you think is right.', wait: 'pick' },
      { at: 'act', text: 'Then tap Check. Once you check, your answer counts, so take your time before.', wait: 'check' },
      { at: 'stage', text: 'Each card climbs five stages. My help fades as it climbs: choices first, then typing with hints, then plain typing.', mood: 'happy' },
      { text: 'Carry on to the end of the lesson. I will be back then.', wait: 'finished', hidden: true },
      { at: 'result', text: 'Lesson done. Reviews bring each card back just before you would forget it, starting tomorrow.', mood: 'cheer' },
      { at: 'act', text: 'Tap Continue to go back to the deck.', wait: 'closed' },
      { at: 'streak', text: 'Your streak of days in a row lives here, and reviews appear at the top when cards are due. A few minutes a day is plenty.' },
      { at: 'options', text: 'Deck options, the card editor, Test out and studying with me can wait. I will explain each one the first time you open it, and the ? beside it explains it again.', mood: 'happy' },
    ],
  },
  options: {
    name: 'Deck options',
    steps: [
      { at: 'o-daily', text: 'How much to study: new lessons for your daily goal, and how many reviews a day at most.' },
      { at: 'o-kinds', text: 'Ask both ways also asks the answer back to you. The other way round is spread out, so one never gives the other away. Long answers can be built from word tiles.' },
      { at: 'o-look', text: 'How cards look, and Read aloud: a speaker button by each question and answer, in the languages you set.' },
    ],
  },
  import: {
    name: 'Importing from Anki',
    steps: [
      { at: 'i-fields', text: 'Anki notes have fields. Choose which become the question, the answer and the extra; drag them into order. You can change this later in Deck options.' },
      { at: 'i-progress', text: 'Your progress from Anki can come with the deck, so you carry on where you left off.', mood: 'happy' },
      { at: 'i-go', text: 'When the fields look right, import. Big decks show how far they have got.' },
    ],
  },
  editor: {
    name: 'The card editor',
    steps: [
      { at: 'e-fields', text: 'The question and the answer. More fields can show with the question; drag them into order.' },
      { at: 'e-more', text: 'Other answers you will accept, such as "apple" without "the", and wrong options I may show beside the answer. Leave them empty and I pick some from your deck.' },
      { at: 'e-media', text: 'Add pictures and sounds, or make a picture card with hidden parts for me to ask about.', mood: 'happy' },
    ],
  },
  testout: {
    name: 'Testing out of a unit',
    steps: [
      { text: 'Already know this unit? A short quiz with no help. Pass it and the unit opens.' },
      { text: 'Its cards then start at stage 3, and any you miss go back to the beginning. One try a day.', mood: 'encourage' },
    ],
  },
  thoth: {
    name: 'Studying with Thoth',
    steps: [
      { text: 'For this I need an AI service of your own, set up in Settings. Nothing is sent anywhere until you do.' },
      { text: 'Then ask me anything about your cards, and I explain. I can also add cards, improve them, set a challenge round, or write a short reading passage.', mood: 'happy' },
    ],
  },
};

const key = (p: Part) => `tour:${p}`;

export const tour = $state<{ part: Part | null; i: number }>({ part: null, i: 0 });

/** The step on screen, if any. */
export const currentStep = (): Step | null => (tour.part ? PARTS[tour.part].steps[tour.i] ?? null : null);

export const seen = (p: Part) => data.tips.includes(key(p));
/** Feature tutorials appear by themselves unless turned off, or the tour was skipped. */
export const tipsOn = () => data.settings.tips !== false;

function markSeen(p: Part) {
  if (!data.tips.includes(key(p))) data.tips.push(key(p));
  save();
}

/** Play a part now, from its first step. */
export function startPart(p: Part): void {
  tour.part = p;
  tour.i = 0;
}

/** Play a part if it has not been seen, feature tutorials are on, and no other part is playing. */
export function offerPart(p: Part): void {
  if (tour.part || seen(p) || !tipsOn()) return;
  if (p !== 'basics' && !seen('basics')) return;
  startPart(p);
}

export function nextStep(): void {
  if (!tour.part) return;
  if (tour.i >= PARTS[tour.part].steps.length - 1) return endPart();
  tour.i++;
}

/** End the part on screen. `all` (from the welcome) also stops later parts appearing by themselves. */
export function endPart(all = false): void {
  if (!tour.part) return;
  markSeen(tour.part);
  if (all) {
    data.settings.tips = false;
    save();
  }
  tour.part = null;
  tour.i = 0;
}

/** The learner did something: a step waiting for it moves on. Steps further on can be reached too, if the learner went ahead. */
export function signal(s: Signal): void {
  if (!tour.part) return;
  const steps = PARTS[tour.part].steps;
  const at = steps.findIndex((st, i) => i >= tour.i && st.wait === s);
  if (at < 0) return;
  // Only skip ahead over steps that point at the same screen's controls; never back.
  tour.i = at;
  nextStep();
}

/** First launch: the welcome, for a learner with no decks yet. Someone updating from an earlier version skips it. */
export function firstLaunch(): void {
  if (seen('basics')) return;
  if (Object.keys(data.decks).length) {
    markSeen('basics');
    return;
  }
  if (tipsOn()) startPart('basics');
}

/** Settings: show every tutorial again when its part is next opened, and replay the welcome now. */
export function resetTips(): void {
  data.tips = data.tips.filter((t) => !t.startsWith('tour:'));
  data.settings.tips = true;
  save();
}
