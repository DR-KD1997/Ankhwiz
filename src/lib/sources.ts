// Sources a deck is built from: text files, Markdown, Word documents, PDFs
// and web pages. Each is read into plain text in sections that keep their
// place ("p. 4", "§2 Diffusion"), so a card can say where its facts are.
// The text stays on this device, in a store of its own beside the deck; the
// deck only lists its sources. Nothing is sent anywhere until the learner
// asks Thoth to plan or write cards, and then only the parts they chose.

import { unzipSync, strFromU8 } from 'fflate';
import { createStore, del, get, keys, set, delMany } from 'idb-keyval';
import type { DeckSource, OutlineLesson } from './core/types';
import { http } from './platform';
import { t } from './i18n';

export interface Section {
  /** Where it is in the source: "p. 4", "Diffusion and osmosis", "§3". */
  at: string;
  text: string;
}

export interface ReadSource {
  title: string;
  kind: DeckSource['kind'];
  url?: string;
  sections: Section[];
}

/** The most text kept from one source (a long book is cut here). */
export const MAX_SOURCE_CHARS = 600_000;
/** Sections are kept to about this size, so a lesson can draw on a few. */
const SECTION = 3000;

const store = typeof indexedDB === 'undefined' ? undefined : createStore('ankhwiz-sources', 'texts');
const key = (deckId: string, sourceId: string) => `${deckId}/${sourceId}`;

export async function putSourceText(deckId: string, sourceId: string, sections: Section[]): Promise<void> {
  if (store) await set(key(deckId, sourceId), sections, store);
}
export async function sourceText(deckId: string, sourceId: string): Promise<Section[]> {
  return (store ? ((await get(key(deckId, sourceId), store)) as Section[] | undefined) : undefined) ?? [];
}
export async function removeSourceText(deckId: string, sourceId: string): Promise<void> {
  if (store) await del(key(deckId, sourceId), store);
}
export async function removeDeckSources(deckId: string): Promise<void> {
  if (!store) return;
  const mine = (await keys(store)).filter((k) => typeof k === 'string' && k.startsWith(`${deckId}/`));
  if (mine.length) await delMany(mine, store);
}

// ---------- plain text ----------

const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Long sections divided at paragraph ends into parts of about SECTION characters ("Diffusion (2)"). */
function sized(sections: Section[]): Section[] {
  const out: Section[] = [];
  let total = 0;
  for (const s of sections) {
    const text = tidy(s.text);
    if (!text) continue;
    if (text.length <= SECTION * 1.4) out.push({ at: s.at, text });
    else {
      const paras = text.split(/\n\n+/);
      let cur = '';
      let n = 1;
      const push = () => {
        if (cur.trim()) out.push({ at: n === 1 ? s.at : `${s.at} (${n})`, text: cur.trim() });
        n++;
        cur = '';
      };
      for (const p of paras) {
        if (cur && cur.length + p.length > SECTION) push();
        cur += (cur ? '\n\n' : '') + p;
      }
      push();
    }
    total += text.length;
    if (total > MAX_SOURCE_CHARS) break;
  }
  return out;
}

/** Plain text in parts, at paragraph ends ("§1", "§2"…). */
export function sectionsFromText(text: string): Section[] {
  const paras = tidy(text).split(/\n\n+/);
  const out: Section[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > SECTION) {
      out.push({ at: `§${out.length + 1}`, text: cur });
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur.trim()) out.push({ at: `§${out.length + 1}`, text: cur });
  return sized(out);
}

/** Markdown in parts at its headings, with its markup removed. */
export function sectionsFromMarkdown(md: string): Section[] {
  const out: Section[] = [];
  let at = '';
  let cur: string[] = [];
  const flush = () => {
    if (cur.join('').trim()) out.push({ at: at || `§${out.length + 1}`, text: cur.join('\n') });
    cur = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const h = raw.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      at = plainMarkdown(h[1]).slice(0, 80);
      continue;
    }
    cur.push(plainMarkdown(raw));
  }
  flush();
  return sized(out);
}

function plainMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '');
}

// ---------- web pages and HTML files ----------

const SKIP = 'script,style,noscript,nav,header,footer,aside,form,svg,iframe,button,template,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],.ad,.ads,.advert,.cookie,.cookies,.newsletter,.share,.social,.comments,#comments';

/** The readable text of an HTML page, in parts at its headings. */
export function sectionsFromHtml(html: string): { title: string; sections: Section[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || '';
  doc.querySelectorAll(SKIP).forEach((e) => e.remove());
  // The main part of the page when it marks one; otherwise the whole body.
  const candidates = [...doc.querySelectorAll('article, main, [role=main], #content, .content, .post, .entry-content')];
  const root = candidates.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0] ?? doc.body;
  const out: Section[] = [];
  let at = '';
  let cur: string[] = [];
  const flush = () => {
    if (cur.join('').trim()) out.push({ at: at || `§${out.length + 1}`, text: cur.join('\n\n') });
    cur = [];
  };
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) {
        flush();
        at = (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      } else if (['p', 'li', 'blockquote', 'pre', 'dd', 'dt', 'figcaption', 'td', 'th', 'caption'].includes(tag)) {
        const t = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) cur.push(tag === 'li' ? `• ${t}` : t);
      } else if (child.children.length) walk(child);
      else {
        const t = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t.length > 40) cur.push(t);
      }
    }
  };
  if (root) walk(root);
  flush();
  return { title, sections: sized(out) };
}

/** A web page's address made whole (a missing https:// added). Empty when it is not one. */
export function pageUrl(text: string): string {
  const t = text.trim();
  if (!t || /\s/.test(t)) return '';
  const withScheme = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : '';
  try {
    const u = new URL(withScheme);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

/** Fetch and read a web page. Throws a message for the learner when it cannot. */
export async function readWebPage(url: string): Promise<ReadSource> {
  const reply = await http({
    url,
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'User-Agent': 'Mozilla/5.0 (compatible; Ankhwiz study app; reads a page the learner chose)',
    },
    body: '',
  });
  if (reply.status === 0) throw new Error(t('The page could not be reached. Check the address and the connection.'));
  if (reply.status === 401 || reply.status === 403) throw new Error(t('That page needs a sign-in or does not allow readers like Ankhwiz. Open it yourself and paste its text instead.'));
  if (reply.status >= 400) throw new Error(t('The page answered with an error ({status}).', { status: reply.status }));
  const body = reply.body;
  if (/^\s*%PDF/.test(body)) throw new Error(t('That address is a PDF. Download it and add it as a file instead.'));
  const looksHtml = /<html|<body|<p[\s>]|<div[\s>]/i.test(body.slice(0, 5000));
  if (!looksHtml) return { title: new URL(url).hostname, kind: 'web', url, sections: sectionsFromText(body) };
  const { title, sections } = sectionsFromHtml(body);
  if (!sections.length) throw new Error(t('No readable text was found on that page. It may build itself with scripts; open it and paste its text instead.'));
  return { title: title || new URL(url).hostname, kind: 'web', url, sections };
}

// ---------- Word documents ----------

/** The text of a .docx, in parts at its headings. */
export function sectionsFromDocx(bytes: Uint8Array): { title: string; sections: Section[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' || f.name === 'docProps/core.xml' });
  } catch {
    throw new Error(t('This Word file could not be opened.'));
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new Error(t('This file is not a Word document (.docx).'));
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out: Section[] = [];
  let at = '';
  let cur: string[] = [];
  const flush = () => {
    if (cur.join('').trim()) out.push({ at: at || `§${out.length + 1}`, text: cur.join('\n\n') });
    cur = [];
  };
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttribute('w:val') ?? '';
    let text = '';
    for (const node of [...p.getElementsByTagNameNS(W, '*')]) {
      if (node.localName === 't') text += node.textContent ?? '';
      else if (node.localName === 'tab') text += '\t';
      else if (node.localName === 'br') text += '\n';
    }
    text = text.trim();
    if (!text) continue;
    if (/^(heading|title|berschrift|titre|titulo|kop)/i.test(style)) {
      flush();
      at = text.slice(0, 80);
    } else cur.push(text);
  }
  flush();
  let title = '';
  const core = files['docProps/core.xml'];
  if (core) title = new DOMParser().parseFromString(strFromU8(core), 'application/xml').getElementsByTagName('dc:title')[0]?.textContent?.trim() ?? '';
  return { title, sections: sized(out) };
}

// ---------- PDFs ----------

/** The text of a PDF, a section a page ("p. 4"). Pages that are only pictures have no text to read. */
export async function sectionsFromPdf(bytes: Uint8Array): Promise<{ title: string; sections: Section[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    const { default: PdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline');
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) {
    const m = e instanceof Error ? t(e.message) : '';
    throw new Error(/password/i.test(m) ? t('This PDF is locked with a password.') : t('This PDF could not be read.'));
  }
  const out: Section[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < MAX_SOURCE_CHARS; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (item.str === undefined) continue;
      text += item.str + (item.hasEOL ? '\n' : '');
    }
    // Words broken across lines with a hyphen are joined again.
    text = text.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
    if (text.trim()) out.push({ at: `p. ${i}`, text });
    total += text.length;
  }
  let title = '';
  try {
    const meta = await doc.getMetadata();
    title = String((meta.info as { Title?: string })?.Title ?? '').trim();
  } catch {
    /* no title */
  }
  await doc.destroy();
  if (!out.length) throw new Error(t('This PDF has no text to read: its pages may be scans or pictures.'));
  return { title, sections: sized(out) };
}

// ---------- any file ----------

const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** Read a file the learner chose: PDF, Word, HTML, Markdown or plain text. */
export async function readSourceFile(name: string, bytes: Uint8Array): Promise<ReadSource> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || strFromU8(bytes.slice(0, 5)) === '%PDF-') {
    const r = await sectionsFromPdf(bytes);
    return { title: r.title || stem(name), kind: 'pdf', sections: r.sections };
  }
  if (ext === 'docx') {
    const r = sectionsFromDocx(bytes);
    return { title: r.title || stem(name), kind: 'word', sections: r.sections };
  }
  if (['doc', 'odt', 'pages', 'rtf', 'epub', 'pptx', 'ppt', 'xlsx'].includes(ext)) {
    throw new Error(t('Ankhwiz cannot read .{ext} files yet. Save it as PDF, Word (.docx) or text, and add that.', { ext }));
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === 'html' || ext === 'htm' || /^\s*<(!doctype html|html)/i.test(text)) {
    const r = sectionsFromHtml(text);
    return { title: r.title || stem(name), kind: 'html', sections: r.sections };
  }
  if (ext === 'md' || ext === 'markdown') return { title: stem(name), kind: 'markdown', sections: sectionsFromMarkdown(text) };
  if (text.includes('\u0000')) throw new Error(t('This file does not look like text, a PDF or a Word document.'));
  return { title: stem(name), kind: 'text', sections: sectionsFromText(text) };
}

// ---------- for Thoth ----------

/** Each section's place and opening words, for planning an outline without sending everything. */
export function briefs(list: { source: DeckSource; sections: Section[] }[]) {
  return list.map(({ source, sections }) => ({
    id: source.id,
    title: source.title,
    sections: sections.map((s) => ({ at: s.at, text: s.text.slice(0, 260), size: s.text.length })),
  }));
}

/** The full text of the sections a lesson draws on, each under a header naming its source and place. */
export function passagesFor(lesson: Pick<OutlineLesson, 'from'>, texts: Map<string, Section[]>, max = 16_000): string {
  const out: string[] = [];
  let left = max;
  for (const [id, at] of lesson.from) {
    const sections = texts.get(id) ?? [];
    // The place as given, and the parts it was divided into ("Diffusion (2)").
    const hits = sections.filter((s) => s.at === at || s.at.startsWith(`${at} (`));
    for (const s of hits.length ? hits : sections.filter((x) => x.at.toLowerCase().includes(at.toLowerCase())).slice(0, 2)) {
      const block = `[${id} · ${s.at}]\n${s.text}`;
      if (block.length > left) break;
      out.push(block);
      left -= block.length;
    }
  }
  return out.join('\n\n');
}

const folded = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Whether a quoted sentence is really in the source text: word for word
 * (ignoring case, accents and punctuation), or nearly so, with at least 85%
 * of its words appearing in the same order within a passage of similar length.
 */
export function quoteFound(quote: string, text: string): boolean {
  const q = folded(quote);
  if (q.length < 12) return false;
  const t = folded(text);
  if (t.includes(q)) return true;
  const qw = q.split(' ');
  const tw = t.split(' ');
  if (qw.length < 4) return false;
  const first = new Map<string, number[]>();
  tw.forEach((w, i) => first.set(w, [...(first.get(w) ?? []), i]));
  const need = Math.ceil(qw.length * 0.85);
  // Start from each place the quote's first few words appear, and count words found in order.
  const starts = new Set<number>();
  for (const w of qw.slice(0, 3)) for (const i of first.get(w) ?? []) starts.add(Math.max(0, i - 3));
  for (const start of starts) {
    let j = start;
    let hits = 0;
    const end = Math.min(tw.length, start + qw.length * 2 + 6);
    for (const w of qw) {
      let k = j;
      while (k < end && tw[k] !== w) k++;
      if (k < end) {
        hits++;
        j = k + 1;
      }
    }
    if (hits >= need) return true;
  }
  return false;
}

/** The section of a source a card points to (by its place), for showing the passage. */
export function sectionAt(sections: Section[], at: string): Section | null {
  return sections.find((s) => s.at === at) ?? sections.find((s) => s.at.startsWith(`${at} (`)) ?? null;
}
