// Exporting a deck as an .apkg (for Anki) or an .ankh (for Ankhwiz), and
// importing either kind of file into the library.

import { ankiImport, buildDeck } from './core';
import type { Deck, Progress, RawNote } from './core/types';
import { buildAnkh, readAnkh } from './export/ankh';
import { buildApkg } from './export/apkg';
import { buildLibrary, readLibrary } from './export/library';
import { packageRows, type AnkiPackage, type Mapping, type SplitBy } from './import/apkg';
import { readPackageAway, release, runInWorker, workerOf } from './import/background';
import { mediaBytes } from './media';
import { dropUnused } from './fields';
import { saveBytes } from './platform';
import { addDeck, addImported, data, ensureAll, ensureDeck, markBackedUp, restoreLibrary, snap } from './store.svelte';
import { plural, t } from './i18n';

export const APP = 'Ankhwiz 0.7.1';

const fileName = (name: string, ext: string) =>
  `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'deck'}.${ext}`;

function missingNote(missing: string[]): string {
  return missing.length ? plural(' {n} media file was not on this device and were left out.', ' {n} media files were not on this device and were left out.', missing.length) : '';
}

export async function exportApkg(deckId: string, withProgress: boolean): Promise<string> {
  await ensureDeck(deckId);
  const deck = snap(data.decks[deckId]);
  const result = await buildApkg(deck, snap(data.progress[deckId] ?? {}), withProgress, (n) => mediaBytes(deckId, n));
  const where = await saveBytes(fileName(deck.name, 'apkg'), result.bytes);
  return t('{notes} notes and {cards} cards exported for Anki{x}. {where}{missing}', { notes: result.notes, cards: result.cards, x: withProgress ? t(', with progress') : '', where, missing: missingNote(result.missing) });
}

export async function exportAnkh(deckId: string, withProgress: boolean): Promise<string> {
  await ensureDeck(deckId);
  const deck = snap(data.decks[deckId]);
  const result = await buildAnkh(deck, withProgress ? snap(data.progress[deckId] ?? {}) : null, (n) => mediaBytes(deckId, n), APP);
  const where = await saveBytes(fileName(deck.name, 'ankh'), result.bytes);
  return t('Deck saved as an Ankhwiz file{x}. {where}{missing}', { x: withProgress ? t(', with progress') : '', where, missing: missingNote(result.missing) });
}

/** An .ankh goes straight in; returns the new deck's id. */
export async function importAnkh(bytes: Uint8Array, withProgress = true): Promise<string> {
  const { deck, progress, media } = readAnkh(bytes);
  return addImported(deck, withProgress && progress ? progress : {}, media);
}

/** Save the whole library as one .ankhlib file. */
export async function backupLibrary(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  // Every deck's notes go in the file, so decks not opened yet are read first.
  await ensureAll();
  const r = await buildLibrary(snap(data), mediaBytes, APP);
  const where = await saveBytes(`ankhwiz-library-${day}.ankhlib`, r.bytes);
  if (!where.startsWith('The file could not')) markBackedUp();
  return plural('{n} deck backed up with progress and settings. {where}{x2}', '{n} decks backed up with progress and settings. {where}{x2}', r.decks, { where, x2: r.missing ? ` ${r.missing} media files were not on this device and were left out.` : '' });
}

/** Restore from an .ankhlib file: replace everything, or add the decks not already here. */
export async function restoreLibraryFile(bytes: Uint8Array, replace: boolean): Promise<string> {
  const lib = readLibrary(bytes);
  const r = await restoreLibrary(lib, replace);
  if (replace) return plural('Library restored: {n} deck, with progress and settings.', 'Library restored: {n} decks, with progress and settings.', r.added);
  return `${r.added} ${r.added === 1 ? 'deck' : 'decks'} added${r.skipped ? plural('; {n} already here was left as they are', '; {n} already here were left as they are', r.skipped) : ''}.`;
}

export { readLibrary };

/** Read an .apkg (in the background when the device allows). */
export const readPackage = readPackageAway;
/** The import screen was closed without importing. */
export const dropPackage = release;
export type { AnkiPackage, Mapping, SplitBy };

/** An .apkg goes in once its fields are mapped. Returns the new deck's id and how many notes were left out. */
/** Where an import has got to, for its progress bar. */
export interface ImportStep {
  stage: 'notes' | 'lessons' | 'media' | 'saving';
  done: number;
  total: number;
}

/** Lets the window draw (a progress bar, say) before the next long step. */
const breathe = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

export async function importPackage(
  pkg: AnkiPackage,
  mappings: Record<string, Mapping>,
  options: { withProgress: boolean; name: string; splitBy?: SplitBy; read?: { lang: string; langBack: string } | null; dropUnused?: boolean },
  onStep?: (s: ImportStep) => void,
): Promise<{ id: string; skipped: number; notes: number }> {
  const step = async (s: ImportStep) => {
    onStep?.(s);
    await breathe();
  };
  const worker = workerOf(pkg);
  if (worker) {
    // Built in the background: the window only takes in the finished deck.
    const r = await runInWorker(
      worker,
      {
        type: 'import',
        mappings: JSON.parse(JSON.stringify(mappings)) as Record<string, Mapping>,
        options: JSON.parse(JSON.stringify(options)) as typeof options,
        lessonSize: data.settings.lessonSize,
        dayOffsetMs: data.dayOffset * 86_400_000,
        taken: Object.keys(data.decks),
      },
      (s) => onStep?.(s),
    );
    release(pkg);
    const deck = JSON.parse(r.deck) as Deck;
    const id = addDeck(deck, JSON.parse(r.progress) as Progress);
    return { id, skipped: r.skipped, notes: Object.keys(deck.notes).length };
  }
  await step({ stage: 'notes', done: 0, total: pkg.notes.length });
  const { rows, skipped, notetypes, media } = packageRows(pkg, mappings, { withProgress: options.withProgress, splitBy: options.splitBy });
  await step({ stage: 'lessons', done: 0, total: rows.length });
  const build = { lessonSize: data.settings.lessonSize };
  const built = ankiImport(options.name || pkg.name, rows as RawNote[], build, pkg.crt);
  const progress = built.progress;
  // A plain copy: the mappings come from the import screen and must not be kept as they are.
  built.deck.anki = { notetypes: JSON.parse(JSON.stringify(notetypes)) as typeof notetypes };
  const deck = options.dropUnused ? dropUnused(built.deck).deck : built.deck;
  deck.options = { ...deck.options, bothWays: Object.values(notetypes).some((t) => t.bothWays) };
  if (options.read) deck.options.look = { ...deck.options.look, speak: 'on', lang: options.read.lang, langBack: options.read.langBack };
  const files: Record<string, Uint8Array> = {};
  for (const m of media) if (pkg.media[m]) files[m] = pkg.media[m];
  const total = Object.keys(files).length;
  if (total) await step({ stage: 'media', done: 0, total });
  let last = 0;
  const id = await addImported(deck, progress, files, async (done) => {
    // Redraw about every 2% of the files, not after each one.
    if (done === total || done - last >= Math.max(1, Math.floor(total / 50))) {
      last = done;
      await step({ stage: 'media', done, total });
    }
  });
  onStep?.({ stage: 'saving', done: 1, total: 1 });
  return { id, skipped, notes: Object.keys(deck.notes).length };
}

export { buildDeck };
