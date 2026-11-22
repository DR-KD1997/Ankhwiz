<script lang="ts">
  import { t } from '../i18n';
  // Which Anki fields become a note type's question, answer and extra: used
  // when importing, and in Deck options to change them later. Question and
  // Extra can hold several fields: "+" adds one after the last, each in
  // slightly smaller type, as they will appear on the card, and their grips
  // put them in order. `map` is changed in place.
  import type { FieldMap } from '../import/apkg';
  import Icon from './Icon.svelte';
  import { moved, sortable } from './sortable';

  let {
    fields,
    sample,
    map,
    cloze = false,
    occlusion = false,
    bothWays = false,
    flag = null,
  }: {
    fields: string[];
    sample: string[];
    map: FieldMap;
    cloze?: boolean;
    occlusion?: boolean;
    bothWays?: boolean;
    /** Marks the main question and answer pickers, for example when changing them resets progress. */
    flag?: { question: boolean; answer: boolean } | null;
  } = $props();

  const plain = $derived(!cloze && !occlusion);
  const more = (l: 'questionMore' | 'extraMore') => map[l] ?? [];

  /** A field not yet used, for a new "+" choice. */
  const unused = $derived.by(() => {
    const taken = new Set([map.question, map.answer, map.extra, ...more('questionMore'), ...more('extraMore')]);
    const i = fields.findIndex((_, i) => !taken.has(i));
    return i < 0 ? null : i;
  });
  function addMore(list: 'questionMore' | 'extraMore') {
    if (unused !== null) map[list] = [...more(list), unused];
  }
  function removeMore(list: 'questionMore' | 'extraMore', i: number) {
    map[list] = more(list).filter((_, j) => j !== i);
  }
  /** Drag a field to another place in its list; the field dragged first becomes the main one. */
  function reorder(list: 'question' | 'extra', from: number, to: number) {
    if (list === 'question') {
      const l = moved([map.question, ...more('questionMore')], from, to);
      map.question = l[0];
      map.questionMore = l.slice(1);
    } else if (map.extra !== null) {
      const l = moved([map.extra, ...more('extraMore')], from, to);
      map.extra = l[0];
      map.extraMore = l.slice(1);
    }
  }
  const gripLabel = (what: string, n: number) => t('Move {what} field {n}: hold and drag, or use the arrow keys', { what, n });
  /** Type size for the n-th field of a list: smaller with each one, down to the fourth. */
  const step = (n: number) => ['s0', 's1', 's2', 's3'][Math.min(n, 3)];
</script>

{#snippet pick(value: number | null, set: (v: number) => void, label: string, size: string, none = false, flagged = false)}
  <select class="input {size}" class:flagged aria-label={label} value={value === null ? '' : String(value)} onchange={(e) => set(e.currentTarget.value === '' ? -1 : Number(e.currentTarget.value))}>
    {#if none}<option value="">{t('None')}</option>{/if}
    {#each fields as f, i (i)}<option value={String(i)}>{f}{sample[i] ? ` · ${sample[i]}` : ''}</option>{/each}
  </select>
{/snippet}

<div class="group">
  <span class="name">{occlusion ? t('Heading') : cloze ? t('Text with gaps') : t('Question')}</span>
  <div class="list" use:sortable={{ onMove: (a, b) => reorder('question', a, b) }}>
    <div class="row" data-sort>
      {#if more('questionMore').length}<button class="grip" data-grip aria-label={gripLabel('question', 1)}><Icon name="grip" /></button>{/if}
      {@render pick(map.question, (v) => (map.question = v), 'Main question field', 's0', false, !!flag?.question)}
      {#if plain && !more('questionMore').length}
        <button class="plus" disabled={unused === null} aria-label={t('Add another question field')} onclick={() => addMore('questionMore')}><Icon name="plus" size={18} /></button>
      {/if}
    </div>
    {#each more('questionMore') as f, i (i)}
      <div class="row" data-sort>
        <button class="grip" data-grip aria-label={gripLabel('question', i + 2)}><Icon name="grip" /></button>
        {@render pick(f, (v) => (map.questionMore = more('questionMore').map((x, j) => (j === i ? v : x))), `Question field ${i + 2}`, step(i + 1))}
        <button class="minus" aria-label={t('Remove question field {x}', { x: i + 2 })} onclick={() => removeMore('questionMore', i)}><Icon name="close" size={16} /></button>
        {#if i === more('questionMore').length - 1}
          <button class="plus" disabled={unused === null} aria-label={t('Add another question field')} onclick={() => addMore('questionMore')}><Icon name="plus" size={18} /></button>
        {/if}
      </div>
    {/each}
  </div>
  {#if plain}
    <p class="note">{bothWays ? t('The first field swaps with the answer when asked both ways; the others show with it, smaller.') : t('The first field is the main question; the others show under it, smaller.')}</p>
  {/if}
</div>

{#if plain}
  <div class="group">
    <span class="name">{t('Answer')}</span>
    <div class="row">{@render pick(map.answer, (v) => (map.answer = v), 'Answer field', 's0', false, !!flag?.answer)}</div>
  </div>
{/if}

<div class="group">
  <span class="name">{t('Extra')} <small>{t('shown after answering')}</small></span>
  <div class="list" use:sortable={{ onMove: (a, b) => reorder('extra', a, b) }}>
    <div class="row" data-sort>
      {#if more('extraMore').length}<button class="grip" data-grip aria-label={gripLabel('extra', 1)}><Icon name="grip" /></button>{/if}
      {@render pick(map.extra, (v) => (map.extra = v < 0 ? null : v), 'Extra field', 's0', true)}
      {#if map.extra !== null && !more('extraMore').length}
        <button class="plus" disabled={unused === null} aria-label={t('Add another extra field')} onclick={() => addMore('extraMore')}><Icon name="plus" size={18} /></button>
      {/if}
    </div>
    {#each more('extraMore') as f, i (i)}
      <div class="row" data-sort>
        <button class="grip" data-grip aria-label={gripLabel('extra', i + 2)}><Icon name="grip" /></button>
        {@render pick(f, (v) => (map.extraMore = more('extraMore').map((x, j) => (j === i ? v : x))), `Extra field ${i + 2}`, step(i + 1))}
        <button class="minus" aria-label={t('Remove extra field {x}', { x: i + 2 })} onclick={() => removeMore('extraMore', i)}><Icon name="close" size={16} /></button>
        {#if i === more('extraMore').length - 1}
          <button class="plus" disabled={unused === null} aria-label={t('Add another extra field')} onclick={() => addMore('extraMore')}><Icon name="plus" size={18} /></button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 6px 10px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 400;
  }
  .input.flagged {
    border-color: var(--close-line);
    background: var(--close-bg);
    color: var(--close-text);
  }
  /* Each added field is a little smaller, down to the fourth. */
  .s0 {
    font-size: 16px;
  }
  .s1 {
    font-size: 15px;
    min-height: 42px;
  }
  .s2 {
    font-size: 14px;
    min-height: 40px;
  }
  .s3 {
    font-size: 13px;
    min-height: 38px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .group .name {
    font-weight: 600;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row .input {
    flex: 1;
  }
  .row .grip {
    margin-right: -4px;
    width: 26px;
  }
  .plus,
  .minus {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
  }
  .plus {
    background: var(--check-bg);
    color: var(--check-text);
  }
  .plus:disabled {
    opacity: 0.4;
  }
  small,
  .note {
    font-size: 13px;
    color: var(--muted);
    font-weight: 400;
  }
  .note {
    margin: 0;
  }
</style>
