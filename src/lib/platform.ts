// Platform services: the few things each shell does differently.
// The interface asks for a service here and never checks which build it is in.
//
//   desktop (Tauri)  commands in src-tauri/src/lib.rs
//   Android          the AnkhwizAndroid object from android/…/MainActivity.java
//   browser          plain web features, for the single-file and dev builds

import type { HttpRequest } from './core/types';

export interface HttpReply {
  /** HTTP status, or 0 when the service could not be reached. */
  status: number;
  body: string;
}

interface AndroidBridge {
  http(id: string, request: string): void;
  getSecret(name: string): string;
  setSecret(name: string, value: string): void;
  saveFile(name: string, text: string): string;
  saveBase64?(name: string, base64: string): string;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    AnkhwizAndroid?: AndroidBridge;
    __TAURI_INTERNALS__?: { invoke: Invoke };
    __ankhwizHttp?: (id: string, status: number, body: string) => void;
  }
}

const tauri = (): Invoke | null => window.__TAURI_INTERNALS__?.invoke ?? null;
const android = (): AndroidBridge | null => window.AnkhwizAndroid ?? null;

export type PlatformName = 'desktop' | 'android' | 'browser';
export function platform(): PlatformName {
  return tauri() ? 'desktop' : android() ? 'android' : 'browser';
}

// ---------- HTTP (used only for the AI connection the learner sets up) ----------

const waiting = new Map<string, (reply: HttpReply) => void>();
let counter = 0;

export async function http(request: HttpRequest): Promise<HttpReply> {
  const invoke = tauri();
  if (invoke) {
    try {
      return await invoke<HttpReply>('http_send', { ...request });
    } catch {
      return { status: 0, body: '' };
    }
  }
  const bridge = android();
  if (bridge) {
    window.__ankhwizHttp ??= (id, status, body) => {
      waiting.get(id)?.({ status, body });
      waiting.delete(id);
    };
    return new Promise((resolve) => {
      const id = `h${++counter}`;
      waiting.set(id, resolve);
      bridge.http(id, JSON.stringify(request));
    });
  }
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : request.body,
    });
    return { status: res.status, body: await res.text() };
  } catch {
    // A browser also lands here when the service does not allow calls from web pages.
    return { status: 0, body: '' };
  }
}

// ---------- secrets (the AI key stays on this device, outside decks and backups) ----------

const SECRET_PREFIX = 'ankhwiz-secret-';

export async function getSecret(name: string): Promise<string> {
  try {
    const invoke = tauri();
    if (invoke) return (await invoke<string | null>('key_get', { name })) ?? '';
    const bridge = android();
    if (bridge) return bridge.getSecret(name) ?? '';
    return localStorage.getItem(SECRET_PREFIX + name) ?? '';
  } catch {
    return '';
  }
}

/** Returns false when the device could not store the secret. */
export async function setSecret(name: string, value: string): Promise<boolean> {
  try {
    const invoke = tauri();
    if (invoke) await (value ? invoke('key_set', { name, value }) : invoke('key_delete', { name }));
    else if (android()) android()!.setSecret(name, value);
    else if (value) localStorage.setItem(SECRET_PREFIX + name, value);
    else localStorage.removeItem(SECRET_PREFIX + name);
    return true;
  } catch {
    return false;
  }
}

/** Where the key is kept, in words for the settings screen. */
export function secretHome(): string {
  switch (platform()) {
    case 'desktop':
      return "your computer's password store (Windows Credential Manager or the Linux keyring; a private file if there is none)";
    case 'android':
      return "this app's private storage, encrypted with a key from the Android Keystore";
    default:
      return "this browser's storage for this page, which is not encrypted";
  }
}

// ---------- saving a file ----------

/** Saves text as a file. Returns a sentence saying where it went. */
export async function saveFile(name: string, text: string): Promise<string> {
  try {
    const invoke = tauri();
    if (invoke) return `Saved to ${await invoke<string>('save_file', { name, contents: text })}.`;
    const bridge = android();
    if (bridge) return bridge.saveFile(name, text);
  } catch {
    return 'The file could not be saved.';
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'Sent to your downloads. If nothing arrived, this view blocks downloads; use the desktop or Android app.';
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Saves binary data (an exported deck) as a file. Returns a sentence saying where it went. */
export async function saveBytes(name: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<string> {
  try {
    const invoke = tauri();
    if (invoke) return `Saved to ${await invoke<string>('save_bytes', { name, base64: toBase64(bytes) })}.`;
    const bridge = android();
    if (bridge?.saveBase64) return bridge.saveBase64(name, toBase64(bytes));
  } catch {
    return 'The file could not be saved.';
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'Sent to your downloads. If nothing arrived, this view blocks downloads; use the desktop or Android app.';
}
