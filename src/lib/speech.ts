// Reading aloud with the device's own voices.
//
//   Desktop (Windows, Linux): tauri-plugin-tts, which speaks through the
//     system's synthesizer (Windows voices; speech-dispatcher on Linux).
//   Android: the system's TextToSpeech, through the app's bridge.
//   Browser: the Web Speech API.
//
// Nothing is downloaded and nothing leaves the device. A card is only read
// when the device has a voice for the deck's language; otherwise the caller
// is told, so it can suggest installing one rather than reading Spanish in an
// English voice.

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
interface SpeechBridge {
  speak?(text: string, lang: string): string;
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

function webVoice(lang: string): boolean | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // still loading
  return voices.some((v) => matches(v.lang, lang));
}

/** Read text aloud in a language, cutting off anything still being read. */
export async function speak(text: string, lang: string): Promise<SpeakResult> {
  if (!text.trim() || typeof window === 'undefined') return 'unavailable';
  const invoke = tauri();
  if (invoke) {
    const voices = await desktopVoices(invoke);
    if (voices) {
      if (lang && !voices.some((v) => matches(v.language, lang))) return 'no-voice';
      try {
        await invoke('plugin:tts|speak', { payload: { text, language: lang || null, queueMode: 'flush' } });
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
    window.speechSynthesis.speak(u);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

export function stopSpeaking(): void {
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
  if (bridge()) return 'Add the language’s voice in your phone’s settings, under Text-to-speech output.';
  if (tauri() && /Windows/i.test(navigator.userAgent)) return 'Add the language’s voice in Windows Settings, under Time & language › Speech.';
  if (tauri()) return 'Install a voice for the language for speech-dispatcher, such as espeak-ng or RHVoice.';
  return 'Your browser or system has no voice for this language.';
}
