<script lang="ts">
  // The second step of importing an Anki deck: which Anki field becomes the
  // question, the answer and the extra, for each kind of note in the file.
  import { importPackage, type AnkiPackage, type Mapping } from '../exporting';

  let { pkg, onDone, onCancel }: { pkg: AnkiPackage; onDone: (r: { id: string; skipped: number; notes: number }) => void; onCancel: () => void } =
    $props();

  // svelte-ignore state_referenced_locally
  let name = $state(pkg.name);
  // svelte-ignore state_referenced_locally
  let maps = $state<Record<string, Mapping>>(Object.fromEntries(pkg.notetypes.map((t) => [t.id, { question: t.question, answer: t.answer, extra: t.extra ?? null }])));
  let withProgress = $state(true);
  // svelte-ignore state_referenced_locally
  let bothWays = $state(pkg.notetypes.some((t) => !t.cloze && t.templates.length > 1));
  let busy = $state(false);
  let error = $state('');
  const mediaCount = $derived(Object.keys(pkg.media).length);

  async function go() {
    busy = true;
    error = '';
    try {
      onDone(await importPackage(pkg, $state.snapshot(maps), { withProgress: withProgress && pkg.studied, bothWays, name: name.trim() }));
    } catch (e) {
      error = e instanceof Error ? e.message : 'The deck could not be imported.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="map plain">
  <p class="label">Import from Anki</p>
  <label class="field"><span>Deck name</span><input class="input" bind:value={name} /></label>

  {#each pkg.notetypes as t (t.id)}
    <div class="type">
      <strong>{t.name}</strong>
      <small>{t.count} {t.count === 1 ? 'note' : 'notes'}{t.cloze ? ' · fill the gap (cloze)' : ''} · fields: {t.fields.join(', ')}</small>
      <div class="selects">
        <label>
          <span>{t.cloze ? 'Text with gaps' : 'Question'}</span>
          <select class="input" bind:value={maps[t.id].question}>
            {#each t.fields as f, i (i)}<option value={i}>{f}{t.sample[i] ? ` · ${t.sample[i]}` : ''}</option>{/each}
          </select>
        </label>
        {#if !t.cloze}
          <label>
            <span>Answer</span>
            <select class="input" bind:value={maps[t.id].answer}>
              {#each t.fields as f, i (i)}<option value={i}>{f}{t.sample[i] ? ` · ${t.sample[i]}` : ''}</option>{/each}
            </select>
          </label>
        {/if}
        <label>
          <span>Extra <small>shown after answering</small></span>
          <select class="input" bind:value={maps[t.id].extra}>
            <option value={null}>None</option>
            {#each t.fields as f, i (i)}<option value={i}>{f}{t.sample[i] ? ` · ${t.sample[i]}` : ''}</option>{/each}
          </select>
        </label>
      </div>
    </div>
  {/each}

  {#if pkg.studied}
    <label class="check"><input type="checkbox" bind:checked={withProgress} /> Bring my Anki progress over</label>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={bothWays} /> Ask both ways (question to answer, and back)</label>
  <p class="hint">
    {mediaCount ? `${mediaCount} pictures and sounds come with it. ` : ''}Other fields are kept, and go back to Anki unchanged if you export the deck.
  </p>
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
  <div class="pair">
    <button class="quiet" onclick={onCancel}>Cancel</button>
    <button class="primary" disabled={busy} onclick={go}>{busy ? 'Importing…' : 'Import'}</button>
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
  .field,
  .selects label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    min-width: 0;
  }
  .input {
    width: 100%;
    min-height: 44px;
    padding: 6px 10px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 400;
  }
  .type {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--hair);
  }
  .selects {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }
  small,
  .hint {
    font-size: 13px;
    color: var(--muted);
    font-weight: 400;
  }
  .hint {
    margin: 0;
  }
  .bad {
    color: var(--off-text);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }
  .check input {
    width: 22px;
    height: 22px;
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
  }
</style>
