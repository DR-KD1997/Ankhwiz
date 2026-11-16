import { describe, expect, it } from 'vitest';
import type { AnkiNotetype, Deck, Note, Progress } from './core/types';
import { applyRemap, keepsProgress, planRemap } from './remap';

const type: AnkiNotetype = {
  id: 'vocab',
  name: 'Japanese vocab',
  cloze: false,
  fields: ['Kanji', 'Reading', 'Meaning', 'Example'],
  templates: [],
  css: '',
  question: 0,
  answer: 2,
  extra: null,
  questionMore: [],
  extraMore: [],
  bothWays: false,
};

function note(id: string, fields: string[]): Note {
  return {
    id,
    front: fields[0],
    back: fields[2],
    alts: [],
    wrong: [],
    extra: '',
    labels: [],
    qmedia: [],
    amedia: [],
    anki: { guid: id, ntid: 'vocab', fields, seen: [fields[0], fields[2], ''] },
  } as unknown as Note;
}

function deck(): Deck {
  return {
    id: 'd',
    name: 'D',
    notes: { a: note('a', ['鳥', 'とり', 'bird', '鳥が飛ぶ']), b: note('b', ['山', 'やま', 'mountain', '山に登る']) },
    lessons: {},
    units: [],
    lessonSize: 8,
    strictAccents: false,
    created: 0,
    options: { bothWays: false } as Deck['options'],
    anki: { notetypes: { vocab: structuredClone(type) } },
  };
}

const studied = (): Progress => ({ a: { stage: 3 } as Progress[string], b: { stage: 2 } as Progress[string] });
const all = () => true;

describe('changing fields after import', () => {
  it('keeps progress when only the extra and smaller question fields change', () => {
    const d = deck();
    const next = { question: 0, answer: 2, extra: 3, questionMore: [1], extraMore: [] };
    expect(keepsProgress(type, next)).toBe(true);
    expect(planRemap(d, studied(), 'vocab', next)).toEqual({ notes: 2, empty: 0, keeps: true, studied: 2 });
    const r = applyRemap(d, studied(), 'vocab', next, all);
    expect(r).toEqual({ reset: [] });
    expect(d.notes.a.frontMore).toEqual(['とり']);
    expect(d.notes.a.extra).toBe('鳥が飛ぶ');
    expect(d.anki!.notetypes.vocab.extra).toBe(3);
  });

  it('starts the cards again when the main question or answer changes', () => {
    const d = deck();
    const next = { question: 1, answer: 2, extra: null, questionMore: [0], extraMore: [] };
    expect(keepsProgress(type, next)).toBe(false);
    const r = applyRemap(d, studied(), 'vocab', next, all);
    expect('reset' in r && r.reset.sort()).toEqual(['a', 'b']);
    expect(d.notes.b.front).toBe('やま');
    expect(d.notes.b.frontMore).toEqual(['山']);
  });

  it('keeps text edited in Ankhwiz when fields move', () => {
    const d = deck();
    d.notes.a.back = 'a bird';
    applyRemap(d, {}, 'vocab', { question: 0, answer: 2, extra: 1, questionMore: [], extraMore: [] }, all);
    expect(d.notes.a.back).toBe('a bird');
    expect(d.notes.a.anki!.fields[2]).toBe('a bird');
    expect(d.notes.a.extra).toBe('とり');
  });

  it('refuses fields that would leave a card without an answer', () => {
    const d = deck();
    d.notes.b.anki!.fields[3] = '';
    const next = { question: 0, answer: 3, extra: null, questionMore: [], extraMore: [] };
    expect(planRemap(d, {}, 'vocab', next).empty).toBe(1);
    expect(applyRemap(d, {}, 'vocab', next, all)).toHaveProperty('error');
    expect(d.notes.b.back).toBe('mountain');
  });
});
