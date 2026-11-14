// The .ankh file: an Ankhwiz deck with everything Anki has no place for
// (lessons and units as built, card kinds, answers also accepted, wrong
// options, extra, labels, deck options, reading passages, the Anki note
// types it came with) and, if wanted, its progress and its media.
//
//   manifest.json   format, version, what is inside
//   deck.json       the deck
//   progress.json   progress, when included
//   media/<name>    pictures and sounds

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Deck, Progress } from '../core/types';

export const ANKH_VERSION = 1;

export interface AnkhManifest {
  format: 'ankh';
  version: number;
  app: string;
  created: string;
  deck: string;
  progress: boolean;
  media: number;
}

export async function buildAnkh(
  deck: Deck,
  progress: Progress | null,
  mediaOf: (name: string) => Promise<Uint8Array | null>,
  app: string,
): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const names = new Set<string>();
  for (const n of Object.values(deck.notes)) [...(n.qmedia ?? []), ...(n.amedia ?? []), ...(n.occlusion ? [n.occlusion.image] : [])].forEach((m) => names.add(m));
  const files: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  for (const name of names) {
    const bytes = await mediaOf(name);
    if (bytes) files[`media/${name}`] = bytes;
    else missing.push(name);
  }
  const manifest: AnkhManifest = {
    format: 'ankh',
    version: ANKH_VERSION,
    app,
    created: new Date().toISOString(),
    deck: deck.name,
    progress: progress !== null,
    media: names.size - missing.length,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['deck.json'] = strToU8(JSON.stringify(deck));
  if (progress) files['progress.json'] = strToU8(JSON.stringify(progress));
  return { bytes: zipSync(files, { level: 6 }), missing };
}

export interface AnkhContents {
  manifest: AnkhManifest;
  deck: Deck;
  progress: Progress | null;
  media: Record<string, Uint8Array>;
}

export function readAnkh(bytes: Uint8Array): AnkhContents {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This file is not a readable .ankh deck.');
  }
  const json = <T>(name: string): T | null => {
    const f = files[name];
    if (!f) return null;
    try {
      return JSON.parse(strFromU8(f)) as T;
    } catch {
      throw new Error(`Part of this .ankh file (${name}) is damaged.`);
    }
  };
  const manifest = json<AnkhManifest>('manifest.json');
  if (manifest?.format !== 'ankh') throw new Error('This file is not an Ankhwiz deck.');
  if (manifest.version > ANKH_VERSION) throw new Error('This deck was saved by a newer Ankhwiz. Update Ankhwiz to open it.');
  const deck = json<Deck>('deck.json');
  if (!deck?.notes || !deck.units) throw new Error('This .ankh file has no deck in it.');
  const media: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) if (name.startsWith('media/') && name.length > 6) media[name.slice(6)] = data;
  return { manifest, deck, progress: json<Progress>('progress.json'), media };
}
