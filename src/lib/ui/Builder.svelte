<script lang="ts">
  // The deck builder: type cards in a card type's own fields, or paste rows
  // from a spreadsheet, check them in a list, then add them to the deck in
  // one go. Lessons are filled up in order; nothing is added until asked.
  import { KINDS, parseRows, rowFor } from '../cardTypes';
  import { addRows, data, openPanel, ui } from '../store.svelte';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const types = $derived(Object.values(deck.anki?.notetypes ?? {}).filter((t) => !t.occlusion && !t.cloze));
  let chosen = $state('');
  const type = $derived(types.find((t) => t.id === chosen) ?? types[0]);
  const kind = $derived(KINDS.find((k) => k.id === deck.made?.kind));
  let unit = $state('');
  const unitName = $derived(unit.trim() || deck.units.at(-1)?.name || deck.name);

  let entry = $state<string[]>([]);
  let drafts = $state<string[][]>([]);
  let pasting = $state(false);
  let pasted = $state('');
  let message = $state('');
  let first = $state<HTMLInputElement>();
  $effect(() => {
    if (type && entry.length !== type.fields.length) entry = type.fields.map(() => '');
  });
  const ready = $derived(!!type && !!entry[type.question]?.trim() && !!entry[type.answer]?.trim());
  const cols = $derived(type ? type.fields.length : 0);

  function add() {
    if (!type || !ready) return;
    drafts.push(entry.map((v) => v.trim()));
    entry = type.fields.map(() => '');
    message = '';
    queueMicrotask(() => first?.focus());
  }
  function addPasted() {
    if (!type) return;
    const rows = parseRows(pasted, cols);
    drafts.push(...rows.map((r) => type!.fields.map((_, i) => r[i] ?? '')));
    message = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} added to the list.`;
    pasted = '';
    pasting = false;
  }
  function commit() {
    if (!type) return;
    const rows = drafts.map((d) => rowFor(type!, d, kind?.selfCheck)).filter((r) => r !== null);
    const n = addRows(deck.id, rows, unitName);
    message = `${n} ${n === 1 ? 'card' : 'cards'} added to ${unitName}.`;
    drafts = [];
  }
  const preview = $derived(type ? (drafts.at(-1) ?? (entry.some(Boolean) ? entry : kind?.example ?? [])) : []);
  const ex = (i: number) => kind?.example[i] ?? '';
</script>

<section class="builder">
  <header>
    <button class="icon-btn" aria-label="Back to lessons" onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">Add cards</h1>
  </header>

  {#if !type}
    <p class="hint">This deck has no card type to type cards into. Open Card types to give its cards one, or add cards in Cards.</p>
    <button class="quiet" onclick={() => openPanel('types')}>Card types</button>
  {:else}
    <div class="top">
      {#if types.length > 1}
        <label class="field"><span>Card type</span>
          <select class="input" bind:value={chosen}>{#each types as t (t.id)}<option value={t.id}>{t.name}</option>{/each}</select>
        </label>
      {/if}
      <label class="field"><span>Unit</span>
        <input class="input" bind:value={unit} placeholder={deck.units.at(-1)?.name || deck.name} list="units" />
        <datalist id="units">{#each deck.units as u (u.id)}<option value={u.name}></option>{/each}</datalist>
      </label>
    </div>

    <div class="entry card">
      {#each type.fields as f, i (f + i)}
        {#if i === 0}
          <label class="field"><span>{f}{i === type.question ? ' · question' : i === type.answer ? ' · answer' : ''}</span>
            <input class="input" bind:this={first} bind:value={entry[i]} placeholder={ex(i)} onkeydown={(e) => e.key === 'Enter' && add()} /></label>
        {:else}
          <label class="field"><span>{f}{i === type.question ? ' · question' : i === type.answer ? ' · answer' : ''}</span>
            <input class="input" bind:value={entry[i]} placeholder={ex(i)} onkeydown={(e) => e.key === 'Enter' && add()} /></label>
        {/if}
      {/each}
      <div class="pair">
        <button class="link-btn" onclick={() => (pasting = !pasting)}>{pasting ? 'Type one at a time' : 'Paste rows from a spreadsheet'}</button>
        <button class="quiet" disabled={!ready} onclick={add}><Icon name="plus" size={16} /> Add to the list</button>
      </div>
      {#if pasting}
        <textarea class="input" rows="6" bind:value={pasted} placeholder={`One card a line, columns in this order: ${type.fields.join(', ')}. Copy from a spreadsheet, or separate with ; or “ = ”.`} aria-label="Rows"></textarea>
        <button class="quiet" disabled={!pasted.trim()} onclick={addPasted}>Add these rows to the list</button>
      {/if}
    </div>

    {#if preview.length}
      <div class="pv card">
        <small>{drafts.length ? 'The last card in the list' : 'How a card will look'}</small>
        <strong>{preview[type.question] || ex(type.question)}</strong>
        <span>{preview[type.answer] || ex(type.answer)}</span>
        {#if type.extra !== null && type.extra !== undefined && (preview[type.extra] || ex(type.extra))}<small>{preview[type.extra] || ex(type.extra)}</small>{/if}
      </div>
    {/if}

    {#if drafts.length}
      <p class="label">To add · {drafts.length}</p>
      <div class="table" role="table" aria-label="Cards to add">
        {#each drafts as d, r (r)}
          <div class="tr" role="row">
            {#each d.slice(0, Math.min(cols, 3)) as _, c (c)}
              <input class="input cell" role="cell" bind:value={drafts[r][c]} aria-label="{type.fields[c]} of card {r + 1}" />
            {/each}
            <button class="icon-btn" aria-label="Remove card {r + 1}" onclick={() => drafts.splice(r, 1)}><Icon name="close" size={16} /></button>
          </div>
        {/each}
      </div>
      <button class="primary" onclick={commit}>Add {drafts.length} {drafts.length === 1 ? 'card' : 'cards'} to {unitName}</button>
    {/if}
    <p class="hint">Cards go into lessons of {deck.lessonSize} in the order you add them. Change any card later in Cards, and the fields or the layout in Card types.</p>
  {/if}
  {#if message}<p class="hint good" role="status">{message}</p>{/if}
</section>

<style>
  .builder {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .hint,
  small {
    color: var(--muted);
    font-size: 14px;
    margin: 0;
  }
  .good {
    color: var(--ok-text);
  }
  .top {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .top .field {
    flex: 1 1 200px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
  }
  .entry {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
    padding: 14px;
  }
  .entry .pair,
  .entry textarea,
  .entry > button {
    grid-column: 1 / -1;
  }
  .pv {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    text-align: center;
  }
  .pv strong {
    font-family: var(--display);
    font-size: 24px;
    font-weight: 400;
  }
  .table {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tr {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .cell {
    flex: 1 1 0;
    min-width: 0;
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
  }
  .link-btn {
    background: none;
    border: 0;
    padding: 0;
    color: var(--emerald);
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
  .label {
    margin: 0;
  }
</style>
