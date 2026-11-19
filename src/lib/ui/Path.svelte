<script lang="ts">
  import Help from './Help.svelte';
  import { signal } from '../tour.svelte';
  // The lesson path for one deck: units, lessons, and what to do next.
  import type { LessonStatus } from '../core/types';
  import {
    currentStreak,
    data,
    goLibrary,
    now,
    openPanel,
    pausedSummary,
    resumePaused,
    startLesson,
    startReview,
    startTestOut,
    testOutTried,
    ui,
  } from '../store.svelte';
  import { summarisePath, type DeckSummary } from './deckView';
  import Icon from './Icon.svelte';
  import Thoth from './Thoth.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const time = $derived(now());
  // While a lesson is open beside the path, the path keeps what it showed when
  // the lesson began: working it out again after every answer would slow a
  // large deck down, and it is brought up to date when the lesson closes.
  let kept: { deck: object; sum: DeckSummary & { testable: Set<string> } } | null = null;
  const sum = $derived.by(() => {
    const d = deck, p = progress, t = time;
    if (ui.session && kept?.deck === d) return kept.sum;
    const fresh = summarisePath(d, p, t);
    kept = { deck: d, sum: fresh };
    return fresh;
  });
  const streak = $derived(currentStreak());
  const mode = $derived(data.settings.thoth);
  const busy = $derived(ui.session !== null);


  const paused = $derived(data.paused?.deckId === deck.id && data.paused.kind !== 'all' ? pausedSummary() : null);
  const rows = $derived(
    deck.units.map((unit, u) => ({
      unit,
      number: u + 1,
      testable: sum.testable.has(unit.id),
      tried: testOutTried(deck.id, unit.id),
      lessons: unit.lessonIds.map((id) => ({
        id,
        lesson: deck.lessons[id],
        status: sum.lessons[id],
        open: sum.lessons[id].unlocked,
        isNext: id === sum.nextId,
      })),
    })),
  );

  // Long units show a window of lessons around the next one, widened on request.
  const WINDOW = 40;
  let windows = $state<Record<string, { from: number; to: number }>>({});
  function windowOf(unitId: string, ids: string[]): { from: number; to: number } {
    if (ids.length <= WINDOW + 10) return { from: 0, to: ids.length };
    const w = windows[unitId];
    if (w) return w;
    const at = Math.max(0, ids.indexOf(sum.nextId ?? ''));
    const from = Math.max(0, Math.min(at - 5, ids.length - WINDOW));
    return { from, to: Math.min(ids.length, from + WINDOW) };
  }
  function widen(unitId: string, ids: string[], side: 'from' | 'to') {
    const w = windowOf(unitId, ids);
    windows[unitId] = side === 'from' ? { ...w, from: Math.max(0, w.from - WINDOW) } : { ...w, to: Math.min(ids.length, w.to + WINDOW * 2) };
  }

  function describe(st: LessonStatus): string {
    if (st.state === 'new') return `${st.total} new`;
    if (st.state === 'started') return `${st.introduced} of ${st.total} introduced`;
    const due = st.due ? ` · ${st.due} due` : '';
    return (st.state === 'complete' ? 'Complete' : 'Learned') + due;
  }
</script>

<section class="path">
  <header>
    <button class="icon-btn" aria-label="Back to library" onclick={goLibrary}><Icon name="back" /></button>
    <h1 class="display">{deck.name}</h1>
    <span class="streak plain" title="Days in a row" data-tour="streak"><Icon name="sun" size={18} /> {streak}</span>
    <button class="icon-btn" aria-label="Settings" onclick={() => (ui.screen = 'settings')}><Icon name="gear" /></button>
  </header>

  {#if mode === 'full'}
    <div class="thoth-row">
      <div class="portrait"><Thoth size={84} portrait nodOn={busy ? 'busy' : sum.suggestions[0]} /></div>
      <p class="bubble plain">{busy ? 'Lesson in progress.' : sum.suggestions[0]}</p>
    </div>
  {:else}
    <div class="suggest plain">
      <p class="label">Suggestions</p>
      <ul>
        {#if busy}<li>Lesson in progress.</li>{:else}{#each sum.suggestions as text (text)}<li>{text}</li>{/each}{/if}
      </ul>
    </div>
  {/if}

  {#if paused && !busy}
    <button class="review card picked" onclick={resumePaused}>
      <span class="medal"><Icon name="resume" size={18} /></span>
      <span class="grow">
        <strong>Pick up where you left off</strong>
        <small>{paused.what.replace(`${deck.name} · `, '')} · {paused.done} of {paused.total} done</small>
      </span>
      <Icon name="play" size={18} />
    </button>
  {/if}

  {#if sum.due > 0 && !busy}
    <button class="review card" class:picked={sum.reviewFirst || !sum.nextId} disabled={busy} onclick={() => startReview(deck.id)}>
      <span class="medal"><Icon name="repeat" size={18} /></span>
      <span class="grow">
        <strong>Review</strong>
        <small>{sum.due} {sum.due === 1 ? 'card' : 'cards'} due today</small>
      </span>
      <Icon name="play" size={18} />
    </button>
  {/if}

  {#if !busy}
    <button class="review card thoth-entry" class:here={ui.panel === 'ai'} onclick={() => openPanel('ai')}>
      <span class="medal"><Icon name="chat" size={18} /></span>
      <span class="grow">
        <strong>Study with Thoth</strong>
        <small>Ask questions, add or change cards, challenge rounds, reading</small>
      </span>
      <Icon name="play" size={18} />
    </button>
    <button class="review card options-entry" data-tour="options" class:here={ui.panel === 'options'} onclick={() => openPanel('options')}>
      <span class="medal"><Icon name="gear" size={18} /></span>
      <span class="grow">
        <strong>Deck options</strong>
        <small>Daily goal, card kinds, look, export</small>
      </span>
      <Icon name="play" size={18} />
    </button>
    <div class="trio">
      <button class="quiet" class:here={ui.panel === 'contents'} onclick={() => openPanel('contents')}><Icon name="cards" size={18} /> Cards</button>
      <button class="quiet" class:here={ui.panel === 'progress'} onclick={() => openPanel('progress')}><Icon name="chart" size={18} /> Progress</button>
      <button class="quiet" class:here={ui.panel === 'practice'} onclick={() => openPanel('practice')}>
        <Icon name="target" size={18} /> Practice{sum.tricky ? ` (${sum.tricky})` : ''}
      </button>
    </div>
    <div class="trio second">
      <button class="quiet" class:here={ui.panel === 'builder'} onclick={() => openPanel('builder')}><Icon name="plus" size={18} /> Add cards</button>
      <button class="quiet" class:here={ui.panel === 'sources'} onclick={() => openPanel('sources')}><Icon name="layers" size={18} /> From sources</button>
      <button class="quiet" class:here={ui.panel === 'types'} onclick={() => openPanel('types')}><Icon name="edit" size={18} /> Card types</button>
    </div>
    {#if sum.goalMet && sum.nextId}
      <p class="goal">Today's goal of {sum.goal} new {sum.goal === 1 ? 'lesson' : 'lessons'} is done. You can keep going.</p>
    {/if}
  {/if}


  {#each rows as row (row.unit.id)}
    {@const ids = row.unit.lessonIds}
    {@const win = windowOf(row.unit.id, ids)}
    <div class="unit">
      <div class="unit-head">
        <p class="label">Unit {row.number}{row.unit.name !== deck.name ? ` · ${row.unit.name}` : ''}</p>
        {#if row.testable && !busy}
          <button
            class="testout"
            disabled={row.tried}
            title={row.tried ? 'One try a day: come back tomorrow' : 'A short quiz without hints. Pass it to skip ahead.'}
            onclick={() => startTestOut(deck.id, row.unit.id)}
          >
            <Icon name="flag" size={14} /> {row.tried ? 'Test out tomorrow' : 'Test out'}
          </button>
          <Help part="testout" />
        {/if}
      </div>
      {#if win.from > 0}<button class="quiet more" onclick={() => widen(row.unit.id, ids, 'from')}>Show {Math.min(WINDOW, win.from)} earlier lessons</button>{/if}
      <ol start={win.from + 1}>
        {#each row.lessons.slice(win.from, win.to) as l, i (l.id)}
          {@const li = win.from + i}
          <li>
            <button
              data-tour={row.number === 1 && li === 0 ? 'lesson1' : undefined}
              class="lesson card"
              class:picked={l.isNext && !sum.reviewFirst}
              class:locked={!l.open}
              disabled={!l.open || busy}
              onclick={() => (startLesson(deck.id, l.id), signal('lesson'))}
            >
              <span class="medal" class:done={l.status.state === 'learned' || l.status.state === 'complete'}>
                {#if !l.open}<Icon name="lock" size={16} />
                {:else if l.status.state === 'complete'}<Icon name="check" size={18} />
                {:else}{l.status.total}{/if}
              </span>
              <span class="grow">
                <strong>{l.lesson.name}</strong>
                <small>{l.open ? describe(l.status) : 'Locked'}</small>
              </span>
              {#if l.status.state === 'learned' || l.status.state === 'complete'}
                <span class="pips" role="img" aria-label="Strength {Math.round(l.status.strength)} of 5">
                  {#each [1, 2, 3, 4, 5] as p (p)}<i class:on={p <= Math.round(l.status.strength)}></i>{/each}
                </span>
              {:else if l.open}
                <Icon name="play" size={18} />
              {/if}
            </button>
          </li>
        {/each}
      </ol>
      {#if win.to < ids.length}<button class="quiet more" onclick={() => widen(row.unit.id, ids, 'to')}>Show more lessons ({ids.length - win.to} to go)</button>{/if}
    </div>
  {/each}

</section>

<style>
  .more {
    width: 100%;
    min-height: 44px;
    margin: 6px 0;
  }
  .trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: -8px;
  }
  .trio.second {
    margin-top: 0;
  }
  .trio button {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 6px;
    font-size: 15px;
  }
  .here {
    border-color: var(--brass) !important;
    background: var(--sel-bg) !important;
  }
  .goal {
    margin: -8px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  .path {
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding-block: 20px 32px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header h1 {
    flex: 1;
    min-width: 0;
    font-size: 24px;
    overflow-wrap: anywhere;
  }
  .streak {
    height: 44px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .thoth-row {
    display: flex;
    align-items: stretch;
    gap: 12px;
  }
  .portrait {
    width: 88px;
    height: 88px;
    flex: none;
    border: 2px solid var(--line);
    background: var(--thoth-bg);
    overflow: hidden;
  }
  .bubble {
    flex: 1;
    padding: 12px 14px;
    display: flex;
    align-items: center;
  }
  .suggest {
    padding: 12px 14px;
  }
  .suggest ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }
  .unit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lesson,
  .review {
    width: 100%;
    min-height: 68px;
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    text-align: left;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  strong {
    font-size: 18px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  small {
    font-size: 14px;
    color: var(--muted);
  }
  .medal {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    border: 2px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }
  .medal.done {
    border-color: var(--emerald);
    background: var(--emerald);
    color: #fbf4e2;
  }
  .picked {
    border: 5px solid var(--brass);
    padding: 8px 16px;
    outline: none;
    background: var(--sel-bg);
  }
  .picked strong {
    color: var(--sel-text);
  }
  .picked .medal {
    border: none;
    background: var(--badge-bg);
    color: var(--badge-text);
  }
  .locked {
    opacity: 0.55;
  }
  .pips {
    display: flex;
    gap: 3px;
  }
  .pips i {
    width: 8px;
    height: 16px;
    background: var(--pip-off);
  }
  .pips i.on {
    background: var(--brass);
  }
  .unit-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .unit-head .label {
    margin: 0;
    flex: 1;
  }
  .testout {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 10px;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: 600 13px var(--body);
    white-space: nowrap;
  }
  .testout:disabled {
    opacity: 0.6;
  }
</style>
