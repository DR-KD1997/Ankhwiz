import { describe, expect, it } from 'vitest';
import type { Note } from './core/types';
import { bucketOf, chunkCount, decodeNotes, encodeNotes, packNote, unpackNote } from './storage';

const imported = (i: number): Note => ({
  id: `n${i}`,
  front: `kelime ${i}`,
  back: `word ${i}`,
  extra: i % 2 ? '' : 'an example',
  labels: ['Turkish::A1', i % 3 ? 'verbs' : 'nouns'],
  frontMore: [`<b>not shown</b>`, ''],
  extraMore: ['Sentence'],
  anki: {
    guid: `g${i}`,
    ntid: '17',
    fields: [`kelime ${i}`, `word ${i}`, `[sound:k${i}.mp3]`, 'Sentence', ''],
    seen: [`kelime ${i}`, `word ${i}`, i % 2 ? '' : 'an example', '<b>not shown</b>', '', 'Sentence'],
  },
});

describe('deck storage', () => {
  it('packs a note smaller and gives it back exactly', () => {
    const labels: string[] = [];
    const index = new Map<string, number>();
    for (let i = 0; i < 20; i++) {
      const n = imported(i);
      const p = packNote(n, index, labels);
      expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(n).length);
      expect(unpackNote(JSON.parse(JSON.stringify(p)), labels)).toEqual(n);
    }
    expect(labels).toEqual(['Turkish::A1', 'nouns', 'verbs']);
  });

  it('keeps text that only looks like a reference', () => {
    const n: Note = { id: 'x', front: '1', back: '0', anki: { guid: 'g', ntid: 't', fields: ['1', '0', ''], seen: ['1', 'changed', ''] } };
    const labels: string[] = [];
    const p = packNote(n, new Map(), labels);
    expect(unpackNote(JSON.parse(JSON.stringify(p)), labels)).toEqual(n);
  });

  it('splits notes into chunks and puts them back in order', () => {
    const notes: Record<string, Note> = {};
    for (let i = 0; i < 1200; i++) notes[`n${i}`] = imported(i);
    const enc = encodeNotes(notes);
    expect(enc.k).toBe(8);
    expect(enc.chunks.length).toBe(8);
    const back = decodeNotes(enc, enc.chunks.map((c) => enc.texts.get(c)));
    expect(Object.keys(back)).toEqual(Object.keys(notes));
    expect(back).toEqual(notes);
  });

  it('rewrites only the chunks an edit touches', () => {
    const notes: Record<string, Note> = {};
    for (let i = 0; i < 1200; i++) notes[`n${i}`] = imported(i);
    const first = encodeNotes(notes);
    expect(encodeNotes(notes, first)).toBe(first);
    const edited = { ...notes, n5: { ...notes.n5, back: 'changed' } };
    const second = encodeNotes(edited, first);
    const changed = second.chunks.filter((c, i) => c !== first.chunks[i]);
    expect(changed).toHaveLength(1);
    expect(second.chunks[bucketOf('n5', second.k)]).toBe(changed[0]);
  });

  it('keeps the chunk count while a deck changes a little', () => {
    expect(chunkCount(100)).toBe(1);
    expect(chunkCount(16711)).toBe(128);
    expect(chunkCount(1300, 4)).toBe(4);
    expect(chunkCount(5000, 4)).toBe(32);
  });

  it('says which part is missing instead of losing notes', () => {
    const notes: Record<string, Note> = { a: imported(1) };
    const enc = encodeNotes(notes);
    expect(() => decodeNotes(enc, [undefined])).toThrow(/missing/);
  });
});
