// The .ankhlib file: the whole library in one file, for moving to another
// device or keeping safe. Each deck goes in as its own .ankh (with progress
// and media), beside the settings that belong to the learner. The AI key is
// never included: it stays in the device's key storage.
//
//   manifest.json      format, version, how many decks
//   library.json       settings, streak, reminders, tips and the like
//   decks/<id>.ankh    one per deck

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AppData } from '../store.svelte';
import { buildAnkh, readAnkh, type AnkhContents } from './ankh';
import { t } from '../i18n';

export const LIB_VERSION = 1;

/** What of the app's data travels in library.json (not decks, progress or the paused session). */
export type LibrarySettings = Pick<AppData, 'settings' | 'ai' | 'streak' | 'reminder' | 'tips' | 'testOuts' | 'celebrated'>;

export interface LibManifest {
  format: 'ankhlib';
  version: number;
  app: string;
  created: string;
  decks: number;
}

export async function buildLibrary(
  data: AppData,
  mediaOf: (deckId: string, name: string) => Promise<Uint8Array | null>,
  app: string,
): Promise<{ bytes: Uint8Array; decks: number; missing: number }> {
  const files: Record<string, Uint8Array> = {};
  let missing = 0;
  for (const deck of Object.values(data.decks)) {
    const r = await buildAnkh(deck, data.progress[deck.id] ?? {}, (n) => mediaOf(deck.id, n), app);
    files[`decks/${deck.id}.ankh`] = r.bytes;
    missing += r.missing.length;
  }
  const settings: LibrarySettings = {
    settings: data.settings,
    ai: data.ai,
    streak: data.streak,
    reminder: data.reminder,
    tips: data.tips,
    testOuts: data.testOuts,
    celebrated: data.celebrated,
  };
  const manifest: LibManifest = { format: 'ankhlib', version: LIB_VERSION, app, created: new Date().toISOString(), decks: Object.keys(data.decks).length };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['library.json'] = strToU8(JSON.stringify(settings));
  // Decks inside are already compressed.
  return { bytes: zipSync(files, { level: 0 }), decks: manifest.decks, missing };
}

export interface LibContents {
  manifest: LibManifest;
  settings: Partial<LibrarySettings>;
  decks: AnkhContents[];
}

export function readLibrary(bytes: Uint8Array): LibContents {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error(t('This file is not a readable Ankhwiz library.'));
  }
  const json = <T>(name: string): T | null => {
    const f = files[name];
    if (!f) return null;
    try {
      return JSON.parse(strFromU8(f)) as T;
    } catch {
      throw new Error(t('Part of this library file ({name}) is damaged.', { name }));
    }
  };
  const manifest = json<LibManifest>('manifest.json');
  if (manifest?.format !== 'ankhlib') throw new Error(t('This file is not an Ankhwiz library.'));
  if (manifest.version > LIB_VERSION) throw new Error(t('This library was saved by a newer Ankhwiz. Update Ankhwiz to open it.'));
  const decks = Object.entries(files)
    .filter(([name]) => name.startsWith('decks/') && name.endsWith('.ankh'))
    .map(([, b]) => readAnkh(b));
  return { manifest, settings: json<Partial<LibrarySettings>>('library.json') ?? {}, decks };
}
