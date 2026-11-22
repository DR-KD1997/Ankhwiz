<script lang="ts">
  import { t } from '../i18n';
  // Shown with an answer: where the card's facts come from (for decks built
  // from sources), with the passage itself a tap away, and the card in its
  // card type's own layout when that is turned on.
  import { data } from '../store.svelte';
  import { sectionAt, sourceText, type Section } from '../sources';
  import CardLayout from './CardLayout.svelte';
  import Icon from './Icon.svelte';

  let { deckId, noteId }: { deckId: string; noteId: string } = $props();
  const deck = $derived(data.decks[deckId]);
  const note = $derived(deck?.notes[noteId]);
  const src = $derived(note?.source ?? null);
  const source = $derived(src ? deck?.sources?.find((s) => s.id === src.id) : undefined);
  const type = $derived(note?.anki ? deck?.anki?.notetypes[note.anki.ntid] : undefined);
  let open = $state(false);
  let passage = $state<Section | null>(null);
  let missing = $state(false);

  async function toggle() {
    open = !open;
    if (!open || passage || !src) return;
    const sections = await sourceText(deckId, src.id);
    passage = sectionAt(sections, src.at);
    missing = !passage;
  }
  /** The passage split around the quote, when the quote is in it word for word. */
  const parts = $derived.by(() => {
    if (!passage) return null;
    const q = src?.quote?.trim() ?? '';
    const i = q ? passage.text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? { before: passage.text, quote: '', after: '' } : { before: passage.text.slice(0, i), quote: passage.text.slice(i, i + q.length), after: passage.text.slice(i + q.length) };
  });
</script>

{#if src}
  <div class="from">
    <button class="quiet src-btn" aria-expanded={open} onclick={toggle}>
      <Icon name="layers" size={16} />
      {#if src.found}{t('From: {x} · {at}', { x: source?.title ?? t('a source'), at: src.at })}{:else}{t('Not found in your sources')}{/if}
    </button>
    {#if open}
      <div class="passage plain">
        {#if parts}
          <p class="small">{source?.title ?? ''} · {passage?.at}</p>
          <p class="text">{parts.before}{#if parts.quote}<mark>{parts.quote}</mark>{/if}{parts.after}</p>
          {#if source?.url}<a class="small" href={source.url} target="_blank" rel="noopener noreferrer">{t('Open the page')}</a>{/if}
        {:else if missing}
          <p class="small">{source ? t('That part of the source is no longer there.') : t('The source was removed from this deck.')}{src.quote ? ' ' + t('Thoth quoted: “{quote}”', { quote: src.quote }) : ''}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
{#if type?.showLayout && note}
  <div class="layout card"><CardLayout {deckId} {type} {note} side="back" /></div>
{/if}

<style>
  .from {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .src-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
  }
  .passage {
    padding: 10px 12px;
    max-height: 260px;
    overflow-y: auto;
  }
  .text {
    margin: 4px 0;
    white-space: pre-wrap;
    line-height: 1.5;
  }
  mark {
    background: var(--close-bg);
    color: var(--text);
    border-bottom: 2px solid var(--close-line);
  }
  .small {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
  }
  .layout {
    padding: 4px;
  }
</style>
