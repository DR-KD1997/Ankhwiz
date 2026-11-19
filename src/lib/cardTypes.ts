// Card types: the fields a kind of note has, which of them the question, the
// answer and the extra are, and the card layout (templates and styling) used
// when a deck goes to Anki and, if chosen, shown with the answer in Ankhwiz.
// They are kept as Anki note types (deck.anki.notetypes), so a deck built in
// Ankhwiz goes to Anki and back unchanged.

import type { AnkiNotetype, Deck, Note, RawNote } from './core/types';
import { readFields, type FieldMap } from './import/apkg';
import { foldEdits } from './remap';

export type KindId = 'words' | 'formula' | 'dates' | 'qa';

export interface Kind {
  id: KindId;
  name: string;
  blurb: string;
  fields: string[];
  question: number;
  answer: number;
  extra: number | null;
  extraMore: number[];
  /** What to ask, as the card says it. */
  ask: string;
  /** Example rows, shown greyed in the builder until the first is typed. */
  example: string[];
  /** Learners check these themselves (formulas are hard to type exactly). */
  selfCheck?: boolean;
}

export const KINDS: Kind[] = [
  {
    id: 'words',
    name: 'Words & phrases',
    blurb: 'A language, terms, jargon',
    fields: ['Word', 'Meaning', 'Example', 'Example meaning', 'Notes'],
    question: 0,
    answer: 1,
    extra: 2,
    extraMore: [3, 4],
    ask: 'What does this mean?',
    example: ['teşekkür ederim', 'thank you', 'Yardımın için teşekkür ederim.', 'Thank you for your help.', ''],
  },
  {
    id: 'formula',
    name: 'Formulas',
    blurb: 'Maths, physics, chemistry',
    fields: ['Name', 'Formula', 'Units', 'Notes'],
    question: 0,
    answer: 1,
    extra: 2,
    extraMore: [3],
    ask: 'Write the formula for',
    example: ['Kinetic energy', 'E = ½ m v²', 'joules (J)', ''],
    selfCheck: true,
  },
  {
    id: 'dates',
    name: 'Dates & events',
    blurb: 'History, timelines',
    fields: ['Event', 'Date', 'Place', 'Notes'],
    question: 0,
    answer: 1,
    extra: 2,
    extraMore: [3],
    ask: 'When did this happen?',
    example: ['Fall of Constantinople', '1453', 'Istanbul', ''],
  },
  {
    id: 'qa',
    name: 'Questions & answers',
    blurb: 'Anything else',
    fields: ['Question', 'Answer', 'Extra', 'Source'],
    question: 0,
    answer: 1,
    extra: 2,
    extraMore: [3],
    ask: 'Question',
    example: ['How many compressions a minute in CPR?', '100–120', '', 'Course notes p. 4'],
  },
];

const CSS = `.card {
  font-family: var(--body);
  font-size: 22px;
  text-align: center;
  color: var(--text);
}
.ask {
  font-size: 13px;
  color: var(--muted);
}
.main {
  font-family: var(--display);
  font-size: 1.5em;
}
.extra {
  font-size: 0.8em;
  color: var(--muted);
}`;

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A card type for a kind, with a simple layout to start from. */
export function typeFor(kind: Kind): AnkiNotetype {
  const f = kind.fields;
  const extras = [kind.extra, ...kind.extraMore].filter((i): i is number => i !== null).map((i) => `{{#${f[i]}}}<p class="extra">{{${f[i]}}}</p>{{/${f[i]}}}`);
  return {
    id: newId(),
    name: `${kind.name} (Ankhwiz)`,
    cloze: false,
    fields: [...f],
    templates: [
      {
        name: 'Card 1',
        qfmt: `<p class="ask">${kind.ask}</p>\n<div class="main">{{${f[kind.question]}}}</div>`,
        afmt: `{{FrontSide}}\n\n<hr id="answer">\n<div class="main">{{${f[kind.answer]}}}</div>\n${extras.join('\n')}`,
      },
    ],
    css: CSS,
    question: kind.question,
    answer: kind.answer,
    extra: kind.extra,
    questionMore: [],
    extraMore: [...kind.extraMore],
    bothWays: false,
  };
}

/** A new deck's settings for a kind of card: one card type, asked one way. */
export function deckWithType(deck: Deck, kind: Kind): Deck {
  const type = typeFor(kind);
  return { ...deck, anki: { notetypes: { ...(deck.anki?.notetypes ?? {}), [type.id]: type } }, made: { kind: kind.id, by: 'builder' } };
}

const mapOf = (t: AnkiNotetype): FieldMap => ({ question: t.question, answer: t.answer, extra: t.extra ?? null, questionMore: t.questionMore ?? [], extraMore: t.extraMore ?? [] });

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** A note of a card type from what was typed in each field (plain text). Null when it has no question or answer. */
export function rowFor(type: AnkiNotetype, values: string[], selfCheck = false): RawNote | null {
  const fields = type.fields.map((_, i) => esc((values[i] ?? '').trim()));
  const r = readFields(type, fields, mapOf(type), () => true);
  if (!r) return null;
  return {
    front: r.front,
    back: r.back,
    extra: r.extra,
    frontMore: r.frontMore,
    extraMore: r.extraMore,
    qmedia: r.qmedia,
    amedia: r.amedia,
    selfCheck: selfCheck || undefined,
    noBuild: selfCheck || undefined,
    anki: {
      guid: Math.random().toString(36).slice(2, 12),
      ntid: type.id,
      fields,
      seen: [r.front.trim(), r.back.trim(), r.extra.trim(), ...r.frontMore, ...r.extraMore],
    },
  };
}

/** Rows typed or pasted: one per line, columns split by tabs (from a spreadsheet), semicolons or " = ". */
export function parseRows(text: string, columns: number): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.includes(' = ') ? line.split(' = ') : line.split(/\s*,\s*/);
      return parts.slice(0, columns).map((p) => p.trim());
    })
    .filter((r) => r.filter(Boolean).length >= 2);
}

// ---------- changing a type's fields ----------

export type FieldRole = 'question' | 'questionMore' | 'answer' | 'extra' | 'extraMore' | 'none';

/** Each field's part in the card, in field order. */
export function rolesOf(t: AnkiNotetype): FieldRole[] {
  return t.fields.map((_, i) =>
    i === t.question ? 'question' : i === t.answer ? 'answer' : i === t.extra ? 'extra' : (t.questionMore ?? []).includes(i) ? 'questionMore' : (t.extraMore ?? []).includes(i) ? 'extraMore' : 'none',
  );
}

/** A field choice from roles in field order (more fields keep their field order). */
export function mapFromRoles(roles: FieldRole[]): FieldMap | string {
  const q = roles.indexOf('question');
  const a = roles.indexOf('answer');
  if (q < 0) return 'Choose a field for the question.';
  if (a < 0) return 'Choose a field for the answer.';
  if (roles.filter((r) => r === 'question').length > 1 || roles.filter((r) => r === 'answer').length > 1) return 'Only one field can be the question, and one the answer. Use “Shown with the question” or “Shown after” for the others.';
  const extra = roles.indexOf('extra');
  if (roles.filter((r) => r === 'extra').length > 1) return 'Only one field can be the extra. Use “Shown after” for the others.';
  const at = (role: FieldRole) => roles.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);
  return { question: q, answer: a, extra: extra >= 0 ? extra : null, questionMore: at('questionMore'), extraMore: at('extraMore') };
}

const NAME = /^[^:{}#^/"]+$/;
/** Whether a field name can be used: no braces, colons or quotes, and not taken. */
export function fieldNameProblem(name: string, others: string[]): string {
  const n = name.trim();
  if (!n) return 'A field needs a name.';
  if (!NAME.test(n)) return 'Field names cannot hold { } : # ^ / or quotes.';
  if (others.some((o) => o.toLowerCase() === n.toLowerCase())) return `There is already a field called “${n}”.`;
  return '';
}

/** A template with a field's name changed wherever it is used ({{Old}}, {{#Old}}, {{type:Old}}…). */
export function renameInTemplate(text: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\{\\{([#^/]?)((?:[\\w-]+:)*)\\s*${esc}\\s*\\}\\}`, 'g'), (_m, mark: string, filters: string) => `{{${mark}${filters}${to}}}`);
}

/**
 * A deck with one type's fields changed: renamed, added, removed (only
 * fields no card shows) and put in a new order. `plan` lists, in the new
 * order, each field's old position (or -1 for a new one) and its name.
 */
export function reshapeFields(deck: Deck, ntid: string, plan: { from: number; name: string }[]): Deck {
  const t = deck.anki!.notetypes[ntid];
  const roles = rolesOf(t);
  const kept = new Set(plan.map((p) => p.from).filter((i) => i >= 0));
  roles.forEach((r, i) => {
    if (r !== 'none' && !kept.has(i)) throw new Error(`“${t.fields[i]}” is part of the card: choose “Not shown” for it before removing it.`);
  });
  const newIndex = (old: number) => plan.findIndex((p) => p.from === old);
  let templates = t.templates.map((x) => ({ ...x }));
  for (const p of plan) {
    if (p.from < 0) continue;
    const old = t.fields[p.from];
    if (old !== p.name) {
      templates = templates.map((x) => ({ ...x, qfmt: renameInTemplate(x.qfmt, old, p.name), afmt: renameInTemplate(x.afmt, old, p.name) }));
    }
  }
  const type: AnkiNotetype = {
    ...t,
    fields: plan.map((p) => p.name.trim()),
    templates,
    question: newIndex(t.question),
    answer: newIndex(t.answer),
    extra: t.extra === null || t.extra === undefined ? null : newIndex(t.extra),
    questionMore: (t.questionMore ?? []).map(newIndex),
    extraMore: (t.extraMore ?? []).map(newIndex),
  };
  const notes: Record<string, Note> = {};
  for (const [id, n] of Object.entries(deck.notes)) {
    if (n.anki?.ntid !== ntid) {
      notes[id] = n;
      continue;
    }
    const current = foldEdits(n, t);
    notes[id] = { ...n, anki: { ...n.anki, fields: plan.map((p) => (p.from >= 0 ? (current[p.from] ?? '') : '')) } };
  }
  return { ...deck, notes, anki: { notetypes: { ...deck.anki!.notetypes, [ntid]: type } } };
}

/**
 * Give cards made in Ankhwiz (without a card type) a type of their own, so
 * their layout can be designed: fields Question, Answer, Extra and as many
 * more as the notes use.
 */
export function typeForOwnNotes(deck: Deck): Deck {
  const own = Object.values(deck.notes).filter((n) => !n.anki && !n.cloze && !n.occlusion);
  if (!own.length) return deck;
  const qm = Math.max(0, ...own.map((n) => n.frontMore?.length ?? 0));
  const xm = Math.max(0, ...own.map((n) => n.extraMore?.length ?? 0));
  const fields = ['Question', 'Answer', 'Extra', ...Array.from({ length: qm }, (_, i) => `Question ${i + 2}`), ...Array.from({ length: xm }, (_, i) => `Extra ${i + 2}`)];
  const kind = KINDS.find((k) => k.id === 'qa')!;
  const base = typeFor({ ...kind, fields, extraMore: [] });
  const type: AnkiNotetype = {
    ...base,
    name: 'Basic (Ankhwiz)',
    questionMore: Array.from({ length: qm }, (_, i) => 3 + i),
    extraMore: Array.from({ length: xm }, (_, i) => 3 + qm + i),
    bothWays: null,
  };
  const media = (text: string, list?: string[]) => (list ?? []).reduce((out, m) => out + (/\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(m) ? `[sound:${m}]` : `<img src="${m.replace(/"/g, '&quot;')}">`), esc(text));
  const notes = { ...deck.notes };
  for (const n of own) {
    const f = [media(n.front, n.qmedia), media(n.back, n.amedia), esc(n.extra ?? ''), ...Array.from({ length: qm }, (_, i) => esc(n.frontMore?.[i] ?? '')), ...Array.from({ length: xm }, (_, i) => esc(n.extraMore?.[i] ?? ''))];
    notes[n.id] = { ...n, anki: { guid: Math.random().toString(36).slice(2, 12), ntid: type.id, fields: f, seen: [n.front.trim(), n.back.trim(), (n.extra ?? '').trim(), ...(n.frontMore ?? []), ...(n.extraMore ?? [])] } };
  }
  return { ...deck, notes, anki: { notetypes: { ...(deck.anki?.notetypes ?? {}), [type.id]: type } } };
}

// ---------- the card layout ----------

/** A note's fields as they stand (edits in Ankhwiz written back), by name. */
export function fieldValues(note: Note, type: AnkiNotetype): Record<string, string> {
  const values = foldEdits(note, type);
  return Object.fromEntries(type.fields.map((f, i) => [f, values[i] ?? '']));
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
const SOUND = /\[sound:([^\]]+)\]/g;

/**
 * One side of a card from a template, the way Anki fills it: {{Field}},
 * {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}}, {{FrontSide}}, {{type:Field}},
 * {{cloze:Field}}, {{text:Field}}; anything else with a filter shows the
 * field's text. Reading aloud ({{tts …}}) is left out. Not yet made safe:
 * pass the result through `safeHtml`.
 */
export function fillTemplate(template: string, values: Record<string, string>, side: 'front' | 'back', front = ''): string {
  let out = template;
  // Sections, innermost first, until none are left.
  const section = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  for (let guard = 0; guard < 200 && section.test(out); guard++) {
    out = out.replace(section, (_m, mark: string, name: string, inner: string) => {
      const has = !!textOf(values[name.trim()] ?? '') || /<img|\[sound:/i.test(values[name.trim()] ?? '');
      return (mark === '#' ? has : !has) ? inner : '';
    });
  }
  out = out.replace(/\{\{\s*FrontSide\s*\}\}/g, side === 'back' ? front : '');
  out = out.replace(/\{\{([^{}]+)\}\}/g, (_m, inner: string) => {
    const parts = inner.trim().split(':');
    const name = parts.pop()!.trim();
    const filters = parts.map((p) => p.trim().toLowerCase());
    if (filters.some((f) => f.startsWith('tts'))) return '';
    const value = values[name] ?? '';
    if (filters.includes('type')) return side === 'front' ? '<input class="tpl-type" disabled placeholder="Type the answer">' : `<code class="tpl-typed">${textOf(value)}</code>`;
    if (filters.includes('cloze')) {
      const first = Math.min(...[...value.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])), Infinity);
      return value.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_w, n: string, ans: string, hint?: string) =>
        Number(n) === first ? (side === 'front' ? `<span class="cloze">[${hint ?? '…'}]</span>` : `<span class="cloze">${ans}</span>`) : ans,
      );
    }
    if (filters.includes('text')) return textOf(value);
    return value;
  });
  return out.replace(SOUND, '<span class="tpl-sound" title="Sound: $1">🔊</span>');
}

const DROP = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset', 'applet', 'style', 'noscript', 'template']);

/**
 * HTML made safe to show: no scripts, frames, forms or embedded styles, no
 * event attributes or script links. Pictures keep their file names in
 * `data-media` so the app can show its own copies.
 */
export function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (DROP.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value.trim().toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action') && /^(javascript|data:text|vbscript)/.test(v))) child.removeAttribute(a.name);
      }
      if (child.tagName.toLowerCase() === 'img') {
        const src = child.getAttribute('src') ?? '';
        if (src && !/^(https?:|data:image\/)/i.test(src)) {
          child.setAttribute('data-media', src);
          child.removeAttribute('src');
        }
      }
      if (child.tagName.toLowerCase() === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * A type's styling limited to one card on screen: every rule is put under
 * the scope's class, `.card` becomes the scope itself, and imports, fonts
 * from elsewhere and page-wide rules (html, body) are left out.
 */
export function scopeCss(css: string, scope: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/gi, '').replace(/url\(\s*['"]?(?!data:)[^)]*\)/gi, 'none');
  const out: string[] = [];
  const rules = (text: string): string[] => {
    const res: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          res.push(text.slice(start, i + 1).trim());
          start = i + 1;
        }
      }
    }
    return res.filter(Boolean);
  };
  const scoped = (selectors: string) =>
    selectors
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^(html|body|:root)\b/i.test(s))
      .map((s) => (/^\.card\b/.test(s) ? s.replace(/^\.card/, `.${scope}`) : `.${scope} ${s}`))
      .join(', ');
  for (const rule of rules(clean)) {
    const brace = rule.indexOf('{');
    const head = rule.slice(0, brace).trim();
    const body = rule.slice(brace + 1, -1);
    if (/^@font-face/i.test(head)) continue;
    if (/^@(media|supports)/i.test(head)) {
      const inner = rules(body)
        .map((r) => {
          const b = r.indexOf('{');
          const sel = scoped(r.slice(0, b));
          return sel ? `${sel} {${r.slice(b + 1, -1)}}` : '';
        })
        .filter(Boolean);
      if (inner.length) out.push(`${head} { ${inner.join(' ')} }`);
      continue;
    }
    if (head.startsWith('@')) continue;
    const sel = scoped(head);
    if (sel) out.push(`${sel} {${body}}`);
  }
  return out.join('\n');
}

/** Both sides of a card, filled and made safe, for showing. */
export function cardLayout(type: AnkiNotetype, note: Note, templateIndex = 0): { front: string; back: string } {
  const t = type.templates[templateIndex] ?? type.templates[0];
  if (!t) return { front: '', back: '' };
  const values = fieldValues(note, type);
  const front = fillTemplate(t.qfmt, values, 'front');
  const back = fillTemplate(t.afmt, values, 'back', front);
  return { front: safeHtml(front), back: safeHtml(back) };
}
