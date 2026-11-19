<script lang="ts">
  // Card types: name a type's fields, choose which is the question, the
  // answer and the extra, add or remove fields, and design the card's layout
  // (Anki's templates and styling) with a live preview. The layout is what a
  // deck takes to Anki, and can be shown with the answer in Ankhwiz too.
  import type { AnkiNotetype, AnkiTemplate } from '../core/types';
  import { fieldNameProblem, mapFromRoles, rolesOf, type FieldRole } from '../cardTypes';
  import { data, giveOwnType, openPanel, remapFields, reshapeType, ui, updateType } from '../store.svelte';
  import { planRemap } from '../remap';
  import CardLayout from './CardLayout.svelte';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const types = $derived(Object.values(deck.anki?.notetypes ?? {}).filter((t) => !t.occlusion && Object.values(deck.notes).some((n) => n.anki?.ntid === t.id)));
  const own = $derived(Object.values(deck.notes).filter((n) => !n.anki && !n.cloze && !n.occlusion).length);
  let chosen = $state('');
  const type = $derived(types.find((t) => t.id === chosen) ?? types[0]);
  let tab = $state<'simple' | 'code'>('simple');
  let message = $state('');
  let error = $state('');

  // A note of this type to preview with: the learner can step through them.
  const notes = $derived(type ? Object.values(deck.notes).filter((n) => n.anki?.ntid === type.id) : []);
  let at = $state(0);
  const note = $derived(notes[Math.min(at, notes.length - 1)]);

  // ---------- fields (a draft until saved) ----------
  type Row = { from: number; name: string; role: FieldRole };
  let rows = $state<Row[]>([]);
  let draftFor = '';
  $effect(() => {
    // A fresh draft whenever another type is chosen or the type changes underneath.
    const t = type;
    if (!t) return;
    const key = `${t.id}:${t.fields.join('|')}:${rolesOf(t).join('|')}`;
    if (key === draftFor) return;
    draftFor = key;
    const roles = rolesOf(t);
    rows = t.fields.map((name, i) => ({ from: i, name, role: roles[i] }));
    resetLayout(t);
  });
  const ROLES: [FieldRole, string][] = [
    ['question', 'Question'],
    ['questionMore', 'Shown with the question'],
    ['answer', 'Answer'],
    ['extra', 'Extra (after answering)'],
    ['extraMore', 'Shown after answering'],
    ['none', 'Not shown'],
  ];
  const changedFields = $derived(!!type && (rows.length !== type.fields.length || rows.some((r, i) => r.from !== i || r.name.trim() !== type.fields[i])));
  const changedRoles = $derived(!!type && rows.some((r) => r.role !== (r.from >= 0 ? rolesOf(type)[r.from] : 'none')));
  const roleMap = $derived(mapFromRoles(rows.map((r) => r.role)));
  const remapEffect = $derived.by(() => {
    if (!type || !changedRoles || typeof roleMap === 'string' || changedFields) return null;
    return planRemap(deck, data.progress[deck.id] ?? {}, type.id, roleMap);
  });
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  function addField() {
    let n = rows.length + 1;
    while (rows.some((r) => r.name.toLowerCase() === `field ${n}`)) n++;
    rows.push({ from: -1, name: `Field ${n}`, role: 'none' });
  }
  async function saveFields() {
    if (!type) return;
    error = '';
    message = '';
    for (const [i, r] of rows.entries()) {
      const problem = fieldNameProblem(r.name, rows.filter((_, j) => j !== i).map((x) => x.name));
      if (problem) {
        error = problem;
        return;
      }
    }
    const map = mapFromRoles(rows.map((r) => r.role));
    if (typeof map === 'string') {
      error = map;
      return;
    }
    // Fields first (names, order, new and removed), then which is which.
    if (changedFields) {
      const keepRoles = rolesOf(type);
      const err = reshapeType(
        deck.id,
        type.id,
        rows.map((r) => ({ from: r.from, name: r.name.trim() })),
      );
      if (err) {
        error = err;
        return;
      }
      void keepRoles;
    }
    const now = data.decks[deck.id].anki!.notetypes[type.id];
    const target = mapFromRoles(rows.map((r) => r.role));
    if (typeof target !== 'string' && (target.question !== now.question || target.answer !== now.answer || (target.extra ?? null) !== (now.extra ?? null) || target.questionMore.join() !== (now.questionMore ?? []).join() || target.extraMore.join() !== (now.extraMore ?? []).join())) {
      const err = await remapFields(deck.id, type.id, target);
      if (err) {
        error = err;
        return;
      }
    }
    draftFor = '';
    message = 'Saved. A backup of the deck was made first.';
  }

  // ---------- layout (a draft until saved) ----------
  let templates = $state<AnkiTemplate[]>([]);
  let css = $state('');
  let tIndex = $state(0);
  let part = $state<'qfmt' | 'afmt' | 'css'>('qfmt');
  let editor = $state<HTMLTextAreaElement>();
  function resetLayout(t: AnkiNotetype) {
    templates = t.templates.map((x) => ({ ...x }));
    css = t.css ?? '';
    tIndex = 0;
  }
  const draftType = $derived<AnkiNotetype | undefined>(type ? { ...type, templates: $state.snapshot(templates), css } : undefined);
  const layoutChanged = $derived(!!type && (css !== (type.css ?? '') || templates.some((t, i) => t.qfmt !== type.templates[i]?.qfmt || t.afmt !== type.templates[i]?.afmt)));
  const code = $derived(part === 'css' ? css : (templates[tIndex]?.[part] ?? ''));
  function setCode(v: string) {
    if (part === 'css') css = v;
    else if (templates[tIndex]) templates[tIndex][part] = v;
  }
  function insert(text: string) {
    const el = editor;
    const v = code;
    const a = el?.selectionStart ?? v.length;
    const b = el?.selectionEnd ?? v.length;
    setCode(v.slice(0, a) + text + v.slice(b));
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(a + text.length, a + text.length);
    });
  }
  const chips = $derived(type ? [...type.fields.map((f) => `{{${f}}}`), '{{FrontSide}}', `{{type:${type.fields[type.answer]}}}`, ...type.fields.slice(0, 2).map((f) => `{{#${f}}}…{{/${f}}}`)] : []);
  function saveLayout() {
    if (!type) return;
    updateType(deck.id, type.id, { templates: $state.snapshot(templates), css });
    message = 'Layout saved.';
  }
  // Notes the layout leaves without a front (an empty question field, say), from a sample.
  const emptyFronts = $derived.by(() => {
    if (!draftType) return 0;
    const t = draftType.templates[tIndex] ?? draftType.templates[0];
    if (!t) return 0;
    const fields = /\{\{[^#^/{}]+\}\}/.test(t.qfmt);
    return fields ? 0 : 1;
  });
  const lines = $derived(code.split('\n').length);
</script>

<section class="types">
  <header>
    <button class="icon-btn" aria-label="Back to lessons" onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">Card types</h1>
  </header>

  {#if own}
    <div class="own card">
      <span class="grow"><strong>{own} {own === 1 ? 'card' : 'cards'} made in Ankhwiz</strong><small>They use the standard layout. Give them a card type to name their fields and design how they look in Anki and here.</small></span>
      <button class="quiet" onclick={() => giveOwnType(deck.id)}>Give them a card type</button>
    </div>
  {/if}

  {#if !type}
    <p class="hint">This deck has no card types yet.</p>
  {:else}
    {#if types.length > 1}
      <label class="field"><span>Card type</span>
        <select class="input" value={type.id} onchange={(e) => ((chosen = e.currentTarget.value), (at = 0))}>
          {#each types as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </label>
    {/if}
    <div class="name-row">
      <label class="field grow"><span>Name</span><input class="input" value={type.name} onchange={(e) => updateType(deck.id, type.id, { name: e.currentTarget.value.trim() || type.name })} /></label>
      <span class="count">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
    </div>
    <div class="seg" role="tablist" aria-label="Editor">
      <button role="tab" aria-selected={tab === 'simple'} onclick={() => (tab = 'simple')}>Simple</button>
      <button role="tab" aria-selected={tab === 'code'} onclick={() => (tab = 'code')}>Layout code</button>
    </div>

    <div class="split">
      <div class="edit">
        {#if tab === 'simple'}
          <p class="label">Fields</p>
          {#each rows as r, i (i)}
            <div class="frow">
              <span class="moves">
                <button class="icon-btn" aria-label="Move {r.name} up" disabled={i === 0} onclick={() => move(i, -1)}><Icon name="up" size={16} /></button>
                <button class="icon-btn" aria-label="Move {r.name} down" disabled={i === rows.length - 1} onclick={() => move(i, 1)}><Icon name="down" size={16} /></button>
              </span>
              <input class="input fname" bind:value={r.name} aria-label="Field name" />
              <select class="input" bind:value={r.role} aria-label="Part of the card for {r.name}">
                {#each ROLES as [id, label] (id)}<option value={id}>{label}</option>{/each}
              </select>
              <button class="icon-btn" aria-label="Remove {r.name}" disabled={r.role !== 'none'} title={r.role !== 'none' ? 'Choose “Not shown” first' : 'Remove this field'} onclick={() => rows.splice(i, 1)}><Icon name="trash" size={16} /></button>
            </div>
          {/each}
          <button class="quiet" onclick={addField}><Icon name="plus" size={16} /> Add a field</button>
          {#if typeof roleMap === 'string' && changedRoles}<p class="hint warn">{roleMap}</p>{/if}
          {#if remapEffect && !remapEffect.keeps && remapEffect.studied}<p class="hint warn">Changing the question or the answer makes these different cards: {remapEffect.studied} studied {remapEffect.studied === 1 ? 'card starts' : 'cards start'} again.</p>{/if}
          {#if remapEffect && remapEffect.empty}<p class="hint warn">{remapEffect.empty} {remapEffect.empty === 1 ? 'card' : 'cards'} would have no question or answer.</p>{/if}
          <div class="pair">
            <button class="quiet" disabled={!changedFields && !changedRoles} onclick={() => (draftFor = '')}>Undo changes</button>
            <button class="primary" disabled={!changedFields && !changedRoles} onclick={saveFields}>Save fields</button>
          </div>
          <label class="check"><input type="checkbox" checked={type.bothWays ?? deck.options.bothWays} onchange={(e) => updateType(deck.id, type.id, { bothWays: e.currentTarget.checked })} /> <span>Ask both ways <small>Also asks the answer and wants the question back.</small></span></label>
          <label class="check"><input type="checkbox" checked={!!type.showLayout} onchange={(e) => updateType(deck.id, type.id, { showLayout: e.currentTarget.checked })} /> <span>Show this card's layout with the answer <small>As well as Ankhwiz's own, after you answer. Change it under Layout code.</small></span></label>
        {:else}
          {#if templates.length > 1}
            <div class="seg small" role="tablist" aria-label="Card">
              {#each templates as t, i (i)}<button role="tab" aria-selected={tIndex === i} onclick={() => (tIndex = i)}>{t.name || `Card ${i + 1}`}</button>{/each}
            </div>
          {/if}
          <div class="seg small" role="tablist" aria-label="Part">
            <button role="tab" aria-selected={part === 'qfmt'} onclick={() => (part = 'qfmt')}>Front</button>
            <button role="tab" aria-selected={part === 'afmt'} onclick={() => (part = 'afmt')}>Back</button>
            <button role="tab" aria-selected={part === 'css'} onclick={() => (part = 'css')}>Styling</button>
          </div>
          <div class="code">
            <pre class="nums" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
            <textarea bind:this={editor} value={code} oninput={(e) => setCode(e.currentTarget.value)} spellcheck="false" aria-label="{part === 'css' ? 'Styling' : part === 'qfmt' ? 'Front template' : 'Back template'}" rows={Math.max(10, lines + 1)}></textarea>
          </div>
          {#if part !== 'css'}
            <div class="chips" aria-label="Insert">
              {#each chips as c (c)}<button class="chip" onclick={() => insert(c.replace('…', ''))}>{c}</button>{/each}
            </div>
          {/if}
          {#if emptyFronts}<p class="hint warn">The front names no field, so every card's front would be the same.</p>{/if}
          <p class="hint">Anki's template language: {'{{Field}}'}, {'{{#Field}}…{{/Field}}'} for fields that may be empty, {'{{FrontSide}}'} on the back. Scripts are left out, so shared decks stay safe. Ankhwiz asks cards its own way; this layout is what Anki shows, and what Ankhwiz shows with the answer when you turn that on.</p>
          <div class="pair">
            <button class="quiet" disabled={!layoutChanged} onclick={() => type && resetLayout(type)}>Undo changes</button>
            <button class="primary" disabled={!layoutChanged} onclick={saveLayout}>Save layout</button>
          </div>
        {/if}
      </div>

      <aside class="preview">
        <div class="pv-top">
          <p class="label">Preview</p>
          {#if notes.length > 1}
            <span class="stepper">
              <button class="icon-btn" aria-label="Previous note" onclick={() => (at = (at - 1 + notes.length) % notes.length)}><Icon name="back" size={16} /></button>
              <small>{Math.min(at, notes.length - 1) + 1} of {notes.length}</small>
              <button class="icon-btn flip" aria-label="Next note" onclick={() => (at = (at + 1) % notes.length)}><Icon name="back" size={16} /></button>
            </span>
          {/if}
        </div>
        {#if note && draftType}
          <div class="side card"><small>Front</small><CardLayout deckId={deck.id} type={draftType} {note} side="front" template={tIndex} /></div>
          <div class="side card ans"><small>Back</small><CardLayout deckId={deck.id} type={draftType} {note} side="back" template={tIndex} /></div>
        {/if}
      </aside>
    </div>
  {/if}
  {#if message}<p class="hint good" role="status">{message}</p>{/if}
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
</section>

<style>
  .types {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    width: 100%;
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
  .warn {
    color: var(--close-text);
  }
  .good {
    color: var(--ok-text);
  }
  .bad {
    color: var(--off-text);
  }
  .own {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1 1 220px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
  }
  .name-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }
  .count {
    color: var(--muted);
    padding-bottom: 10px;
  }
  .seg {
    display: inline-flex;
    border: 2px solid var(--line);
    align-self: flex-start;
  }
  .seg button {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button + button {
    border-left: 2px solid var(--line);
  }
  .seg button[aria-selected='true'] {
    background: var(--emerald);
    color: var(--surface);
  }
  .seg.small button {
    min-height: 36px;
    padding: 0 12px;
    font-size: 14px;
  }
  .split {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .edit {
    flex: 999 1 380px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .preview {
    flex: 1 1 280px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pv-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pv-top .label {
    margin: 0;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .flip :global(svg) {
    transform: scaleX(-1);
  }
  .side {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .side.ans {
    border-color: var(--ok-line);
  }
  .frow {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .moves {
    display: inline-flex;
  }
  .fname {
    flex: 1 1 140px;
    min-width: 0;
  }
  .frow select {
    flex: 1 1 180px;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .check input {
    width: 22px;
    height: 22px;
    flex: none;
    accent-color: var(--emerald);
  }
  .check span {
    display: flex;
    flex-direction: column;
  }
  .code {
    display: flex;
    border: 2px solid var(--line);
    background: #1e1706;
    max-height: 420px;
    overflow: auto;
  }
  .nums {
    margin: 0;
    padding: 10px 8px;
    text-align: right;
    color: #8f7f5c;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 14px;
    line-height: 1.6;
    border-right: 1px solid #5c4c33;
    user-select: none;
  }
  .code textarea {
    flex: 1;
    min-width: 0;
    border: 0;
    margin: 0;
    padding: 10px 12px;
    background: transparent;
    color: #f1e3c4;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 14px;
    line-height: 1.6;
    resize: none;
    white-space: pre;
    overflow: hidden;
    outline: none;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 36px;
    padding: 0 10px;
    border: 2px solid var(--hair);
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 13px;
    cursor: pointer;
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .label {
    margin: 0;
  }
</style>
