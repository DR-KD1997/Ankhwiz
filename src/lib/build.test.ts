import { describe, expect, it } from 'vitest';
import { builtRight, joinWords, makeTiles, words } from './build';

const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('building sentences from tiles', () => {
  it('splits words, keeping apostrophes and dropping punctuation', () => {
    expect(words("I don't like apples, really.")).toEqual(['I', "don't", 'like', 'apples', 'really']);
    expect(words('¿Dónde está la estación?')).toEqual(['Dónde', 'está', 'la', 'estación']);
  });
  it('splits text written without spaces', () => {
    const w = words('我想吃苹果', 'zh');
    expect(w.length).toBeGreaterThan(1);
    expect(w.join('')).toBe('我想吃苹果');
  });
  it('mixes in words from other answers that are not in the answer', () => {
    const tiles = makeTiles('I would like an apple', ['I would like a pear', 'She eats bread'], 3, '', seeded(7));
    const texts = tiles.map((t) => t.text);
    expect(texts).toHaveLength(8);
    for (const w of ['I', 'would', 'like', 'an', 'apple']) expect(texts).toContain(w);
    expect(texts.filter((t) => t === 'I')).toHaveLength(1);
    expect(texts.slice(0, 5)).not.toEqual(['I', 'would', 'like', 'an', 'apple']);
  });
  it('accepts the answer or another accepted version, ignoring capitals', () => {
    expect(builtRight(['i', 'would', 'like', 'an', 'apple'], ['I would like an apple.'])).toBe(true);
    expect(builtRight(['I', "I'd", 'like', 'an', 'apple'], ['I would like an apple'])).toBe(false);
    expect(builtRight(["I'd", 'like', 'an', 'apple'], ['I would like an apple', "I'd like an apple"])).toBe(true);
    expect(joinWords(['我', '想'], '我想吃')).toBe('我想');
  });
});
