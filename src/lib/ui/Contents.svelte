<script lang="ts">
  import { plural, shownName, stageName, t } from '../i18n';
  import AnswerLinks from './AnswerLinks.svelte';
  import Help from './Help.svelte';
  import { offerPart } from '../tour.svelte';
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
  import { moved, sortable } from './sortable';
  import { noteHas } from './searchIndex';
  import { flagOf, langName } from '../languages';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});

  let query = $state('');
  let label = $state('');
  let show = $state<'all' | 'stopped' | 'tricky' | 'ai' | 'new' | 'unsourced'>('all');
  let editing = $state<string | null>(ui.editNote);
  let adding = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let newName = $state('');
  let notice = $state('');
  $effect(() => {
    ui.editNote = null;
  });

  const allLabels = $derived([...new Set(Object.values(deck.notes).flatMap((n) => n.labels ?? []))].sort());
  const lessonList = $derived(deck.units.flatMap((u) => u.lessonIds.map((id) => ({ id, name: shownName(deck.lessons[id].name), unit: shownName(u.name) }))));

  const text = (n: Note) =>
    n.occlusion ? plural('{x}Picture, {n} hidden part', '{x}Picture, {n} hidden parts', n.occlusion.shapes.length, { x: n.front ? `${n.front} · ` : '' }) : n.cloze ? filledIn(n.front) : n.front;
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
  const q = $derived(query.trim().toLowerCase());
  function matches(n: Note): boolean {
    if (q && !noteHas(deck.notes, n, q)) return false;
    if (label && !(n.labels ?? []).includes(label)) return false;
    if (show === 'all') return true;
    if (show === 'ai') return !!n.ai;
    if (show === 'unsourced') return !!n.source && !n.source.found;
    // Only these filters need the cards' progress, which is slower to look up for every note.
    const st = stateOf(n);
    if (show === 'stopped' && !st.stopped) return false;
    if (show === 'tricky' && st.lapses < 2) return false;
    if (show === 'new' && st.met) return false;
    return true;
  }
  const filtering = $derived(query.trim() !== '' || label !== '' || show !== 'all');
  const groups = $derived.by(() => {
    // `start`: how many cards come before this lesson, so long decks can be shown a part at a time.
    let start = 0;
    return deck.units.map((u) => ({
      unit: u,
      lessons: u.lessonIds.map((id) => {
        const notes = deck.lessons[id].noteIds.map((n) => deck.notes[n]).filter((n) => n && matches(n));
        const at = start;
        start += notes.length;
        return { lesson: deck.lessons[id], notes, start: at };
      }),
    }));
  });
  const shown = $derived(groups.reduce((t, g) => t + g.lessons.reduce((s, l) => s + l.notes.length, 0), 0));
  // Very large decks list their cards a few hundred at a time, lesson by lesson.
  const PAGE = 400;
  let limit = $state(PAGE);

  function edit(edits: Edit[], message = '') {
    const r = editDeck(deck.id, edits);
    notice = message || (r.skipped ? t('Some changes could not be made.') : '');
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
    noBuild: false,
    voices: [] as { text: string; lang: string }[],
    picture: false,
    occlusion: null as Occlusion | null,
  });
  let form = $state(blank());
  // The first time a card is opened for editing (or a new one), Thoth explains the editor.
  $effect(() => {
    if (editing || adding) offerPart('editor');
  });

  // Marking words to be read in another language: the words last selected in
  // the question or answer, and the language to read them in.
  let picked = $state('');
  let markLang = $state('');
  const voiceLangs = $derived.by(() => {
    const l = deck.options.look;
    const mine = [l.langBack, l.quoteLang, l.lang].filter((x): x is string => !!x);
    return [...new Set([...mine, 'en-GB', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'ja-JP', 'zh-CN', 'ko-KR', 'ru-RU', 'ar-SA', 'af-ZA', 'zu-ZA'])];
  });
  $effect(() => {
    if (!markLang && voiceLangs.length) markLang = voiceLangs[0];
  });
  function pick(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    const text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0).trim();
    if (text) picked = text.slice(0, 120);
  }
  function addMark() {
    if (!picked || !markLang) return;
    form.voices = [...form.voices.filter((v) => v.text !== picked), { text: picked, lang: markLang }];
    picked = '';
  }
  /** Type size for the n-th extra field of a list: smaller each time, down to the fourth. */
  const step = (n: number) => ['s1', 's2', 's3'][Math.min(n, 2)];
  /** Drag a question or extra field to another place; the one moved to the top becomes the main field. */
  function reorderFields(list: 'front' | 'extra', from: number, to: number) {
    if (list === 'front') {
      const l = moved([form.front, ...form.frontMore], from, to);
      form.front = l[0];
      form.frontMore = l.slice(1);
    } else {
      const l = moved([form.extra, ...form.extraMore], from, to);
      form.extra = l[0];
      form.extraMore = l.slice(1);
    }
  }
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
      noBuild: !!n.noBuild,
      voices: (n.voices ?? []).map((v) => ({ ...v })),
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
            noBuild: form.noBuild || undefined,
            voices: form.voices.length ? $state.snapshot(form.voices) : undefined,
            occlusion: form.picture ? $state.snapshot(form.occlusion) : null,
          },
        },
      ]);
      open(null, form.lessonId);
      notice = t('Card added. Add another, or go back to the list.');
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
        noBuild: form.noBuild,
        voices: $state.snapshot(form.voices),
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
    edit([{ op: 'delete', noteId: editing }], t('Card removed.'));
    close();
  }

  async function attach(side: 'qmedia' | 'amedia', files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const name = await freeName(deck.id, file.name);
      if (await putMedia(deck.id, name, file)) form[side] = [...form[side], name];
      else notice = t('This device could not store the file.');
    }
  }

  // ---------- history ----------
  const day = (d: number) => new Date(d * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const dueText = (c: CardState) => {
    const days = Math.round((c.due - now()) / 86_400_000);
    return days <= 0 ? t('Due now') : days === 1 ? t('Due tomorrow') : t('Due in {days} days', { days });
  };
  const cardName = (id: string) =>
    id.endsWith(':r')
      ? t('Other way round')
      : id.includes(':c')
        ? t('Gap {x}', { x: id.split(':c')[1] })
        : id.includes(':o')
          ? t('Part {x}', { x: id.split(':o')[1] })
          : deck.notes[id]?.occlusion
            ? t('Part {x}', { x: Math.min(...deck.notes[id].occlusion!.shapes.map((s) => s.ord)) })
            : deck.notes[id]?.cloze
              ? 'Gap 1'
              : t('Question to answer');

  function rename(kind: 'lesson' | 'unit', id: string) {
    if (!newName.trim()) return;
    edit([kind === 'lesson' ? { op: 'renameLesson', lessonId: id, name: newName } : { op: 'renameUnit', unitId: id, name: newName }]);
    renaming = null;
  }
</script>

<section class="contents">
  <header>
    <button class="icon-btn" aria-label={editing || adding ? t('Back to cards') : t('Back to lessons')} onclick={() => (editing || adding ? close() : openPanel('path'))}>
      <Icon name="back" />
    </button>
    <h1 class="display">{adding ? t('New card') : editing ? t('Edit card') : t('Cards')}</h1>
    {#if editing || adding}<Help part="editor" />{/if}
    {#if !editing && !adding}<span class="count">{filtering ? `${shown} of ` : ''}{Object.keys(deck.notes).length}</span>{/if}
  </header>

  {#if notice}<p class="notice plain" role="status">{notice}</p>{/if}

  {#if editing || adding}
    {@const n = editing ? deck.notes[editing] : null}
    <div class="editor">
      {#if adding}
        <div class="seg" role="group" aria-label={t('Kind of card')}>
          <button aria-pressed={!form.picture} onclick={() => (form.picture = false)}>{t('Question and answer')}</button>
          <button aria-pressed={form.picture} onclick={() => ((form.picture = true), (form.occlusion ??= { image: '', shapes: [], hideAll: false }))}>{t('Picture with hidden parts')}</button>
        </div>
      {/if}
      {#if form.picture}
        <OcclusionEditor deckId={deck.id} bind:value={form.occlusion} />
      {/if}
      <div class="field" data-tour="e-fields">
        <label for="q-main">{form.picture ? t('Heading') : t('Question')} <small>{form.picture ? t('Optional: shown above the picture') : 'Write gaps as {{c1::answer}} for a fill-the-gap card'}</small></label>
        <div class="more-list" use:sortable={{ onMove: (a, b) => reorderFields('front', a, b) }}>
        <div class="more-row" data-sort>
          {#if form.frontMore.length}<button class="grip" data-grip aria-label={t('Move question field 1: hold and drag, or use the arrow keys')}><Icon name="grip" /></button>{/if}
          <textarea id="q-main" class="input" rows={form.picture ? 1 : 3} bind:value={form.front} dir="auto" onselect={pick} onkeyup={pick} onpointerup={pick}></textarea>
          {#if !form.picture && !isCloze && !form.frontMore.length}
            <button class="plus" aria-label={t('Add another question field')} onclick={() => (form.frontMore = [...form.frontMore, ''])}><Icon name="plus" size={18} /></button>
          {/if}
        </div>
        {#each form.frontMore as _, i (i)}
          <div class="more-row" data-sort>
            <button class="grip" data-grip aria-label={t('Move question field {x}: hold and drag, or use the arrow keys', { x: i + 2 })}><Icon name="grip" /></button>
            <input class="input {step(i)}" aria-label={t('Question field {x}', { x: i + 2 })} bind:value={form.frontMore[i]} dir="auto" />
            <button class="minus" aria-label={t('Remove question field {x}', { x: i + 2 })} onclick={() => (form.frontMore = form.frontMore.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            {#if i === form.frontMore.length - 1}
              <button class="plus" aria-label={t('Add another question field')} onclick={() => (form.frontMore = [...form.frontMore, ''])}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
        {/each}
        </div>
        {#if form.frontMore.length}<small>{t('The first field is the main question (asked the other way round when this kind of card is asked both ways); the others show under it, smaller{x}.', { x: form.frontMore.length > 2 ? t(', and after the third, behind an arrow') : '' })}</small>{/if}
      </div>
      {#if form.picture}
        <!-- a picture card has no written answer: its parts are the answers -->
      {:else if gaps.length && !form.back.trim()}
        <p class="hint">{plural('Fill-the-gap card with {n} gap: each gap is asked on its own.', 'Fill-the-gap card with {n} gaps: each gap is asked on its own.', gaps.length)}</p>
      {:else}
        <label class="field">
          <span>{t('Answer')}</span>
          <textarea class="input" rows="2" bind:value={form.back} dir="auto" onselect={pick} onkeyup={pick} onpointerup={pick}></textarea>
        </label>
      {/if}
      {#if deck.options.look.speak !== 'off' && !form.picture}
        <div class="voices-edit">
          <span class="label">{t('Read in another language')}</span>
          <div class="pick-row">
            <span class="picked" dir="auto">{picked ? `“${picked}”` : t('Select words in the question or answer')}</span>
            <select class="input" aria-label={t('Language for the selected words')} bind:value={markLang}>
              {#each voiceLangs as l (l)}<option value={l}>{flagOf(l)} {langName(l)}</option>{/each}
            </select>
            <button class="quiet" disabled={!picked || !markLang} onclick={addMark}>{t('Mark')}</button>
          </div>
          {#each form.voices as v, i (v.text + v.lang)}
            <button class="chip" aria-label={t('Unmark {text}', { text: v.text })} onclick={() => (form.voices = form.voices.filter((_, j) => j !== i))}><span class="marked" lang={v.lang}>{v.text}</span> · {flagOf(v.lang)} {langName(v.lang)} <Icon name="close" size={12} /></button>
          {/each}
          {#if !form.voices.length}<small>{t('Marked words are read in their own language wherever they appear, such as the Spanish in “What does la manzana mean?”.')}</small>{/if}
        </div>
      {/if}
      <div class="media-edit" data-tour="e-media">
        <span class="label">{t('Question pictures and sounds')}</span>
        <Media deckId={deck.id} names={form.qmedia} small />
        {#each form.qmedia as m (m)}
          <button class="chip" onclick={() => (form.qmedia = form.qmedia.filter((x) => x !== m))}>{isAudio(m) ? '♪' : '▣'} {m} <Icon name="close" size={12} /></button>
        {/each}
        <label class="quiet attach">{t('Add')}<input type="file" accept="image/*,audio/*" multiple onchange={(e) => attach('qmedia', e.currentTarget.files)} /></label>
      </div>
      {#if !isCloze}
        <div class="media-edit">
          <span class="label">{t('Answer pictures and sounds')}</span>
          <Media deckId={deck.id} names={form.amedia} small />
          {#each form.amedia as m (m)}
            <button class="chip" onclick={() => (form.amedia = form.amedia.filter((x) => x !== m))}>{isAudio(m) ? '♪' : '▣'} {m} <Icon name="close" size={12} /></button>
          {/each}
          <label class="quiet attach">{t('Add')}<input type="file" accept="image/*,audio/*" multiple onchange={(e) => attach('amedia', e.currentTarget.files)} /></label>
        </div>
      {/if}
      <div class="field">
        <label for="x-main">{t('Extra')} <small>{t('An example or note, shown after answering')}</small></label>
        <div class="more-list" use:sortable={{ onMove: (a, b) => reorderFields('extra', a, b) }}>
        <div class="more-row" data-sort>
          {#if form.extraMore.length}<button class="grip" data-grip aria-label={t('Move extra field 1: hold and drag, or use the arrow keys')}><Icon name="grip" /></button>{/if}
          <textarea id="x-main" class="input" rows="2" bind:value={form.extra} dir="auto"></textarea>
          {#if form.extra.trim() && !form.extraMore.length}
            <button class="plus" aria-label={t('Add another extra field')} onclick={() => (form.extraMore = [...form.extraMore, ''])}><Icon name="plus" size={18} /></button>
          {/if}
        </div>
        {#each form.extraMore as _, i (i)}
          <div class="more-row" data-sort>
            <button class="grip" data-grip aria-label={t('Move extra field {x}: hold and drag, or use the arrow keys', { x: i + 2 })}><Icon name="grip" /></button>
            <input class="input {step(i)}" aria-label={t('Extra field {x}', { x: i + 2 })} bind:value={form.extraMore[i]} dir="auto" />
            <button class="minus" aria-label={t('Remove extra field {x}', { x: i + 2 })} onclick={() => (form.extraMore = form.extraMore.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            {#if i === form.extraMore.length - 1}
              <button class="plus" aria-label={t('Add another extra field')} onclick={() => (form.extraMore = [...form.extraMore, ''])}><Icon name="plus" size={18} /></button>
            {/if}
          </div>
        {/each}
        </div>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={form.selfCheck} />
        <span>{t('You check this card yourself')} <small>{t('See the answer and say how close you were, instead of being marked')}</small></span>
      </label>
      {#if deck.options.buildSentences !== false && !form.picture && !form.selfCheck}
        <label class="check">
          <input type="checkbox" checked={!form.noBuild} onchange={(e) => (form.noBuild = !e.currentTarget.checked)} />
          <span>{t('Build the answer from words')} <small>{t('In the first two stages, answers of three words or more are put together from word tiles')}</small></span>
        </label>
      {/if}
      <label class="field" data-tour="e-more">
        <span>{t('Also accepted')} <small>{t('Other right answers, separated by commas')}</small></span>
        <input class="input" bind:value={form.alts} dir="auto" />
      </label>
      {#if !isCloze && editing}
        <label class="field">
          <span>{t('Wrong options')} <small>{t('Shown first in multiple choice, separated by commas')}</small></span>
          <input class="input" bind:value={form.wrong} dir="auto" />
        </label>
      {/if}
      {#if !isCloze && editing && !form.picture}
        <AnswerLinks
          deckId={deck.id}
          noteId={editing}
          onAlts={(more) => (form.alts = [form.alts, ...more].filter((x) => x.trim()).join(', '))}
          onWrong={(more) => (form.wrong = [form.wrong, ...more].filter((x) => x.trim()).join(', '))}
        />
      {/if}
      <label class="field">
        <span>{t('Labels')} <small>{t('Your own tags, separated by commas')}</small></span>
        <input class="input" bind:value={form.labels} list="labels" />
        <datalist id="labels">{#each allLabels as l (l)}<option value={l}></option>{/each}</datalist>
      </label>
      <label class="field">
        <span>{t('Lesson')}</span>
        <select class="input" bind:value={form.lessonId}>
          {#each lessonList as l (l.id)}<option value={l.id}>{l.unit !== deck.name ? `${l.unit} · ` : ''}{l.name}</option>{/each}
        </select>
      </label>

      {#if n}
        <div class="history plain">
          <p class="label">{t('History')} {#if n.ai}<span class="tag">{t('AI')}</span>{/if}</p>
          {#each cardsOf(n) as cid (cid)}
            {@const c = progress[cid]}
            <div class="hrow">
              <span class="grow">
                <strong>{cardName(cid)}</strong>
                {#if c}
                  <small>
                    {plural('Stage {stage} · {x} · {c} · {n} answer, {lapses} wrong{x3}', 'Stage {stage} · {x} · {c} · {n} answers, {lapses} wrong{x3}', c.reps, { stage: c.stage, x: stageName(limits.stageNames[c.stage - 1]), c: c.suspended ? t('Stopped') : dueText(c), lapses: c.lapses, x3: c.added != null ? ' · ' + t('first met {date}', { date: day(c.added) }) : '' })}
                  </small>
                  {#if c.hist?.length}
                    <span class="dots" aria-label={t('Recent answers')}>
                      {#each c.hist.slice(-12) as h, i (i)}<i class:ok={h.ok} title="{day(h.day)}: {h.ok ? 'right' : 'wrong'}"></i>{/each}
                    </span>
                  {/if}
                {:else}
                  <small>{t('Not met yet')}</small>
                {/if}
              </span>
              {#if c?.suspended || (c?.buried ?? null) !== null}
                <button class="quiet small" onclick={() => flagCard(deck.id, cid, 'resume')}>{t('Resume')}</button>
              {:else if c}
                <button class="quiet small" onclick={() => flagCard(deck.id, cid, 'stop')} title={t('Anki: suspend')}>{t('Stop asking')}</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        {#if editing}
          {#if confirmDelete}
            <button class="quiet danger" onclick={deleteCard}>{t('Remove for good')}</button>
          {:else}
            <button class="icon-btn" aria-label={t('Remove card')} onclick={() => (confirmDelete = true)}><Icon name="trash" /></button>
          {/if}
        {/if}
        <span class="grow"></span>
        <button class="quiet" onclick={close}>{t('Cancel')}</button>
        <button class="primary" disabled={!valid} onclick={saveCard}>{adding ? t('Add card') : t('Save')}</button>
      </div>
    </div>
  {:else}
    <div class="filters">
      <label class="search">
        <Icon name="search" size={18} />
        <input bind:value={query} placeholder={t('Search cards')} aria-label={t('Search cards')} />
      </label>
      <div class="pair">
        <select class="input" bind:value={show} aria-label={t('Show')}>
          <option value="all">{t('All cards')}</option>
          <option value="new">{t('Not met yet')}</option>
          <option value="tricky">{t('Tricky')}</option>
          <option value="stopped">{t('Stopped')}</option>
          <option value="ai">{t('Written by AI')}</option>
          {#if deck.sources?.length}<option value="unsourced">{t('Not found in sources')}</option>{/if}
        </select>
        {#if allLabels.length}
          <select class="input" bind:value={label} aria-label={t('Label')}>
            <option value="">{t('Any label')}</option>
            {#each allLabels as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        {/if}
      </div>
      <button class="quiet add" onclick={() => open(null)}><Icon name="plus" size={18} /> {t('Add a card')}</button>
    </div>

    {#each groups as g (g.unit.id)}
      {#if !g.lessons.length || g.lessons[0].start < limit}
      <div class="unit">
        {#if renaming === g.unit.id}
          <form class="rename" onsubmit={(e) => (e.preventDefault(), rename('unit', g.unit.id))}>
            <input class="input" bind:value={newName} aria-label={t('Unit name')} />
            <button class="quiet">{t('Rename')}</button>
          </form>
        {:else}
          <p class="label unit-name">
            {g.unit.name}
            <button class="link" onclick={() => ((renaming = g.unit.id), (newName = g.unit.name))}>{t('Rename')}</button>
          </p>
        {/if}
        {#each g.lessons as l, li (l.lesson.id)}
          {#if (!filtering || l.notes.length) && (l.start < limit || (!l.notes.length && l.start === limit && shown <= limit))}
            <div class="lesson">
              <div class="lhead">
                {#if renaming === l.lesson.id}
                  <form class="rename" onsubmit={(e) => (e.preventDefault(), rename('lesson', l.lesson.id))}>
                    <input class="input" bind:value={newName} aria-label={t('Lesson name')} />
                    <button class="quiet">{t('Rename')}</button>
                  </form>
                {:else}
                  <strong class="grow">{l.lesson.name} <small>· {l.lesson.noteIds.length}</small></strong>
                  <button class="icon-btn s" aria-label={t('Rename {name}', { name: l.lesson.name })} onclick={() => ((renaming = l.lesson.id), (newName = l.lesson.name))}><Icon name="edit" size={16} /></button>
                  <button class="icon-btn s" aria-label={t('Move {name} up', { name: l.lesson.name })} onclick={() => edit([{ op: 'shiftLesson', lessonId: l.lesson.id, delta: -1 }])}><Icon name="up" size={16} /></button>
                  <button class="icon-btn s" aria-label={t('Move {name} down', { name: l.lesson.name })} onclick={() => edit([{ op: 'shiftLesson', lessonId: l.lesson.id, delta: 1 }])}><Icon name="down" size={16} /></button>
                  <button class="icon-btn s" aria-label={t('Add a card to {name}', { name: l.lesson.name })} onclick={() => open(null, l.lesson.id)}><Icon name="plus" size={16} /></button>
                {/if}
              </div>
              <ul>
                {#each l.notes.slice(0, Math.max(0, limit - l.start)) as n (n.id)}
                  {@const st = stateOf(n)}
                  <li>
                    <button class="row" onclick={() => open(n.id)}>
                      <span class="grow">
                        <span class="front" dir="auto">{text(n)}</span>
                        {#if !n.cloze}<span class="back" dir="auto">{n.back}</span>{/if}
                      </span>
                      <span class="badges">
                        {#if n.qmedia?.length || n.amedia?.length}<i title={t('Has media')}>▣</i>{/if}
                        {#if n.cloze}<i title={t('Fill the gap')}>[ ]</i>{/if}
                        {#if n.ai}<span class="tag">{t('AI')}</span>{/if}
                        {#if st.stopped}<span class="tag">{t('Stopped')}</span>{/if}
                        <span class="stage" class:none={!st.met} title={st.met ? `Stage ${st.stage}` : t('Not met yet')}>{st.met ? st.stage : '·'}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
              {#if !filtering && li === g.lessons.length - 1}
                <button class="link" onclick={() => edit([{ op: 'addLesson', unitId: g.unit.id, name: `Lesson ${Object.keys(deck.lessons).length + 1}` }])}>
                  {t('+ New lesson in {name}', { name: g.unit.name })}
                </button>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
      {/if}
    {/each}
    {#if filtering && shown === 0}<p class="hint">{t('No cards match.')}</p>{/if}
    {#if shown > limit}
      <button class="quiet more" onclick={() => (limit += PAGE)}>{t('Show {limit} more cards ({limit2} not shown yet)', { limit: Math.min(PAGE, shown - limit), limit2: shown - limit })}</button>
    {/if}
  {/if}
</section>

<style>
  .voices-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .voices-edit > .label,
  .voices-edit > small {
    flex-basis: 100%;
  }
  .voices-edit small {
    color: var(--muted);
    font-size: 13px;
  }
  .pick-row {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .pick-row .picked {
    flex: 1 1 160px;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--muted);
  }
  .pick-row select {
    width: auto;
    min-height: 44px;
  }
  .pick-row .quiet {
    min-height: 44px;
    padding: 0 16px;
  }
  .marked {
    text-decoration: underline 2px var(--brass);
    text-underline-offset: 0.18em;
  }
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
  .more {
    align-self: center;
    min-height: 44px;
    padding: 0 16px;
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
  .more-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .more-row {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .more-row .grip {
    width: 26px;
    margin-right: -4px;
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
