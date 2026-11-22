<script lang="ts">
  import { shownName, t } from '../i18n';
  import Help from './Help.svelte';
  import { offerPart } from '../tour.svelte';
  import { onMount } from 'svelte';
  onMount(() => offerPart('thoth'));
  // Study with Thoth: the AI features for one deck. Everything AI writes
  // arrives as a draft to approve, and is labelled once it is in the deck.
  import { acceptNotice, aiHost, aiReady, ask, isLocal, plan } from '../ai.svelte';
  import { addNotes } from '../core';
  import type { ChallengeQuestion, Message, ProposedChanges, RawNote, Reading, ReadingQuestion, Suggestion } from '../core/types';
  import { data, editDeck, openPanel, putDeck, save, setDeckExtras, snap, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Quiz from './Quiz.svelte';
  import Thoth from './Thoth.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  const ready = $derived(aiReady());

  type Tab = 'ask' | 'cards' | 'improve' | 'challenge' | 'reading';
  const tabs: [Tab, string][] = [
    ['ask', t('Ask')],
    ['cards', t('Add cards')],
    ['improve', t('Improve')],
    ['challenge', t('Challenge')],
    ['reading', t('Reading')],
  ];
  let tab = $state<Tab>(ui.aiTab);
  // Cards sent here from elsewhere (tricky cards from Progress).
  const sentNotes = ui.aiNotes.filter((id) => data.decks[ui.deckId!]?.notes[id]);
  ui.aiTab = 'ask';
  ui.aiNotes = [];
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');

  async function run<T>(task: string, args: Record<string, unknown>): Promise<T | null> {
    busy = true;
    error = '';
    notice = '';
    try {
      return await ask<T>(task, snap(deck), args);
    } catch (e) {
      error = e instanceof Error ? t(e.message) : t('Something went wrong.');
      return null;
    } finally {
      busy = false;
    }
  }

  /** "About 1,200 tokens will be sent", shown before larger jobs. */
  function size(task: string, args: Record<string, unknown>): string {
    const req = ready ? plan(task, snap(deck), args) : null;
    if (!req) return '';
    const rounded = req.estimate < 100 ? req.estimate : Math.round(req.estimate / 50) * 50;
    return t('About {x} tokens will be sent, using the {x2} model.', { x: rounded.toLocaleString(), x2: req.strong && data.ai.strongModel ? t('larger') : t('quick') });
  }

  // ----- Ask -----
  let history = $state<Message[]>([]);
  let question = $state('');
  async function send() {
    const q = question.trim();
    if (!q || busy) return;
    question = '';
    const before = snap(history);
    history.push({ role: 'user', content: q });
    const answer = await run<string>('chat', { history: before, question: q });
    if (answer) history.push({ role: 'assistant', content: answer });
    else history.pop(), (question = q);
  }

  // ----- Add cards -----
  let topic = $state('');
  let source = $state('');
  let count = $state(8);
  let drafts = $state<(RawNote & { keep: boolean })[]>([]);
  const cardArgs = $derived({ topic, source, count });
  async function draft() {
    const cards = await run<RawNote[]>('cards', cardArgs);
    if (cards) drafts = cards.map((c) => ({ ...c, keep: true }));
  }
  function addDrafts() {
    const rows = drafts.filter((d) => d.keep && d.front.trim() && d.back.trim()).map(({ keep: _keep, ...row }) => row);
    if (!rows.length) return;
    const unit = topic.trim() ? topic.trim().slice(0, 40) : t('Added with Thoth');
    const result = addNotes(snap(deck), unit, snap(rows), true);
    putDeck(result.deck);
    notice = t('Added {noteIdsCount} cards as new lessons in “{unit}”. They are marked AI on the lesson screen.', { noteIdsCount: result.noteIds.length, unit });
    drafts = [];
  }

  // ----- Improve -----
  const lessonList = $derived(deck.units.flatMap((u) => u.lessonIds.map((id) => deck.lessons[id])));
  let lessonId = $state(sentNotes.length ? '__sent' : (data.decks[ui.deckId!]?.units[0]?.lessonIds[0] ?? ''));
  const chosen = $derived(
    lessonId === '__sent' ? { id: '__sent', name: t('Tricky cards'), noteIds: sentNotes } : (deck.lessons[lessonId] ?? lessonList[0]),
  );
  let suggestions = $state<(Suggestion & { keepAlts: boolean[]; keepWrong: boolean[] })[]>([]);
  let names = $state<{ id: string; from: string; to: string; keep: boolean }[]>([]);
  async function improve() {
    const noteIds = snap(chosen.noteIds).slice(0, 30);
    const found = await run<Suggestion[]>('improve', { noteIds });
    if (!found) return;
    suggestions = found.map((s) => ({ ...s, keepAlts: s.alts.map(() => true), keepWrong: s.wrong.map(() => true) }));
    if (!found.length) notice = t('Thoth found nothing to add to these cards.');
  }
  function applySuggestions() {
    let changed = 0;
    for (const s of suggestions) {
      const note = deck.notes[s.noteId];
      if (!note) continue;
      const alts = s.alts.filter((_, i) => s.keepAlts[i]);
      const wrong = s.wrong.filter((_, i) => s.keepWrong[i]);
      if (!alts.length && !wrong.length) continue;
      note.alts = [...(note.alts ?? []), ...alts];
      note.wrong = [...(note.wrong ?? []), ...wrong];
      note.ai = true;
      changed++;
    }
    save();
    suggestions = [];
    notice = changed ? t('Updated {changed} cards.', { changed }) : t('Nothing was selected.');
  }
  async function nameLessons() {
    const found = await run<Record<string, string>>('lessons', {});
    if (!found) return;
    names = Object.entries(found)
      .filter(([id, to]) => deck.lessons[id] && deck.lessons[id].name !== to)
      .map(([id, to]) => ({ id, from: deck.lessons[id].name, to, keep: true }));
    if (!names.length) notice = t('The lesson names already fit.');
  }
  function applyNames() {
    for (const n of names) if (n.keep && n.to.trim()) deck.lessons[n.id].name = n.to.trim();
    save();
    names = [];
    notice = t('Lesson names updated.');
  }

  // ----- Direct changes -----
  let instruction = $state('');
  let scope = $state('deck');
  let proposed = $state<(ProposedChanges['changes'][number] & { keep: boolean })[]>([]);
  let summary = $state('');
  let keepBackup = $state(true);
  const scopeArgs = $derived({ scope, instruction });
  const scopeCount = $derived(
    scope === 'deck'
      ? Object.keys(deck.notes).length
      : (deck.units.find((u) => u.id === scope)?.lessonIds.reduce((t, l) => t + deck.lessons[l].noteIds.length, 0) ??
          deck.lessons[scope]?.noteIds.length ??
          0),
  );
  async function previewChanges() {
    const found = await run<ProposedChanges>('edit', { scope, instruction });
    if (!found) return;
    summary = found.summary;
    proposed = found.changes.map((c) => ({ ...c, keep: true }));
  }
  function applyChanges() {
    const edits = proposed.filter((c) => c.keep).map((c) => c.edit);
    if (!edits.length) return;
    const label = t('Before Thoth: {x}{x2}', { x: instruction.trim().slice(0, 50), x2: instruction.trim().length > 50 ? '…' : '' });
    const r = editDeck(deck.id, snap(edits), true, keepBackup ? label : '');
    notice = `Made ${edits.length - r.skipped} ${edits.length - r.skipped === 1 ? 'change' : 'changes'}.${keepBackup ? t(' The deck as it was is kept under Deck options › Backups.') : ''}`;
    proposed = [];
    instruction = '';
  }

  // ----- Challenge -----
  let challenge = $state<ChallengeQuestion[] | null>(null);
  let challengeScore = $state<number | null>(null);
  async function startChallenge() {
    challengeScore = null;
    challenge = await run<ChallengeQuestion[]>('challenge', { progress: snap(progress), count: 5 });
  }

  // ----- Reading -----
  let readTopic = $state('');
  let ownPassage = $state('');
  let writing = $state(false);
  let ownQuestions = $state([{ question: '', right: '', wrong: ['', '', ''] }]);
  let open = $state<Reading | null>(null);
  let answering = $state(false);
  let readScore = $state<number | null>(null);
  const readings = $derived(deck.readings ?? []);

  function keep(reading: Reading) {
    setDeckExtras(deck.id, { readings: [...(deck.readings ?? []), reading] });
    openReading(reading);
  }
  function openReading(reading: Reading) {
    open = reading;
    answering = false;
    readScore = null;
  }
  async function makeReading(passage: string) {
    const reading = await run<Reading>('reading', { topic: readTopic, passage, count: 4 });
    if (reading) keep(reading);
  }
  function saveOwn() {
    const questions: ReadingQuestion[] = [];
    for (const q of ownQuestions) {
      const wrong = q.wrong.map((w) => w.trim()).filter(Boolean);
      if (!q.question.trim() || !q.right.trim() || !wrong.length) continue;
      // Place the right answer at a varying position.
      const at = (q.question.length + questions.length) % (wrong.length + 1);
      const options = [...wrong.slice(0, at), q.right.trim(), ...wrong.slice(at)];
      questions.push({ question: q.question.trim(), options, answer: at });
    }
    if (!ownPassage.trim() || !questions.length) {
      error = t('Add a passage and at least one question with a right answer and a wrong one.');
      return;
    }
    error = '';
    const title = ownPassage.trim().split(/\s+/).slice(0, 5).join(' ') + '…';
    keep({ id: `r${Date.now().toString(36)}`, title, passage: ownPassage.trim(), questions, best: null });
    writing = false;
    ownPassage = '';
    ownQuestions = [{ question: '', right: '', wrong: ['', '', ''] }];
  }
  function finishReading(correct: number) {
    readScore = correct;
    answering = false;
    const id = open?.id;
    if (deck.readings?.some((r) => r.id === id)) {
      setDeckExtras(deck.id, { readings: deck.readings.map((r) => (r.id === id ? { ...r, best: Math.max(r.best ?? 0, correct) } : r)) });
    }
  }
  function removeReading(id: string) {
    setDeckExtras(deck.id, { readings: (deck.readings ?? []).filter((r) => r.id !== id) });
    open = null;
  }
</script>

<section class="ai">
  <header>
    <button class="icon-btn" aria-label={t('Back to lessons')} onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">{t('Study with Thoth')}</h1>
    <Help part="thoth" />
  </header>

  {#if !ready}
    <div class="intro plain">
      {#if data.settings.thoth !== 'hidden'}<div class="portrait"><Thoth size={84} portrait mood={busy ? 'think' : 'idle'} nodOn={busy} /></div>{/if}
      <div>
        <p><strong>{t('No AI connection yet.')}</strong></p>
        <p>
          {t('Connect a service of your own (OpenAI, Gemini, Grok, OpenRouter, a model on this computer, or any compatible address) and I can answer questions, draft cards, set challenge rounds and write reading passages.')}
        </p>
        <button class="quiet" onclick={() => (ui.screen = 'settings')}>{t('Open Settings')}</button>
      </div>
    </div>
  {:else if !data.ai.noticeSeen}
    <div class="intro plain">
      <div>
        <p><strong>{t('Before the first request')}</strong></p>
        {#if isLocal()}
          <p>{t('Your AI model runs on this computer, so nothing leaves it.')}</p>
        {:else}
          <p>
            {t('When you use a feature here, the cards it needs from this deck and whatever you type are sent to')}
            <strong>{aiHost()}</strong>{t(', under your own key and that service\'s terms. Nothing is sent at other times.')}
          </p>
        {/if}
        <p>{t('AI can be wrong. New cards and changes are shown as drafts for you to approve, and are marked “AI” afterwards.')}</p>
        <button class="quiet" onclick={acceptNotice}>{t('I understand')}</button>
      </div>
    </div>
  {/if}

  <div class="seg tabs" role="group" aria-label={t('Features')}>
    {#each tabs as [id, name] (id)}
      <button aria-pressed={tab === id} onclick={() => ((tab = id), (error = ''), (notice = ''))}>{name}</button>
    {/each}
  </div>

  {#if error}<p class="msg bad plain" role="alert">{error}</p>{/if}
  {#if notice}<p class="msg plain" role="status">{notice}</p>{/if}

  {#if tab === 'ask'}
    <p class="hint">{t('Ask about anything this deck covers. Answers draw on its cards first.')}</p>
    <div class="chat">
      {#each history as m, i (i)}
        <p class="turn {m.role} plain">{m.content}</p>
      {/each}
      {#if busy}<p class="turn assistant plain muted">{t('Thoth is thinking…')}</p>{/if}
    </div>
    <form class="ask" onsubmit={(e) => (e.preventDefault(), void send())}>
      <input class="input" bind:value={question} placeholder={t('Your question')} aria-label={t('Your question')} disabled={!ready || !data.ai.noticeSeen} />
      <button class="quiet" disabled={!ready || !data.ai.noticeSeen || busy || !question.trim()}>{t('Ask')}</button>
    </form>
    {#if history.length}<button class="link" onclick={() => (history = [])}>{t('Start over')}</button>{/if}
  {:else if tab === 'cards'}
    {#if drafts.length}
      <p class="hint">{t('Drafts. Edit them, untick any you do not want, then add the rest.')}</p>
      <ul class="drafts">
        {#each drafts as d, i (i)}
          <li class="plain">
            <input type="checkbox" bind:checked={d.keep} aria-label={t('Keep this card')} />
            <span class="pairin">
              <input class="input" bind:value={d.front} aria-label={t('Front')} />
              <input class="input" bind:value={d.back} aria-label={t('Answer')} />
              {#if d.alts?.length}<small>{t('Also accepted: {x}', { x: d.alts.join(', ') })}</small>{/if}
            </span>
          </li>
        {/each}
      </ul>
      <div class="pair">
        <button class="quiet" onclick={() => (drafts = [])}>{t('Discard')}</button>
        <button class="primary" onclick={addDrafts}>{t('Add {length} cards', { length: drafts.filter((d) => d.keep).length })}</button>
      </div>
    {:else}
      <label class="field"><span>{t('Topic')} <small>{t('what the new cards should cover')}</small></span>
        <input class="input" bind:value={topic} placeholder={t('e.g. vegetables, the French Revolution')} />
      </label>
      <label class="field"><span>{t('Source text')} <small>{t('optional: paste notes or an article and the cards will come only from it')}</small></span>
        <textarea class="input" rows="5" bind:value={source}></textarea>
      </label>
      <label class="field narrow"><span>{t('How many')}</span>
        <input class="input" type="number" min="1" max="40" bind:value={count} />
      </label>
      <p class="hint">{size('cards', cardArgs)}</p>
      <button class="primary" disabled={!ready || !data.ai.noticeSeen || busy || (!topic.trim() && !source.trim())} onclick={draft}>
        {busy ? t('Writing drafts…') : t('Draft cards')}
      </button>
    {/if}
  {:else if tab === 'improve'}
    {#if proposed.length}
      <p class="hint"><strong>{t('Proposed changes')}</strong>{t('{x}. Untick any you do not want.', { x: summary ? ` · ${summary.replace(/[.!]+$/, '')}` : '' })}</p>
      <ul class="drafts">
        {#each proposed as c, i (i)}
          <li class="plain">
            <input type="checkbox" bind:checked={c.keep} aria-label={t('Make this change')} />
            <span class="pairin"><span dir="auto">{c.describe}</span></span>
          </li>
        {/each}
      </ul>
      <label class="keep"><input type="checkbox" bind:checked={keepBackup} /> {t('Keep a backup of the deck as it is now')}</label>
      <div class="pair">
        <button class="quiet" onclick={() => (proposed = [])}>{t('Discard')}</button>
        <button class="primary" disabled={!proposed.some((c) => c.keep)} onclick={applyChanges}>
          {t('Make {length} changes', { length: proposed.filter((c) => c.keep).length })}
        </button>
      </div>
    {:else if !suggestions.length && !names.length}
      <div class="direct plain">
        <p class="label">{t('Change the deck in your own words')}</p>
        <textarea
          class="input"
          rows="3"
          bind:value={instruction}
          placeholder={t('e.g. Add an example sentence to each card\'s Extra · Make the answers lowercase · Add five more fruits to the Fruit lesson')}
        ></textarea>
        <label class="field"><span>{t('Apply to')}</span>
          <select class="input" bind:value={scope}>
            <option value="deck">{t('The whole deck')}</option>
            {#each deck.units as u (u.id)}<option value={u.id}>{t('Unit: {name}', { name: u.name })}</option>{/each}
            {#each lessonList as l (l.id)}<option value={l.id}>{t('Lesson: {name}', { name: l.name })}</option>{/each}
          </select>
        </label>
        {#if scopeCount > 150}<p class="hint">{t('Only the first 150 cards are sent; choose a unit or lesson to reach the rest.')}</p>{/if}
        <p class="hint">{t('{scopeArgs} You see every change before anything is made.', { scopeArgs: size('edit', scopeArgs) })}</p>
        <button class="primary" disabled={!ready || !data.ai.noticeSeen || busy || !instruction.trim()} onclick={previewChanges}>
          {busy ? t('Thoth is working…') : t('Preview changes')}
        </button>
      </div>
      <p class="label or">{t('Or let Thoth suggest')}</p>
    {/if}
    {#if proposed.length}
      <!-- the preview above replaces the suggestions until it is applied or discarded -->
    {:else if suggestions.length}
      <p class="hint">{t('Suggestions. Untick anything you disagree with. Flags are for you to act on; they change nothing.')}</p>
      <ul class="drafts">
        {#each suggestions as s (s.noteId)}
          <li class="plain col">
            <strong>{deck.notes[s.noteId]?.front} = {deck.notes[s.noteId]?.back}</strong>
            {#if s.flag}<p class="flag">{t('Check this card: {flag}', { flag: s.flag })}</p>{/if}
            {#each s.alts as a, i (a)}
              <label><input type="checkbox" bind:checked={s.keepAlts[i]} /> {t('Also accept “{a}”', { a })}</label>
            {/each}
            {#each s.wrong as w, i (w)}
              <label><input type="checkbox" bind:checked={s.keepWrong[i]} /> {t('Wrong option “{w}”', { w })}</label>
            {/each}
          </li>
        {/each}
      </ul>
      <div class="pair">
        <button class="quiet" onclick={() => (suggestions = [])}>{t('Discard')}</button>
        <button class="primary" onclick={applySuggestions}>{t('Apply selected')}</button>
      </div>
    {:else if names.length}
      <p class="hint">{t('Proposed lesson names.')}</p>
      <ul class="drafts">
        {#each names as n (n.id)}
          <li class="plain">
            <input type="checkbox" bind:checked={n.keep} aria-label={t('Use this name')} />
            <span class="pairin"><small>{n.from}</small><input class="input" bind:value={n.to} aria-label={t('New name')} /></span>
          </li>
        {/each}
      </ul>
      <div class="pair">
        <button class="quiet" onclick={() => (names = [])}>{t('Discard')}</button>
        <button class="primary" onclick={applyNames}>{t('Rename lessons')}</button>
      </div>
    {:else}
      <label class="field"><span>{t('Lesson')} <small>{t('Thoth suggests other accepted answers and harder wrong options, and flags doubtful cards')}</small></span>
        <select class="input" bind:value={lessonId}>
          {#if sentNotes.length}<option value="__sent">{t('Tricky cards ({sentNotesCount})', { sentNotesCount: sentNotes.length })}</option>{/if}
          {#each lessonList as l (l.id)}<option value={l.id}>{shownName(l.name)} ({l.noteIds.length})</option>{/each}
        </select>
      </label>
      <p class="hint">{chosen ? size('improve', { noteIds: snap(chosen.noteIds).slice(0, 30) }) : ''}</p>
      <button class="primary" disabled={!ready || !data.ai.noticeSeen || busy || !chosen} onclick={improve}>
        {busy ? t('Reading the cards…') : t('Review this lesson')}
      </button>
      <button class="quiet" disabled={!ready || !data.ai.noticeSeen || busy} onclick={nameLessons}>{t('Propose names for all lessons')}</button>
      <p class="hint">{size('lessons', {})}</p>
    {/if}
  {:else if tab === 'challenge'}
    {#if challenge && challengeScore === null}
      <p class="hint"><span class="tag">{t('AI')}</span> {t('Written for this round. It does not change your review schedule.')}</p>
      {#key challenge}
        <Quiz questions={challenge} whys={challenge.map((q) => q.why)} onDone={(n) => (challengeScore = n)} />
      {/key}
    {:else}
      {#if challenge && challengeScore !== null}
        <p class="msg plain" role="status">{t('Challenge complete: {challengeScore} of {challengeCount}.', { challengeScore, challengeCount: challenge.length })}</p>
      {/if}
      <p class="hint">
        {t('Five fresh questions on what you have met so far, asked in new ways. A challenge round is extra practice: it never moves a card\'s stage or due date.')}
      </p>
      <p class="hint">{size('challenge', { progress: snap(progress), count: 5 })}</p>
      <button class="primary" disabled={!ready || !data.ai.noticeSeen || busy} onclick={startChallenge}>
        {busy ? t('Setting questions…') : challenge ? t('Another round') : t('Start a challenge')}
      </button>
    {/if}
  {:else if open}
    <div class="reading">
      <p class="label">{open.title} {#if open.ai}<span class="tag">{t('AI')}</span>{/if}</p>
      {#if answering}
        <details class="plain"><summary>{t('Show the passage')}</summary><p class="passage">{open.passage}</p></details>
        {#key open.id}<Quiz questions={open.questions} onDone={finishReading} />{/key}
      {:else}
        <p class="passage plain">{open.passage}</p>
        {#if readScore !== null}<p class="msg plain" role="status">{t('You answered {readScore} of {questionsCount} correctly.', { readScore, questionsCount: open.questions.length })}</p>{/if}
        <button class="primary" onclick={() => ((answering = true), (readScore = null))}>
          {readScore === null ? `Answer ${open.questions.length} questions` : t('Try again')}
        </button>
        <div class="pair">
          <button class="quiet" onclick={() => (open = null)}>{t('Back to passages')}</button>
          <button class="quiet" onclick={() => removeReading(open!.id)}>{t('Remove')}</button>
        </div>
      {/if}
    </div>
  {:else if writing}
    <label class="field"><span>{t('Passage')}</span><textarea class="input" rows="6" bind:value={ownPassage}></textarea></label>
    {#each ownQuestions as q, i (i)}
      <fieldset class="plain">
        <legend>{t('Question {x}', { x: i + 1 })}</legend>
        <input class="input" bind:value={q.question} placeholder={t('Question')} aria-label={t('Question')} />
        <input class="input" bind:value={q.right} placeholder={t('Right answer')} aria-label={t('Right answer')} />
        {#each q.wrong as _, w (w)}
          <input class="input" bind:value={q.wrong[w]} placeholder={t('Wrong answer{x}', { x: w ? t(' (optional)') : '' })} aria-label={t('Wrong answer')} />
        {/each}
      </fieldset>
    {/each}
    <button class="quiet" onclick={() => ownQuestions.push({ question: '', right: '', wrong: ['', '', ''] })}>{t('Add a question')}</button>
    {#if ready && data.ai.noticeSeen}
      <button class="quiet" disabled={busy || !ownPassage.trim()} onclick={() => makeReading(ownPassage)}>
        {busy ? t('Writing questions…') : t('Let Thoth write the questions instead')}
      </button>
    {/if}
    <div class="pair">
      <button class="quiet" onclick={() => (writing = false)}>{t('Cancel')}</button>
      <button class="primary" onclick={saveOwn}>{t('Save passage')}</button>
    </div>
  {:else}
    <p class="hint">{t('Read a passage, then answer questions about it. Questions can be yours or Thoth\'s.')}</p>
    {#if readings.length}
      <ul class="drafts">
        {#each readings as r (r.id)}
          <li>
            <button class="lesson card" onclick={() => openReading(r)}>
              <span class="grow"><strong>{r.title}</strong>
                <small>{t('{questionsCount} questions{x}{x2}', { questionsCount: r.questions.length, x: r.best != null ? ` · best ${r.best} of ${r.questions.length}` : '', x2: r.ai ? t(' · AI') : '' })}</small>
              </span>
              <Icon name="play" size={18} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <label class="field"><span>{t('Topic for a new passage')} <small>{t('optional')}</small></span>
      <input class="input" bind:value={readTopic} placeholder={t('Thoth chooses if left empty')} />
    </label>
    <p class="hint">{size('reading', { topic: readTopic, passage: '', count: 4 })}</p>
    <button class="primary" disabled={!ready || !data.ai.noticeSeen || busy} onclick={() => makeReading('')}>
      {busy ? t('Writing…') : t('Write a passage with questions')}
    </button>
    <button class="quiet" onclick={() => ((writing = true), (error = ''))}>{t('Use my own passage')}</button>
  {/if}
</section>

<style>
  .ai {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding-block: 20px 32px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header h1 {
    font-size: 24px;
  }
  .intro {
    display: flex;
    gap: 14px;
    padding: 14px;
  }
  .intro > div:last-child {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }
  .portrait {
    flex: none;
    width: 84px;
    height: 84px;
    overflow: hidden;
    background: var(--thoth-bg);
    border: 2px solid var(--line);
  }
  .tabs button {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 2px;
    font-size: 14px;
  }
  .hint,
  small {
    font-size: 14px;
    color: var(--muted);
  }
  .hint:empty {
    display: none;
  }
  .msg {
    padding: 10px 14px;
    font-weight: 600;
  }
  .bad {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }
  .chat {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .turn {
    max-width: 92%;
    padding: 10px 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .turn.user {
    align-self: flex-end;
    background: var(--sel-bg);
  }
  .muted {
    color: var(--muted);
  }
  .ask {
    display: flex;
    gap: 8px;
  }
  .ask .input {
    flex: 1;
    min-width: 0;
  }
  .input {
    width: 100%;
    min-height: 46px;
    padding: 8px 12px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
  }
  select.input {
    appearance: none;
    border-radius: 0;
  }
  textarea.input {
    line-height: 1.4;
    resize: vertical;
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
  .narrow {
    max-width: 140px;
  }
  .link {
    align-self: flex-start;
    padding: 4px 0;
    border: none;
    background: none;
    text-decoration: underline;
    color: var(--muted);
  }
  .drafts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .drafts li.plain {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
  }
  .drafts li.col {
    flex-direction: column;
    gap: 6px;
  }
  .drafts input[type='checkbox'] {
    width: 22px;
    height: 22px;
    flex: none;
    margin-top: 10px;
    accent-color: var(--emerald);
  }
  .col input[type='checkbox'] {
    margin: 0 6px 0 0;
    vertical-align: -4px;
  }
  .direct {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .direct .label,
  .or {
    margin: 0;
  }
  .keep {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }
  .keep input {
    width: 22px;
    height: 22px;
    accent-color: var(--emerald);
  }
  .pairin {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flag {
    margin: 0;
    padding: 6px 10px;
    background: var(--close-bg);
    color: var(--close-text);
    border-left: 4px solid var(--close-line);
  }
  .pair {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .pair .quiet {
    flex: 1;
    min-height: 52px;
  }
  .pair .primary {
    flex: 2;
    font-size: 19px;
  }
  .tag {
    display: inline-block;
    padding: 0 6px;
    border: 1.5px solid currentColor;
    font-size: 11px;
    letter-spacing: 0.08em;
  }
  .reading {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .passage {
    margin: 0;
    padding: 14px 16px;
    font-size: 18px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  details {
    padding: 8px 12px;
  }
  details .passage {
    padding: 8px 0 0;
    font-size: 16px;
  }
  fieldset {
    margin: 0;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    padding: 0 6px;
    font-weight: 600;
  }
  .lesson {
    width: 100%;
    min-height: 60px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
  }
  .lesson .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
