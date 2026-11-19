// Reading and importing an Anki package away from the window, so the app
// stays usable while a large deck comes in. The app hands over the compiled
// core and SQLite's bytes, the package's bytes, and later the field choices;
// the worker reads the package, builds the deck, saves the media files
// straight into storage, and sends back the deck and its progress.

import { createStore, setMany } from 'idb-keyval';
import { ankiImport, setClock, startCore } from '../core/bridge';
import type { AnkiNotetype, RawNote } from '../core/types';
import { mimeOf } from '../media';
import { packageRows, readPackage, type AnkiPackage, type Mapping, type SplitBy } from './apkg';
import { openerFrom } from './sql';
import { dropUnused } from '../fields';

export type ToWorker =
  | { type: 'read'; core: WebAssembly.Module; sql: ArrayBuffer; bytes: Uint8Array; fileName: string }
  | {
      type: 'import';
      mappings: Record<string, Mapping>;
      options: { withProgress: boolean; name: string; splitBy?: SplitBy; read?: { lang: string; langBack: string } | null; dropUnused?: boolean };
      lessonSize: number;
      dayOffsetMs: number;
      taken: string[];
    };

export type FromWorker =
  | { type: 'read'; pkg: AnkiPackage }
  | { type: 'step'; stage: 'notes' | 'lessons' | 'media' | 'saving'; done: number; total: number }
  | { type: 'done'; deck: string; progress: string; skipped: number }
  | { type: 'error'; message: string };

const media = createStore('ankhwiz-media', 'files');
let pkg: AnkiPackage | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

async function read(m: Extract<ToWorker, { type: 'read' }>): Promise<void> {
  await startCore(m.core);
  pkg = await readPackage(m.bytes, m.fileName, openerFrom(m.sql));
  // The media files stay here; the window only needs their names.
  post({ type: 'read', pkg: { ...pkg, media: Object.fromEntries(Object.keys(pkg.media).map((k) => [k, new Uint8Array(0)])) } });
}

async function build(m: Extract<ToWorker, { type: 'import' }>): Promise<void> {
  if (!pkg) throw new Error('The package is no longer open. Choose the file again.');
  setClock(() => Date.now() + m.dayOffsetMs);
  post({ type: 'step', stage: 'notes', done: 0, total: pkg.notes.length });
  const { rows, skipped, notetypes, media: used } = packageRows(pkg, m.mappings, { withProgress: m.options.withProgress, splitBy: m.options.splitBy });
  post({ type: 'step', stage: 'lessons', done: 0, total: rows.length });
  const built = ankiImport(m.options.name || pkg.name, rows as RawNote[], { lessonSize: m.lessonSize }, pkg.crt);
  built.deck.anki = { notetypes: notetypes as Record<string, AnkiNotetype> };
  const deck = m.options.dropUnused ? dropUnused(built.deck).deck : built.deck;
  const progress = built.progress;
  deck.options = { ...deck.options, bothWays: Object.values(notetypes).some((t) => t.bothWays) };
  if (m.options.read) deck.options.look = { ...deck.options.look, speak: 'on', lang: m.options.read.lang, langBack: m.options.read.langBack };
  const taken = new Set(m.taken);
  while (taken.has(deck.id)) deck.id = `d${Math.random().toString(36).slice(2, 10)}`;
  // Media go straight into storage, a hundred at a time.
  const files = used.filter((f) => pkg!.media[f]);
  if (files.length) post({ type: 'step', stage: 'media', done: 0, total: files.length });
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    await setMany(
      batch.map((f) => [`${deck.id}/${f}`, new Blob([pkg!.media[f] as BlobPart], { type: mimeOf(f) })]),
      media,
    );
    post({ type: 'step', stage: 'media', done: Math.min(files.length, i + 100), total: files.length });
  }
  post({ type: 'step', stage: 'saving', done: 1, total: 1 });
  // Sent as text: quicker to hand over than a large object, and read once by the window.
  post({ type: 'done', deck: JSON.stringify(deck), progress: JSON.stringify(progress), skipped });
  pkg = null;
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  (m.type === 'read' ? read(m) : build(m)).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
