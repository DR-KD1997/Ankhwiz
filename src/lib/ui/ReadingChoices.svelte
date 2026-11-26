<script lang="ts">
  // How a Japanese deck shows furigana and whether it asks readings on cards
  // of their own. Used in Deck options › Readings and when Ankhwiz first finds
  // Japanese in a deck. Changes are sent through `onChange`.
  import type { Look } from '../core/types';
  import { plural, t } from '../i18n';
  import { readingCoverage } from '../furigana';
  import { openPanel, data } from '../store.svelte';

  let { deckId, furigana, readingCards, onChange }: { deckId: string; furigana: string; readingCards: string; onChange: (patch: Partial<Look>) => void } = $props();

  const deck = $derived(data.decks[deckId]);
  const cover = $derived(readingCoverage(deck));
  const mode = $derived(furigana || 'fade');
  const MODES = [
    ['fade', t('Fade as you learn'), t('Shown over new words, lighter while you are learning them, hidden once you know them. Tap a word to see it; that answer then counts as helped.')],
    ['always', t('Always'), t('Every reading, every time.')],
    ['tap', t('When tapped'), t('Hidden until you tap a word.')],
    ['never', t('Never'), t('Plain text, no readings.')],
  ] as const;
  const CARDS = [
    ['firm', t('After the meaning is firm'), t('Each card gets a reading card once its meaning reaches Firm recall, so a new word is one card on its first day.')],
    ['start', t('From the start'), t('Learned together with each card from its first lesson: twice the cards in early lessons.')],
    ['off', t('Off'), t('Readings are never asked on their own.')],
  ] as const;
  const cardNote = $derived(CARDS.find((c) => c[0] === (readingCards || 'off'))?.[2] ?? '');
</script>

<div class="readings">
  <fieldset>
    <legend>{t('Furigana over kanji')}</legend>
    {#each MODES as [id, name, note] (id)}
      <label class="choice" class:on={mode === id}>
        <input type="radio" name="furi-{deckId}" value={id} checked={mode === id} onchange={() => onChange({ furigana: id })} />
        <span><strong>{name}</strong><small>{note}</small></span>
      </label>
    {/each}
  </fieldset>
  <fieldset>
    <legend>{t('Reading cards (answered in kana)')}</legend>
    <div class="seg" role="radiogroup">
      {#each CARDS as [id, name] (id)}
        <button type="button" role="radio" aria-checked={(readingCards || 'off') === id} onclick={() => onChange({ readingCards: id })}>{name}</button>
      {/each}
    </div>
    <small class="note">{cardNote}</small>
  </fieldset>
  <p class="cover">
    {#if cover.kanji === 0}{t('No cards with kanji yet.')}
    {:else if cover.read === cover.kanji}{plural('Every card with kanji has its readings ({n} card).', 'Every card with kanji has its readings ({n} cards).', cover.kanji)}
    {:else}{t('Readings on {read} of {n} cards with kanji.', { read: cover.read, n: cover.kanji })}
      <button type="button" class="link" onclick={() => openPanel('prepare')}>{t('Prepare for Ankhwiz can add the rest ›')}</button>
    {/if}
  </p>
</div>

<style>
  .readings {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  legend {
    padding: 0 0 4px;
    font-weight: 700;
  }
  .choice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 44px;
    padding: 8px 10px;
    border: 2px solid var(--line);
    background: var(--surface);
    cursor: pointer;
  }
  .choice.on {
    border-color: var(--brass);
  }
  .choice input {
    margin-top: 3px;
    accent-color: var(--emerald);
  }
  .choice span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice small,
  .note {
    color: var(--muted);
    font-size: 13px;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 2px solid var(--line);
  }
  .seg button {
    min-height: 48px;
    padding: 4px;
    border: 0;
    border-right: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button[aria-checked='true'] {
    background: var(--emerald);
    color: var(--surface);
  }
  .cover {
    margin: 0;
    font-size: 14px;
  }
  .link {
    all: unset;
    cursor: pointer;
    color: var(--emerald);
    font-weight: 700;
    text-decoration: underline;
  }
</style>
