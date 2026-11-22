// "Prepare for Ankhwiz": makes an imported deck ready for what Ankhwiz adds,
// in one go. Each step runs on this device, or asks Thoth (the AI
// connection), or both. Results are kept as data in the deck (`deck.prep`):
// what this device found is applied at once and can be undone until it is
// reviewed; what Thoth suggests waits for the learner's OK. A backup is made
// first. Running again only looks at cards added or changed since.
//
// The run goes on in the background: the learner can keep studying. Its
// progress is shown wherever the deck is open.

import { aiReady, ask } from './ai.svelte';
import type { Deck, Note, PrepPatch, PrepState, Reading, Suggestion } from './core/types';
import { detectLanguage } from './detect';
import { unusedReport } from './fields';
import { language, plural, t } from './i18n';
import { COMMON_LANGS, langName } from './languages';
import { addLink, deviceLinks, linkable } from './links';
import { studiedWords } from './practice';
import {
  data,
  deleteUnusedFields,
  editDeck,
  ensureDeck,
  makeBackup,
  setDeckExtras,
  setDeckLinks,
  setDeckOptions,
  setDeckPlace,
} from './store.svelte';

export type StepId = 'lang' | 'place' | 'fields' | 'answers' | 'wrong' | 'lessons' | 'notes' | 'stories' | 'check';
export type How = 'device' | 'both' | 'ai' | 'content';

/** The steps, in the order they run. Names are English, shown through t(). */
export const STEPS: { id: StepId; name: string; how: How }[] = [
  { id: 'lang', name: t('Languages and voices'), how: 'device' },
  { id: 'place', name: t('Its place in your library'), how: 'both' },
  { id: 'fields', name: t('Unused card fields'), how: 'device' },
  { id: 'answers', name: t('Answers that mean the same'), how: 'both' },
  { id: 'wrong', name: t('Fairer wrong options'), how: 'ai' },
  { id: 'lessons', name: t('Lesson names'), how: 'ai' },
  { id: 'notes', name: t('Notes on similar answers'), how: 'content' },
  { id: 'stories', name: t('Stories for reading rounds'), how: 'content' },
  { id: 'check', name: t('Check for doubtful cards'), how: 'ai' },
];

export const needsAi = (how: How) => how === 'ai' || how === 'content';

/** The steps ticked by each choice at the top of the plan. */
export function presetSteps(preset: 'device' | 'full'): StepId[] {
  return STEPS.filter((s) => (preset === 'device' ? !needsAi(s.how) : s.how !== 'content')).map((s) => s.id);
}

// ---------- what to look at ----------

/** A short fingerprint of a card's question and answer (FNV-1a). */
export function fingerprint(n: Note): string {
  let h = 0x811c9dc5;
  const text = `${n.front}\u0001${n.back}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Notes in path order. */
function ordered(deck: Deck): string[] {
  const out: string[] = [];
  for (const u of deck.units) for (const l of u.lessonIds) for (const n of deck.lessons[l]?.noteIds ?? []) if (deck.notes[n]) out.push(n);
  for (const id of Object.keys(deck.notes)) if (!out.includes(id)) out.push(id);
  return out;
}

/** Notes added or changed since the deck was last prepared (all, the first time). */
export function changedNotes(deck: Deck): string[] {
  const seen = deck.prep?.seen;
  return ordered(deck).filter((id) => !seen || seen[id] !== fingerprint(deck.notes[id]));
}

const GENERIC_LESSON = /^(lesson|deck|unit|part)\s*\d+$/i;
const WINDOW = 150;
const STEP = 125;
const BATCH = 30;

/** Windows of notes for finding answers that mean the same: neighbours in the path, where synonyms usually sit. */
function windows(deck: Deck, changed: Set<string>): string[][] {
  const all = ordered(deck).filter((id) => linkable(deck.notes[id]));
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += STEP) {
    const w = all.slice(i, i + WINDOW);
    if (w.some((id) => changed.has(id))) out.push(w);
    if (i + WINDOW >= all.length) break;
  }
  return out;
}

const batches = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** How many requests each step would send. */
export function estimate(deck: Deck, steps: StepId[]): { per: Partial<Record<StepId, number>>; total: number; minutes: number } {
  const ai = aiReady();
  const changed = changedNotes(deck);
  const forward = changed.filter((id) => linkable(deck.notes[id]));
  const per: Partial<Record<StepId, number>> = {};
  if (ai) {
    per.answers = windows(deck, new Set(changed)).length;
    const improve = Math.ceil(forward.length / BATCH);
    per.wrong = improve;
    per.check = steps.includes('wrong') ? 0 : improve;
    per.lessons = Object.values(deck.lessons).some((l) => GENERIC_LESSON.test(l.name.trim())) ? 1 : 0;
    const close = (deck.links ?? []).filter((l) => l.kind === 'close' && !l.note).length;
    per.notes = Math.max(1, Math.ceil(close / BATCH));
    per.stories = 3;
    per.place = deck.place?.subject || placeOnDevice(deck) ? 0 : 1;
  }
  const total = steps.reduce((n, s) => n + (per[s] ?? 0), 0);
  return { per, total, minutes: Math.max(1, Math.round(1 + total / 40)) };
}

// ---------- the run ----------

type StepState = 'waiting' | 'running' | 'done' | 'skipped' | 'failed' | 'stopped';

/** The run in progress (one at a time), shown wherever its deck is open. */
export const job = $state({
  deckId: '',
  running: false,
  paused: false,
  stopping: false,
  steps: [] as { id: StepId; state: StepState; detail: string; done?: number; of?: number }[],
});

class Stopped extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function gate(): Promise<void> {
  while (job.paused && !job.stopping) await sleep(250);
  if (job.stopping) throw new Stopped();
}

/** Run tasks a few at a time, in order of starting, stopping between them when asked. */
async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>, each: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      await gate();
      const i = next++;
      out[i] = await run(items[i]);
      each(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

const uid = () => `p${Math.random().toString(36).slice(2, 9)}`;

function prepOf(deckId: string): PrepState {
  return structuredClone($state.snapshot(data.decks[deckId]?.prep ?? null) ?? { at: 0 }) as PrepState;
}
function savePrep(deckId: string, prep: PrepState): void {
  setDeckExtras(deckId, { prep });
}

/** Where a deck goes, from its Anki name ("Languages::Turkish::Phrases") or its languages. */
/** Whether a word is the name of a language, in English or in the app's language. */
function isLanguageName(word: string): boolean {
  const w = word.toLocaleLowerCase();
  const codes = [...new Set(COMMON_LANGS.map((c) => c.split('-')[0]))];
  for (const loc of ['en', language()]) {
    try {
      const names = new Intl.DisplayNames([loc], { type: 'language' });
      if (codes.some((c) => names.of(c)?.toLocaleLowerCase() === w)) return true;
    } catch {
      // No language names here.
    }
  }
  return false;
}

export function placeOnDevice(deck: Deck): { subject: string; topic: string; from: 'name' | 'lang' } | null {
  const parts = deck.name.split('::').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // "Turkish::Phrases": a language first means Languages › Turkish.
    if (isLanguageName(parts[0])) return { subject: t('Languages'), topic: parts[0], from: 'name' };
    return { subject: parts[0], topic: parts.length >= 3 ? parts[1] : '', from: 'name' };
  }
  const { lang, langBack } = deck.options.look;
  const q = lang.split('-')[0];
  const a = (langBack || '').split('-')[0];
  if (q && a && q !== a) return { subject: t('Languages'), topic: langName(lang).replace(/\s*\(.*\)$/, ''), from: 'lang' };
  return null;
}

export function stepName(id: StepId): string {
  return t(STEPS.find((s) => s.id === id)?.name ?? id);
}

/**
 * Prepare a deck. Resolves when the run ends (finished, stopped or failed);
 * the results are in `deck.prep`.
 */
export async function runPrepare(deckId: string, steps: StepId[]): Promise<void> {
  if (job.running) return;
  await ensureDeck(deckId);
  const ai = aiReady() && data.ai.noticeSeen;
  job.deckId = deckId;
  job.running = true;
  job.paused = false;
  job.stopping = false;
  job.steps = STEPS.filter((s) => steps.includes(s.id)).map((s) => ({ id: s.id, state: 'waiting', detail: '' }));
  makeBackup(deckId, t('Before preparing for Ankhwiz'));
  const prep = prepOf(deckId);
  prep.applied = [];
  prep.pending = prep.pending ?? [];
  prep.unfinished = [];
  prep.dismissed = false;
  const deckNow = () => data.decks[deckId];
  const changed = changedNotes(deckNow());
  const changedSet = new Set(changed);
  /** Groups Thoth found close in this run, for the notes step. */
  let newClose: string[][] = [];
  let improve: Suggestion[] | null = null;
  let stopped = false;

  const set = (id: StepId, state: StepState, detail = '', done?: number, of?: number) => {
    const s = job.steps.find((x) => x.id === id);
    if (s) Object.assign(s, { state, detail, done, of });
  };

  async function runImprove(id: StepId): Promise<Suggestion[]> {
    if (improve) return improve;
    const ids = changed.filter((n) => linkable(deckNow().notes[n]));
    const groups = batches(ids, BATCH);
    set(id, 'running', '', 0, groups.length);
    const results = await pool(groups, 3, (g) => ask<Suggestion[]>('improve', deckNow(), { noteIds: g }).catch(() => [] as Suggestion[]), (d) => set(id, 'running', '', d, groups.length));
    improve = results.flat();
    return improve;
  }

  const handlers: Record<StepId, () => Promise<string>> = {
    async lang() {
      const deck = deckNow();
      const look = deck.options.look;
      const notes = Object.values(deck.notes).filter((n) => !n.occlusion);
      const fronts = notes.map((n) => (n.cloze ? n.front : n.front));
      const backs = notes.filter((n) => !n.cloze).map((n) => n.back);
      const lang = look.lang || detectLanguage(fronts);
      let langBack = look.langBack || detectLanguage(backs);
      if (langBack && lang && langBack.split('-')[0] === lang.split('-')[0]) langBack = '';
      if ((lang === look.lang && langBack === (look.langBack ?? '')) || !lang) return lang ? t('Already set') : t('Could not tell; choose them in Deck options');
      const patch: PrepPatch = { kind: 'lang', id: uid(), lang, langBack, prev: { lang: look.lang, langBack: look.langBack ?? '', speak: look.speak } };
      setDeckOptions(deckId, { look: { ...look, lang, langBack, speak: 'on' } });
      prep.applied!.push(patch);
      return langBack ? `${langName(lang)} → ${langName(langBack)}` : langName(lang);
    },
    async place() {
      const deck = deckNow();
      if (deck.place?.subject) return t('Already sorted');
      let where: { subject: string; topic: string; from: 'name' | 'lang' | 'thoth' } | null = placeOnDevice(deck);
      if (!where && ai) {
        const existing = [...new Set(Object.values(data.decks).flatMap((d) => (d.place?.subject ? [d.place.subject, d.place.topic ?? ''] : [])).filter(Boolean))];
        const r = await ask<{ subject: string; topic: string }>('place', deck, { existing });
        where = { ...r, from: 'thoth' };
      }
      if (!where) return t('Could not tell; sort it from the library');
      setDeckPlace(deckId, where.subject, where.topic);
      prep.applied!.push({ kind: 'place', id: uid(), ...where });
      return where.topic ? `${where.subject} › ${where.topic}` : where.subject;
    },
    async fields() {
      const report = unusedReport(deckNow());
      if (!report.length) return t('None');
      const names = report.flatMap((r) => r.names);
      const notes = report.reduce((n, r) => n + r.notes, 0);
      prep.pending!.push({ kind: 'dropFields', id: uid(), names, notes });
      return plural('{n} field to check', '{n} fields to check', names.length);
    },
    async answers() {
      const device = deviceLinks(deckNow());
      let made: string[] = [];
      if (device.length) {
        let links = deckNow().links ?? [];
        const before = new Set(links.map((l) => l.id));
        for (const g of device) links = addLink(links, g.notes, 'same', 'device');
        made = links.filter((l) => !before.has(l.id)).map((l) => l.id);
        setDeckLinks(deckId, links);
        prep.applied!.push({ kind: 'links', id: uid(), by: 'device', groups: device, made });
      }
      let found = 0;
      if (ai) {
        const ws = windows(deckNow(), changedSet);
        set('answers', 'running', '', 0, ws.length);
        const results = await pool(
          ws,
          3,
          (w) => ask<{ kind: 'same' | 'close'; notes: string[] }[]>('linkAnswers', deckNow(), { noteIds: w }).catch(() => []),
          (d) => set('answers', 'running', '', d, ws.length),
        );
        const linked = (a: string, b: string) => (deckNow().links ?? []).some((l) => l.notes.includes(a) && l.notes.includes(b));
        const seen = new Set<string>();
        const groups = results
          .flat()
          .filter((g) => !g.notes.every((a) => g.notes.every((b) => a === b || linked(a, b))))
          .filter((g) => {
            const k = `${g.kind}:${[...g.notes].sort().join(',')}`;
            return !seen.has(k) && seen.add(k);
          });
        if (groups.length) prep.pending!.push({ kind: 'links', id: uid(), by: 'thoth', groups });
        newClose = groups.filter((g) => g.kind === 'close').map((g) => g.notes);
        found = groups.length;
      }
      return [device.length ? plural('{n} link on this device', '{n} links on this device', device.length) : '', ai ? plural('{n} from Thoth to check', '{n} from Thoth to check', found) : '']
        .filter(Boolean)
        .join(' · ') || t('None found');
    },
    async wrong() {
      const list = await runImprove('wrong');
      const wrong: Record<string, string[]> = {};
      for (const s of list) if (s.wrong.length) wrong[s.noteId] = s.wrong;
      if (Object.keys(wrong).length) prep.pending!.push({ kind: 'wrong', id: uid(), wrong });
      addAlts(list);
      return plural('Wrong options for {n} card', 'Wrong options for {n} cards', Object.keys(wrong).length);
    },
    async check() {
      const list = await runImprove('check');
      const flags: Record<string, string> = {};
      for (const s of list) if (s.flag) flags[s.noteId] = s.flag;
      if (Object.keys(flags).length) prep.pending!.push({ kind: 'flags', id: uid(), flags });
      addAlts(list);
      return plural('{n} card looks doubtful', '{n} cards look doubtful', Object.keys(flags).length);
    },
    async lessons() {
      const deck = deckNow();
      if (!Object.values(deck.lessons).some((l) => GENERIC_LESSON.test(l.name.trim()))) return t('Already named');
      const names = await ask<Record<string, string>>('lessons', deck);
      const changedNames: Record<string, string> = {};
      for (const [id, name] of Object.entries(names)) if (deck.lessons[id] && GENERIC_LESSON.test(deck.lessons[id].name.trim()) && name.trim()) changedNames[id] = name.trim();
      if (Object.keys(changedNames).length) prep.pending!.push({ kind: 'lessons', id: uid(), names: changedNames });
      return plural('{n} lesson to name', '{n} lessons to name', Object.keys(changedNames).length);
    },
    async notes() {
      const deck = deckNow();
      const groups = [...(deck.links ?? []).filter((l) => l.kind === 'close' && !l.note).map((l) => l.notes), ...newClose];
      if (!groups.length) return t('No close pairs');
      const parts = batches(groups, BATCH);
      set('notes', 'running', '', 0, parts.length);
      const results = await pool(parts, 2, (g) => ask<string[]>('contrast', deckNow(), { groups: g }).catch(() => g.map(() => '')), (d) => set('notes', 'running', '', d, parts.length));
      const notes = parts.flatMap((g, i) => g.map((n, j) => ({ notes: n, note: results[i][j] ?? '' }))).filter((x) => x.note);
      if (notes.length) prep.pending!.push({ kind: 'notes', id: uid(), notes });
      return plural('{n} note written', '{n} notes written', notes.length);
    },
    async stories() {
      const deck = deckNow();
      let known = studiedWords(deck, data.progress[deckId] ?? {});
      if (known.length < 30) {
        // A deck not studied yet: the words of its first lessons.
        const first = ordered(deck).slice(0, 40).map((id) => deck.notes[id].front);
        known = [...new Set(first.join(' ').split(/[^\p{L}'’-]+/u).filter((w) => w.length > 1))].slice(0, 200);
      }
      if (known.length < 8) return t('Not enough words yet');
      const readings: Reading[] = [];
      for (let i = 0; i < 3; i++) {
        await gate();
        set('stories', 'running', '', i, 3);
        try {
          const r = await ask<Reading>('story', deckNow(), { known, count: 3 });
          readings.push({ ...r, ai: true, best: null });
        } catch {
          // One story fewer.
        }
      }
      if (readings.length) prep.pending!.push({ kind: 'stories', id: uid(), readings });
      return plural('{n} story', '{n} stories', readings.length);
    },
  };

  function addAlts(list: Suggestion[]) {
    if (!steps.includes('answers') || prep.pending!.some((p) => p.kind === 'alts' && p.id.startsWith('run'))) return;
    const alts: Record<string, string[]> = {};
    for (const s of list) if (s.alts.length) alts[s.noteId] = s.alts;
    if (Object.keys(alts).length) prep.pending!.push({ kind: 'alts', id: `run${uid()}`, alts });
  }

  for (const s of job.steps) {
    const info = STEPS.find((x) => x.id === s.id)!;
    if (stopped) {
      set(s.id, 'stopped', t('Not run'));
      prep.unfinished!.push(s.id);
      continue;
    }
    if (needsAi(info.how) && !ai) {
      set(s.id, 'skipped', t('Needs the AI connection'));
      continue;
    }
    try {
      await gate();
      set(s.id, 'running');
      const detail = await handlers[s.id]();
      set(s.id, 'done', detail);
    } catch (e) {
      if (e instanceof Stopped) {
        stopped = true;
        set(s.id, 'stopped', t('Stopped'));
      } else set(s.id, 'failed', e instanceof Error ? t(e.message) : String(e));
      prep.unfinished!.push(s.id);
    }
    savePrep(deckId, { ...prep });
  }
  // The pending "extra answers" of this run lose their marker.
  prep.pending = prep.pending!.map((p) => (p.kind === 'alts' && p.id.startsWith('run') ? { ...p, id: uid() } : p));
  prep.at = Date.now();
  if (!prep.unfinished!.length) {
    const deck = deckNow();
    prep.seen = Object.fromEntries(Object.values(deck.notes).map((n) => [n.id, fingerprint(n)]));
  }
  savePrep(deckId, prep);
  job.running = false;
  job.stopping = false;
  job.paused = false;
}

// ---------- reviewing ----------

/** A result as the review screen shows it: a title, a couple of examples, and every item (with a key to leave it out). */
export interface Described {
  title: string;
  examples: string[];
  items: { key: string; text: string; tag?: 'same' | 'close' }[];
  from: 'device' | 'thoth';
}

const pair = (deck: Deck, ids: string[]) =>
  ids
    .map((id) => deck.notes[id])
    .filter(Boolean)
    .map((n) => `“${n.back}”`)
    .join(' · ');

export function describe(deck: Deck, p: PrepPatch): Described {
  const n = (id: string) => deck.notes[id];
  switch (p.kind) {
    case 'lang':
      return { title: t('Languages: {q}{a}', { q: langName(p.lang), a: p.langBack ? ` → ${langName(p.langBack)}` : '' }), examples: [t('Reading aloud is on.')], items: [], from: 'device' };
    case 'place':
      return { title: t('Placed under {where}', { where: p.topic ? `${p.subject} › ${p.topic}` : p.subject }), examples: [p.from === 'name' ? t('From the deck’s Anki name') : p.from === 'lang' ? t('From its languages') : t('Suggested by Thoth')], items: [], from: p.from === 'thoth' ? 'thoth' : 'device' };
    case 'dropFields':
      return { title: plural('Delete the text of {n} unused field', 'Delete the text of {n} unused fields', p.names.length), examples: [t('{names}: in {count} cards, never shown.', { names: p.names.join(', '), count: p.notes })], items: [], from: 'device' };
    case 'links': {
      const items = p.groups.map((g, i) => ({ key: String(i), text: pair(deck, g.notes), tag: g.kind }));
      return {
        title: p.by === 'device' ? plural('{n} answer linked on this device', '{n} answers linked on this device', p.groups.length) : plural('{n} answer linked', '{n} answers linked', p.groups.length),
        examples: items.slice(0, 1).map((i) => `${i.text}: ${i.tag === 'same' ? t('same meaning') : t('close, never offered against each other')}`),
        items,
        from: p.by,
      };
    }
    case 'wrong': {
      const ids = Object.keys(p.wrong);
      const items = ids.map((id) => ({ key: id, text: `${n(id)?.front ?? ''}: ${p.wrong[id].join(', ')}` }));
      return { title: plural('Wrong options for {n} card', 'Wrong options for {n} cards', ids.length), examples: items.slice(0, 1).map((i) => i.text), items, from: 'thoth' };
    }
    case 'alts': {
      const ids = Object.keys(p.alts);
      const items = ids.map((id) => ({ key: id, text: `${n(id)?.front ?? ''} → ${n(id)?.back ?? ''}: ${p.alts[id].join(', ')}` }));
      return { title: plural('Extra right answers for {n} card', 'Extra right answers for {n} cards', ids.length), examples: items.slice(0, 1).map((i) => i.text), items, from: 'thoth' };
    }
    case 'flags': {
      const ids = Object.keys(p.flags);
      const items = ids.map((id) => ({ key: id, text: `${n(id)?.front ?? ''} → ${n(id)?.back ?? ''}: ${p.flags[id]}` }));
      return { title: plural('{n} card looks doubtful', '{n} cards look doubtful', ids.length), examples: [...items.slice(0, 1).map((i) => i.text), t('Kept: they get the label “thoth-check”, to find them in Cards.')], items, from: 'thoth' };
    }
    case 'lessons': {
      const ids = Object.keys(p.names);
      const items = ids.map((id) => ({ key: id, text: `${deck.lessons[id]?.name ?? ''} → ${p.names[id]}` }));
      return { title: plural('{n} lesson named by theme', '{n} lessons named by theme', ids.length), examples: items.slice(0, 1).map((i) => i.text), items, from: 'thoth' };
    }
    case 'notes': {
      const items = p.notes.map((x, i) => ({ key: String(i), text: `${pair(deck, x.notes)}: ${x.note}` }));
      return { title: plural('{n} note on similar answers', '{n} notes on similar answers', p.notes.length), examples: items.slice(0, 1).map((i) => i.text), items, from: 'thoth' };
    }
    case 'stories': {
      const items = p.readings.map((r, i) => ({ key: String(i), text: r.title }));
      return { title: plural('{n} story for reading rounds', '{n} stories for reading rounds', p.readings.length), examples: items.slice(0, 2).map((i) => i.text), items, from: 'thoth' };
    }
  }
}

/** Apply a result to the deck, leaving out the items whose keys are given. */
export function applyPatch(deckId: string, p: PrepPatch, skip: Set<string> = new Set()): void {
  const deck = data.decks[deckId];
  if (!deck) return;
  const keep = (k: string) => !skip.has(k);
  switch (p.kind) {
    case 'lang':
      setDeckOptions(deckId, { look: { ...deck.options.look, lang: p.lang, langBack: p.langBack, speak: 'on' } });
      break;
    case 'place':
      setDeckPlace(deckId, p.subject, p.topic);
      break;
    case 'dropFields':
      deleteUnusedFields(deckId);
      break;
    case 'links': {
      let links = deck.links ?? [];
      p.groups.forEach((g, i) => {
        if (keep(String(i))) links = addLink(links, g.notes.filter((id) => deck.notes[id]), g.kind, p.by);
      });
      setDeckLinks(deckId, links);
      break;
    }
    case 'wrong':
      editDeck(
        deckId,
        Object.entries(p.wrong)
          .filter(([id]) => keep(id) && deck.notes[id])
          .map(([noteId, w]) => ({ op: 'update' as const, noteId, wrong: [...new Set([...(deck.notes[noteId].wrong ?? []), ...w])].slice(0, 6) })),
        true,
      );
      break;
    case 'alts':
      editDeck(
        deckId,
        Object.entries(p.alts)
          .filter(([id]) => keep(id) && deck.notes[id])
          .map(([noteId, a]) => ({ op: 'update' as const, noteId, alts: [...new Set([...(deck.notes[noteId].alts ?? []), ...a])] })),
        true,
      );
      break;
    case 'flags':
      editDeck(
        deckId,
        Object.keys(p.flags)
          .filter((id) => keep(id) && deck.notes[id])
          .map((noteId) => ({ op: 'update' as const, noteId, labels: [...new Set([...(deck.notes[noteId].labels ?? []), 'thoth-check'])] })),
      );
      break;
    case 'lessons':
      editDeck(
        deckId,
        Object.entries(p.names)
          .filter(([id]) => keep(id) && deck.lessons[id])
          .map(([lessonId, name]) => ({ op: 'renameLesson' as const, lessonId, name })),
      );
      break;
    case 'notes': {
      let links = deck.links ?? [];
      p.notes.forEach((x, i) => {
        if (!keep(String(i))) return;
        const at = links.findIndex((l) => x.notes.filter((n) => l.notes.includes(n)).length >= 2);
        // Only for pairs still linked: a pair left out of the links gets no note.
        if (at >= 0) links = links.map((l, j) => (j === at ? { ...l, note: x.note } : l));
      });
      setDeckLinks(deckId, links);
      break;
    }
    case 'stories':
      setDeckExtras(deckId, { readings: [...(deck.readings ?? []), ...p.readings.filter((_, i) => keep(String(i)))] });
      break;
  }
}

/** Undo a result this device applied in the last run. */
function undoApplied(deckId: string, p: PrepPatch): void {
  const deck = data.decks[deckId];
  if (!deck) return;
  if (p.kind === 'lang') setDeckOptions(deckId, { look: { ...deck.options.look, ...p.prev } });
  else if (p.kind === 'place') setDeckPlace(deckId, '');
  else if (p.kind === 'links' && p.made) setDeckLinks(deckId, (deck.links ?? []).filter((l) => !p.made!.includes(l.id)));
}

/** Keep or drop a result waiting for review. */
export function settle(deckId: string, patchId: string, keepIt: boolean, skip: Set<string> = new Set()): void {
  const prep = prepOf(deckId);
  const p = prep.pending?.find((x) => x.id === patchId);
  if (!p) return;
  if (keepIt) applyPatch(deckId, p, skip);
  prep.pending = (prep.pending ?? []).filter((x) => x.id !== patchId);
  savePrep(deckId, { ...prepOf(deckId), pending: prep.pending });
}

/** Undo, or redo, a result applied on this device. Returns whether it is now undone. */
export function toggleApplied(deckId: string, patchId: string, undone: boolean): void {
  const p = prepOf(deckId).applied?.find((x) => x.id === patchId);
  if (!p) return;
  if (undone) undoApplied(deckId, p);
  else applyPatch(deckId, p);
}

/** The review is over: what was applied stays, and is no longer offered for undoing. */
export function closeReview(deckId: string): void {
  const prep = prepOf(deckId);
  savePrep(deckId, { ...prep, applied: [], unfinished: [] });
}

/** The learner said not now to the offer after importing. */
export function dismissOffer(deckId: string): void {
  savePrep(deckId, { ...prepOf(deckId), dismissed: true });
}

/** Whether to offer preparing on the deck screen: an imported deck never prepared, not dismissed. */
export function offerFor(deck: Deck): boolean {
  return !!deck.anki && !deck.prep?.at && !deck.prep?.dismissed && !(job.running && job.deckId === deck.id);
}
