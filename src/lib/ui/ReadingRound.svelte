<script lang="ts">
  // The reading round: a short text to read, then a few questions on it.
  // With the AI connection, Thoth writes a story from the words the learner
  // has studied and it is kept for later, so stories can be prepared ahead
  // for times without a connection. Without one, the round is made from the
  // deck's own sentences and example fields. Nothing changes the schedule.
  import { aiReady, ask } from '../ai.svelte';
  import type { Reading, ReadingQuestion } from '../core/types';
  import { fold, knownWords, lookUp, offlineRound, studiedWords, words, type OfflineRound } from '../practice';
  import { speak } from '../speech';
  import { data, openPanel, setDeckExtras, snap, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Quiz from './Quiz.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const online = $derived(aiReady());
  const known = $derived(knownWords(deck, progress));
  /** Stories by Thoth not read yet: they work without a connection. */
  const prepared = $derived((deck.readings ?? []).filter((r) => r.ai && r.best == null));
  let unitId = $state('');

  type Shown = { kind: 'story'; reading: Reading } | { kind: 'cards'; round: OfflineRound };
  let shown = $state<Shown | null>(null);
  let quiz = $state(false);
  let score = $state<number | null>(null);
  let busy = $state('');
  let error = $state('');
  let word = $state<{ text: string; meaning: string } | { text: string; meaning: null } | null>(null);
  let revealed = $state<Set<number>>(new Set());

  const questions = $derived<ReadingQuestion[]>(shown?.kind === 'story' ? shown.reading.questions : shown?.kind === 'cards' ? shown.round.questions : []);
  const studiedList = () => studiedWords(deck, progress);

  async function writeStory(keep = false): Promise<Reading | null> {
    const r = await ask<Reading>('story', snap(deck), { known: studiedList(), count: 3 });
    const story = { ...r, ai: true, best: null };
    setDeckExtras(deck.id, { readings: [...(data.decks[deck.id].readings ?? []), story] });
    if (!keep) open({ kind: 'story', reading: story });
    return story;
  }

  async function newStory() {
    busy = 'Thoth is writing a story from the words you know…';
    error = '';
    try {
      await writeStory();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The story could not be written.';
    } finally {
      busy = '';
    }
  }

  async function prepare() {
    busy = 'Preparing three stories for later…';
    error = '';
    try {
      for (let i = 0; i < 3; i++) await writeStory(true);
    } catch (e) {
      error = e instanceof Error ? e.message : 'The stories could not be written.';
    } finally {
      busy = '';
    }
  }

  function fromCards() {
    error = '';
    const round = offlineRound(deck, progress, { unitId: unitId || undefined });
    if (!round) {
      error = 'There are not enough sentences made of words you have studied yet. Meet more cards, or let Thoth write a story.';
      return;
    }
    open({ kind: 'cards', round });
  }

  function open(s: Shown) {
    shown = s;
    quiz = false;
    score = null;
    word = null;
    revealed = new Set();
  }

  function finish(correct: number) {
    score = correct;
    quiz = false;
    if (shown?.kind === 'story') {
      const id = shown.reading.id;
      setDeckExtras(deck.id, { readings: (data.decks[deck.id].readings ?? []).map((r) => (r.id === id ? { ...r, best: Math.max(r.best ?? 0, correct) } : r)) });
    }
  }

  /** A passage as words and the spaces between them, each word marked as studied or new. */
  function tokens(text: string): { t: string; word: boolean; known: boolean }[] {
    const out: { t: string; word: boolean; known: boolean }[] = [];
    const re = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
    let at = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > at) out.push({ t: text.slice(at, m.index), word: false, known: false });
      out.push({ t: m[0], word: true, known: known.has(fold(m[0])) });
      at = m.index! + m[0].length;
    }
    if (at < text.length) out.push({ t: text.slice(at), word: false, known: false });
    return out;
  }
  function tap(w: string) {
    const hit = lookUp(deck, w);
    word = hit ?? { text: w, meaning: null };
  }
  const lang = $derived(deck.options.look.lang || '');
  const share = (text: string) => {
    const w = words(text);
    return w.length ? Math.round((w.filter((x) => known.has(fold(x))).length / w.length) * 100) : 0;
  };
</script>

<section class="read">
  <header>
    <button class="icon-btn" aria-label="Back" onclick={() => (shown ? (shown = null) : openPanel('practice'))}><Icon name="back" /></button>
    <h1 class="display">Reading round</h1>
  </header>

  {#if !shown}
    <p class="hint">A short text to read, then a few questions. Tap any word to see what it means on your cards. Practice only: nothing changes when your cards come back.</p>
    {#if online}
      <div class="choice card">
        <span class="grow"><strong>A new story by Thoth</strong><small>Written from the {known.size} words you have studied, with two or three new ones. Kept, so you can read it again.</small></span>
        <button class="quiet go" disabled={!!busy || known.size < 8} onclick={newStory}>Write</button>
      </div>
    {/if}
    {#if prepared.length}
      <p class="label">Ready to read{online ? '' : ' without a connection'}</p>
      {#each prepared as r (r.id)}
        <button class="choice card" onclick={() => open({ kind: 'story', reading: r })}>
          <span class="grow"><strong>{r.title}</strong><small>A story by Thoth · {share(r.passage)}% words you know</small></span>
          <Icon name="play" size={18} />
        </button>
      {/each}
    {/if}
    <div class="choice card">
      <span class="grow"
        ><strong>From your cards</strong><small>Sentences from your cards and their examples, made mostly of words you have studied, easiest first. Works without a connection.</small>
        {#if deck.units.length > 1}
          <select class="input" bind:value={unitId} aria-label="Unit">
            <option value="">The whole deck</option>
            {#each deck.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
          </select>
        {/if}
      </span>
      <button class="quiet go" onclick={fromCards}>Start</button>
    </div>
    {#if online}
      <button class="quiet" disabled={!!busy || known.size < 8} onclick={prepare}><Icon name="download" size={18} /> Prepare three stories for later</button>
    {:else}
      <p class="hint">Set up the AI connection in Settings and Thoth can write stories from the words you know, and prepare some for times without a connection.</p>
    {/if}
    {#if busy}<p class="hint" role="status">{busy}</p>{/if}
    {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
  {:else if quiz}
    <Quiz {questions} onDone={finish} />
  {:else}
    {#if shown.kind === 'story'}
      <article class="passage card" {lang}>
        <div class="top">
          <p class="label">{shown.reading.title}</p>
          {#if lang}<button class="icon-btn" aria-label="Read it to me" onclick={() => shown?.kind === 'story' && speak(shown.reading.passage, lang)}><Icon name="sound" /></button>{/if}
        </div>
        <p class="text">
          {#each tokens(shown.reading.passage) as tk, i (i)}{#if tk.word}<button class="tok" class:new={!tk.known} onclick={() => tap(tk.t)}>{tk.t}</button>{:else}{tk.t}{/if}{/each}
        </p>
        <p class="small">Underlined words are not on the cards you have studied yet.</p>
      </article>
    {:else}
      <ol class="sentences">
        {#each shown.round.sentences as s, i (i)}
          <li class="card" {lang}>
            <p class="text">
              {#each tokens(s.text) as tk, j (j)}{#if tk.word}<button class="tok" class:new={!tk.known} onclick={() => tap(tk.t)}>{tk.t}</button>{:else}{tk.t}{/if}{/each}
              {#if lang}<button class="icon-btn small-btn" aria-label="Read it to me" onclick={() => speak(s.text, lang)}><Icon name="sound" size={16} /></button>{/if}
            </p>
            {#if revealed.has(i)}<p class="small">{s.translation}</p>{:else}<button class="link" onclick={() => (revealed = new Set([...revealed, i]))}>Show the translation</button>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if word}
      <div class="word card" role="status">
        <strong>{word.text}</strong>
        <span>{word.meaning ?? 'Not on your cards yet.'}</span>
        <button class="icon-btn" aria-label="Close" onclick={() => (word = null)}><Icon name="close" size={16} /></button>
      </div>
    {/if}
    {#if score !== null}
      <p class="done card" role="status">{score} of {questions.length} right.</p>
      <div class="pair">
        <button class="quiet" onclick={() => (shown = null)}>Another round</button>
        <button class="primary" onclick={() => openPanel('practice')}>Done</button>
      </div>
    {:else}
      <button class="primary" disabled={!questions.length} onclick={() => (quiz = true)}>Check your reading · {questions.length} questions</button>
    {/if}
  {/if}
</section>

<style>
  .read {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .hint,
  .small,
  small {
    color: var(--muted);
    font-size: 15px;
    margin: 0;
  }
  .bad {
    color: var(--off-text);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    text-align: left;
    width: 100%;
    color: var(--text);
    font: inherit;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .go {
    flex: none;
  }
  .passage {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .top .label {
    margin: 0;
  }
  .text {
    font-size: 21px;
    line-height: 1.7;
    margin: 0;
  }
  .tok {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .tok:hover,
  .tok:focus-visible {
    background: var(--sel-bg);
  }
  .tok.new {
    text-decoration: underline dotted var(--brass) 2px;
    text-underline-offset: 4px;
  }
  .sentences {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sentences li {
    padding: 10px 12px;
  }
  .small-btn {
    width: 32px;
    height: 32px;
    vertical-align: middle;
  }
  .link {
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--emerald);
    font: inherit;
    font-size: 15px;
    text-decoration: underline;
    cursor: pointer;
  }
  .word {
    position: sticky;
    bottom: 12px;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 12px;
  }
  .word span {
    flex: 1;
  }
  .done {
    padding: 12px;
    font-weight: 700;
    margin: 0;
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .label {
    margin: 4px 0 0;
  }
</style>
