// Media files (pictures and sounds) for cards, kept in the device's
// IndexedDB under the deck they belong to. Cards refer to files by name.

import { createStore, del, get, keys, set } from 'idb-keyval';

const store = createStore('ankhwiz-media', 'files');
const urls = new Map<string, string>();

const AUDIO = ['mp3', 'ogg', 'wav', 'm4a', 'opus', 'flac', 'aac', 'webm', 'oga'];
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
};
const VIDEO = ['mp4', 'm4v', 'mov'];

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isAudio = (name: string) => AUDIO.includes(ext(name));
/** A short video, shown like an animated picture: playing, looping and silent. */
export const isVideo = (name: string) => VIDEO.includes(ext(name));
/** A side that is only a picture or a sound comes from the core as
 * `[[picture:name]]` or `[[sound:name]]`: the kind and file name, or null. */
export function mediaToken(text: string | null | undefined): { kind: 'picture' | 'sound'; name: string } | null {
  const m = /^\[\[(picture|sound):(.+)\]\]$/.exec((text ?? '').trim());
  return m ? { kind: m[1] as 'picture' | 'sound', name: m[2] } : null;
}
/** Text to show or read aloud: nothing for a picture or sound standing in for text, or the "(picture)" left by an import. */
export const plainText = (text: string | null | undefined) => {
  const s = (text ?? '').trim();
  return mediaToken(s) || s === '(picture)' || s === '(listen)' ? '' : (text ?? '');
};
export const mimeOf = (name: string) => TYPES[ext(name)] ?? 'application/octet-stream';
const key = (deckId: string, name: string) => `${deckId}/${name}`;

export async function putMedia(deckId: string, name: string, bytes: Uint8Array | Blob): Promise<boolean> {
  try {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mimeOf(name) });
    await set(key(deckId, name), blob, store);
    const old = urls.get(key(deckId, name));
    if (old) URL.revokeObjectURL(old);
    urls.delete(key(deckId, name));
    return true;
  } catch {
    return false;
  }
}

export async function hasMedia(deckId: string, name: string): Promise<boolean> {
  try {
    return (await get(key(deckId, name), store)) !== undefined;
  } catch {
    return false;
  }
}

/** A name not yet used in the deck, based on the one given. */
export async function freeName(deckId: string, name: string): Promise<string> {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
  if (!(await hasMedia(deckId, clean))) return clean;
  const dot = clean.lastIndexOf('.');
  const [stem, tail] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${tail}`;
    if (!(await hasMedia(deckId, candidate))) return candidate;
  }
}

export async function mediaUrl(deckId: string, name: string): Promise<string | null> {
  const k = key(deckId, name);
  const cached = urls.get(k);
  if (cached) return cached;
  try {
    const blob = (await get(k, store)) as Blob | undefined;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(k, url);
    return url;
  } catch {
    return null;
  }
}

export async function mediaBytes(deckId: string, name: string): Promise<Uint8Array | null> {
  try {
    const blob = (await get(key(deckId, name), store)) as Blob | undefined;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function removeDeckMedia(deckId: string): Promise<void> {
  try {
    for (const k of await keys(store)) {
      if (String(k).startsWith(`${deckId}/`)) await del(k, store);
    }
  } catch {
    /* nothing stored */
  }
}
