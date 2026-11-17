// Anki fields are small pieces of HTML. The prototype shows plain text, so
// tags are removed and the common entities decoded. No DOM is needed, which
// keeps this usable in tests and, later, outside a web view.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  times: '×',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  ccedil: 'ç',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text of an Anki field: no tags, sound markers or images. */
export function fieldText(html: string): string {
  let s = html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\[sound:[^\]]*\]/g, '')
    // Anki's reading tags only say how to read the words inside; keep the words.
    .replace(/\[\/?anki:tts\b[^\]]*\]/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ')
    .trim();
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/**
 * A cloze note as a question and answer: the first deletion is blanked out
 * (showing its hint if it has one) and becomes the answer; later deletions
 * are shown filled in.
 */
export function clozeToPair(text: string): { front: string; back: string } | null {
  let first: string | null = null;
  let answer = '';
  for (const m of text.matchAll(CLOZE)) {
    if (first === null || Number(m[1]) < Number(first)) first = m[1];
  }
  if (first === null) return null;
  const answers: string[] = [];
  const front = text.replace(CLOZE, (_w, n: string, body: string, hint?: string) => {
    if (n !== first) return body;
    answers.push(body);
    return hint ? `[${hint}]` : '_____';
  });
  answer = answers.join(', ');
  return { front: fieldText(front), back: fieldText(answer) };
}
