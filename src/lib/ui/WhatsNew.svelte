<script lang="ts">
  // A release's notes, shown as plain text (headings, items, bold and code),
  // never as HTML.
  import { readNotes } from '../updates';

  let { notes }: { notes: string } = $props();
  const lines = $derived(readNotes(notes));
</script>

{#if lines.length}
  <div class="notes">
    {#each lines as line, i (i)}
      <p class={line.kind}>
        {#each line.runs as r, j (j)}{#if r.bold}<strong>{r.text}</strong>{:else if r.code}<code>{r.text}</code>{:else}{r.text}{/if}{/each}
      </p>
    {/each}
  </div>
{/if}

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 46vh;
    overflow-y: auto;
    padding-right: 4px;
  }
  p {
    margin: 0;
    font-size: 15px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .heading {
    font-weight: 600;
    margin-top: 8px;
  }
  .heading:first-child {
    margin-top: 0;
  }
  .item {
    padding-left: 16px;
    position: relative;
  }
  .item::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 0.6em;
    width: 5px;
    height: 5px;
    background: var(--brass);
  }
  code {
    font-size: 13px;
  }
</style>
