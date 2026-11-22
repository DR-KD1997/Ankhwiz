<script lang="ts">
  // More fields of a card side (extra question fields, extra notes). Each
  // field is a little smaller than the one before, down to the fourth; past the
  // third field of a side, the rest wait behind a dropdown arrow on the card.
  //
  // `first` is the field number of items[0] on its side: 2 when the side's
  // first field is shown elsewhere (the question itself), 1 otherwise.
  import { t } from '../i18n';
  import Icon from './Icon.svelte';

  let { items, first = 1, base = 17, label = 'More' }: { items: string[]; first?: number; base?: number; label?: string } = $props();

  const shown = $derived(items.filter((x) => x.trim()));
  // Fields up to the third on the side are visible; the rest fold away.
  const visible = $derived(Math.max(0, 3 - (first - 1)));
  let open = $state(false);
  const scale = (n: number) => [1, 0.86, 0.76, 0.68][Math.min(n, 4) - 1];
</script>

{#if shown.length}
  <div class="fields">
    {#each shown.slice(0, visible) as text, i (i)}
      <p dir="auto" style="font-size: calc({base * scale(first + i)}px * var(--scale, 1))">{text}</p>
    {/each}
    {#if shown.length > visible}
      <button class="fold" aria-expanded={open} onclick={() => (open = !open)}>
        <Icon name={open ? 'up' : 'down'} size={16} />
        {open ? t('Show less') : t('{n} more: {what}', { n: shown.length - visible, what: label })}
      </button>
      {#if open}
        <div class="rest">
          {#each shown.slice(visible) as text, i (i)}
            <p dir="auto" style="font-size: calc({base * scale(4)}px * var(--scale, 1))">{text}</p>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  p {
    margin: 0;
    color: var(--muted);
    overflow-wrap: anywhere;
    line-height: 1.35;
  }
  p:first-child {
    color: var(--text);
  }
  .fold {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 10px;
    border: 1.5px solid var(--hair);
    background: transparent;
    color: var(--text);
    font: 600 13px var(--body);
  }
  .rest {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 10px;
    border-left: 2px solid var(--hair);
  }
</style>
