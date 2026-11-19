import { describe, expect, it } from 'vitest';
import type { AnkiNotetype, Deck, Note } from './core/types';
import { dropUnused, unusedFields, unusedReport } from './fields';

const type: AnkiNotetype = {
  id: 't',
  name: 'Turkish',
  cloze: false,
  fields: ['Turkish', 'English', 'Audio', 'Grammar', 'Notes', 'Kind'],
  templates: [],
  css: '',
  question: 0,
  answer: 1,
  extra: null,
  questionMore: [5],
  extraMore: [3],
};
const note = (i: number, notes = ''): Note => ({
  id: `n${i}`,
  front: `t${i}`,
  back: `e${i}`,
  anki: { guid: `g${i}`, ntid: 't', fields: [`t${i}`, `e${i}`, `[sound:${i}.mp3]`, 'grammar', notes, 'Word'], seen: [] },
});
const deck = (): Deck =>
  ({ id: 'd', name: 'D', notes: { n1: note(1, 'a note'), n2: note(2), n3: { id: 'n3', front: 'own', back: 'card' } }, anki: { notetypes: { t: type } } }) as unknown as Deck;

describe('unused fields', () => {
  it('finds fields no part of a card shows', () => {
    expect(unusedFields(type)).toEqual([2, 4]);
  });
  it('reports what they hold', () => {
    expect(unusedReport(deck())).toEqual([{ ntid: 't', type: 'Turkish', names: ['Audio', 'Notes'], notes: 2, size: 13 + 13 + 6 }]);
  });
  it('deletes only their text', () => {
    const r = dropUnused(deck());
    expect(r.changed).toBe(2);
    expect(r.deck.notes.n1.anki!.fields).toEqual(['t1', 'e1', '', 'grammar', '', 'Word']);
    expect(r.deck.notes.n3).toEqual({ id: 'n3', front: 'own', back: 'card' });
    expect(unusedReport(r.deck)).toEqual([]);
  });
});
