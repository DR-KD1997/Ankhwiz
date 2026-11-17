import { describe, expect, it } from 'vitest';
import { marksInField, pieces, runs, ttsFields } from './voices';

describe('reading in more than one voice', () => {
  it('reads quoted words in the quote language, without the quote marks', () => {
    expect(pieces("What does 'la manzana' mean?", 'en', [], 'es')).toEqual([
      { text: 'What does', lang: 'en', from: 'base' },
      { text: 'la manzana', lang: 'es', from: 'quote' },
      { text: 'mean?', lang: 'en', from: 'base' },
    ]);
  });
  it('leaves apostrophes alone', () => {
    expect(pieces("Don't say 'hola' yet", 'en', [], 'es').map((p) => p.text)).toEqual(["Don't say", 'hola', 'yet']);
  });
  it('lets marked words keep their own language over the quote rule', () => {
    const p = pieces('Is “le pain” French, and “el pan” Spanish?', 'en', [{ text: 'le pain', lang: 'fr' }], 'es');
    expect(p.map((x) => [x.text, x.lang])).toEqual([
      ['Is', 'en'],
      ['le pain', 'fr'],
      ['French, and', 'en'],
      ['el pan', 'es'],
      ['Spanish?', 'en'],
    ]);
  });
  it('marks whole words only', () => {
    expect(pieces('la lasagna', 'en', [{ text: 'la', lang: 'it' }]).map((p) => p.lang)).toEqual(['it', 'en']);
    expect(pieces('りんごは何ですか', 'en', [{ text: 'りんご', lang: 'ja' }]).map((p) => p.lang)).toEqual(['ja', 'en']);
  });
  it('reads a field as one piece when nothing is marked', () => {
    expect(pieces('la manzana', 'es')).toEqual([{ text: 'la manzana', lang: 'es', from: 'base' }]);
  });
  it('keeps quote marks on screen', () => {
    expect(runs("Say 'hola'", 'en', [], 'es').map((r) => r.text).join('')).toBe("Say 'hola'");
  });
  it('finds marks in Anki fields and reading tags in templates', () => {
    expect(marksInField('What does <span lang="es_ES">la&nbsp;manzana</span> mean? [anki:tts lang=fr_FR]le pain[/anki:tts]')).toEqual([
      { text: 'la manzana', lang: 'es-ES' },
      { text: 'le pain', lang: 'fr-FR' },
    ]);
    expect(ttsFields('{{Front}} {{tts es_ES voices=Apple_Monica:Back}}')).toEqual({ Back: 'es-ES' });
  });
});
