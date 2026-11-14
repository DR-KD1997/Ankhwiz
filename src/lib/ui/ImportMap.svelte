<script lang="ts">
  // The second step of importing an Anki deck: which Anki fields become the
  // question, the answer and the extra, for each kind of note in the file.
  // Each kind arrives already matched (from its card layout, or a known note
  // type); the learner can change any of it. Question and Extra can hold
  // several fields: "+" adds one after the last, each in slightly smaller type,
  // as they will appear on the card.
  import { aiReady } from '../ai.svelte';
  import { importPackage, type AnkiPackage, type Mapping, type SplitBy } from '../exporting';
  import { data } from '../store.svelte';
  import Icon from './Icon.svelte';

  let {
    pkg,
    onDone,
    onCancel,
  }: { pkg: AnkiPackage; onDone: (r: { id: string; skipped: number; notes: number; suggest: boolean }) => void; onCancel: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(pkg.name);
  // svelte-ignore state_referenced_locally
  let maps = $state<Record<string, Mapping>>(
    Object.fromEntries(
      pkg.notetypes.map((t) => [
        t.id,
        { question: t.question, questionMore: [...t.questionMore], answer: t.answer, extra: t.extra ?? null, extraMore: [...t.extraMore], selfCheck: t.selfCheck },
      ]),
    ),
  );
  let withProgress = $state(true);
  // svelte-ignore state_referenced_locally
  let bothWays = $state(pkg.notetypes.some((t) => t.reverse));
  // svelte-ignore state_referenced_locally
  let splitBy = $state<SplitBy>(pkg.notes.some((n) => n.group) ? 'subdeck' : 'size');
  let suggest = $state(aiReady());
  let busy = $state(false);
  let error = $state('');
  const mediaCount = $derived(Object.keys(pkg.media).length);

  const MATCHED: Record<string, string> = {
    ankhwiz: 'Matched: an Ankhwiz deck',
    occlusion: 'Matched: pictures with hidden parts',
    cloze: 'Matched: fill the gap',
    template: 'Matched from its card layout',
    names: 'Matched by field names',
  };

  /** Units under each way of splitting, for the preview. */
  const unitCount = $derived.by(() => {
    if (splitBy === 'size') return 1;
    const keys = new Set(
      pkg.notes.map((n) => (splitBy === 'tag' ? (n.tags.find((t) => !/^(ankh::|leech$|marked$)/i.test(t))?.split('::')[0] ?? '') : (n.group ?? ''))),
    );
    return keys.size;
  });
  const selfCount = $derived(pkg.notetypes.filter((t) => maps[t.id].selfCheck).reduce((n, t) => n + t.count, 0));

  /** Fields not yet used by this note type's mapping, for a new "+" choice. */
  function unused(tid: string, fields: string[]): number | null {
    const m = maps[tid];
    const taken = new Set([m.question, m.answer, m.extra, ...m.questionMore, ...m.extraMore]);
    const i = fields.findIndex((_, i) => !taken.has(i));
    return i < 0 ? null : i;
  }
  function addMore(tid: string, list: 'questionMore' | 'extraMore', fields: string[]) {
    const next = unused(tid, fields);
    if (next !== null) maps[tid][list] = [...maps[tid][list], next];
  }
  function removeMore(tid: string, list: 'questionMore' | 'extraMore', i: number) {
    maps[tid][list] = maps[tid][list].filter((_, j) => j !== i);
  }
  /** Type size for the n-th field of a list: smaller with each one, down to the fourth. */
  const step = (n: number) => ['s0', 's1', 's2', 's3'][Math.min(n, 3)];

  async function go() {
    busy = true;
    error = '';
    try {
      const r = await importPackage(pkg, $state.snapshot(maps), { withProgress: withProgress && pkg.studied, bothWays, name: name.trim(), splitBy });
      onDone({ ...r, suggest });
    } catch (e) {
      error = e instanceof Error ? e.message : 'The deck could not be imported.';
    } finally {
      busy = false;
    }
  }
</script>

{#snippet pick(tid: string, fields: string[], sample: string[], value: number | null, set: (v: number) => void, label: string, size: string, none = false)}
  <select class="input {size}" aria-label={label} value={value === null ? '' : String(value)} onchange={(e) => set(e.currentTarget.value === '' ? -1 : Number(e.currentTarget.value))}>
    {#if none}<option value="">None</option>{/if}
    {#each fields as f, i (i)}<option value={String(i)}>{f}{sample[i] ? ` · ${sample[i]}` : ''}</option>{/each}
  </select>
{/snippet}

<div class="map plain">
  <p class="label">Import from Anki</p>
  <label class="field"><span>Deck name</span><input class="input" bind:value={name} /></label>

  {#each pkg.notetypes as t (t.id)}
    {@const m = maps[t.id]}
    {@const canAdd = unused(t.id, t.fields) !== null}
    <section class="type" aria-label={t.name}>
      <div class="head">
        <strong>{t.name}</strong>
        <span class="matched">{MATCHED[t.matched]}</span>
      </div>
      <small>{t.count} {t.count === 1 ? 'note' : 'notes'} · fields: {t.fields.join(', ')}</small>

      {#if t.occlusion}
        <p class="hint">Each note is a picture with parts hidden; each part becomes a card. Parts with names are asked as questions; the rest you check yourself.</p>
      {/if}

      <div class="group">
        <span class="name">{t.occlusion ? 'Heading' : t.cloze ? 'Text with gaps' : 'Question'}</span>
        <div class="list">
          <div class="row">
            {@render pick(t.id, t.fields, t.sample, m.question, (v) => (m.question = v), 'Main question field', 's0')}
            {#if !t.cloze && !t.occlusion && !m.questionMore.length}
              <button class="plus" disabled={!canAdd} aria-label="Add another question field" onclick={() => addMore(t.id, 'questionMore', t.fields)}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
          {#each m.questionMore as f, i (i)}
            <div class="row">
              {@render pick(t.id, t.fields, t.sample, f, (v) => (m.questionMore[i] = v), `Question field ${i + 2}`, step(i + 1))}
              <button class="minus" aria-label="Remove question field {i + 2}" onclick={() => removeMore(t.id, 'questionMore', i)}><Icon name="close" size={16} /></button>
              {#if i === m.questionMore.length - 1}
                <button class="plus" disabled={!canAdd} aria-label="Add another question field" onclick={() => addMore(t.id, 'questionMore', t.fields)}><Icon name="plus" size={18} /></button>
              {/if}
            </div>
          {/each}
        </div>
        {#if !t.cloze && !t.occlusion}
          <p class="note">{bothWays ? 'The first field swaps with the answer when asked both ways; the others show with it, smaller.' : 'The first field is the main question; the others show under it, smaller.'}</p>
        {/if}
      </div>

      {#if !t.cloze && !t.occlusion}
        <div class="group">
          <span class="name">Answer</span>
          <div class="row">{@render pick(t.id, t.fields, t.sample, m.answer, (v) => (m.answer = v), 'Answer field', 's0')}</div>
        </div>
      {/if}

      <div class="group">
        <span class="name">Extra <small>shown after answering</small></span>
        <div class="list">
          <div class="row">
            {@render pick(t.id, t.fields, t.sample, m.extra, (v) => (m.extra = v < 0 ? null : v), 'Extra field', 's0', true)}
            {#if m.extra !== null && !m.extraMore.length}
              <button class="plus" disabled={!canAdd} aria-label="Add another extra field" onclick={() => addMore(t.id, 'extraMore', t.fields)}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
          {#each m.extraMore as f, i (i)}
            <div class="row">
              {@render pick(t.id, t.fields, t.sample, f, (v) => (m.extraMore[i] = v), `Extra field ${i + 2}`, step(i + 1))}
              <button class="minus" aria-label="Remove extra field {i + 2}" onclick={() => removeMore(t.id, 'extraMore', i)}><Icon name="close" size={16} /></button>
              {#if i === m.extraMore.length - 1}
                <button class="plus" disabled={!canAdd} aria-label="Add another extra field" onclick={() => addMore(t.id, 'extraMore', t.fields)}><Icon name="plus" size={18} /></button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={m.selfCheck} />
        <span>You check these cards yourself <small>{t.custom ? 'Their Anki layout uses scripts or drawing Ankhwiz cannot copy, so you see the answer and say how close you were.' : 'See the answer and say how close you were, instead of being marked.'}</small></span>
      </label>
    </section>
  {/each}

  <div class="group global">
    <span class="name">Units</span>
    <select class="input s0" bind:value={splitBy} aria-label="Group cards into units by">
      <option value="subdeck">One unit per subdeck</option>
      <option value="tag">One unit per tag</option>
      <option value="size">One unit, split into lessons</option>
    </select>
    <p class="note">{unitCount} {unitCount === 1 ? 'unit' : 'units'}, each split into lessons of about {data.settings.lessonSize} cards.</p>
  </div>

  {#if selfCount}
    <p class="notice" role="note"><Icon name="info" size={18} /> <span><strong>{selfCount} {selfCount === 1 ? 'card' : 'cards'} will be self-check.</strong> You see the answer and say how close you were.</span></p>
  {/if}

  {#if pkg.studied}
    <label class="check"><input type="checkbox" bind:checked={withProgress} /> <span>Bring my Anki progress <small>Cards you know well start at a higher stage.</small></span></label>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={bothWays} /> <span>Ask both ways <small>Question to answer, and answer to the main question field.</small></span></label>
  {#if aiReady()}
    <label class="check"><input type="checkbox" bind:checked={suggest} /> <span>Suggest lesson names and wrong options <small>Opens Thoth's suggestions after importing. Uses your AI connection; you approve each one.</small></span></label>
  {/if}
  <p class="hint">
    {mediaCount ? `${mediaCount} ${mediaCount === 1 ? 'picture or sound comes' : 'pictures and sounds come'} with it. ` : ''}Fields you do not use are kept, and go back to Anki unchanged if you export the deck.
  </p>
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
  <div class="pair">
    <button class="quiet" onclick={onCancel}>Cancel</button>
    <button class="primary" disabled={busy} onclick={go}>{busy ? 'Importing…' : `Import ${pkg.notes.length} notes`}</button>
  </div>
</div>

<style>
  .map {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .map > .label {
    margin: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    min-width: 0;
  }
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
  .type {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--hair);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    justify-content: space-between;
  }
  .matched {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--ok-text);
    background: var(--ok-bg);
    border: 1.5px solid var(--ok-line);
    padding: 1px 7px;
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
  .hint,
  .note {
    font-size: 13px;
    color: var(--muted);
    font-weight: 400;
  }
  .hint,
  .note {
    margin: 0;
  }
  .notice {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 2px solid var(--close-line);
    background: var(--close-bg);
    color: var(--close-text);
    font-size: 14px;
  }
  .bad {
    color: var(--off-text);
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-weight: 600;
  }
  .check span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .check input {
    flex: none;
    width: 22px;
    height: 22px;
    margin-top: 1px;
    accent-color: var(--emerald);
  }
  .pair {
    display: flex;
    gap: 10px;
  }
  .pair .quiet {
    flex: 1;
    min-height: 52px;
  }
  .pair .primary {
    flex: 2;
    white-space: nowrap;
    padding-inline: 10px;
  }
</style>
