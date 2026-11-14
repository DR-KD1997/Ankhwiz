<script lang="ts">
  // Cards: every card of the deck by unit and lesson, with search, labels,
  // a card editor with its history, and lesson renaming and reordering.
  // (Anki: the Browser.)
  import { limits } from '../core';
  import { cardIds, filledIn, gapNumbers } from './cardIds';
  import type { CardState, Edit, Note, Occlusion } from '../core/types';
  import { freeName, isAudio, putMedia } from '../media';
  import { data, editDeck, flagCard, now, openPanel, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Media from './Media.svelte';
  import OcclusionEditor from './OcclusionEditor.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});

  let query = $state('');
  let label = $state('');
  let show = $state<'all' | 'stopped' | 'tricky' | 'ai' | 'new'>('all');
  let editing = $state<string | null>(ui.editNote);
  let adding = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let newName = $state('');
  let notice = $state('');
  $effect(() => {
    ui.editNote = null;
  });

  const allLabels = $derived([...new Set(Object.values(deck.notes).flatMap((n) => n.labels ?? []))].sort());
  const lessonList = $derived(deck.units.flatMap((u) => u.lessonIds.map((id) => ({ id, name: deck.lessons[id].name, unit: u.name }))));

  const text = (n: Note) =>
    n.occlusion ? `${n.front ? `${n.front} · ` : ''}Picture, ${n.occlusion.shapes.length} hidden ${n.occlusion.shapes.length === 1 ? 'part' : 'parts'}` : n.cloze ? filledIn(n.front) : n.front;
  function cardsOf(n: Note): string[] {
    return cardIds(deck, n);
  }
  function stateOf(n: Note): { stage: number; stopped: boolean; lapses: number; met: boolean } {
    const states = cardsOf(n).map((c) => progress[c]).filter(Boolean) as CardState[];
    return {
      stage: states.length ? Math.min(...states.map((c) => c.stage)) : 0,
      stopped: states.some((c) => c.suspended),
      lapses: Math.max(0, ...states.map((c) => c.lapses)),
      met: states.length > 0,
    };
  }
  function matches(n: Note): boolean {
    const q = query.trim().toLowerCase();
    if (q && ![n.front, n.back, n.extra ?? '', ...(n.alts ?? []), ...(n.labels ?? [])].some((t) => t.toLowerCase().includes(q))) return false;
    if (label && !(n.labels ?? []).includes(label)) return false;
    const st = stateOf(n);
    if (show === 'stopped' && !st.stopped) return false;
    if (show === 'tricky' && st.lapses < 2) return false;
    if (show === 'ai' && !n.ai) return false;
    if (show === 'new' && st.met) return false;
    return true;
  }
  const filtering = $derived(query.trim() !== '' || label !== '' || show !== 'all');
  const groups = $derived(
    deck.units.map((u) => ({
      unit: u,
      lessons: u.lessonIds.map((id) => ({
        lesson: deck.lessons[id],
        notes: deck.lessons[id].noteIds.map((n) => deck.notes[n]).filter((n) => n && matches(n)),
      })),
    })),
  );
  const shown = $derived(groups.reduce((t, g) => t + g.lessons.reduce((s, l) => s + l.notes.length, 0), 0));

  function edit(edits: Edit[], message = '') {
    const r = editDeck(deck.id, edits);
    notice = message || (r.skipped ? 'Some changes could not be made.' : '');
    return r;
  }

  // ---------- the editor ----------
  const blank = () => ({
    front: '',
    back: '',
    extra: '',
    alts: '',
    wrong: '',
    labels: '',
    lessonId: '',
    qmedia: [] as string[],
    amedia: [] as string[],
    frontMore: [] as string[],
    extraMore: [] as string[],
    selfCheck: false,
    picture: false,
    occlusion: null as Occlusion | null,
  });
  let form = $state(blank());
  /** Type size for the n-th extra field of a list: smaller each time, down to the fourth. */
  const step = (n: number) => ['s1', 's2', 's3'][Math.min(n, 2)];
  let confirmDelete = $state(false);
  const list = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const gaps = $derived(gapNumbers(form.front));
  const isCloze = $derived(gaps.length > 0 && !form.back.trim());

  function open(id: string | null, lessonId = '') {
    confirmDelete = false;
    notice = '';
    if (id === null) {
      adding = lessonId || lessonList.at(-1)?.id || null;
      editing = null;
      form = { ...blank(), labels: label, lessonId: adding ?? '' };
      return;
    }
    const n = deck.notes[id];
    const lessonOf = lessonList.find((l) => deck.lessons[l.id].noteIds.includes(id))?.id ?? '';
    editing = id;
    adding = null;
    form = {
      front: n.front,
      back: n.cloze ? '' : n.back,
      extra: n.extra ?? '',
      alts: (n.alts ?? []).join(', '),
      wrong: (n.wrong ?? []).join(', '),
      labels: (n.labels ?? []).join(', '),
      lessonId: lessonOf,
      qmedia: [...(n.qmedia ?? [])],
      amedia: [...(n.amedia ?? [])],
      frontMore: [...(n.frontMore ?? [])],
      extraMore: [...(n.extraMore ?? [])],
      selfCheck: !!n.selfCheck,
      picture: !!n.occlusion,
      occlusion: n.occlusion ? structuredClone($state.snapshot(n.occlusion)) : null,
    };
  }
  $effect(() => {
    if (editing && deck.notes[editing] && form.front === '' && !form.picture && !adding) open(editing);
  });

  function close() {
    editing = null;
    adding = null;
  }

  const valid = $derived(
    form.picture ? !!form.occlusion?.image && (form.occlusion?.shapes.length ?? 0) > 0 : form.front.trim() !== '' && (isCloze || form.back.trim() !== ''),
  );

  function saveCard() {
    if (!valid) return;
    if (adding) {
      edit([
        {
          op: 'add',
          lessonId: form.lessonId,
          note: {
            front: form.front,
            back: isCloze ? '' : form.back,
            extra: form.extra,
            alts: list(form.alts),
            labels: list(form.labels),
            qmedia: form.qmedia,
            amedia: form.amedia,
            cloze: !form.picture && isCloze,
            frontMore: form.frontMore,
            extraMore: form.extraMore,
            selfCheck: form.selfCheck,
            occlusion: form.picture ? $state.snapshot(form.occlusion) : null,
          },
        },
      ]);
      open(null, form.lessonId);
      notice = 'Card added. Add another, or go back to the list.';
      return;
    }
    const id = editing!;
    const edits: Edit[] = [
      {
        op: 'update',
        noteId: id,
        front: form.front,
        back: isCloze || form.picture ? undefined : form.back,
        extra: form.extra,
        alts: list(form.alts),
        wrong: list(form.wrong),
        labels: list(form.labels),
        qmedia: form.qmedia,
        amedia: form.amedia,
        cloze: form.picture ? undefined : isCloze,
        frontMore: form.frontMore,
        extraMore: form.extraMore,
        selfCheck: form.selfCheck,
        occlusion: form.picture && form.occlusion ? $state.snapshot(form.occlusion) : undefined,
      },
    ];
    const current = lessonList.find((l) => deck.lessons[l.id].noteIds.includes(id))?.id;
    if (form.lessonId && form.lessonId !== current) edits.push({ op: 'move', noteId: id, lessonId: form.lessonId });
    edit(edits, 'Saved.');
    close();
  }

  function deleteCard() {
    if (!editing) return;
    edit([{ op: 'delete', noteId: editing }], 'Card removed.');
    close();
  }

  async function attach(side: 'qmedia' | 'amedia', files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const name = await freeName(deck.id, file.name);
      if (await putMedia(deck.id, name, file)) form[side] = [...form[side], name];
      else notice = 'This device could not store the file.';
    }
  }

  // ---------- history ----------
  const day = (d: number) => new Date(d * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const dueText = (c: CardState) => {
    const days = Math.round((c.due - now()) / 86_400_000);
    return days <= 0 ? 'Due now' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
  };
  const cardName = (id: string) =>
    id.endsWith(':r')
      ? 'Other way round'
      : id.includes(':c')
        ? `Gap ${id.split(':c')[1]}`
        : id.includes(':o')
          ? `Part ${id.split(':o')[1]}`
          : deck.notes[id]?.occlusion
            ? `Part ${Math.min(...deck.notes[id].occlusion!.shapes.map((s) => s.ord))}`
            : deck.notes[id]?.cloze
              ? 'Gap 1'
              : 'Question to answer';

  function rename(kind: 'lesson' | 'unit', id: string) {
    if (!newName.trim()) return;
    edit([kind === 'lesson' ? { op: 'renameLesson', lessonId: id, name: newName } : { op: 'renameUnit', unitId: id, name: newName }]);
    renaming = null;
  }
</script>

<section class="contents">
  <header>
    <button class="icon-btn" aria-label={editing || adding ? 'Back to cards' : 'Back to lessons'} onclick={() => (editing || adding ? close() : openPanel('path'))}>
      <Icon name="back" />
    </button>
    <h1 class="display">{adding ? 'New card' : editing ? 'Edit card' : 'Cards'}</h1>
    {#if !editing && !adding}<span class="count">{filtering ? `${shown} of ` : ''}{Object.keys(deck.notes).length}</span>{/if}
  </header>

  {#if notice}<p class="notice plain" role="status">{notice}</p>{/if}

  {#if editing || adding}
    {@const n = editing ? deck.notes[editing] : null}
    <div class="editor">
      {#if adding}
        <div class="seg" role="group" aria-label="Kind of card">
          <button aria-pressed={!form.picture} onclick={() => (form.picture = false)}>Question and answer</button>
          <button aria-pressed={form.picture} onclick={() => ((form.picture = true), (form.occlusion ??= { image: '', shapes: [], hideAll: false }))}>Picture with hidden parts</button>
        </div>
      {/if}
      {#if form.picture}
        <OcclusionEditor deckId={deck.id} bind:value={form.occlusion} />
      {/if}
      <div class="field">
        <label for="q-main">{form.picture ? 'Heading' : 'Question'} <small>{form.picture ? 'Optional: shown above the picture' : 'Write gaps as {{c1::answer}} for a fill-the-gap card'}</small></label>
        <div class="more-row">
          <textarea id="q-main" class="input" rows={form.picture ? 1 : 3} bind:value={form.front} dir="auto"></textarea>
          {#if !form.picture && !isCloze && !form.frontMore.length}
            <button class="plus" aria-label="Add another question field" onclick={() => (form.frontMore = [...form.frontMore, ''])}><Icon name="plus" size={18} /></button>
          {/if}
        </div>
        {#each form.frontMore as _, i (i)}
          <div class="more-row">
            <input class="input {step(i)}" aria-label="Question field {i + 2}" bind:value={form.frontMore[i]} dir="auto" />
            <button class="minus" aria-label="Remove question field {i + 2}" onclick={() => (form.frontMore = form.frontMore.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            {#if i === form.frontMore.length - 1}
              <button class="plus" aria-label="Add another question field" onclick={() => (form.frontMore = [...form.frontMore, ''])}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
        {/each}
        {#if form.frontMore.length}<small>The first field is the main question (asked the other way round when the deck asks both ways); the others show under it, smaller{form.frontMore.length > 2 ? ', and after the third, behind an arrow' : ''}.</small>{/if}
      </div>
      {#if form.picture}
        <!-- a picture card has no written answer: its parts are the answers -->
      {:else if gaps.length && !form.back.trim()}
        <p class="hint">Fill-the-gap card with {gaps.length} {gaps.length === 1 ? 'gap' : 'gaps'}: each gap is asked on its own.</p>
      {:else}
        <label class="field">
          <span>Answer</span>
          <textarea class="input" rows="2" bind:value={form.back} dir="auto"></textarea>
        </label>
      {/if}
      <div class="media-edit">
        <span class="label">Question pictures and sounds</span>
        <Media deckId={deck.id} names={form.qmedia} small />
        {#each form.qmedia as m (m)}
          <button class="chip" onclick={() => (form.qmedia = form.qmedia.filter((x) => x !== m))}>{isAudio(m) ? '♪' : '▣'} {m} <Icon name="close" size={12} /></button>
        {/each}
        <label class="quiet attach">Add<input type="file" accept="image/*,audio/*" multiple onchange={(e) => attach('qmedia', e.currentTarget.files)} /></label>
      </div>
      {#if !isCloze}
        <div class="media-edit">
          <span class="label">Answer pictures and sounds</span>
          <Media deckId={deck.id} names={form.amedia} small />
          {#each form.amedia as m (m)}
            <button class="chip" onclick={() => (form.amedia = form.amedia.filter((x) => x !== m))}>{isAudio(m) ? '♪' : '▣'} {m} <Icon name="close" size={12} /></button>
          {/each}
          <label class="quiet attach">Add<input type="file" accept="image/*,audio/*" multiple onchange={(e) => attach('amedia', e.currentTarget.files)} /></label>
        </div>
      {/if}
      <div class="field">
        <label for="x-main">Extra <small>An example or note, shown after answering</small></label>
        <div class="more-row">
          <textarea id="x-main" class="input" rows="2" bind:value={form.extra} dir="auto"></textarea>
          {#if form.extra.trim() && !form.extraMore.length}
            <button class="plus" aria-label="Add another extra field" onclick={() => (form.extraMore = [...form.extraMore, ''])}><Icon name="plus" size={18} /></button>
          {/if}
        </div>
        {#each form.extraMore as _, i (i)}
          <div class="more-row">
            <input class="input {step(i)}" aria-label="Extra field {i + 2}" bind:value={form.extraMore[i]} dir="auto" />
            <button class="minus" aria-label="Remove extra field {i + 2}" onclick={() => (form.extraMore = form.extraMore.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            {#if i === form.extraMore.length - 1}
              <button class="plus" aria-label="Add another extra field" onclick={() => (form.extraMore = [...form.extraMore, ''])}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={form.selfCheck} />
        <span>You check this card yourself <small>See the answer and say how close you were, instead of being marked</small></span>
      </label>
      <label class="field">
        <span>Also accepted <small>Other right answers, separated by commas</small></span>
        <input class="input" bind:value={form.alts} dir="auto" />
      </label>
      {#if !isCloze && editing}
        <label class="field">
          <span>Wrong options <small>Shown first in multiple choice, separated by commas</small></span>
          <input class="input" bind:value={form.wrong} dir="auto" />
        </label>
      {/if}
      <label class="field">
        <span>Labels <small>Your own tags, separated by commas</small></span>
        <input class="input" bind:value={form.labels} list="labels" />
        <datalist id="labels">{#each allLabels as l (l)}<option value={l}></option>{/each}</datalist>
      </label>
      <label class="field">
        <span>Lesson</span>
        <select class="input" bind:value={form.lessonId}>
          {#each lessonList as l (l.id)}<option value={l.id}>{l.unit !== deck.name ? `${l.unit} · ` : ''}{l.name}</option>{/each}
        </select>
      </label>

      {#if n}
        <div class="history plain">
          <p class="label">History {#if n.ai}<span class="tag">AI</span>{/if}</p>
          {#each cardsOf(n) as cid (cid)}
            {@const c = progress[cid]}
            <div class="hrow">
              <span class="grow">
                <strong>{cardName(cid)}</strong>
                {#if c}
                  <small>
                    Stage {c.stage} · {limits.stageNames[c.stage - 1]} · {c.suspended ? 'Stopped' : dueText(c)} · {c.reps}
                    {c.reps === 1 ? 'answer' : 'answers'}, {c.lapses} wrong{c.added != null ? ` · first met ${day(c.added)}` : ''}
                  </small>
                  {#if c.hist?.length}
                    <span class="dots" aria-label="Recent answers">
                      {#each c.hist.slice(-12) as h, i (i)}<i class:ok={h.ok} title="{day(h.day)}: {h.ok ? 'right' : 'wrong'}"></i>{/each}
                    </span>
                  {/if}
                {:else}
                  <small>Not met yet</small>
                {/if}
              </span>
              {#if c?.suspended || (c?.buried ?? null) !== null}
                <button class="quiet small" onclick={() => flagCard(deck.id, cid, 'resume')}>Resume</button>
              {:else if c}
                <button class="quiet small" onclick={() => flagCard(deck.id, cid, 'stop')} title="Anki: suspend">Stop asking</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        {#if editing}
          {#if confirmDelete}
            <button class="quiet danger" onclick={deleteCard}>Remove for good</button>
          {:else}
            <button class="icon-btn" aria-label="Remove card" onclick={() => (confirmDelete = true)}><Icon name="trash" /></button>
          {/if}
        {/if}
        <span class="grow"></span>
        <button class="quiet" onclick={close}>Cancel</button>
        <button class="primary" disabled={!valid} onclick={saveCard}>{adding ? 'Add card' : 'Save'}</button>
      </div>
    </div>
  {:else}
    <div class="filters">
      <label class="search">
        <Icon name="search" size={18} />
        <input bind:value={query} placeholder="Search cards" aria-label="Search cards" />
      </label>
      <div class="pair">
        <select class="input" bind:value={show} aria-label="Show">
          <option value="all">All cards</option>
          <option value="new">Not met yet</option>
          <option value="tricky">Tricky</option>
          <option value="stopped">Stopped</option>
          <option value="ai">Written by AI</option>
        </select>
        {#if allLabels.length}
          <select class="input" bind:value={label} aria-label="Label">
            <option value="">Any label</option>
            {#each allLabels as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        {/if}
      </div>
      <button class="quiet add" onclick={() => open(null)}><Icon name="plus" size={18} /> Add a card</button>
    </div>

    {#each groups as g (g.unit.id)}
      <div class="unit">
        {#if renaming === g.unit.id}
          <form class="rename" onsubmit={(e) => (e.preventDefault(), rename('unit', g.unit.id))}>
            <input class="input" bind:value={newName} aria-label="Unit name" />
            <button class="quiet">Rename</button>
          </form>
        {:else}
          <p class="label unit-name">
            {g.unit.name}
            <button class="link" onclick={() => ((renaming = g.unit.id), (newName = g.unit.name))}>Rename</button>
          </p>
        {/if}
        {#each g.lessons as l, li (l.lesson.id)}
          {#if !filtering || l.notes.length}
            <div class="lesson">
              <div class="lhead">
                {#if renaming === l.lesson.id}
                  <form class="rename" onsubmit={(e) => (e.preventDefault(), rename('lesson', l.lesson.id))}>
                    <input class="input" bind:value={newName} aria-label="Lesson name" />
                    <button class="quiet">Rename</button>
                  </form>
                {:else}
                  <strong class="grow">{l.lesson.name} <small>· {l.lesson.noteIds.length}</small></strong>
                  <button class="icon-btn s" aria-label="Rename {l.lesson.name}" onclick={() => ((renaming = l.lesson.id), (newName = l.lesson.name))}><Icon name="edit" size={16} /></button>
                  <button class="icon-btn s" aria-label="Move {l.lesson.name} up" onclick={() => edit([{ op: 'shiftLesson', lessonId: l.lesson.id, delta: -1 }])}><Icon name="up" size={16} /></button>
                  <button class="icon-btn s" aria-label="Move {l.lesson.name} down" onclick={() => edit([{ op: 'shiftLesson', lessonId: l.lesson.id, delta: 1 }])}><Icon name="down" size={16} /></button>
                  <button class="icon-btn s" aria-label="Add a card to {l.lesson.name}" onclick={() => open(null, l.lesson.id)}><Icon name="plus" size={16} /></button>
                {/if}
              </div>
              <ul>
                {#each l.notes as n (n.id)}
                  {@const st = stateOf(n)}
                  <li>
                    <button class="row" onclick={() => open(n.id)}>
                      <span class="grow">
                        <span class="front" dir="auto">{text(n)}</span>
                        {#if !n.cloze}<span class="back" dir="auto">{n.back}</span>{/if}
                      </span>
                      <span class="badges">
                        {#if n.qmedia?.length || n.amedia?.length}<i title="Has media">▣</i>{/if}
                        {#if n.cloze}<i title="Fill the gap">[ ]</i>{/if}
                        {#if n.ai}<span class="tag">AI</span>{/if}
                        {#if st.stopped}<span class="tag">Stopped</span>{/if}
                        <span class="stage" class:none={!st.met} title={st.met ? `Stage ${st.stage}` : 'Not met yet'}>{st.met ? st.stage : '·'}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
              {#if !filtering && li === g.lessons.length - 1}
                <button class="link" onclick={() => edit([{ op: 'addLesson', unitId: g.unit.id, name: `Lesson ${Object.keys(deck.lessons).length + 1}` }])}>
                  + New lesson in {g.unit.name}
                </button>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/each}
    {#if filtering && shown === 0}<p class="hint">No cards match.</p>{/if}
  {/if}
</section>

<style>
  .contents {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding-block: 20px 40px;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    flex: 1;
    font-size: 24px;
  }
  .count,
  small,
  .hint {
    color: var(--muted);
    font-size: 14px;
  }
  .hint {
    margin: 0;
  }
  .notice {
    margin: 0;
    padding: 8px 12px;
    font-weight: 600;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    min-height: 46px;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    outline: none;
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair select {
    flex: 1;
    min-width: 0;
  }
  .input {
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  textarea.input {
    resize: vertical;
    line-height: 1.4;
  }
  .add {
    align-self: flex-start;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
  }
  .unit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .unit-name {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin: 0;
  }
  .lesson {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lhead {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-bottom: 4px;
    border-bottom: 2px solid var(--line);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .icon-btn.s {
    width: 36px;
    height: 36px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 4px;
    border: none;
    border-bottom: 1px solid var(--hair);
    background: none;
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .row:hover {
    background: var(--sel-bg);
  }
  .row .grow {
    display: flex;
    flex-direction: column;
  }
  .front {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .back {
    color: var(--muted);
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .badges {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    flex: none;
    font-style: normal;
  }
  .badges i {
    font-style: normal;
    color: var(--muted);
    font-size: 13px;
  }
  .stage {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--badge-bg);
    color: var(--badge-text);
    font-size: 13px;
    font-weight: 700;
  }
  .stage.none {
    background: transparent;
    border: 1.5px solid var(--hair);
    color: var(--muted);
  }
  .tag {
    display: inline-block;
    padding: 0 5px;
    border: 1.5px solid currentColor;
    font-size: 11px;
    letter-spacing: 0.06em;
  }
  .link {
    align-self: flex-start;
    padding: 4px 0;
    border: none;
    background: none;
    color: var(--muted);
    text-decoration: underline;
    font: inherit;
    font-size: 14px;
  }
  .rename {
    display: flex;
    gap: 8px;
    flex: 1;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
  }
  .field small {
    font-weight: 400;
  }
  .media-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .media-edit .label {
    flex-basis: 100%;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1.5px solid var(--hair);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .attach {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    font-size: 14px;
    cursor: pointer;
  }
  .attach input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .history {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .history .label {
    margin: 0;
  }
  .hrow {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .hrow .grow {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 10px;
    height: 10px;
    background: var(--off-line);
  }
  .dots i.ok {
    background: var(--ok-line);
  }
  .small {
    min-height: 36px;
    padding: 0 10px;
    font-size: 14px;
    flex: none;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions .quiet {
    min-height: 52px;
    padding: 0 16px;
  }
  .actions .primary {
    min-width: 120px;
    padding: 0 18px;
  }
  .danger {
    border-color: var(--off-line);
    color: var(--off-text);
  }
  .more-row {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .more-row .input {
    flex: 1;
    min-width: 0;
  }
  .s1 {
    font-size: 15px;
  }
  .s2 {
    font-size: 14px;
  }
  .s3 {
    font-size: 13px;
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
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-weight: 600;
  }
  .check span {
    display: flex;
    flex-direction: column;
  }
  .check small {
    font-weight: 400;
    color: var(--muted);
  }
  .check input {
    flex: none;
    width: 22px;
    height: 22px;
    accent-color: var(--emerald);
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .seg button {
    flex: 1;
    min-height: 44px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: 600 14px var(--body);
  }
  .seg button[aria-pressed='true'] {
    background: var(--emerald);
    border-color: var(--emerald);
    color: #fbf4e2;
  }
</style>
