<script lang="ts">
  // Build with Thoth: a deck's sources (files and web pages) on one shelf,
  // three quick questions, an outline to change before any cards are made, a
  // few sample cards, then every lesson's cards, each linked to the passage
  // it comes from. Cards Thoth cannot back with a sentence of the source are
  // added switched off, and listed at the end to keep or delete.
  import { acceptNotice, aiReady, plan } from '../ai.svelte';
  import type { DeckSource, OutlineLesson, OutlineUnit, RawNote } from '../core/types';
  import { pageUrl, readSourceFile, readWebPage, sectionsFromText, type Section } from '../sources';
  import { addLesson, draftLesson, forgetSource, planOutline, storeSource, textsOf, type Goal, type Style } from '../thothBuild';
  import { clearCards, data, editDeck, openPanel, putBuiltDeck, setDeckExtras, snap, ui } from '../store.svelte';
  import { cardIds } from './cardIds';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const sources = $derived(deck.sources ?? []);
  const on = $derived(sources.filter((s) => !s.off));
  const ready = $derived(aiReady());

  type Step = 'shelf' | 'outline' | 'making' | 'review';
  let step = $state<Step>('shelf');
  let busy = $state('');
  let error = $state('');
  let note = $state('');

  // ---------- the shelf ----------
  let picker = $state<HTMLInputElement>();
  let link = $state('');
  let pasting = $state(false);
  let pasteTitle = $state('');
  let pasteText = $state('');

  async function addRead(read: Awaited<ReturnType<typeof readWebPage>>) {
    if (!read.sections.length) throw new Error('No text was found to read.');
    const entry = await storeSource(deck.id, read);
    setDeckExtras(deck.id, { sources: [...(data.decks[deck.id].sources ?? []), entry] });
    note = `Added “${entry.title}”: ${entry.sections} ${entry.sections === 1 ? 'part' : 'parts'}, about ${words(entry.chars)} words.`;
  }
  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    error = '';
    note = '';
    for (const f of files) {
      busy = `Reading ${f.name}…`;
      try {
        await addRead(await readSourceFile(f.name, new Uint8Array(await f.arrayBuffer())));
      } catch (err) {
        error = `${f.name}: ${err instanceof Error ? err.message : 'it could not be read.'}`;
      }
    }
    busy = '';
  }
  async function addLink() {
    const url = pageUrl(link);
    error = '';
    note = '';
    if (!url) {
      error = 'That does not look like a web address.';
      return;
    }
    busy = 'Reading the page…';
    try {
      await addRead(await readWebPage(url));
      link = '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'The page could not be read.';
    } finally {
      busy = '';
    }
  }
  async function addPasted() {
    error = '';
    if (!pasteText.trim()) return;
    await addRead({ title: pasteTitle.trim() || pasteText.trim().split(/\s+/).slice(0, 6).join(' '), kind: 'text', sections: sectionsFromText(pasteText) });
    pasting = false;
    pasteText = '';
    pasteTitle = '';
  }
  function toggle(s: DeckSource) {
    setDeckExtras(deck.id, { sources: sources.map((x) => (x.id === s.id ? { ...x, off: !x.off } : x)) });
  }
  let confirmRemove = $state('');
  async function remove(s: DeckSource) {
    setDeckExtras(deck.id, { sources: sources.filter((x) => x.id !== s.id) });
    await forgetSource(deck.id, s.id);
    confirmRemove = '';
  }
  const words = (chars: number) => Math.max(1, Math.round(chars / 6)).toLocaleString();
  const KIND: Record<DeckSource['kind'], string> = { pdf: 'PDF', web: 'Web', text: 'Text', markdown: 'Text', word: 'Word', html: 'Page' };

  // ---------- Thoth's questions ----------
  let goal = $state<Goal>({ goal: 'exam', level: 'some', days: 28, notes: '' });
  const GOALS = [
    ['exam', 'An exam'],
    ['course', 'Following a course'],
    ['interest', 'Interest'],
  ] as const;
  const LEVELS = [
    ['new', 'New to it'],
    ['some', 'Some'],
    ['revise', 'Revising'],
  ] as const;
  const WHEN = [
    [7, '1 week'],
    [28, '4 weeks'],
    [90, '3 months'],
    [0, 'No rush'],
  ] as const;
  const goalText = $derived<Goal>({
    goal: { exam: 'an exam: definitions, processes and exam-style questions', course: 'following a course, in the order of the notes', interest: 'interest: big ideas first' }[goal.goal] ?? goal.goal,
    level: { new: 'new to it: explain the basics first', some: 'knows some: skip the very basics', revise: 'revising: key facts only' }[goal.level] ?? goal.level,
    days: goal.days,
    notes: goal.notes,
  });

  // ---------- the outline ----------
  type Lesson = OutlineLesson & { keep: boolean };
  type Unit = { name: string; lessons: Lesson[] };
  let outline = $state<Unit[]>([]);
  let texts = $state.raw<Map<string, Section[]>>(new Map());
  const kept = $derived(outline.flatMap((u) => u.lessons.filter((l) => l.keep).map((l) => ({ unit: u.name, lesson: l }))));
  const total = $derived(kept.reduce((t, x) => t + x.lesson.cards, 0));
  const tokens = (n: number) => (n < 1000 ? `${n}` : `${Math.round(n / 100) / 10}k`);
  const outlineCost = $derived.by(() => {
    if (!ready) return 0;
    return plan('outline', snap(deck), { sources: [], goal: goalText })?.estimate ?? 0;
  });

  async function suggest() {
    error = '';
    note = '';
    busy = 'Thoth is reading the shape of your sources…';
    try {
      texts = await textsOf(deck);
      const units: OutlineUnit[] = await planOutline(snap(deck), texts, goalText);
      outline = units.map((u) => ({ name: u.name, lessons: u.lessons.map((l) => ({ ...l, keep: true })) }));
      sample = [];
      step = 'outline';
    } catch (err) {
      error = err instanceof Error ? err.message : 'The outline could not be made.';
    } finally {
      busy = '';
    }
  }
  function moveLesson(ui: number, li: number, d: number) {
    const list = outline[ui].lessons;
    const j = li + d;
    if (j < 0 || j >= list.length) return;
    [list[li], list[j]] = [list[j], list[li]];
  }
  const KINDS: Record<OutlineLesson['kind'], string> = { qa: 'Questions', words: 'Terms', dates: 'Dates', formula: 'Formulas', order: 'Steps' };

  // ---------- the sample ----------
  let style = $state<Style>({ short: false, exam: true, keepTerms: false, notes: '' });
  let sample = $state<RawNote[]>([]);
  async function writeSample() {
    const first = kept[0];
    if (!first) return;
    error = '';
    busy = `Thoth is writing five cards from “${first.lesson.name}”…`;
    try {
      sample = await draftLesson(snap(deck), $state.snapshot(first.lesson), first.unit, texts, $state.snapshot(style), 5);
    } catch (err) {
      error = err instanceof Error ? err.message : 'The sample could not be written.';
    } finally {
      busy = '';
    }
  }

  // ---------- making every card ----------
  let made = $state({ lessons: 0, cards: 0, off: 0, failed: [] as string[] });
  let stop = false;
  let newNotes = $state<string[]>([]);
  async function makeAll() {
    step = 'making';
    error = '';
    stop = false;
    made = { lessons: 0, cards: 0, off: 0, failed: [] };
    newNotes = [];
    const list = $state.snapshot(kept);
    const st = $state.snapshot(style);
    for (const { unit, lesson } of list) {
      if (stop) break;
      busy = `Writing “${lesson.name}” (${made.lessons + 1} of ${list.length})…`;
      try {
        const current = data.decks[deck.id];
        const rows = await draftLesson(snap(current), lesson, unit, texts, st);
        const r = addLesson(snap(data.decks[deck.id]), unit, lesson.name, rows);
        putBuiltDeck(deck.id, r.deck, r.off);
        newNotes = [...newNotes, ...r.noteIds];
        made = { ...made, lessons: made.lessons + 1, cards: made.cards + r.noteIds.length, off: made.off + r.noteIds.filter((id) => r.deck.notes[id]?.source?.found === false).length };
      } catch (err) {
        made = { ...made, lessons: made.lessons + 1, failed: [...made.failed, `${lesson.name}: ${err instanceof Error ? err.message : 'failed'}`] };
      }
    }
    busy = '';
    step = 'review';
  }

  // ---------- cards without a source ----------
  const unsourced = $derived(newNotes.map((id) => deck.notes[id]).filter((n) => n && n.source && !n.source.found));
  function keep(id: string) {
    const n = deck.notes[id];
    if (!n) return;
    // Back to a new card, to be met in its lesson like the others.
    clearCards(deck.id, cardIds(deck, n));
    newNotes = newNotes.filter((x) => x !== id);
  }
  function drop(id: string) {
    editDeck(deck.id, [{ op: 'delete', noteId: id }]);
    newNotes = newNotes.filter((x) => x !== id);
  }
</script>

<section class="src">
  <header>
    <button class="icon-btn" aria-label="Back to lessons" onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">Build with Thoth</h1>
  </header>
  <ol class="steps" aria-label="Steps">
    {#each [['shelf', 'Sources'], ['outline', 'Outline'], ['making', 'Cards'], ['review', 'Check']] as [id, name], i (id)}
      <li class:now={step === id}>{i + 1} {name}</li>
    {/each}
  </ol>

  {#if step === 'shelf'}
    <p class="hint">Add the files and pages this deck is about. They are kept with the deck on this device, so you never add them twice. Ankhwiz reads only what you can open yourself, and nothing is sent anywhere until you ask Thoth to plan cards.</p>
    {#each sources as s (s.id)}
      <div class="source card" class:off={s.off}>
        <label class="tick"><input type="checkbox" checked={!s.off} onchange={() => toggle(s)} aria-label="Use {s.title}" /></label>
        <span class="kind">{KIND[s.kind]}</span>
        <span class="grow"><strong>{s.title}</strong><small>{s.sections} {s.sections === 1 ? 'part' : 'parts'} · about {words(s.chars)} words{s.url ? ` · ${new URL(s.url).hostname}` : ''}</small></span>
        {#if confirmRemove === s.id}
          <button class="quiet danger" onclick={() => remove(s)}>Remove</button>
        {:else}
          <button class="icon-btn" aria-label="Remove {s.title}" onclick={() => (confirmRemove = s.id)}><Icon name="trash" size={18} /></button>
        {/if}
      </div>
    {/each}
    <div class="add card">
      <button class="quiet" disabled={!!busy} onclick={() => picker?.click()}><Icon name="upload" size={18} /> Add files</button>
      <input bind:this={picker} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,text/plain,application/pdf" hidden onchange={onFiles} />
      <div class="link">
        <input class="input" type="url" bind:value={link} placeholder="Paste a web address" aria-label="Web address" onkeydown={(e) => e.key === 'Enter' && addLink()} />
        <button class="quiet" disabled={!!busy || !link.trim()} onclick={addLink}>Add page</button>
      </div>
      {#if pasting}
        <input class="input" bind:value={pasteTitle} placeholder="A name for it (optional)" aria-label="Name" />
        <textarea class="input" rows="6" bind:value={pasteText} placeholder="Paste text here" aria-label="Text"></textarea>
        <div class="pair">
          <button class="quiet" onclick={() => (pasting = false)}>Cancel</button>
          <button class="quiet" disabled={!pasteText.trim()} onclick={addPasted}>Add text</button>
        </div>
      {:else}
        <button class="link-btn" onclick={() => (pasting = true)}>Or paste some text</button>
      {/if}
      <small>PDF, Word (.docx), text, Markdown and web pages. Pages that need a sign-in, and PDFs that are only scanned pictures, cannot be read.</small>
    </div>

    {#if on.length}
      <div class="ask card">
        <p class="label">Three quick questions</p>
        <div class="q">
          <strong>What is it for?</strong>
          <div class="chips">{#each GOALS as [id, name] (id)}<button aria-pressed={goal.goal === id} onclick={() => (goal.goal = id)}>{name}</button>{/each}</div>
        </div>
        <div class="q">
          <strong>How much do you know already?</strong>
          <div class="chips">{#each LEVELS as [id, name] (id)}<button aria-pressed={goal.level === id} onclick={() => (goal.level = id)}>{name}</button>{/each}</div>
        </div>
        <div class="q">
          <strong>By when?</strong>
          <div class="chips">{#each WHEN as [days, name] (days)}<button aria-pressed={goal.days === days} onclick={() => (goal.days = days)}>{name}</button>{/each}</div>
        </div>
        <input class="input" bind:value={goal.notes} placeholder="Anything else? (optional: “only chapters 2 to 4”)" aria-label="Anything else" />
        {#if !ready}
          <p class="hint">Planning and writing cards needs the AI connection: set it up in Settings › Study with Thoth. Your sources stay here meanwhile.</p>
        {:else if !data.ai.noticeSeen}
          <p class="hint">Thoth sends the openings of each part of your sources (not the whole text) to your AI service to plan the outline, and later the parts each lesson uses. Nothing else about you is sent.</p>
          <button class="quiet" onclick={acceptNotice}>I understand</button>
        {:else}
          <p class="hint">About {tokens(Math.round(on.reduce((t, s) => t + Math.min(s.chars, s.sections * 300), 0) / 4) + outlineCost)} tokens will go to your AI service to plan the outline.</p>
          <button class="primary" disabled={!!busy} onclick={suggest}>Suggest an outline</button>
        {/if}
      </div>
    {/if}
  {:else if step === 'outline'}
    <p class="hint">Rename, reorder or drop lessons before any cards are made. Each lesson shows where it comes from.</p>
    {#each outline as u, ui_ (ui_)}
      <div class="unit">
        <input class="input unit-name" bind:value={u.name} aria-label="Unit name" />
        {#each u.lessons as l, li (li)}
          <div class="lesson card" class:dropped={!l.keep}>
            <div class="row">
              <input class="input" bind:value={l.name} aria-label="Lesson name" disabled={!l.keep} />
              <select class="input" bind:value={l.kind} aria-label="Kind of cards" disabled={!l.keep}>
                {#each Object.entries(KINDS) as [k, name] (k)}<option value={k}>{name}</option>{/each}
              </select>
              <input class="input num" type="number" min="1" max="60" bind:value={l.cards} aria-label="About how many cards" disabled={!l.keep} />
            </div>
            <div class="row small">
              <span class="from">{l.from.map(([id, at]) => `${sources.find((s) => s.id === id)?.title ?? id} · ${at}`).join('; ') || 'No source part named'}</span>
              <button class="icon-btn" aria-label="Move up" onclick={() => moveLesson(ui_, li, -1)}><Icon name="up" size={16} /></button>
              <button class="icon-btn" aria-label="Move down" onclick={() => moveLesson(ui_, li, 1)}><Icon name="down" size={16} /></button>
              <button class="quiet" onclick={() => (l.keep = !l.keep)}>{l.keep ? 'Drop' : 'Keep'}</button>
            </div>
          </div>
        {/each}
      </div>
    {/each}

    <div class="sample card">
      <p class="label">Sample · up to five cards from the first lesson</p>
      {#each sample as c, i (i)}
        <div class="sc" class:nosrc={c.source && !c.source.found}>
          <strong>{c.front}</strong>
          <span>{c.back}</span>
          <small>{c.source?.found ? `From: ${sources.find((s) => s.id === c.source?.id)?.title ?? ''} · ${c.source.at}` : 'Not found in your sources: this card would be switched off'}</small>
        </div>
      {/each}
      <p class="small"><strong>Tell Thoth what to change</strong> (for every card)</p>
      <div class="chips">
        <button aria-pressed={style.short} onclick={() => (style.short = !style.short)}>Shorter answers</button>
        <button aria-pressed={style.exam} onclick={() => (style.exam = !style.exam)}>Exam-style questions</button>
        <button aria-pressed={style.keepTerms} onclick={() => (style.keepTerms = !style.keepTerms)}>Keep technical terms</button>
      </div>
      <input class="input" bind:value={style.notes} placeholder="Anything else? (“add a one-line example”)" aria-label="Other wishes" />
      <button class="quiet" disabled={!!busy || !kept.length} onclick={writeSample}>{sample.length ? 'Write the sample again' : 'Write a sample'}</button>
    </div>
    <div class="pair">
      <button class="quiet" onclick={() => (step = 'shelf')}>Back to sources</button>
      <button class="primary" disabled={!!busy || !kept.length} onclick={makeAll}>Make about {total} cards</button>
    </div>
  {:else if step === 'making'}
    <ProgressBar label={busy || 'Starting…'} value={kept.length ? made.lessons / kept.length : 0} />
    <p class="hint">{made.cards} cards so far. You can leave this screen open; each lesson is added as soon as it is written.</p>
    <button class="quiet" onclick={() => (stop = true)}>Stop after this lesson</button>
  {:else}
    <div class="done card" role="status">
      <h2 class="display">{made.cards} cards in {made.lessons - made.failed.length} {made.lessons - made.failed.length === 1 ? 'lesson' : 'lessons'}</h2>
      <p class="small">Every card links to the passage it comes from: tap “From” on its answer to read it.</p>
      {#each made.failed as f (f)}<p class="small bad">{f}</p>{/each}
    </div>
    {#if unsourced.length}
      <p class="label">Not found in your sources · switched off</p>
      <p class="hint">Thoth could not point to a sentence for these, so they will not come up until you decide.</p>
      {#each unsourced as n (n.id)}
        <div class="sc nosrc card">
          <strong>{n.front}</strong>
          <span>{n.back}</span>
          {#if n.source?.quote}<small>Thoth quoted: “{n.source.quote}”</small>{/if}
          <div class="pair">
            <button class="quiet" onclick={() => keep(n.id)}>Keep it anyway</button>
            <button class="quiet danger" onclick={() => drop(n.id)}>Delete it</button>
          </div>
        </div>
      {/each}
    {/if}
    <div class="pair">
      <button class="quiet" onclick={() => (step = 'shelf')}>Add more sources</button>
      <button class="primary" onclick={() => openPanel('path')}>To the lessons</button>
    </div>
  {/if}

  {#if busy && step !== 'making'}<p class="hint" role="status">{busy}</p>{/if}
  {#if note}<p class="hint good" role="status">{note}</p>{/if}
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
</section>

<style>
  .src {
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
  .steps {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    flex-wrap: wrap;
    font-size: 14px;
    font-weight: 700;
  }
  .steps li {
    padding: 4px 10px;
    border: 2px solid var(--line);
  }
  .steps li.now {
    background: var(--emerald);
    color: var(--surface);
  }
  .hint,
  .small,
  small {
    color: var(--muted);
    font-size: 15px;
    margin: 0;
  }
  .good {
    color: var(--ok-text);
  }
  .bad {
    color: var(--off-text);
  }
  .source {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
  }
  .source.off {
    opacity: 0.6;
  }
  .tick input {
    width: 24px;
    height: 24px;
    accent-color: var(--emerald);
  }
  .kind {
    flex: none;
    width: 52px;
    text-align: center;
    padding: 3px 0;
    border: 2px solid var(--hair);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .grow strong {
    overflow-wrap: anywhere;
  }
  .add,
  .ask,
  .sample,
  .done {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }
  .link {
    display: flex;
    gap: 8px;
  }
  .link input {
    flex: 1;
    min-width: 0;
  }
  .link-btn {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 0;
    color: var(--emerald);
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips button {
    min-height: 44px;
    padding: 0 14px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .chips button[aria-pressed='true'] {
    background: var(--sel-bg);
    border: 3px solid var(--sel-text);
  }
  .unit {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .unit-name {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .lesson {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lesson.dropped {
    opacity: 0.55;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .row > .input:first-child {
    flex: 1 1 200px;
    min-width: 0;
  }
  .num {
    width: 76px;
  }
  .from {
    flex: 1 1 200px;
    min-width: 0;
    color: var(--muted);
  }
  .sc {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 2px solid var(--hair);
    background: var(--ground);
  }
  .sc.nosrc {
    border: 2px dashed var(--off-line);
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .done h2 {
    margin: 0;
  }
  .label {
    margin: 0;
  }
</style>
