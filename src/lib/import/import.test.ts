import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ankiImport, buildDeck, initCore, introduce, sampleDeck } from '../core';
import type { Progress } from '../core/types';
import { buildAnkh, readAnkh } from '../export/ankh';
import { buildApkg } from '../export/apkg';
import { fieldMedia, packageRows, readPackage, type OpenDatabase } from './apkg';
import { clozeToPair, fieldText } from './html';
import { parseList } from './paste';

beforeAll(initCore);

const open: OpenDatabase = async (bytes) => {
  const SQL = await initSqlJs();
  return new SQL.Database(bytes) as never;
};
const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe('field text', () => {
  it('removes markup, sound markers and decodes entities', () => {
    expect(fieldText('<div><b>la pera</b></div>')).toBe('la pera');
    expect(fieldText('the&nbsp;pear &amp; co &#233;')).toBe('the pear & co é');
    expect(fieldText('the bread<br>(a loaf)')).toBe('the bread / (a loaf)');
    expect(fieldText('hola [sound:a.mp3]')).toBe('hola');
    expect(fieldText('<img src="x.png">')).toBe('');
  });

  it('turns a cloze into a question and answer', () => {
    expect(clozeToPair('The capital of Spain is {{c1::Madrid::city}}.')).toEqual({
      front: 'The capital of Spain is [city].',
      back: 'Madrid',
    });
    expect(clozeToPair('{{c2::B}} then {{c1::A}}')).toEqual({ front: 'B then _____', back: 'A' });
    expect(clozeToPair('no cloze here')).toBeNull();
  });
});

describe('pasted lists', () => {
  it('reads tab, equals, semicolon and comma lists', () => {
    expect(parseList('uno\tone\ndos\ttwo').rows.length).toBe(2);
    expect(parseList('uno = one\ndos = two').rows[1]).toMatchObject({ front: 'dos', back: 'two' });
    expect(parseList('uno;one;Numbers\ndos;two;Numbers').rows[0].group).toBe('Numbers');
    expect(parseList('uno,one\n# a comment\n\ndos,two').rows.length).toBe(2);
  });
  it('reports lines it cannot read', () => {
    expect(parseList('just words\nmore words')).toEqual({ rows: [], skipped: 2 });
  });
});

// Both fixtures were written by Anki 26.09.4's own exporter.
describe.each(['new.apkg', 'legacy.apkg'])('Anki package: %s', (file) => {
  it('lists note types with their fields, and reads notes, subdecks and cloze notes', async () => {
    const pkg = await readPackage(fixture(file), 'fallback.apkg', open);
    expect(pkg.name).toBe('Spanish');
    const basic = pkg.notetypes.find((t) => !t.cloze)!;
    expect(basic.fields.slice(0, 2)).toEqual(['Front', 'Back']);
    expect(basic.templates[0].qfmt).toContain('{{Front}}');
    expect(pkg.notetypes.some((t) => t.cloze)).toBe(true);
    const { rows, skipped, notetypes } = packageRows(pkg, {}, true);
    expect(rows.length + skipped).toBe(13);
    expect(rows[0]).toMatchObject({ front: 'la manzana', back: 'the apple', group: 'Food' });
    expect(rows[0].anki?.fields[0]).toContain('la manzana');
    const cloze = rows.find((r) => r.cloze)!;
    expect(cloze.front).toBe('The capital of Spain is {{c1::Madrid::city}}.');
    expect(Object.keys(notetypes).length).toBe(2);
    const built = buildDeck(pkg.name, rows, { lessonSize: 4 });
    expect(built.units.map((u) => u.name)).toEqual(['Food', 'Travel']);
  });

  it('lets the learner choose other fields', async () => {
    const pkg = await readPackage(fixture(file), 'fallback.apkg', open);
    const basic = pkg.notetypes.find((t) => !t.cloze)!;
    const { rows } = packageRows(pkg, { [basic.id]: { question: 1, answer: 0, extra: null } }, false);
    expect(rows[0]).toMatchObject({ front: 'the apple', back: 'la manzana' });
  });
});

describe('field media', () => {
  it('finds pictures and sounds', () => {
    expect(fieldMedia('<img src="a%20b.png"> hola [sound:x.mp3] <img src=\'https://x/y.png\'>')).toEqual(['a b.png', 'x.mp3']);
  });
});

describe('bad files', () => {
  it('rejects something that is not a package', async () => {
    await expect(readPackage(new Uint8Array([1, 2, 3]), 'x.apkg', open)).rejects.toThrow(/not a readable/);
    expect(() => readAnkh(new Uint8Array([1, 2, 3]))).toThrow(/not a readable/);
  });
});

describe('export and back', () => {
  function studiedSample() {
    const deck = sampleDeck();
    deck.options.bothWays = true;
    deck.options.retention = 0.85;
    const first = deck.units[0].lessonIds[0];
    const noteId = deck.lessons[first].noteIds[0];
    deck.notes[noteId].qmedia = ['apple.png'];
    deck.notes[noteId].extra = 'Una manzana al día.';
    deck.notes[noteId].labels = ['fruit'];
    const card = introduce();
    const progress: Progress = { [noteId]: { ...card, stage: 4, okDays: [card.added!], due: Date.now() + 5 * 86_400_000, mem: { stability: 5, difficulty: 5.5, lastDay: card.added! }, reps: 7, lapses: 1 } };
    return { deck, progress, noteId };
  }
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it('goes to Anki and comes back with lessons, extra, labels, media and progress', async () => {
    const { deck, progress, noteId } = studiedSample();
    const out = await buildApkg(deck, progress, true, async (n) => (n === 'apple.png' ? png : null), open);
    expect(out.notes).toBe(36);
    expect(out.cards).toBe(72);
    expect(out.media).toBe(1);
    if (process.env.ANKH_EXPORT_DIR) writeFileSync(`${process.env.ANKH_EXPORT_DIR}/sample.apkg`, out.bytes);

    const pkg = await readPackage(out.bytes, 'sample.apkg', open);
    expect(pkg.media['apple.png']).toEqual(png);
    expect(pkg.studied).toBe(true);
    const { rows, notetypes } = packageRows(pkg, {}, true);
    const back = ankiImport(pkg.name, rows, { lessonSize: 6 }, pkg.crt);
    expect(back.deck.units.map((u) => u.name)).toEqual(['Food', 'Everyday']);
    expect(back.deck.units[0].lessonIds.map((l) => back.deck.lessons[l].name)).toEqual(['Fruit', 'Drinks', 'At the table']);
    const apple = Object.values(back.deck.notes).find((n) => n.front === deck.notes[noteId].front)!;
    expect(apple).toMatchObject({ back: 'the apple', extra: 'Una manzana al día.', labels: ['fruit'], qmedia: ['apple.png'], alts: ['apple'] });
    expect(back.progress[apple.id]).toMatchObject({ stage: 4, reps: 7, lapses: 1 });
    expect(Object.values(notetypes)[0].name).toBe('Ankhwiz Basic (both ways)');
  });

  it('keeps everything in an .ankh file', async () => {
    const { deck, progress } = studiedSample();
    const { bytes, missing } = await buildAnkh(deck, progress, async (n) => (n === 'apple.png' ? png : null), 'test');
    expect(missing).toEqual([]);
    const read = readAnkh(bytes);
    expect(read.deck).toEqual(deck);
    expect(read.progress).toEqual(progress);
    expect(read.media['apple.png']).toEqual(png);
    const plain = readAnkh((await buildAnkh(deck, null, async () => null, 'test')).bytes);
    expect(plain.progress).toBeNull();
  });
});
