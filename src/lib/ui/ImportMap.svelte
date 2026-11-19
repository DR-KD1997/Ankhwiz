<script lang="ts">
  // The second step of importing an Anki deck: which Anki fields become the
  // question, the answer and the extra, for each kind of note in the file.
  // Each kind arrives already matched (from its card layout, or a known note
  // type); the learner can change any of it. Question and Extra can hold
  // several fields: "+" adds one after the last, each in slightly smaller type,
  // as they will appear on the card.
  import { aiReady } from '../ai.svelte';
  import { readingLanguages } from '../import/apkg';
  import { importPackage, type AnkiPackage, type ImportStep, type Mapping, type SplitBy } from '../exporting';
  import { canSpeak } from '../speech';
  import { unusedFields } from '../fields';
  import type { AnkiNotetype } from '../core/types';
  import { data } from '../store.svelte';
  import FieldMapper from './FieldMapper.svelte';
  import LangPicker from './LangPicker.svelte';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import Help from './Help.svelte';
  import { offerPart } from '../tour.svelte';
  import { onMount } from 'svelte';

  onMount(() => offerPart('import'));

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
        {
          question: t.question,
          questionMore: [...t.questionMore],
          answer: t.answer,
          extra: t.extra ?? null,
          extraMore: [...t.extraMore],
          selfCheck: t.selfCheck,
          bothWays: !t.cloze && !t.occlusion && t.reverse,
        },
      ]),
    ),
  );
  let withProgress = $state(true);
  // Fields no card will show, with the choices made above: their text can be left out.
  let dropUnusedText = $state(false);
  const unusedNames = $derived(
    [...new Set(pkg.notetypes.flatMap((t) => unusedFields({ ...t, ...maps[t.id] } as AnkiNotetype).map((i) => t.fields[i])))],
  );
  // Templates that read fields aloud with {{tts es_ES:Field}} turn reading on, in their languages.
  // svelte-ignore state_referenced_locally
  const reading = readingLanguages(pkg);
  let read = $state(!!reading);
  let lang = $state(reading?.lang ?? '');
  let langBack = $state(reading?.langBack ?? '');
  // svelte-ignore state_referenced_locally
  let splitBy = $state<SplitBy>(pkg.notes.some((n) => n.group) ? 'subdeck' : 'size');
  let suggest = $state(aiReady());
  let busy = $state(false);
  let stepNow = $state<ImportStep | null>(null);
  const STAGE: Record<ImportStep['stage'], string> = { notes: 'Reading the notes', lessons: 'Building lessons', media: 'Saving pictures and sounds', saving: 'Saving the deck' };
  /** Rough share of the whole import each stage has reached. */
  const share = $derived.by(() => {
    const s = stepNow;
    if (!s) return 0;
    const part = s.total ? s.done / s.total : 1;
    const hasMedia = mediaCount > 0;
    if (s.stage === 'notes') return 0.05;
    if (s.stage === 'lessons') return hasMedia ? 0.15 : 0.3;
    if (s.stage === 'media') return 0.35 + 0.6 * part;
    return 0.97;
  });
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

  async function go() {
    busy = true;
    error = '';
    try {
      const r = await importPackage(
        pkg,
        $state.snapshot(maps),
        { withProgress: withProgress && pkg.studied, name: name.trim(), splitBy, read: read ? { lang: lang.trim(), langBack: langBack.trim() } : null, dropUnused: dropUnusedText },
        (s) => (stepNow = s),
      );
      onDone({ ...r, suggest });
    } catch (e) {
      error = e instanceof Error ? e.message : 'The deck could not be imported.';
    } finally {
      busy = false;
      stepNow = null;
    }
  }
</script>

<div class="map plain">
  <div class="title"><p class="label">Import from Anki</p><Help part="import" /></div>
  <label class="field"><span>Deck name</span><input class="input" bind:value={name} /></label>

  {#each pkg.notetypes as t, ti (t.id)}
    {@const m = maps[t.id]}
    <section class="type" aria-label={t.name} data-tour={ti === 0 ? 'i-fields' : undefined}>
      <div class="head">
        <strong>{t.name}</strong>
        <span class="matched">{MATCHED[t.matched]}</span>
      </div>
      <small>{t.count} {t.count === 1 ? 'note' : 'notes'} · fields: {t.fields.join(', ')}</small>

      {#if t.occlusion}
        <p class="hint">Each note is a picture with parts hidden; each part becomes a card. Parts with names are asked as questions; the rest you check yourself.</p>
      {/if}

      <FieldMapper fields={t.fields} sample={t.sample} map={m} cloze={t.cloze} occlusion={t.occlusion} bothWays={!!m.bothWays} />

      {#if !t.cloze && !t.occlusion}
        <label class="check">
          <input type="checkbox" bind:checked={m.bothWays} />
          <span>Ask both ways <small>{t.reverse ? 'Anki asks this type both ways too. ' : ''}Question to answer, and answer to the main question field.</small></span>
        </label>
      {/if}
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
    <label class="check" data-tour="i-progress"><input type="checkbox" bind:checked={withProgress} /> <span>Bring my Anki progress <small>Cards you know well start at a higher stage.</small></span></label>
  {/if}
  {#if canSpeak()}
    <label class="check"><input type="checkbox" bind:checked={read} /> <span>Read aloud <small>A speaker button by the question and the answer, with this device's own voices.</small></span></label>
    {#if read}
      <div class="langs">
        <div class="field"><span>Question language</span><LangPicker label="Question language" value={lang} emptyLabel="The device's own language" onPick={(c) => (lang = c)} /></div>
        <div class="field"><span>Answer language</span><LangPicker label="Answer language" value={langBack} emptyLabel="Same as the question" onPick={(c) => (langBack = c)} /></div>
      </div>
    {/if}
  {/if}
  {#if aiReady()}
    <label class="check"><input type="checkbox" bind:checked={suggest} /> <span>Suggest lesson names and wrong options <small>Opens Thoth's suggestions after importing. Uses your AI connection; you approve each one.</small></span></label>
  {/if}
  {#if unusedNames.length}
    <label class="check"><input type="checkbox" bind:checked={dropUnusedText} /> <span>Leave out fields no card shows <small>{unusedNames.join(', ')}. The deck is smaller and quicker to open, but goes back to Anki without them.</small></span></label>
  {/if}
  <p class="hint">
    {mediaCount ? `${mediaCount} ${mediaCount === 1 ? 'picture or sound comes' : 'pictures and sounds come'} with it. ` : ''}{dropUnusedText ? '' : 'Fields you do not use are kept, and go back to Anki unchanged if you export the deck. You can delete them later in Deck options.'}
  </p>
  {#if busy && stepNow}
    <ProgressBar label={stepNow.stage === 'media' ? `${STAGE.media}: ${stepNow.done} of ${stepNow.total}` : `${STAGE[stepNow.stage]}…`} value={share} />
  {/if}
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
  <div class="pair">
    <button class="quiet" onclick={onCancel}>Cancel</button>
    <button class="primary" data-tour="i-go" disabled={busy} onclick={go}>{busy ? 'Importing…' : `Import ${pkg.notes.length} notes`}</button>
  </div>
</div>

<style>
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title .label {
    margin: 0;
  }
  .map {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .title > .label {
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
  .langs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
    margin-left: 32px;
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
