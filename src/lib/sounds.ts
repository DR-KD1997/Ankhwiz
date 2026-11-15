// Answer sounds: four sets, each with a sound for a right answer, a nearly
// right one, a wrong one and the end of a lesson. Every sound is made on the
// spot with the Web Audio API, so the app carries no audio files and no
// licences. Sounds only follow a tap or a key, so web views allow them.

import { data } from './store.svelte';

export type SoundSet = 'marimba' | 'lyre' | 'bell' | 'pop';
export type Moment = 'right' | 'nearly' | 'wrong' | 'end';

export const SOUND_SETS: { id: SoundSet; name: string; about: string }[] = [
  { id: 'marimba', name: 'Reed marimba', about: 'Warm and wooden' },
  { id: 'lyre', name: 'Lyre', about: 'A plucked string' },
  { id: 'bell', name: 'Temple bell', about: 'A bell and a sistrum' },
  { id: 'pop', name: 'Soft pop', about: 'Round, bouncy blips' },
];

export const DEFAULT_SOUNDS: SoundSet = 'marimba';

/** The chosen set, or null when sounds are off. */
export function chosenSounds(): SoundSet | null {
  const s = data.settings.sounds ?? DEFAULT_SOUNDS;
  return s === 'off' ? null : s;
}

/** Play a moment's sound in the chosen set (nothing when sounds are off). */
export function playSound(moment: Moment): void {
  const set = chosenSounds();
  if (set) playFrom(set, moment);
}

/** Play a moment's sound from a given set, as Settings does to let you hear one. */
export function playFrom(set: SoundSet, moment: Moment): void {
  const c = audio();
  if (!c || !master) return;
  try {
    SETS[set][moment](c, master, c.currentTime + 0.02);
  } catch {
    /* audio unavailable */
  }
}

// ---------- plumbing ----------
type Ctx = BaseAudioContext;
type Out = AudioNode;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A seeded random, so a sound is the same every time. */
function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const noises = new WeakMap<Ctx, AudioBuffer>();
function noise(c: Ctx): AudioBuffer {
  let b = noises.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    const r = rng(7);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noises.set(c, b);
  }
  return b;
}

interface Partial {
  type?: OscillatorType;
  peak?: number;
  a?: number;
  d?: number;
  f2?: number;
}
/** One tone with a quick attack and an exponential fade; `f2` slides the pitch. */
function partial(c: Ctx, out: Out, t: number, f: number, { type = 'sine', peak = 0.3, a = 0.005, d = 0.4, f2 = 0 }: Partial = {}) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + Math.min(d, 0.12));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

/** A short band of filtered noise: mallet clicks, knocks, sistrum jingles. */
function hiss(c: Ctx, out: Out, t: number, { f = 6000, q = 4, peak = 0.1, d = 0.04, at = 0 } = {}) {
  const s = c.createBufferSource();
  const bp = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = noise(c);
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = q;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(bp);
  bp.connect(g);
  g.connect(out);
  s.start(t, at);
  s.stop(t + d + 0.02);
}

// ---------- voices ----------
function marimba(c: Ctx, out: Out, t: number, f: number, v = 1, damp = 1) {
  partial(c, out, t, f, { peak: 0.5 * v, a: 0.004, d: 0.55 * damp });
  partial(c, out, t, f * 3.93, { peak: 0.1 * v, a: 0.002, d: 0.09 * damp });
  hiss(c, out, t, { f: f * 6, q: 2, peak: 0.05 * v, d: 0.015 });
}

// A plucked string (Karplus–Strong), rendered once per pitch.
const plucks = new WeakMap<Ctx, Map<string, AudioBuffer>>();
function pluckBuffer(c: Ctx, f: number, bright: number, len: number): AudioBuffer {
  const key = `${f}:${bright}:${len}`;
  let m = plucks.get(c);
  if (!m) plucks.set(c, (m = new Map()));
  const have = m.get(key);
  if (have) return have;
  const sr = c.sampleRate;
  const n = Math.round(sr / f);
  const b = c.createBuffer(1, Math.round(sr * len), sr);
  const y = b.getChannelData(0);
  const r = rng(Math.round(f));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev += bright * (r() * 2 - 1 - prev);
    y[i] = prev;
  }
  for (let i = n; i < y.length; i++) y[i] = 0.996 * 0.5 * (y[i - n] + (y[i - n - 1] ?? 0));
  m.set(key, b);
  return b;
}
function lyre(c: Ctx, out: Out, t: number, f: number, v = 1, { bright = 0.55, len = 1, cut = 4200 } = {}) {
  const s = c.createBufferSource();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = pluckBuffer(c, f, bright, len);
  lp.type = 'lowpass';
  lp.frequency.value = cut;
  g.gain.setValueAtTime(0.6 * v, t);
  g.gain.setValueAtTime(0.6 * v, t + len * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(lp);
  lp.connect(g);
  g.connect(out);
  s.start(t);
}

function bell(c: Ctx, out: Out, t: number, f: number, v = 1, damp = 1) {
  const parts: [number, number, number][] = [
    [1, 0.32, 1.5],
    [2, 0.12, 1.0],
    [2.76, 0.1, 0.7],
    [4.07, 0.05, 0.45],
    [5.4, 0.035, 0.3],
  ];
  for (const [r, a, d] of parts) partial(c, out, t, f * r, { peak: a * v, a: 0.003, d: d * damp });
}
/** The sistrum: a few quick metallic jingles that die away. */
function sistrum(c: Ctx, out: Out, t: number, dur = 0.3, v = 1) {
  const r = rng(11);
  const hits = Math.round(dur * 26);
  for (let i = 0; i < hits; i++) {
    hiss(c, out, t + (i / hits) * dur + r() * 0.012, { f: 5500 + r() * 3500, q: 9, peak: 0.07 * v * (1 - i / hits), d: 0.03, at: r() * 0.5 });
  }
}

function pop(c: Ctx, out: Out, t: number, f1: number, f2: number, v = 1, d = 0.1) {
  partial(c, out, t, f1, { peak: 0.55 * v, a: 0.004, d, f2 });
  partial(c, out, t, f1 * 2, { type: 'triangle', peak: 0.05 * v, a: 0.004, d: d * 0.7, f2: f2 * 2 });
}

// ---------- the sets ----------
const N = {
  A2: 110, D3: 146.83, F3: 174.61, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, Cs5: 554.37, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5,
};

type Play = (c: Ctx, o: Out, t: number) => void;
// Nearly right uses the same voice as right with a smaller step and a softer
// touch; wrong is always low, short and soft.
const SETS: Record<SoundSet, Record<Moment, Play>> = {
  marimba: {
    right: (c, o, t) => (marimba(c, o, t, N.E5), marimba(c, o, t + 0.09, N.A5)),
    nearly: (c, o, t) => (marimba(c, o, t, N.D5, 0.6), marimba(c, o, t + 0.1, N.E5, 0.65)),
    wrong: (c, o, t) => (marimba(c, o, t, N.A3, 0.8, 0.45), marimba(c, o, t + 0.13, N.F3, 0.8, 0.45)),
    end: (c, o, t) => {
      [N.C5, N.D5, N.E5, N.G5, N.A5].forEach((f, i) => marimba(c, o, t + i * 0.085, f, 0.6));
      [N.C6, N.G5, N.E5].forEach((f) => marimba(c, o, t + 0.5, f, 0.5, 1.8));
    },
  },
  lyre: {
    right: (c, o, t) => (lyre(c, o, t, N.G4), lyre(c, o, t + 0.08, N.D5)),
    nearly: (c, o, t) => (lyre(c, o, t, N.D5, 0.55), lyre(c, o, t + 0.1, N.E5, 0.6)),
    wrong: (c, o, t) => (lyre(c, o, t, N.D3, 1.1, { bright: 0.3, len: 0.5, cut: 900 }), lyre(c, o, t + 0.14, N.A2, 1.1, { bright: 0.3, len: 0.6, cut: 700 })),
    end: (c, o, t) => {
      [N.G4, N.B4, N.D5, N.E5].forEach((f, i) => lyre(c, o, t + i * 0.075, f, 0.8));
      [N.G4, N.D5, N.G5, N.B5].forEach((f, i) => lyre(c, o, t + 0.45 + i * 0.025, f, 0.65, { len: 2 }));
    },
  },
  bell: {
    right: (c, o, t) => (bell(c, o, t, N.A5, 0.9, 0.7), sistrum(c, o, t + 0.02, 0.18, 0.7)),
    nearly: (c, o, t) => bell(c, o, t, N.E5, 0.6, 0.6),
    wrong: (c, o, t) => (bell(c, o, t, N.D4, 0.9, 0.25), hiss(c, o, t, { f: 300, q: 1, peak: 0.18, d: 0.06 })),
    end: (c, o, t) => {
      [N.A4, N.Cs5, N.E5, N.A5].forEach((f, i) => bell(c, o, t + i * 0.13, f, 0.55, 0.8));
      bell(c, o, t + 0.55, N.E6, 0.25, 1.2);
      sistrum(c, o, t + 0.5, 0.7, 1);
    },
  },
  pop: {
    right: (c, o, t) => (pop(c, o, t, N.C5, N.G5), pop(c, o, t + 0.1, N.G5, N.C6)),
    nearly: (c, o, t) => pop(c, o, t, N.D5, N.G5, 0.6, 0.12),
    wrong: (c, o, t) => (pop(c, o, t, N.E4, N.D4, 0.9, 0.14), pop(c, o, t + 0.15, N.C4, N.A3 * 0.9, 0.9, 0.22)),
    end: (c, o, t) => {
      [
        [N.C5, N.E5],
        [N.E5, N.G5],
        [N.G5, N.C6],
      ].forEach(([a, b], i) => pop(c, o, t + i * 0.11, a, b, 0.75));
      [N.C6, N.E5, N.G5].forEach((f) => {
        partial(c, o, t + 0.4, f, { peak: 0.22, a: 0.01, d: 0.9 });
        partial(c, o, t + 0.4, f * 2, { type: 'triangle', peak: 0.02, a: 0.01, d: 0.5 });
      });
    },
  },
};

/** For tests: every set has every moment. */
export const _sets = SETS;
