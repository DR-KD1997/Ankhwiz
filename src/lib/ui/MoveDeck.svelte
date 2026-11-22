<script lang="ts">
  // Move one deck: choose a subject and a topic by tapping (or type new ones);
  // the full path shows before moving. Moving never changes the deck's cards
  // or progress.
  import { t } from '../i18n';
  import { knownPlaces } from '../places';
  import { data, setDeckPlace } from '../store.svelte';
  import { untrack } from 'svelte';

  let { deckId, onClose }: { deckId: string; onClose: () => void } = $props();

  const deck = $derived(data.decks[deckId]);
  const places = $derived(knownPlaces(Object.values(data.decks)));
  const start = untrack(() => data.decks[deckId]?.place);
  let subject = $state(start?.subject ?? '');
  let topic = $state(start?.topic ?? '');
  let newSubject = $state(false);
  let newTopic = $state(false);
  const topics = $derived(places.get(subject) ?? []);
  const path = $derived(subject ? [subject, topic, deck?.name].filter(Boolean).join(' › ') : t('Not sorted yet'));

  function pickSubject(s: string) {
    subject = s;
    newSubject = false;
    topic = '';
  }
  function move() {
    setDeckPlace(deckId, subject, topic);
    onClose();
  }
</script>

<div class="back" role="presentation" onclick={onClose}></div>
<div class="sheet plain" role="dialog" aria-label={t('Move a deck')}>
  <h2 class="display">{t('Move “{name}”', { name: deck?.name ?? '' })}</h2>
  <span class="label">{t('Subject')}</span>
  <div class="chips">
    {#each [...places.keys()] as s (s)}
      <button aria-pressed={subject === s && !newSubject} onclick={() => pickSubject(s)}>{s}</button>
    {/each}
    <button aria-pressed={newSubject} class="new" onclick={() => ((newSubject = true), (subject = ''), (topic = ''))}>{t('+ New subject')}</button>
    <button aria-pressed={!subject && !newSubject} onclick={() => pickSubject('')}>{t('Not sorted')}</button>
  </div>
  {#if newSubject}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="input" bind:value={subject} placeholder={t('Languages, Math, History…')} aria-label={t('New subject')} autofocus />
  {/if}
  {#if subject}
    <span class="label">{t('Topic')}</span>
    <div class="chips">
      {#each topics as tp (tp)}
        <button aria-pressed={topic === tp && !newTopic} onclick={() => ((topic = tp), (newTopic = false))}>{tp}</button>
      {/each}
      <button aria-pressed={newTopic} class="new" onclick={() => ((newTopic = true), (topic = ''))}>{t('+ New topic')}</button>
      <button aria-pressed={!topic && !newTopic} onclick={() => ((topic = ''), (newTopic = false))}>{t('No topic')}</button>
    </div>
    {#if newTopic}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" bind:value={topic} placeholder={t('Turkish, Trigonometry…')} aria-label={t('New topic')} autofocus />
    {/if}
  {/if}
  <p class="path">{path}</p>
  <p class="fine">{t('Moving a deck never changes its cards or progress.')}</p>
  <div class="pair">
    <button class="quiet" onclick={onClose}>{t('Cancel')}</button>
    <button class="primary" onclick={move}>{t('Move here')}</button>
  </div>
</div>

<style>
  .back {
    position: fixed;
    inset: 0;
    background: rgba(20, 16, 10, 0.45);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    margin: 0 auto;
    max-width: 560px;
    max-height: 90dvh;
    overflow-y: auto;
    padding: 18px max(16px, env(safe-area-inset-left, 0px)) calc(18px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-width: 3px 3px 0;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    overflow-wrap: anywhere;
  }
  .label {
    margin: 4px 0 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips button {
    min-height: 40px;
    padding: 0 12px;
    border: 2px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .chips button.new {
    border-style: dashed;
    background: transparent;
  }
  .chips button[aria-pressed='true'] {
    background: var(--text);
    color: var(--surface);
    border-style: solid;
  }
  .input {
    min-height: 46px;
  }
  .path {
    margin: 4px 0 0;
    padding: 8px 10px;
    border: 2px solid var(--hair);
    background: var(--bg);
    overflow-wrap: anywhere;
  }
  .fine {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair button {
    flex: 1;
  }
</style>
