<script lang="ts">
  // Where a deck sits in the library, chosen in Deck options: tap a subject
  // and a topic (or type new ones), then Move here. Moving never changes the
  // deck's cards or progress.
  import { t } from '../i18n';
  import { knownPlaces } from '../places';
  import { data, setDeckPlace } from '../store.svelte';

  let { deckId }: { deckId: string } = $props();

  const deck = $derived(data.decks[deckId]);
  const places = $derived(knownPlaces(Object.values(data.decks)));
  let subject = $state('');
  let topic = $state('');
  let newSubject = $state(false);
  let newTopic = $state(false);
  // Start from where the deck is now, and again whenever it moves.
  $effect(() => {
    subject = deck?.place?.subject ?? '';
    topic = deck?.place?.topic ?? '';
    newSubject = false;
    newTopic = false;
  });
  const topics = $derived(places.get(subject) ?? []);
  const path = $derived(subject.trim() ? [subject.trim(), topic.trim(), deck?.name].filter(Boolean).join(' › ') : t('Not sorted yet'));
  const changed = $derived((deck?.place?.subject ?? '') !== subject.trim() || (deck?.place?.topic ?? '') !== topic.trim());

  function pickSubject(s: string) {
    subject = s;
    newSubject = false;
    topic = '';
  }
</script>

<div class="picker">
  <span class="sub">{t('Subject')}</span>
  <div class="chips">
    {#each [...places.keys()] as s (s)}
      <button aria-pressed={subject === s && !newSubject} onclick={() => pickSubject(s)}>{s}</button>
    {/each}
    <button aria-pressed={newSubject} class="new" onclick={() => ((newSubject = true), (subject = ''), (topic = ''))}>{t('+ New subject')}</button>
    <button aria-pressed={!subject && !newSubject} onclick={() => pickSubject('')}>{t('Not sorted')}</button>
  </div>
  {#if newSubject}
    <input class="input" bind:value={subject} placeholder={t('Languages, Math, History…')} aria-label={t('New subject')} />
  {/if}
  {#if subject.trim()}
    <span class="sub">{t('Topic')}</span>
    <div class="chips">
      {#each topics as tp (tp)}
        <button aria-pressed={topic === tp && !newTopic} onclick={() => ((topic = tp), (newTopic = false))}>{tp}</button>
      {/each}
      <button aria-pressed={newTopic} class="new" onclick={() => ((newTopic = true), (topic = ''))}>{t('+ New topic')}</button>
      <button aria-pressed={!topic && !newTopic} onclick={() => ((topic = ''), (newTopic = false))}>{t('No topic')}</button>
    </div>
    {#if newTopic}
      <input class="input" bind:value={topic} placeholder={t('Turkish, Trigonometry…')} aria-label={t('New topic')} />
    {/if}
  {/if}
  <p class="path">{path}</p>
  <div class="foot">
    <small>{t('Moving a deck never changes its cards or progress. You can also hold a deck in the library’s Lists and drag it to another subject or topic.')}</small>
    <button class="primary" disabled={!changed} onclick={() => setDeckPlace(deckId, subject.trim(), topic.trim())}>{t('Move here')}</button>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sub {
    font-weight: 700;
    font-size: 15px;
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
    background: var(--surface);
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
    margin: 0;
    padding: 8px 10px;
    border: 2px solid var(--hair);
    background: var(--surface);
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .foot small {
    flex: 1 1 220px;
    color: var(--muted);
    font-size: 14px;
  }
  .foot .primary {
    min-height: 44px;
    padding: 0 18px;
  }
  .foot .primary:disabled {
    opacity: 0.5;
  }
</style>
