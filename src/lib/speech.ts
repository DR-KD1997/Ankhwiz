// Reading aloud with the device's own voices.
//
//   Desktop (Windows, Linux): tauri-plugin-tts, which speaks through the
//     system's synthesizer (Windows voices; speech-dispatcher on Linux).
//   Android: the system's TextToSpeech, through the app's bridge.
//   Browser: the Web Speech API.
//
// Piper voices (piper.ts) can be downloaded for a language in Settings; when
// one is chosen it reads that language instead of the device's voice.
//
// Nothing is downloaded unless asked for, and nothing leaves the device. A card is only read
// when the device has a voice for the deck's language; otherwise the caller
// is told, so it can suggest installing one rather than reading Spanish in an
// English voice.

import { piperSpeak, piperStop } from './piper';
import { data } from './store.svelte';
import { t } from './i18n';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
/** The downloaded Piper voice chosen for a language, if any. */
export function piperFor(lang: string): string | null {
  const chosen = data.settings.piperVoices ?? {};
  const l = lang.replace('_', '-').toLowerCase();
  if (!l) return null;
  if (chosen[l]) return chosen[l];
  const base = l.split('-')[0];
  const near = Object.entries(chosen).find(([k]) => k.split('-')[0] === base);
  return near ? near[1] : null;
}

interface SpeechBridge {
  speechEngines?(): string;
  setSpeechEngine?(name: string): void;
  openSpeechSettings?(): void;
  speak?(text: string, lang: string): string;
  /** Pieces as JSON [{text, lang}], queued one after another, each in its own language. */
  speakPieces?(json: string): string;
  stopSpeaking?(): void;
  voiceFor?(lang: string): string;
}
interface NativeVoice {
  id: string;
  name: string;
  language: string;
}

export type SpeakResult = 'ok' | 'no-voice' | 'unavailable';

const tauri = (): Invoke | null => (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__?.invoke ?? null;
const bridge = (): SpeechBridge | null => {
  const b = (window as unknown as { AnkhwizAndroid?: SpeechBridge }).AnkhwizAndroid;
  return b?.speak ? b : null;
};
const web = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Whether this device can read aloud at all. */
export function canSpeak(): boolean {
  if (typeof window === 'undefined') return false;
  return !!tauri() || !!bridge() || web();
}

/** "es-ES" and "es_ES" both match a deck set to "es-ES" or "es". */
const matches = (voiceLang: string, lang: string) => {
  const v = voiceLang.replace('_', '-').toLowerCase();
  const l = lang.replace('_', '-').toLowerCase();
  return !l || v === l || v.startsWith(`${l.split('-')[0]}-`) || v === l.split('-')[0];
};

let nativeVoices: Promise<NativeVoice[] | null> | null = null;
function desktopVoices(invoke: Invoke): Promise<NativeVoice[] | null> {
  nativeVoices ??= invoke<{ voices: NativeVoice[] }>('plugin:tts|get_voices', { payload: {} })
    .then((r) => (r.voices.length ? r.voices : null))
    .catch(() => null)
    .then((v) => {
      // An empty list can mean the speech service was still starting; ask again next time.
      if (!v) nativeVoices = null;
      return v;
    });
  return nativeVoices;
}

/** Whether the device has a voice for a language: true, false, or null when it cannot tell. */
export async function hasVoice(lang: string): Promise<boolean | null> {
  if (piperFor(lang)) return true;
  const invoke = tauri();
  if (invoke) {
    const voices = await desktopVoices(invoke);
    return voices ? voices.some((v) => matches(v.language, lang)) : web() ? webVoice(lang) : false;
  }
  const b = bridge();
  if (b?.voiceFor) {
    const r = b.voiceFor(lang);
    return r === 'yes' ? true : r === 'no' ? false : null;
  }
  return web() ? webVoice(lang) : false;
}

/** Names of this device's own voices for a language (empty when it has none, or cannot list them, as on Android). */
export async function deviceVoiceNames(lang: string): Promise<string[]> {
  const invoke = tauri();
  if (invoke) {
    const voices = await desktopVoices(invoke);
    if (voices) return [...new Set(voices.filter((v) => matches(v.language, lang)).map((v) => v.name))];
  }
  if (bridge()) return [];
  if (!web()) return [];
  return [...new Set(window.speechSynthesis.getVoices().filter((v) => matches(v.lang, lang)).map((v) => v.name))];
}

function webVoice(lang: string): boolean | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // still loading
  return voices.some((v) => matches(v.lang, lang));
}

/**
 * Read text aloud in a language, cutting off anything still being read.
 * `rate` slows it down (0.7) or speeds it up, where the device allows.
 */
export async function speak(text: string, lang: string, rate = 1): Promise<SpeakResult> {
  if (!text.trim() || typeof window === 'undefined') return 'unavailable';
  const mine = ++turn;
  const piper = piperFor(lang);
  if (piper) {
    stopDevice();
    piperStop();
    void piperSpeak(piper, text, rate).catch(() => {
      // The voice could not run here: read with the device's own instead.
      if (mine === turn) void deviceSpeak(text, lang, rate);
    });
    return 'ok';
  }
  return deviceSpeak(text, lang, rate);
}

async function deviceSpeak(text: string, lang: string, rate = 1): Promise<SpeakResult> {
  const invoke = tauri();
  if (invoke) {
    const voices = await desktopVoices(invoke);
    if (voices) {
      if (lang && !voices.some((v) => matches(v.language, lang))) return 'no-voice';
      try {
        await invoke('plugin:tts|speak', { payload: { text, language: lang || null, queueMode: 'flush', ...(rate !== 1 ? { rate } : {}) } });
        return 'ok';
      } catch {
        /* fall through to the web view's own voices */
      }
    }
  }
  const b = bridge();
  if (b?.speak) {
    const r = b.speak(text, lang);
    return r === 'ok' ? 'ok' : r === 'no-voice' ? 'no-voice' : 'unavailable';
  }
  if (!web()) return 'unavailable';
  try {
    if (lang && webVoice(lang) === false) return 'no-voice';
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    u.rate = rate;
    window.speechSynthesis.speak(u);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

// ---------- reading in turn ----------

/** Bumped by every new reading and by stopSpeaking, so an older reading stops part way. */
let turn = 0;

/** Waits for the desktop plugin to finish one utterance, or a generous time based on its length. */
async function finished(id: string | undefined, text: string): Promise<void> {
  const limit = 1500 + text.length * 110;
  if (!id) return new Promise((r) => setTimeout(r, limit));
  let unlisten: (() => void) | null = null;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, limit);
      const done = (e: { payload: { id?: string } }) => {
        if (e.payload?.id === id) {
          clearTimeout(timer);
          resolve();
        }
      };
      void Promise.all([listen('tts://speech:finish', done), listen('tts://speech:cancel', done), listen('tts://speech:error', done)]).then((fns) => {
        unlisten = () => fns.forEach((f) => f());
      });
    });
  } catch {
    await new Promise((r) => setTimeout(r, limit));
  } finally {
    (unlisten as (() => void) | null)?.();
  }
}

/**
 * Read pieces of text one after another, each in its own language, cutting
 * off anything still being read. A piece with no voice on this device is
 * skipped; the result names its language so the learner can add the voice.
 */
export async function speakPieces(parts: { text: string; lang: string }[]): Promise<{ result: SpeakResult; missing: string[] }> {
  const list = parts.filter((p) => p.text.trim());
  if (list.length <= 1) {
    const r = list.length ? await speak(list[0].text, list[0].lang) : 'unavailable';
    return { result: r, missing: r === 'no-voice' ? [list[0].lang] : [] };
  }
  const mine = ++turn;
  const langs = [...new Set(list.map((p) => p.lang).filter(Boolean))];
  const missing: string[] = [];
  for (const l of langs) if ((await hasVoice(l)) === false) missing.push(l);
  const readable = list.filter((p) => !missing.includes(p.lang));
  if (!readable.length) return { result: 'no-voice', missing };
  const outcome = (ok: boolean) => ({ result: (ok ? 'ok' : 'unavailable') as SpeakResult, missing });

  if (readable.some((p) => piperFor(p.lang))) {
    // Some pieces in a downloaded voice: each piece in turn, waiting for the one before.
    stopDevice();
    piperStop();
    for (const p of readable) {
      if (mine !== turn) break;
      const piper = piperFor(p.lang);
      try {
        if (piper) await piperSpeak(piper, p.text);
        else await deviceSpeakAndWait(p.text, p.lang);
      } catch {
        await deviceSpeakAndWait(p.text, p.lang);
      }
    }
    return outcome(true);
  }

  const invoke = tauri();
  if (invoke && (await desktopVoices(invoke))) {
    try {
      for (let i = 0; i < readable.length; i++) {
        if (mine !== turn) break;
        const p = readable[i];
        const r = await invoke<{ utteranceId?: string }>('plugin:tts|speak', { payload: { text: p.text, language: p.lang || null, queueMode: 'flush' } });
        if (i < readable.length - 1) await finished(r?.utteranceId, p.text);
      }
      return outcome(true);
    } catch {
      /* fall through */
    }
  }
  const b = bridge();
  if (b?.speakPieces) return outcome(b.speakPieces(JSON.stringify(readable)) === 'ok');
  if (b?.speak) return outcome(b.speak(readable.map((p) => p.text).join(' '), readable[0].lang) === 'ok');
  if (!web()) return outcome(false);
  try {
    // The browser queues utterances itself, each keeping its own language.
    window.speechSynthesis.cancel();
    for (const p of readable) {
      const u = new SpeechSynthesisUtterance(p.text);
      if (p.lang) u.lang = p.lang;
      window.speechSynthesis.speak(u);
    }
    return outcome(true);
  } catch {
    return outcome(false);
  }
}

/** Read one piece with the device's voice and wait until it has finished, as far as the device can say. */
async function deviceSpeakAndWait(text: string, lang: string): Promise<void> {
  const invoke = tauri();
  if (invoke && (await desktopVoices(invoke))) {
    try {
      const r = await invoke<{ utteranceId?: string }>('plugin:tts|speak', { payload: { text, language: lang || null, queueMode: 'flush' } });
      return finished(r?.utteranceId, text);
    } catch {
      /* fall through */
    }
  }
  const b = bridge();
  if (b?.speak) {
    b.speak(text, lang);
    // The phone does not report the end of a single reading here; allow for its length.
    return new Promise((r) => setTimeout(r, 900 + text.length * 85));
  }
  if (!web()) return;
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    u.onend = u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
    setTimeout(resolve, 1500 + text.length * 110);
  });
}

/** Stop the device's own voices (not a downloaded one). */
function stopDevice(): void {
  const invoke = tauri();
  if (invoke) void invoke('plugin:tts|stop').catch(() => undefined);
  bridge()?.stopSpeaking?.();
  if (web()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to stop */
    }
  }
}

// ---------- Android's speech engines ----------

export interface SpeechEngines {
  engines: { name: string; label: string }[];
  /** The phone's default engine. */
  current: string;
  /** The one chosen in Ankhwiz; empty for the phone's default. */
  chosen: string;
}

/** The phone's speech engines, on Android; null elsewhere. */
export function speechEngines(): SpeechEngines | null {
  const b = (window as unknown as { AnkhwizAndroid?: SpeechBridge }).AnkhwizAndroid;
  if (!b?.speechEngines) return null;
  try {
    const r = JSON.parse(b.speechEngines()) as Partial<SpeechEngines>;
    return { engines: r.engines ?? [], current: r.current ?? '', chosen: r.chosen ?? '' };
  } catch {
    return null;
  }
}

export function setSpeechEngine(name: string): void {
  (window as unknown as { AnkhwizAndroid?: SpeechBridge }).AnkhwizAndroid?.setSpeechEngine?.(name);
}

/** Opens the phone's text-to-speech settings, where voices are added. False when there are none to open. */
export function openSpeechSettings(): boolean {
  const b = (window as unknown as { AnkhwizAndroid?: SpeechBridge }).AnkhwizAndroid;
  if (!b?.openSpeechSettings) return false;
  b.openSpeechSettings();
  return true;
}

export function stopSpeaking(): void {
  turn++;
  piperStop();
  const invoke = tauri();
  if (invoke) void invoke('plugin:tts|stop').catch(() => undefined);
  bridge()?.stopSpeaking?.();
  if (web()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to stop */
    }
  }
}

/** Where to install a voice, for the hint shown when a language has none. */
export function voiceHelp(): string {
  if (bridge()) return t('Add the language’s voice in your phone’s settings, under Text-to-speech output.');
  if (tauri() && /Windows/i.test(navigator.userAgent)) return t('Add the language’s voice in Windows Settings, under Time & language › Speech.');
  if (tauri()) return t('Install a voice for the language for speech-dispatcher, such as espeak-ng or RHVoice.');
  return t('Your browser or system has no voice for this language.');
}
