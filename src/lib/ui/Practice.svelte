<script lang="ts">
  // Practice: extra rounds that never change when cards come back.
  // (Anki: custom study and filtered decks.)
  import { deckView } from '../core';
  import { data, openPanel, snap, startPractice, ui } from '../store.svelte';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const view = $derived(deckView(snap(deck), snap(progress)));
  let unitId = $state(data.decks[ui.deckId!]?.units[0]?.id ?? '');
  let message = $state('');
  const unit = $derived(unitId || deck.units[0]?.id || '');

  function go(mode: 'tricky' | 'unit' | 'cram') {
    message = startPractice(deck.id, mode, unit) ? '' : 'Nothing to practise there yet: meet some cards in a lesson first.';
  }
</script>

<section class="prac">
  <header>
    <button class="icon-btn" aria-label="Back to lessons" onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">Practice</h1>
  </header>
  <p class="hint">Practice rounds are extra. They mark your answers but never change your stages or when cards come back.</p>

  <button class="choice card" disabled={!view.tricky} onclick={() => go('tricky')}>
    <span class="grow">
      <strong>Tricky cards</strong>
      <small>{view.tricky ? `${view.tricky} ${view.tricky === 1 ? 'card' : 'cards'} you have missed twice or more` : 'None yet'}</small>
    </span>
    <Icon name="play" size={18} />
  </button>

  <div class="choice card">
    <span class="grow">
      <strong>One unit</strong>
      <small>Up to 20 cards you have met, in a shuffled order</small>
      {#if deck.units.length > 1}
        <select bind:value={unitId} aria-label="Unit">
          {#each deck.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
        </select>
      {/if}
    </span>
    <button class="quiet go" onclick={() => go('unit')}>Start</button>
  </div>

  <button class="choice card" disabled={!view.introduced} onclick={() => go('cram')}>
    <span class="grow">
      <strong>Cram for a test</strong>
      <small>Your 20 weakest cards from the whole deck</small>
    </span>
    <Icon name="play" size={18} />
  </button>

  {#if message}<p class="hint" role="status">{message}</p>{/if}
</section>

<style>
  .prac {
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding-block: 20px 40px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    font-size: 24px;
  }
  .hint,
  small {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .choice {
    min-height: 72px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    color: var(--text);
  }
  .choice:disabled {
    opacity: 0.55;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select {
    margin-top: 4px;
    min-height: 40px;
    padding: 4px 8px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
  }
  .go {
    min-height: 44px;
    padding: 0 16px;
    flex: none;
  }
</style>
