// The rules themselves are tested in Rust (core/src, `cargo test`). These
// tests check the bridge: that the WebAssembly module loads and that the
// interface and the core agree on the shape of what passes between them.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  addNotes,
  aiHttp,
  aiPresets,
  aiReply,
  aiRequest,
  buildDeck,
  checkAnswer,
  CoreError,
  call,
  deckView,
  exercise,
  gradeCard,
  initCore,
  introduce,
  progressChanged,
  lessonQueue,
  lessonTags,
  limits,
  liveFeedback,
  resplit,
  reviewQueue,
  sampleDeck,
  setClock,
  streakAfter,
} from './index';
import type { ChallengeQuestion, Progress } from './types';

const T0 = Date.UTC(2026, 10, 11, 9);
const DAY = 86_400_000;
let time = T0;

beforeAll(async () => {
  await initCore();
  setClock(() => time);
});

describe('bridge', () => {
  it('loads the core and reads its limits', () => {
    expect(call<string>('version')).toBe('0.5.1');
    expect(limits.stageNames).toEqual(['Meet', 'Recognise', 'Assisted recall', 'Firm recall', 'Mastered']);
    expect(limits.minLesson).toBe(3);
  });

  it('turns core errors into exceptions', () => {
    expect(() => call('nope')).toThrow(CoreError);
  });

  it('passes non-ASCII text both ways', () => {
    expect(liveFeedback('melocotó', ['melocotón'], true)).toBe('match');
    expect(checkAnswer('MELOCOTON', ['melocotón'], false)).toBe('correct');
    const deck = sampleDeck();
    expect(deck.prompt).toBe('What does “{front}” mean?');
  });
});

describe('a learner’s first days, through the bridge', () => {
  it('runs a lesson, then reviews it on later days until typing begins', () => {
    time = T0;
    const deck = sampleDeck();
    const lessonId = deck.units[0].lessonIds[0];
    const progress: Progress = {};
    let lastMet = '';
    for (const item of lessonQueue(deck, progress, lessonId)) {
      const ex = exercise(deck, progress, item.cardId, lastMet === item.cardId)!;
      if (ex.kind === 'meet') {
        progress[item.cardId] = introduce();
        progressChanged(progress, [item.cardId]);
        lastMet = item.cardId;
        continue;
      }
      expect(ex.kind).toBe('choice');
      expect(ex.options).toContain(ex.answer);
      progress[item.cardId] = gradeCard(progress[item.cardId], { correct: true, assisted: true, sawRed: false, ms: 2000 }, ex.answer.length).card;
      progressChanged(progress, [item.cardId]);
      lastMet = '';
    }
    let view = deckView(deck, progress);
    expect(view.introduced).toBe(6);
    expect(view.due).toBe(0);
    expect(view.lessons[deck.units[0].lessonIds[1]].unlocked).toBe(true);

    for (let day = 1; day <= 1; day++) {
      time = T0 + day * DAY;
      const queue = reviewQueue(deck, progress);
      expect(queue.length).toBe(6);
      for (const item of queue) {
        const ex = exercise(deck, progress, item.cardId, false)!;
        expect(ex.kind).toBe('choice');
        progress[item.cardId] = gradeCard(progress[item.cardId], { correct: true, assisted: true, sawRed: false, ms: 2000 }, ex.answer.length).card;
        // Progress changed in place: the core is told which cards, as the store does.
        progressChanged(progress, [item.cardId]);
      }
    }
    time = T0 + 2 * DAY;
    const typed = exercise(deck, progress, reviewQueue(deck, progress)[0].cardId, false)!;
    expect(typed.kind).toBe('typed');
    expect(typed.live).toBe(true);
    view = deckView(deck, progress);
    expect(view.stages[2]).toBe(6);
    expect(streakAfter({ count: 0, last: null, best: 0 }).count).toBe(1);
  });

  it('builds, resplits, extends and tags decks', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ front: `f${i}`, back: `b${i}` }));
    const deck = buildDeck('Test', rows, { lessonSize: 5 });
    expect(Object.keys(deck.lessons).length).toBe(4);
    expect(Object.keys(resplit(deck, {}, 10).lessons).length).toBe(2);
    const more = addNotes(deck, 'Extra', [{ front: 'x', back: 'y' }], true);
    expect(more.deck.notes[more.noteIds[0]].ai).toBe(true);
    expect(Object.values(lessonTags(deck))[0]).toMatch(/^ankh::01-test::\d\d-lesson-\d+$/);
  });
});

describe('AI requests and replies', () => {
  it('lists the services and builds a request for one', () => {
    expect(aiPresets().map((p) => p.id)).toEqual(['openai', 'gemini', 'xai', 'openrouter', 'ollama', 'lmstudio', 'custom']);
    const deck = sampleDeck();
    const request = aiRequest('challenge', deck, { count: 3 });
    expect(request.json).toBe(true);
    const http = aiHttp({ baseUrl: 'http://localhost:11434/v1', key: '', fastModel: 'm', strongModel: '' }, request);
    expect(http.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(http.body).model).toBe('m');
    const content = JSON.stringify({ questions: [{ question: 'Q', options: ['a', 'b', 'c', 'd'], answer: 3, why: 'w' }] });
    const body = JSON.stringify({ choices: [{ message: { content } }] });
    expect(aiReply<ChallengeQuestion[]>('challenge', 200, body)[0].answer).toBe(3);
    expect(() => aiReply('challenge', 401, '{"error":{"message":"bad key"}}')).toThrow(/refused the key/);
  });
});
