<script lang="ts">
  import Furi from './Furi.svelte';
  import { stageName, t } from '../i18n';
  // Progress for one deck: stages, the week ahead, how well cards are
  // remembered, the streak calendar, and the cards that keep slipping.
  // (Anki: Statistics, with leeches as tricky cards.)
  import { deckStats, limits, today } from '../core';
  import { data, now, openPanel, snap, ui } from '../store.svelte';
  import { filledIn } from './cardIds';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const time = $derived(now());
  const stats = $derived((void time, deckStats(snap(deck), snap(progress))));
  const top = $derived(Math.max(1, ...stats.forecast));
  const maxStage = $derived(Math.max(1, ...stats.stages));
  const day0 = $derived((void time, today()));
  const days = $derived(new Set(data.streak.days ?? []));
  // Twelve weeks, oldest first, ending today.
  const calendar = $derived(Array.from({ length: 84 }, (_, i) => day0 - 83 + i));
  const label = (offset: number) =>
    offset === 0 ? t('Today') : offset === 1 ? t('Tmrw') : new Date((day0 + offset) * 86_400_000).toLocaleDateString(undefined, { weekday: 'short' });
  const noteOf = (cardId: string) => deck.notes[cardId.split(':')[0]];
  const tricky = $derived(stats.tricky.slice(0, 8));

  function askThoth() {
    ui.aiTab = 'improve';
    ui.aiNotes = [...new Set(stats.tricky.map((c) => c.split(':')[0]))];
    openPanel('ai');
  }
</script>

<section class="prog">
  <header>
    <button class="icon-btn" aria-label={t('Back to lessons')} onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">{t('Progress')}</h1>
  </header>

  <div class="tiles">
    <div class="plain"><span class="label">{t('Met')}</span><b>{stats.introduced}</b><small>{t('of {total} cards', { total: stats.total })}</small></div>
    <div class="plain"><span class="label">{t('Remembered')}</span><b>{stats.retention === null ? '–' : `${Math.round(stats.retention * 100)}%`}</b><small>{t('last 30 days, {answers30} answers', { answers30: stats.answers30 })}</small></div>
    <div class="plain"><span class="label">{t('Streak')}</span><b>{data.streak.count}</b><small>{t('best {best}', { best: data.streak.best })}</small></div>
  </div>

  <div class="group">
    <p class="label">{t('Cards by stage')}</p>
    {#each stats.stages as n, i (i)}
      <div class="bar">
        <span class="name">{i + 1} · {stageName(limits.stageNames[i])}</span>
        <span class="track"><i style="width: {(n / maxStage) * 100}%"></i></span>
        <b>{n}</b>
      </div>
    {/each}
    {#if stats.stopped}<p class="hint">{t('{stopped} stopped (not asked until resumed in Cards).', { stopped: stats.stopped })}</p>{/if}
  </div>

  <div class="group">
    <p class="label">{t('The week ahead')}</p>
    <div class="week" role="img" aria-label={t('Reviews due over the next seven days: {x}', { x: stats.forecast.join(', ') })}>
      {#each stats.forecast as n, i (i)}
        <div class="col">
          <b>{n}</b>
          <span class="stick"><i style="height: {(n / top) * 100}%"></i></span>
          <small>{label(i)}</small>
        </div>
      {/each}
    </div>
  </div>

  <div class="group">
    <p class="label">{t('Days studied · last 12 weeks')}</p>
    <div class="cal" role="img" aria-label={t('{length} days studied in the last 12 weeks', { length: calendar.filter((d) => days.has(d)).length })}>
      {#each calendar as d (d)}<i class:on={days.has(d)} class:today={d === day0}></i>{/each}
    </div>
  </div>

  <div class="group">
    <p class="label">{t('Tricky cards')}</p>
    {#if tricky.length}
      <p class="hint">{t('Missed twice or more (Anki: leeches). Practise them, or let Thoth suggest better answers and wrong options.')}</p>
      <ul>
        {#each tricky as c (c)}
          {@const n = noteOf(c)}
          {#if n}
            <li>
              <button class="row" onclick={() => ((ui.editNote = n.id), openPanel('contents'))}>
                <span class="grow"><strong dir="auto"><Furi text={n.cloze ? filledIn(n.front) : n.front} /></strong><small dir="auto"><Furi text={n.cloze ? '' : n.back} /></small></span>
                <span class="miss">{t('{lapses} wrong', { lapses: progress[c]?.lapses })}</span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
      <div class="pair">
        <button class="quiet" onclick={() => openPanel('practice')}>{t('Practise them')}</button>
        <button class="quiet" onclick={askThoth}>{t('Ask Thoth to improve them')}</button>
      </div>
    {:else}
      <p class="hint">{t('None so far.')}</p>
    {/if}
  </div>
</section>

<style>
  .prog {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding-block: 20px 40px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    font-size: 24px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .tiles div {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tiles b {
    font-family: var(--display);
    font-size: 28px;
    font-weight: 400;
  }
  small,
  .hint {
    font-size: 13px;
    color: var(--muted);
  }
  .hint {
    margin: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: grid;
    grid-template-columns: 150px 1fr 36px;
    gap: 10px;
    align-items: center;
    font-size: 14px;
  }
  .track {
    height: 14px;
    border: 1.5px solid var(--line);
    background: var(--surface);
  }
  .track i {
    display: block;
    height: 100%;
    background: var(--brass);
  }
  .bar b {
    text-align: right;
  }
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 6px;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .stick {
    width: 100%;
    max-width: 34px;
    height: 90px;
    display: flex;
    align-items: flex-end;
    border-bottom: 2px solid var(--line);
  }
  .stick i {
    display: block;
    width: 100%;
    background: var(--brass);
    min-height: 2px;
  }
  .cal {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, 12px);
    grid-auto-columns: 12px;
    gap: 3px;
    overflow-x: auto;
  }
  .cal i {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .cal i.on {
    background: var(--brass);
  }
  .cal i.today {
    outline: 2px solid var(--text);
    outline-offset: -1px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    width: 100%;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 2px;
    border: none;
    border-bottom: 1px solid var(--hair);
    background: none;
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .row .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .miss {
    font-size: 13px;
    color: var(--off-text);
    flex: none;
  }
  .pair {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pair button {
    flex: 1 1 180px;
    min-height: 48px;
  }
  @media (max-width: 420px) {
    .bar {
      grid-template-columns: 120px 1fr 30px;
    }
  }
</style>
