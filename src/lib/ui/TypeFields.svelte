<script lang="ts">
  // Deck options › Fields: change which Anki fields become one note type's
  // question, answer and extra after the deck was imported. Extra fields, and
  // the question fields shown under the main one, can change freely and keep
  // progress. Changing the main question or the answer makes them different
  // cards, so it warns first: those cards start again from the beginning.
  import type { AnkiNotetype, Deck } from '../core/types';
  import type { FieldMap } from '../import/apkg';
  import { fieldText } from '../import/html';
  import { currentMap, planRemap, sameMap } from '../remap';
  import { data, remapFields } from '../store.svelte';
  import FieldMapper from './FieldMapper.svelte';
  import Icon from './Icon.svelte';

  let { deck, type }: { deck: Deck; type: AnkiNotetype } = $props();

  let open = $state(false);
  let draft = $state<FieldMap>({ question: 0, answer: 0, extra: null, questionMore: [], extraMore: [] });
  let confirming = $state(false);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');

  const first = $derived(Object.values(deck.notes).find((n) => n.anki?.ntid === type.id));
  const sample = $derived((first?.anki?.fields ?? []).map((f) => fieldText(f).slice(0, 60)));
  const changed = $derived(open && !sameMap(draft, currentMap(type)));
  const plan = $derived(changed ? planRemap(deck, data.progress[deck.id] ?? {}, type.id, $state.snapshot(draft)) : null);
  const flag = $derived(open ? { question: draft.question !== type.question, answer: !type.cloze && draft.answer !== type.answer } : null);
  const where = (i: number | null | undefined) => (i === null || i === undefined ? 'None' : (type.fields[i] ?? '?'));
  const summary = $derived(`Question: ${[type.question, ...(type.questionMore ?? [])].map(where).join(', ')}${type.cloze ? '' : ` · Answer: ${where(type.answer)}`}${type.extra !== null && type.extra !== undefined ? ` · Extra: ${[type.extra, ...(type.extraMore ?? [])].map(where).join(', ')}` : ''}`);

  function start() {
    draft = currentMap(type);
    open = true;
    confirming = false;
    error = '';
    message = '';
  }
  function cancel() {
    open = false;
    confirming = false;
    error = '';
  }
  async function save() {
    // Read the plan now: once saved, the fields match again and there is no plan.
    const p = plan;
    if (!p) return;
    if (p.empty) {
      error = `${p.empty} ${p.empty === 1 ? 'card' : 'cards'} would have no question or no answer with these fields. Choose other fields.`;
      return;
    }
    // Changing the main question or the answer asks once more before progress is lost.
    if (!p.keeps && p.studied && !confirming) {
      confirming = true;
      return;
    }
    busy = true;
    const err = await remapFields(deck.id, type.id, $state.snapshot(draft));
    busy = false;
    if (err) {
      error = err;
      return;
    }
    open = false;
    confirming = false;
    message = p.keeps ? 'Fields changed. Your progress is kept.' : p.studied ? 'Fields changed. These cards start again from the beginning; the deck as it was is in Backups.' : 'Fields changed.';
  }
</script>

<div class="type">
  <div class="row">
    <span><strong>{type.name}</strong><small>{summary}</small></span>
    {#if !open}<button class="quiet" onclick={start}>Change</button>{/if}
  </div>

  {#if open}
    <div class="editor">
      <FieldMapper fields={type.fields} {sample} map={draft} cloze={type.cloze} bothWays={!!type.bothWays} {flag} />
      {#if plan && !plan.keeps}
        <p class="warn" role="alert">
          <Icon name="info" size={18} />
          <span>
            <strong>{type.cloze ? 'Changing the text with gaps' : 'Changing the main question or answer field'} starts these cards again.</strong>
            {plan.studied
              ? `They become different cards, so the progress of ${plan.studied} studied ${plan.studied === 1 ? 'card' : 'cards'} of this type goes back to the beginning. To keep your progress, change only the other fields.`
              : 'None of these cards has been studied yet, so no progress is lost.'}
          </span>
        </p>
      {:else if changed}
        <p class="hint">The main question and answer stay the same, so your progress is kept.</p>
      {/if}
      {#if confirming}
        <p class="hint strong" role="alert">Start {plan?.studied} {plan?.studied === 1 ? 'card' : 'cards'} again from the beginning? A backup of the deck is made first.</p>
      {/if}
      {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
      <div class="pair">
        <button class="quiet" onclick={cancel}>{confirming ? 'Keep the fields as they were' : 'Cancel'}</button>
        <button class={confirming ? 'danger' : 'primary'} disabled={!changed || busy} onclick={save}>
          {busy ? 'Saving…' : confirming ? 'Change and start again' : 'Save fields'}
        </button>
      </div>
    </div>
  {/if}
  {#if message}<p class="hint" role="status">{message}</p>{/if}
</div>

<style>
  .type {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    border-top: 1.5px solid var(--hair);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .row > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row small,
  .hint {
    font-size: 13px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .row .quiet {
    flex: none;
    min-height: 40px;
    padding: 0 14px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hint {
    margin: 0;
  }
  .strong {
    color: var(--text);
    font-weight: 600;
  }
  .bad {
    color: var(--off-text);
  }
  .warn {
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
  .warn span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pair {
    display: flex;
    gap: 10px;
  }
  .pair button {
    flex: 1;
    min-height: 48px;
  }
  .danger {
    border: 2px solid var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
    font-weight: 600;
  }
</style>
