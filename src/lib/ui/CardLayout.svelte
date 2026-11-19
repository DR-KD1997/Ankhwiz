<script lang="ts">
  // One side of a card in its card type's own layout (templates and
  // styling), made safe and kept to its box. Pictures named in the fields are
  // shown from the deck's own files.
  import type { AnkiNotetype, Note } from '../core/types';
  import { cardLayout, scopeCss } from '../cardTypes';
  import { mediaUrl } from '../media';

  let { deckId, type, note, side = 'back', template = 0 }: { deckId: string; type: AnkiNotetype; note: Note; side?: 'front' | 'back'; template?: number } = $props();

  const scope = `tpl-${Math.random().toString(36).slice(2, 9)}`;
  const html = $derived.by(() => {
    try {
      const l = cardLayout(type, note, template);
      return side === 'front' ? l.front : l.back;
    } catch {
      return '<p>This layout could not be shown.</p>';
    }
  });
  const css = $derived(scopeCss(type.css ?? '', scope));
  let box = $state<HTMLDivElement>();

  // Pictures: the deck's own copies, once the side is drawn.
  $effect(() => {
    void html;
    const el = box;
    if (!el) return;
    let live = true;
    queueMicrotask(() => {
      for (const img of el.querySelectorAll<HTMLImageElement>('img[data-media]')) {
        const name = img.dataset.media ?? '';
        void mediaUrl(deckId, name).then((u) => {
          if (live && u) img.src = u;
        });
      }
    });
    return () => {
      live = false;
    };
  });
</script>

<svelte:element this={'style'}>{css}</svelte:element>
<div class="layout {scope}" bind:this={box}>{@html html}</div>

<style>
  .layout {
    overflow: auto;
    max-width: 100%;
    padding: 12px;
    word-break: break-word;
  }
  .layout :global(img) {
    max-width: 100%;
    height: auto;
  }
  .layout :global(.cloze) {
    font-weight: 700;
    color: var(--emerald);
  }
  .layout :global(.tpl-type) {
    min-height: 36px;
    width: min(260px, 100%);
  }
  .layout :global(hr#answer) {
    border: 0;
    border-top: 1.5px solid var(--hair);
  }
</style>
