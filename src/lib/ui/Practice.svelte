<script lang="ts">
  import { plural, t } from '../i18n';
  // Practice: extra rounds that never change when cards come back.
  // (Anki: custom study and filtered decks.)
  import { deckView } from '../core';
  import { data, openPanel, snap, startPractice, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import { aiReady } from '../ai.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const view = $derived(deckView(snap(deck), snap(progress)));
  let unitId = $state(data.decks[ui.deckId!]?.units[0]?.id ?? '');
  let message = $state('');
  const unit = $derived(unitId || deck.units[0]?.id || '');

  function go(mode: 'tricky' | 'unit' | 'cram') {
    message = startPractice(deck.id, mode, unit) ? '' : t('Nothing to practise there yet: meet some cards in a lesson first.');
  }
</script>

<section class="prac">
  <header>
    <button class="icon-btn" aria-label={t('Back to lessons')} onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">{t('Practice')}</h1>
  </header>
  <p class="hint">{t('Practice rounds are extra. They mark your answers but never change your stages or when cards come back.')}</p>

  <button class="choice card" disabled={!view.tricky} onclick={() => go('tricky')}>
    <span class="grow">
      <strong>{t('Tricky cards')}</strong>
      <small>{view.tricky ? plural('{n} card you have missed twice or more', '{n} cards you have missed twice or more', view.tricky) : t('None yet')}</small>
    </span>
    <Icon name="play" size={18} />
  </button>

  <div class="choice card">
    <span class="grow">
      <strong>{t('One unit')}</strong>
      <small>{t('Up to 20 cards you have met, in a shuffled order')}</small>
      {#if deck.units.length > 1}
        <select bind:value={unitId} aria-label={t('Unit')}>
          {#each deck.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
        </select>
      {/if}
    </span>
    <button class="quiet go" onclick={() => go('unit')}>{t('Start')}</button>
  </div>

  <button class="choice card" disabled={!view.introduced} onclick={() => go('cram')}>
    <span class="grow">
      <strong>{t('Cram for a test')}</strong>
      <small>{t('Your 20 weakest cards from the whole deck')}</small>
    </span>
    <Icon name="play" size={18} />
  </button>

  <p class="label">{t('Other ways to practise')}</p>
  <button class="choice card" disabled={!view.introduced} onclick={() => openPanel('dictation')}>
    <span class="grow">
      <strong>{t('Dictation')}</strong>
      <small>{t('Hear a card and write it, checked word by word')}</small>
    </span>
    <Icon name="sound" size={18} />
  </button>
  <button class="choice card" disabled={!view.introduced} onclick={() => openPanel('recall')}>
    <span class="grow">
      <strong>{t('Unit recall')}</strong>
      <small>{t('Write everything you remember from a unit; what you miss comes back tomorrow')}</small>
    </span>
    <Icon name="edit" size={18} />
  </button>
  <button class="choice card" disabled={!view.introduced} onclick={() => openPanel('reading')}>
    <span class="grow">
      <strong>{t('Reading round')}</strong>
      <small>{t('A short text made of words you know, then a few questions{x}', { x: aiReady() ? t('; Thoth can write stories') : '' })}</small>
    </span>
    <Icon name="layers" size={18} />
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
