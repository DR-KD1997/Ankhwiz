import { describe, expect, it } from 'vitest';
import type { Deck } from './core/types';
import { fillTemplate, KINDS, mapFromRoles, parseRows, renameInTemplate, reshapeFields, rolesOf, rowFor, scopeCss, typeFor } from './cardTypes';

describe('card types', () => {
  const words = typeFor(KINDS[0]);
  it('makes a note from typed fields', () => {
    const r = rowFor(words, ['ekmek', 'bread', 'Ekmek alır mısın?', 'Could you buy bread?', ''])!;
    expect(r.front).toBe('ekmek');
    expect(r.back).toBe('bread');
    expect(r.extra).toBe('Ekmek alır mısın?');
    expect(r.extraMore).toEqual(['Could you buy bread?', '']);
    expect(r.anki!.fields).toHaveLength(5);
    expect(rowFor(words, ['', 'bread'])).toBeNull();
  });
  it('fills a layout the way Anki does', () => {
    const values = { Word: 'ekmek', Meaning: 'bread', Example: '', Notes: 'a <b>noun</b>' };
    expect(fillTemplate('{{Word}}{{#Example}}<i>{{Example}}</i>{{/Example}}{{^Example}}none{{/Example}}', values, 'front')).toBe('ekmeknone');
    const front = fillTemplate('<p>{{Word}}</p>', values, 'front');
    expect(fillTemplate('{{FrontSide}}<hr>{{Meaning}} {{text:Notes}} {{type:Meaning}}', values, 'back', front)).toBe('<p>ekmek</p><hr>bread a noun <code class="tpl-typed">bread</code>');
    expect(fillTemplate('{{cloze:T}}', { T: 'The {{c1::cell}} has a {{c2::wall}}' }, 'front')).toBe('The <span class="cloze">[…]</span> has a wall');
    expect(fillTemplate('{{tts tr_TR:Word}}[sound:a.mp3]', values, 'front')).toContain('tpl-sound');
  });
  it('keeps styling to its own box', () => {
    const css = scopeCss('.card { color: red } body { margin: 0 } .main, b { font-size: 2em } @media (max-width: 400px) { .card { font-size: 12px } } @import url(x.css);', 's1');
    expect(css).toContain('.s1 { color: red }');
    expect(css).toContain('.s1 .main, .s1 b');
    expect(css).toContain('@media (max-width: 400px) { .s1 {');
    expect(css).not.toContain('body');
    expect(css).not.toContain('import');
  });
  it('reads rows from a spreadsheet or a list', () => {
    expect(parseRows('a\tb\tc\nd;e\nf = g\nonly', 3)).toEqual([['a', 'b', 'c'], ['d', 'e'], ['f', 'g']]);
  });
  it('turns roles into a field choice, and says what is wrong', () => {
    expect(mapFromRoles(['question', 'answer', 'extra', 'extraMore', 'none'])).toEqual({ question: 0, answer: 1, extra: 2, questionMore: [], extraMore: [3] });
    expect(mapFromRoles(['answer', 'none'])).toMatch(/question/);
    expect(rolesOf(words)).toEqual(['question', 'answer', 'extra', 'extraMore', 'extraMore']);
  });
  it('renames, reorders, adds and removes fields', () => {
    expect(renameInTemplate('{{Word}} {{#Word}}x{{/Word}} {{type:Word}}', 'Word', 'Term')).toBe('{{Term}} {{#Term}}x{{/Term}} {{type:Term}}');
    const r = rowFor(words, ['ekmek', 'bread', 'ex', 'gloss', 'note'])!;
    const deck = { id: 'd', notes: { n: { id: 'n', ...r } }, anki: { notetypes: { [words.id]: words } } } as unknown as Deck;
    expect(() => reshapeFields(deck, words.id, [{ from: 0, name: 'Word' }, { from: 1, name: 'Meaning' }])).toThrow(/part of the card/);
    const t = { ...words, extraMore: [3] };
    const deck2 = { ...deck, anki: { notetypes: { [words.id]: t } } } as unknown as Deck;
    const out = reshapeFields(deck2, words.id, [{ from: 1, name: 'Meaning' }, { from: 0, name: 'Term' }, { from: 2, name: 'Example' }, { from: 3, name: 'Example meaning' }, { from: -1, name: 'Picture' }]);
    const nt = out.anki!.notetypes[words.id];
    expect(nt.fields).toEqual(['Meaning', 'Term', 'Example', 'Example meaning', 'Picture']);
    expect([nt.question, nt.answer, nt.extra, nt.extraMore]).toEqual([1, 0, 2, [3]]);
    expect(out.notes.n.anki!.fields).toEqual(['bread', 'ekmek', 'ex', 'gloss', '']);
    expect(nt.templates[0].qfmt).toContain('{{Term}}');
  });
});
