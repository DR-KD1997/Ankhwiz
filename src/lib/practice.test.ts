import { describe, expect, it } from 'vitest';
import type { Deck, Note, Progress } from './core/types';
import { compareRecall, compareWords, dictationItems, fold, knownShare, knownWords, offlineRound, wordMatch } from './practice';

const note = (id: string, front: string, back: string, more: Partial<Note> = {}): Note => ({ id, front, back, ...more });
function deck(notes: Note[]): Deck {
  return {
    id: 'd',
    name: 'Turkish',
    notes: Object.fromEntries(notes.map((n) => [n.id, n])),
    lessons: { l1: { id: 'l1', name: 'One', noteIds: notes.slice(0, 6).map((n) => n.id) }, l2: { id: 'l2', name: 'Two', noteIds: notes.slice(6).map((n) => n.id) } },
    units: [{ id: 'u1', name: 'Greetings', lessonIds: ['l1'] }, { id: 'u2', name: 'Food', lessonIds: ['l2'] }],
    lessonSize: 6,
    strictAccents: false,
    created: 0,
    options: { look: { lang: 'tr-TR', langBack: 'en-GB' } },
  } as unknown as Deck;
}
const turkish = deck([
  note('a', 'merhaba', 'hello'),
  note('b', 'teşekkür ederim', 'thank you'),
  note('c', 'nasılsın', 'how are you'),
  note('d', 'güle güle', 'goodbye'),
  note('e', 'evet', 'yes'),
  note('f', 'hayır', 'no'),
  note('g', 'ekmek', 'bread'),
  note('h', 'su', 'water'),
  note('i', 'ben ekmek ve su istiyorum', 'I want bread and water'),
  note('j', 'evet ben su istiyorum', 'yes I want water'),
  note('k', 'hayır ben ekmek istiyorum', 'no I want bread'),
  note('l', 'istiyorum', 'I want'),
  note('m', 've', 'and'),
  note('n', 'ben', 'I'),
]);
const all: Progress = Object.fromEntries(Object.keys(turkish.notes).map((id) => [id, { stage: 2, okDays: [], demoted: false, lapses: 0, reps: 1, due: 0, mem: null }]));

describe('dictation', () => {
  it('treats a missing accent as nearly right', () => {
    expect(wordMatch('teşekkür', 'tesekkur')).toBe('close');
    expect(wordMatch('nasılsın', 'nasilsin')).toBe('close');
    expect(wordMatch('ekmek', 'ekmek')).toBe('ok');
    expect(wordMatch('su', 'se')).toBe('off');
    expect(fold('İstanbul')).toBe('istanbul');
  });
  it('checks a sentence word by word, so one wrong word does not fail it', () => {
    const r = compareWords('Ben ekmek ve su istiyorum.', 'ben ekmak su istiyorum lütfen');
    expect(r.words.map((w) => w.state)).toEqual(['ok', 'close', 'missing', 'ok', 'ok']);
    expect(r.extra).toEqual(['lütfen']);
    const wrong = compareWords('evet ben su istiyorum', 'evet sen su istiyorum');
    expect(wrong.words.map((w) => w.state)).toEqual(['ok', 'off', 'ok', 'ok']);
    expect(compareWords('merhaba', 'merhaba').score).toBe(1);
  });
  it('only asks for met cards that can be heard', () => {
    expect(dictationItems(turkish, {}, { canSpeak: true })).toEqual([]);
    expect(dictationItems(turkish, all, { canSpeak: false })).toEqual([]);
    const items = dictationItems(turkish, all, { canSpeak: true, count: 50 });
    expect(items).toHaveLength(14);
    expect(items[0].lang).toBe('tr-TR');
  });
});

describe('unit recall', () => {
  it('finds what was remembered, nearly, in other units, and missed', () => {
    const r = compareRecall(turkish, all, 'u1', 'merhaba\ntesekkur ederim, nasilsin\nekmek\nkitap');
    expect(r.found.map((f) => [f.target.noteId, f.exact])).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(r.elsewhere).toEqual([{ typed: 'ekmek', unit: 'Food', text: 'ekmek' }]);
    expect(r.unknown).toEqual(['kitap']);
    expect(r.missed.map((m) => m.noteId)).toEqual(['d', 'e', 'f']);
  });
});

describe('reading round', () => {
  it('uses sentences whose words have been studied, with questions', () => {
    const known = knownWords(turkish, all);
    expect(knownShare('ben su istiyorum', known)).toBe(1);
    const round = offlineRound(turkish, all, { seed: () => 0.3 })!;
    expect(round.sentences.length).toBeGreaterThanOrEqual(3);
    expect(round.questions.length).toBeGreaterThan(0);
    for (const q of round.questions) expect(q.answer).toBeGreaterThanOrEqual(0);
  });
  it('needs studied words first', () => {
    expect(offlineRound(turkish, {})).toBeNull();
  });
});
