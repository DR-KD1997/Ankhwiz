<script lang="ts">
  // The strip above the library's By subject and Lists views: decks with cards
  // due (most first) or the decks opened most recently, side by side, and
  // Study All for one mixed session of everything due.
  import { plural, t } from '../i18n';
  import type { DeckRow } from '../places';
  import { data, openDeck, save, startAll } from '../store.svelte';
  import Icon from './Icon.svelte';

  type Sum = { introduced: number; total: number; due: number };
  let { rows }: { rows: DeckRow<Sum>[] } = $props();

  const tab = $derived(data.settings.strip ?? 'due');
  const dueTotal = $derived(rows.reduce((n, r) => n + r.sum.due, 0));
  const opened = $derived(data.settings.opened ?? {});
  const lastSeen = (id: string) => opened[id] ?? (data.settings.lastDeck === id ? 1 : 0);
  const shown = $derived(
    tab === 'due'
      ? rows.filter((r) => r.sum.due > 0).sort((a, b) => b.sum.due - a.sum.due)
      : [...rows].sort((a, b) => lastSeen(b.deck.id) - lastSeen(a.deck.id) || b.deck.created - a.deck.created).slice(0, 12),
  );
  function setTab(v: 'due' | 'recent') {
    data.settings.strip = v;
    save({});
  }
  const where = (r: DeckRow<Sum>) => r.deck.place?.topic || r.deck.place?.subject || '';
</script>

<div class="strip">
  <div class="bar">
    <div class="tabs" role="tablist" aria-label={t('Decks to study')}>
      <button role="tab" aria-selected={tab === 'due'} onclick={() => setTab('due')}>{t('Due')}</button>
      <button role="tab" aria-selected={tab === 'recent'} onclick={() => setTab('recent')}>{t('Recent')}</button>
    </div>
    <button class="study-all" disabled={!dueTotal} onclick={() => startAll()} aria-label={dueTotal ? plural('Study all: {n} card due in every deck, in one mixed session', 'Study all: {n} cards due in every deck, in one mixed session', dueTotal) : t('Nothing is due')}>
      <Icon name="play" size={16} />
      {t('Study All')}{#if dueTotal}<b>{dueTotal}</b>{/if}
    </button>
  </div>
  {#if shown.length}
    <ul class="row">
      {#each shown as r (r.deck.id)}
        <li>
          <button class="tile card" onclick={() => openDeck(r.deck.id)}>
            {#if where(r)}<span class="where">{where(r)}</span>{/if}
            <strong>{r.deck.name}</strong>
            {#if r.sum.due}<span class="due">{plural('{n} due', '{n} due', r.sum.due)}</span>{:else}<span class="ok">{r.sum.introduced ? t('Up to date') : t('Not started')}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none">{tab === 'due' ? t('Nothing due right now.') : t('No decks opened yet.')}</p>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tabs {
    display: flex;
    border: 2px solid var(--line);
  }
  .tabs button {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .tabs button + button {
    border-left: 2px solid var(--line);
  }
  .tabs button[aria-selected='true'] {
    background: var(--text);
    color: var(--surface);
  }
  .study-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 14px;
    border: 2px solid var(--line);
    background: var(--emerald);
    color: var(--surface);
    font-family: var(--button);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }
  .study-all:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .study-all b {
    min-width: 22px;
    padding: 0 6px;
    background: var(--badge-bg);
    color: var(--text);
    font-family: var(--body);
    font-size: 14px;
    text-align: center;
  }
  .row {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 2px 2px 6px;
    list-style: none;
    overflow-x: auto;
    scroll-snap-type: x proximity;
  }
  .row li {
    flex: none;
    scroll-snap-align: start;
  }
  .tile {
    width: 150px;
    min-height: 104px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    text-align: left;
  }
  .where {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .tile strong {
    font-size: 16px;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .due,
  .ok {
    margin-top: auto;
    align-self: flex-start;
    font-size: 14px;
    font-weight: 700;
  }
  .due {
    padding: 1px 7px;
    background: var(--badge-bg);
    color: var(--text);
  }
  .ok {
    color: var(--muted);
  }
  .none {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
