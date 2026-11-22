import { describe, expect, it } from 'vitest';
import type { Deck, Note } from './core/types';
import { detectLanguage } from './detect';
import { addLink, cleanLinks, contrastFor, deviceLinks, linksOf, noteWithAnswer, pickAllFor, plainAnswer, removePair } from './links';
import { decksUnder, groupDecks, knownPlaces } from './places';
import { matchLanguage, plural, setLanguage, t } from './i18n';

const note = (id: string, front: string, back: string, more: Partial<Note> = {}): Note => ({ id, front, back, ...more }) as Note;
const deck = (notes: Note[], more: Partial<Deck> = {}): Deck =>
  ({ id: 'd', name: 'T', notes: Object.fromEntries(notes.map((n) => [n.id, n])), lessons: {}, units: [], lessonSize: 6, strictAccents: false, created: 0, options: {} as Deck['options'], ...more }) as Deck;

const turkish = deck([
  note('a', 'Anlıyorum.', 'I understand.'),
  note('b', 'Anladım.', 'I got it.'),
  note('c', 'Kavrıyorum.', 'I grasp it.'),
  note('d', 'Geliyorum.', "I'm coming."),
  note('e', 'Biliyorum.', 'I know.'),
]);

describe('answer links', () => {
  it('adds, merges and takes apart links, a pair never being both kinds', () => {
    let links = addLink([], ['a', 'c'], 'same');
    links = addLink(links, ['c', 'e'], 'same');
    expect(links).toHaveLength(1);
    expect(links[0].notes.sort()).toEqual(['a', 'c', 'e']);
    links = addLink(links, ['a', 'e'], 'close');
    expect(links.find((l) => l.kind === 'same')!.notes.sort()).toEqual(['a', 'c']);
    expect(links.find((l) => l.kind === 'close')!.notes.sort()).toEqual(['a', 'e']);
    links = removePair(links, 'a', 'e');
    expect(links.map((l) => l.kind)).toEqual(['same']);
  });

  it('finds the card whose answer was given, and cleans links of deleted cards', () => {
    expect(noteWithAnswer(turkish, 'i got it', false, 'a')).toBe('b');
    expect(noteWithAnswer(turkish, 'Anladim', true, 'a')).toBe('b');
    expect(noteWithAnswer(turkish, 'I sleep', false, 'a')).toBeNull();
    const d = { ...turkish, links: [{ id: 'x', kind: 'same' as const, notes: ['a', 'zz'] }, { id: 'y', kind: 'close' as const, notes: ['a', 'b', 'gone'] }] };
    expect(cleanLinks(d)).toEqual([{ id: 'y', kind: 'close', notes: ['a', 'b'] }]);
    expect(plainAnswer('  “I’m” — OK! ')).toBe('i m — ok');
  });

  it('asks "pick all" only when a card has a same link and three linked cards, and shows close pairs side by side', () => {
    const d = { ...turkish, links: addLink(addLink([], ['a', 'c'], 'same'), ['a', 'b'], 'close') };
    const q = pickAllFor(d, 'a', false)!;
    expect(q.options.filter((o) => o.right).map((o) => o.text)).toEqual(['I understand.', 'I grasp it.']);
    expect(q.options.find((o) => o.text === 'I got it.')?.right).toBe(false);
    expect(pickAllFor({ ...turkish, links: addLink([], ['a', 'c'], 'same') }, 'a')).toBeNull();
    expect(linksOf(d, 'b')).toEqual([{ kind: 'close', other: 'a', link: d.links!.find((l) => l.kind === 'close') }]);
    expect(contrastFor(d, {}, 'b')).toBeNull();
    expect(contrastFor(d, { a: {} as never }, 'b')?.other.id).toBe('a');
  });

  it('links on this device: the same question with other answers, the same answer to other questions', () => {
    const d = deck([note('a', 'su', 'water'), note('b', 'Su', 'Water!'), note('c', 'su', 'liquid'), note('x', 'ev', 'house'), note('y', 'konut', 'house')]);
    const groups = deviceLinks(d);
    expect(groups.map((g) => g.notes.sort())).toEqual([['a', 'b', 'c'], ['x', 'y']]);
    expect(deviceLinks({ ...d, links: [{ id: 'k', kind: 'same', notes: ['x', 'y'] }] }).length).toBe(1);
  });
});

describe('telling languages apart', () => {
  it('knows writing systems and common languages written in Latin letters', () => {
    expect(detectLanguage(['Anlıyorum.', 'Teşekkür ederim.', 'Günaydın.', 'İyi geceler.'])).toBe('tr-TR');
    expect(detectLanguage(['I understand.', 'I got it.', 'Thank you.', 'What is this?', 'The house is big'])).toBe('en-GB');
    expect(detectLanguage(['¿Qué tal?', 'la casa', 'el perro', 'Mañana es lunes'])).toBe('es-ES');
    expect(detectLanguage(['こんにちは', 'ありがとう', '日本語'])).toBe('ja-JP');
    expect(detectLanguage(['你好', '谢谢', '中文'])).toBe('zh-CN');
    expect(detectLanguage(['Привет', 'Спасибо'])).toBe('ru-RU');
    expect(detectLanguage(['x', 'y'])).toBe('');
  });
});

describe('subjects', () => {
  const row = (id: string, subject = '', topic = '', due = 0) => ({ deck: { ...deck([]), id, name: id, place: subject ? { subject, topic } : null } as Deck, sum: { introduced: 0, total: 1, due } });
  const rows = [row('t1', 'Languages', 'Turkish', 3), row('t2', 'Languages', 'Turkish', 1), row('j', 'Languages', 'Japanese'), row('m', 'Math', 'Trigonometry', 2), row('u')];
  it('groups by subject and topic, unsorted last, with due counts', () => {
    const g = groupDecks(rows);
    expect(g.map((x) => [x.name, x.due])).toEqual([['Languages', 4], ['Math', 2], ['', 0]]);
    expect(g[0].topics.map((x) => x.name)).toEqual(['Japanese', 'Turkish']);
    expect(decksUnder(rows, 'Languages/Turkish').map((r) => r.deck.id)).toEqual(['t1', 't2']);
    expect(decksUnder(rows, 'Languages').length).toBe(3);
    expect([...knownPlaces(rows.map((r) => r.deck)).entries()]).toEqual([['Languages', ['Japanese', 'Turkish']], ['Math', ['Trigonometry']]]);
  });
});

describe('interface languages', () => {
  it('matches device languages and falls back to English wording', () => {
    expect(matchLanguage('pt-PT')).toBe('pt-BR');
    expect(matchLanguage('zh-TW')).toBe('zh-Hans');
    expect(matchLanguage('de-AT')).toBe('de');
    expect(matchLanguage('nl')).toBe('en');
    setLanguage('en');
    expect(t('continue')).toBe('Continue');
    expect(t('{n} days in a row', { n: 3 })).toBe('3 days in a row');
    expect(plural('{n} card', '{n} cards', 1)).toBe('1 card');
    expect(plural('{n} card', '{n} cards', 2)).toBe('2 cards');
  });
});
