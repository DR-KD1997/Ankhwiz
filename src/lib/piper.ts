// Piper voices: natural-sounding voices that run on the device, downloaded
// only when the learner asks for one. Nothing here is part of the app's own
// download: the speech engine (ONNX Runtime), the word-to-sound converter
// (piper-phonemize, with eSpeak's pronunciation data) and each voice are
// fetched once and kept on the device, then work offline.
//
//   Engine and converter, once:  about 30 MB
//   Each voice:                   about 20 to 65 MB
//
// Voices: the Piper project's own collection on Hugging Face (MIT licence for
// the code; each voice's licence is in its model card).

import { createStore, del, get, keys, set } from 'idb-keyval';

export const PIPER_SOURCES = {
  ort: 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/',
  phonemize: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/',
  voices: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/',
};

export interface PiperVoice {
  /** Piper's own name, such as es_ES-carlfm-x_low. */
  id: string;
  /** The language as Ankhwiz writes it, such as es-ES. */
  lang: string;
  name: string;
  /** Rough download size, in MB. */
  mb: number;
}

/** One or two voices for each language Piper speaks, the smaller ones first. */
export const PIPER_VOICES: PiperVoice[] = [
  ['ar_JO-kareem-low', 'Kareem', 63],
  ['ca_ES-upc_ona-x_low', 'Ona', 21],
  ['cs_CZ-jirka-low', 'Jirka', 63],
  ['da_DK-talesyntese-medium', 'Talesyntese', 63],
  ['de_DE-eva_k-x_low', 'Eva', 21],
  ['de_DE-thorsten-low', 'Thorsten', 63],
  ['el_GR-rapunzelina-low', 'Rapunzelina', 63],
  ['en_GB-alan-low', 'Alan', 63],
  ['en_GB-southern_english_female-low', 'Southern English', 63],
  ['en_US-lessac-low', 'Lessac', 63],
  ['en_US-amy-low', 'Amy', 63],
  ['es_ES-carlfm-x_low', 'Carlfm', 28],
  ['es_ES-davefx-medium', 'Davefx', 63],
  ['es_MX-ald-medium', 'Ald', 63],
  ['fa_IR-amir-medium', 'Amir', 63],
  ['fi_FI-harri-low', 'Harri', 63],
  ['fr_FR-siwis-low', 'Siwis', 28],
  ['fr_FR-gilles-low', 'Gilles', 63],
  ['hu_HU-anna-medium', 'Anna', 63],
  ['is_IS-bui-medium', 'Búi', 63],
  ['it_IT-riccardo-x_low', 'Riccardo', 28],
  ['ka_GE-natia-medium', 'Natia', 63],
  ['kk_KZ-iseke-x_low', 'Iseke', 28],
  ['lb_LU-marylux-medium', 'Marylux', 63],
  ['ne_NP-google-x_low', 'Google', 28],
  ['nl_BE-nathalie-x_low', 'Nathalie', 28],
  ['nl_NL-mls-medium', 'MLS', 63],
  ['no_NO-talesyntese-medium', 'Talesyntese', 63],
  ['pl_PL-darkman-medium', 'Darkman', 63],
  ['pt_BR-edresson-low', 'Edresson', 63],
  ['pt_PT-tugão-medium', 'Tugão', 63],
  ['ro_RO-mihai-medium', 'Mihai', 63],
  ['ru_RU-irina-medium', 'Irina', 63],
  ['sk_SK-lili-medium', 'Lili', 63],
  ['sl_SI-artur-medium', 'Artur', 63],
  ['sr_RS-serbski_institut-medium', 'Serbski institut', 63],
  ['sv_SE-nst-medium', 'NST', 63],
  ['sw_CD-lanfrica-medium', 'Lanfrica', 63],
  ['tr_TR-dfki-medium', 'DFKI', 63],
  ['uk_UA-lada-x_low', 'Lada', 21],
  ['vi_VN-vivos-x_low', 'Vivos', 21],
  ['zh_CN-huayan-x_low', 'Huayan', 21],
].map(([id, name, mb]) => ({ id: id as string, name: name as string, mb: mb as number, lang: (id as string).split('-')[0].replace('_', '-') }));

/** Where a voice's files live in the Piper collection: es_ES-carlfm-x_low → es/es_ES/carlfm/x_low/. */
export function voicePath(id: string): string {
  const [code, ...rest] = id.split('-');
  const quality = rest.pop()!;
  const speaker = rest.join('-');
  return `${code.split('_')[0]}/${code}/${speaker}/${quality}/${encodeURIComponent(id)}`;
}

/** Piper voices for a language: an exact match first, then others of the same language. */
export function piperVoicesFor(lang: string): PiperVoice[] {
  if (!lang) return [];
  const l = lang.replace('_', '-').toLowerCase();
  const base = l.split('-')[0];
  const exact = PIPER_VOICES.filter((v) => v.lang.toLowerCase() === l);
  const near = PIPER_VOICES.filter((v) => v.lang.toLowerCase() !== l && v.lang.toLowerCase().split('-')[0] === base);
  return [...exact, ...near];
}

const store = typeof indexedDB === 'undefined' ? undefined : createStore('ankhwiz-voices', 'files');
const ENGINE = [
  `${PIPER_SOURCES.ort}ort.wasm.min.js`,
  `${PIPER_SOURCES.ort}ort-wasm-simd.wasm`,
  `${PIPER_SOURCES.phonemize}piper_phonemize.js`,
  `${PIPER_SOURCES.phonemize}piper_phonemize.wasm`,
  `${PIPER_SOURCES.phonemize}piper_phonemize.data`,
];
const modelUrls = (id: string) => [`${PIPER_SOURCES.voices}${voicePath(id)}.onnx`, `${PIPER_SOURCES.voices}${voicePath(id)}.onnx.json`];

export type Progress = (done: number, total: number) => void;

/** A file from the device if it was downloaded before; otherwise fetched and kept. */
async function file(url: string, onBytes?: (n: number) => void): Promise<Blob> {
  const kept = store ? await get<Blob>(url, store) : undefined;
  if (kept) {
    onBytes?.(kept.size);
    return kept;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const reader = res.body?.getReader();
  let blob: Blob;
  if (!reader) blob = await res.blob();
  else {
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      onBytes?.(value.length);
    }
    blob = new Blob(parts as BlobPart[], { type: res.headers.get('Content-Type') ?? '' });
  }
  if (store) await set(url, blob, store);
  return blob;
}

/** Voice ids whose files are on this device. */
export async function downloadedVoices(): Promise<string[]> {
  if (!store) return [];
  const all = (await keys(store)).map(String);
  return PIPER_VOICES.filter((v) => modelUrls(v.id).every((u) => all.includes(u))).map((v) => v.id);
}

/** Download a voice, and the engine with the first voice. Reports megabytes so far and the expected total. */
export async function downloadVoice(id: string, onProgress?: Progress): Promise<void> {
  const v = PIPER_VOICES.find((x) => x.id === id);
  if (!v) throw new Error('Unknown voice.');
  const have = store ? (await keys(store)).map(String) : [];
  const needEngine = ENGINE.some((u) => !have.includes(u));
  const total = v.mb + (needEngine ? 30 : 0);
  let bytes = 0;
  const tick = (n: number) => {
    bytes += n;
    onProgress?.(Math.min(total, bytes / 1e6), total);
  };
  for (const u of [...(needEngine ? ENGINE : []), ...modelUrls(id)]) await file(u, tick);
  onProgress?.(total, total);
}

export async function removeVoice(id: string): Promise<void> {
  if (!store) return;
  for (const u of modelUrls(id)) await del(u, store);
  sessions.delete(id);
  // The engine goes too once no voice is left.
  if (!(await downloadedVoices()).length) for (const u of ENGINE) await del(u, store);
}

// ---------- speaking ----------

type Ort = {
  env: { wasm: { wasmPaths: unknown; numThreads: number } };
  InferenceSession: { create(model: ArrayBuffer): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> }> };
  Tensor: new (type: string, data: unknown, dims?: number[]) => unknown;
};
type Phonemizer = (opts: Record<string, unknown>) => Promise<{ callMain(args: string[]): void }>;

let ort: Ort | null = null;
let phonemizer: Phonemizer | null = null;
const urls = new Map<string, string>();
const sessions = new Map<string, Promise<{ session: Awaited<ReturnType<Ort['InferenceSession']['create']>>; config: VoiceConfig }>>();

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map?: Record<string, number>;
}

async function objectUrl(url: string): Promise<string> {
  if (!urls.has(url)) urls.set(url, URL.createObjectURL(await file(url)));
  return urls.get(url)!;
}

/** Runs a downloaded script (the engine or the converter), which defines a global. */
async function runScript(url: string): Promise<void> {
  const src = await objectUrl(url);
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The voice engine could not be started.'));
    document.head.appendChild(s);
  });
}

async function engine(): Promise<{ ort: Ort; phonemizer: Phonemizer }> {
  if (!ort) {
    await runScript(ENGINE[0]);
    ort = (window as unknown as { ort: Ort }).ort;
    ort.env.wasm.numThreads = 1;
    // The kept copy for most devices; older ones without SIMD fetch theirs from the source.
    ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': await objectUrl(ENGINE[1]), 'ort-wasm.wasm': `${PIPER_SOURCES.ort}ort-wasm.wasm` };
  }
  if (!phonemizer) {
    await runScript(ENGINE[2]);
    phonemizer = (window as unknown as { createPiperPhonemize: Phonemizer }).createPiperPhonemize;
  }
  return { ort, phonemizer };
}

function voice(id: string) {
  if (!sessions.has(id)) {
    const ready = (async () => {
      const { ort } = await engine();
      const [model, json] = modelUrls(id);
      const config = JSON.parse(await (await file(json)).text()) as VoiceConfig;
      const session = await ort.InferenceSession.create(await (await file(model)).arrayBuffer());
      return { session, config };
    })();
    ready.catch(() => sessions.delete(id));
    sessions.set(id, ready);
  }
  return sessions.get(id)!;
}

/** Text to Piper's sound ids, with eSpeak's pronunciation for the voice's language. */
async function phonemes(text: string, espeakVoice: string): Promise<number[]> {
  const { phonemizer } = await engine();
  const wasm = await objectUrl(ENGINE[3]);
  const data = await objectUrl(ENGINE[4]);
  return new Promise((resolve, reject) => {
    let got = false;
    void phonemizer({
      print: (line: string) => {
        got = true;
        resolve(JSON.parse(line).phoneme_ids);
      },
      printErr: (line: string) => {
        if (!got && /error/i.test(line)) reject(new Error(line));
      },
      locateFile: (f: string) => (f.endsWith('.wasm') ? wasm : f.endsWith('.data') ? data : f),
    })
      .then((m) => m.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']))
      .catch(reject);
  });
}

function wav(samples: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** Speech for a text in a downloaded voice, as a WAV file. */
export async function synthesize(id: string, text: string): Promise<Blob> {
  const { session, config } = await voice(id);
  const { ort } = await engine();
  const ids = await phonemes(text, config.espeak.voice);
  const feeds: Record<string, unknown> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w]), [3]),
  };
  if (config.speaker_id_map && Object.keys(config.speaker_id_map).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  return wav(out.output.data, config.audio.sample_rate);
}

let playing: HTMLAudioElement | null = null;

/** Speak in a downloaded voice; resolves when it has finished (or was stopped). */
export async function piperSpeak(id: string, text: string, rate = 1): Promise<void> {
  const audio = new Audio(URL.createObjectURL(await synthesize(id, text)));
  audio.playbackRate = rate;
  piperStop();
  playing = audio;
  await new Promise<void>((resolve) => {
    audio.onended = audio.onerror = audio.onpause = () => resolve();
    void audio.play().catch(() => resolve());
  });
  URL.revokeObjectURL(audio.src);
}

export function piperStop(): void {
  if (playing) {
    playing.pause();
    playing = null;
  }
}
