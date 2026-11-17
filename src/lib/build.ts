// Building an answer from word tiles: the answer is split into words (with
// the device's own word breaker, so Chinese, Japanese and Thai split too), a
// few words from other answers are mixed in, and the learner puts them in order.

export interface Tile {
  id: number;
  text: string;
}

type Segmenter = { segment(t: string): Iterable<{ segment: string; isWordLike?: boolean }> };
const segmenters = new Map<string, Segmenter | null>();

function segmenter(lang: string): Segmenter | null {
  if (segmenters.has(lang)) return segmenters.get(lang)!;
  let s: Segmenter | null = null;
  try {
    const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter }).Segmenter;
    if (S) s = new S(lang || undefined, { granularity: 'word' });
  } catch {
    s = null;
  }
  segmenters.set(lang, s);
  return s;
}

/** Whether words in this text are written with spaces between them. */
export const spaced = (text: string) => /\s/.test(text.trim());

/** The words of a text, in order, without spaces or punctuation of their own. */
export function words(text: string, lang = ''): string[] {
  const t = text.trim();
  if (!t) return [];
  if (spaced(t)) {
    // Split on spaces, keeping a word's apostrophes and hyphens; drop marks around it.
    return t
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(Boolean);
  }
  const s = segmenter(lang);
  if (!s) return Array.from(t).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const out: string[] = [];
  for (const part of s.segment(t)) if (part.isWordLike ?? /[\p{L}\p{N}]/u.test(part.segment)) out.push(part.segment);
  return out;
}

const fold = (w: string) => w.toLocaleLowerCase();

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The tiles for an answer: its words and up to `extra` words from the other
 * answers that are not in it, mixed so they never start in the right order.
 */
export function makeTiles(answer: string, others: string[], extra: number, lang = '', random: () => number = Math.random): Tile[] {
  const own = words(answer, lang);
  const have = new Set(own.map(fold));
  const pool: string[] = [];
  for (const o of others) {
    for (const w of words(o, lang)) {
      if (!have.has(fold(w)) && !pool.some((p) => fold(p) === fold(w))) pool.push(w);
    }
  }
  const all = [...own, ...shuffled(pool, random).slice(0, Math.max(0, extra))];
  let tiles = shuffled(
    all.map((text, id) => ({ id, text })),
    random,
  );
  // Never hand over the answer already in order.
  for (let tries = 0; tries < 5 && own.length > 1 && tiles.slice(0, own.length).every((t, i) => t.text === own[i]); tries++) tiles = shuffled(tiles, random);
  if (own.length > 1 && tiles.slice(0, own.length).every((t, i) => t.text === own[i])) tiles = [...tiles.slice(1), tiles[0]];
  return tiles;
}

/** Whether the tiles, in this order, make the answer or another accepted version of it. */
export function builtRight(built: string[], accepted: string[], lang = ''): boolean {
  const given = built.map(fold).join('\u0000');
  return accepted.some((a) => words(a, lang).map(fold).join('\u0000') === given);
}

/** The tiles joined back into text, as written in the answer's script. */
export const joinWords = (built: string[], answer: string) => built.join(spaced(answer) ? ' ' : '');
