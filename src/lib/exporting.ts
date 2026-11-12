// Exporting a deck as an .apkg (for Anki) or an .ankh (for Ankhwiz), and
// importing either kind of file into the library.

import { ankiImport, buildDeck } from './core';
import type { RawNote } from './core/types';
import { buildAnkh, readAnkh } from './export/ankh';
import { buildApkg } from './export/apkg';
import { packageRows, readPackage, type AnkiPackage, type Mapping } from './import/apkg';
import { mediaBytes } from './media';
import { saveBytes } from './platform';
import { addImported, data, snap } from './store.svelte';

export const APP = 'Ankhwiz 0.3.0';

const fileName = (name: string, ext: string) =>
  `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'deck'}.${ext}`;

function missingNote(missing: string[]): string {
  return missing.length ? ` ${missing.length} media ${missing.length === 1 ? 'file was' : 'files were'} not on this device and were left out.` : '';
}

export async function exportApkg(deckId: string, withProgress: boolean): Promise<string> {
  const deck = snap(data.decks[deckId]);
  const result = await buildApkg(deck, snap(data.progress[deckId] ?? {}), withProgress, (n) => mediaBytes(deckId, n));
  const where = await saveBytes(fileName(deck.name, 'apkg'), result.bytes);
  return `${result.notes} notes and ${result.cards} cards exported for Anki${withProgress ? ', with progress' : ''}. ${where}${missingNote(result.missing)}`;
}

export async function exportAnkh(deckId: string, withProgress: boolean): Promise<string> {
  const deck = snap(data.decks[deckId]);
  const result = await buildAnkh(deck, withProgress ? snap(data.progress[deckId] ?? {}) : null, (n) => mediaBytes(deckId, n), APP);
  const where = await saveBytes(fileName(deck.name, 'ankh'), result.bytes);
  return `Deck saved as an Ankhwiz file${withProgress ? ', with progress' : ''}. ${where}${missingNote(result.missing)}`;
}

/** An .ankh goes straight in; returns the new deck's id. */
export async function importAnkh(bytes: Uint8Array, withProgress = true): Promise<string> {
  const { deck, progress, media } = readAnkh(bytes);
  return addImported(deck, withProgress && progress ? progress : {}, media);
}

export { readPackage };
export type { AnkiPackage, Mapping };

/** An .apkg goes in once its fields are mapped. Returns the new deck's id and how many notes were left out. */
export async function importPackage(
  pkg: AnkiPackage,
  mappings: Record<string, Mapping>,
  options: { withProgress: boolean; bothWays: boolean; name: string },
): Promise<{ id: string; skipped: number; notes: number }> {
  const { rows, skipped, notetypes, media } = packageRows(pkg, mappings, options.withProgress);
  const build = { lessonSize: data.settings.lessonSize };
  const { deck, progress } = ankiImport(options.name || pkg.name, rows as RawNote[], build, pkg.crt);
  deck.anki = { notetypes };
  deck.options = { ...deck.options, bothWays: options.bothWays };
  const files: Record<string, Uint8Array> = {};
  for (const m of media) if (pkg.media[m]) files[m] = pkg.media[m];
  const id = await addImported(deck, progress, files);
  return { id, skipped, notes: Object.keys(deck.notes).length };
}

export { buildDeck };
