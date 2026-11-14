<script lang="ts">
  // One lesson, review, practice round, test out or all-decks review: shows
  // each exercise, grades it, and ends with a summary. The learner never grades
  // themselves, except on cards the app cannot check (self-check cards).
  import { tick, untrack } from 'svelte';
  import { aiReady, ask } from '../ai.svelte';
  import { checkAnswer, limits, liveFeedback, noteLessons } from '../core';
  import { choiceLine, lessonEndLine, line, streakLine } from '../core/thoth';
  import { t } from '../i18n';
  import type { Exercise, Marked } from '../core/types';
  import { closeSession, currentStreak, data, grade, met, next, setAsideCurrent, snap, takeMilestone, ui } from '../store.svelte';
  import { canSpeak, speak } from '../speech';
  import Fields from './Fields.svelte';
  import Media from './Media.svelte';
  import Picture from './Picture.svelte';
  import Icon from './Icon.svelte';
  import Thoth, { type Cue, type Reaction } from './Thoth.svelte';

  const s = $derived(ui.session!);
  const ex = $derived(s.exercise);
  const deck = $derived(data.decks[s.deckId]);
  const mode = $derived(data.settings.thoth);

  let selected = $state<string | null>(null);
  let typed = $state('');
  let done = $state(false);
  let result = $state<{ correct: boolean; promoted: boolean } | null>(null);
  let typoUsed = $state(false);
  let sawRed = $state(false);
  let revealed = $state(false);
  let says = $state('');
  let startedAt = 0;
  let field = $state<HTMLInputElement>();
  // Long answers: written freely, then marked by AI or compared by the learner.
  let free = $state('');
  let marking = $state(false);
  let marked = $state<Marked | null>(null);
  let markError = $state('');
  // "Explain this", after an answer.
  let explaining = $state(false);
  let explanation = $state('');
  const ai = $derived(aiReady() && data.ai.noticeSeen);
  const look = $derived(deck.options.look);
  const scale = $derived(look.size === 's' ? 0.88 : look.size === 'l' ? 1.18 : 1);
  const voice = $derived(look.lang && look.speak !== 'off' && canSpeak());
  let menu = $state(false);
  let cue = $state<Cue | null>(null);
  let cueCount = 0;
  const react = (kind: Reaction) => (cue = { kind, id: ++cueCount });
  const testing = $derived(!!s.testOut);
  let milestone = $state<number | null>(null);
  $effect(() => {
    if (s.finished && s.graded > 0 && !testing) untrack(() => (milestone = takeMilestone()));
  });
  const finishCue = $derived<Cue>({
    kind: milestone
      ? 'delight'
      : testing
        ? s.testOut?.result?.passed
          ? 'cheer'
          : 'encourage'
        : !s.graded
          ? 'nod'
          : s.correct / s.graded >= 0.8
            ? 'cheer'
            : s.correct / s.graded >= 0.5
              ? 'happy'
              : 'encourage',
    id: 0,
  });
  /** Said to screen readers when an answer is marked. */
  let announce = $state('');
  let help = $state(false);

  function reset(e: Exercise | null) {
    selected = null;
    typed = '';
    done = false;
    result = null;
    typoUsed = false;
    sawRed = false;
    revealed = false;
    free = '';
    marking = false;
    marked = null;
    markError = '';
    explaining = false;
    explanation = '';
    rated = null;
    startedAt = performance.now();
    if (!e) return;
    react('nod');
    if (e.kind === 'meet') says = line('meet');
    else if (e.kind === 'choice') says = choiceLine(e.options!.length, s.lastMet === e.cardId);
    else if (e.kind === 'typed') says = line(e.live ? 'typedLive' : 'typedPlain');
    else if (e.kind === 'self') says = line('selfCheck');
    else says = ai ? line('freeAi') : line('self');
    if (testing) says = line('testOut');
    announce = '';
    if (e.kind === 'typed') void tick().then(() => field?.focus());
  }

  $effect(() => {
    const e = ex;
    untrack(() => reset(e));
  });

  const live = $derived(
    ex?.kind === 'typed' && ex.live && !done ? liveFeedback(typed, ex.accepted, deck.strictAccents) : 'empty',
  );
  const liveWord = { empty: '', match: 'On track', close: 'Close', off: 'Off track' } as const;

  function onType() {
    if (ex?.kind === 'typed' && ex.live && liveFeedback(typed, ex.accepted, deck.strictAccents) === 'off') sawRed = true;
  }

  function settle(correct: boolean, assisted: boolean, aiGraded = false) {
    const r = grade({ correct, assisted, sawRed, ms: performance.now() - startedAt, aiGraded });
    result = { correct, promoted: r.promoted };
    done = true;
    says = correct ? line(r.promoted ? 'promoted' : 'correct') : line('wrong');
    react(correct ? (r.promoted ? 'cheer' : 'happy') : 'sad');
    announce = correct ? `Correct.${r.promoted ? ' Moved up a stage.' : ''}` : `Not quite. The answer is ${ex?.answer ?? ''}.`;
  }

  /** Self-check: how close the learner says they were. Partly counts as right, but hard. */
  let rated = $state<'missed' | 'partly' | 'got' | null>(null);
  function rate(how: 'missed' | 'partly' | 'got') {
    rated = how;
    settle(how !== 'missed', how === 'partly');
  }
  const RATED = { missed: ['Missed it', 'It comes back soon'], partly: ['Partly', 'Counted as a hard recall'], got: ['Got it', ''] } as const;

  function check() {
    if (!ex || done) return;
    if (ex.kind === 'choice') {
      if (selected === null) return;
      settle(selected === ex.answer, true);
    } else if (ex.kind === 'typed') {
      if (!typed.trim()) return;
      const verdict = checkAnswer(typed, ex.accepted, deck.strictAccents);
      // One spelling retry before a near miss counts as wrong.
      if (verdict === 'typo' && !typoUsed && !testing) {
        typoUsed = true;
        says = line('typo');
        react('nod');
        field?.focus();
        return;
      }
      settle(verdict === 'correct', !!ex.live || typoUsed);
    }
  }

  /** Send a freely written answer to the AI for marking. */
  async function mark() {
    if (!ex || !free.trim() || marking) return;
    marking = true;
    markError = '';
    try {
      marked = await ask<Marked>('grade', snap(deck), { noteId: ex.cardId, given: free });
      says = marked.feedback || line(marked.correct ? 'correct' : 'wrong');
    } catch (e) {
      // Without a mark, fall back to comparing the answers by eye.
      markError = e instanceof Error ? e.message : 'The answer could not be marked.';
      revealed = true;
    } finally {
      marking = false;
    }
  }

  async function explain() {
    if (!ex || explaining) return;
    explaining = true;
    try {
      const given = ex.kind === 'choice' ? (selected ?? '') : ex.kind === 'typed' ? typed : free;
      explanation = await ask<string>('explain', snap(deck), { noteId: ex.cardId, given: result?.correct ? '' : given });
    } catch (e) {
      explanation = e instanceof Error ? e.message : 'No explanation could be fetched.';
    } finally {
      explaining = false;
    }
  }

  const canAct = $derived(
    !ex ? true : done || ex.kind === 'meet' ? true : ex.kind === 'choice' ? selected !== null : ex.kind === 'typed' ? typed.trim().length > 0 : false,
  );
  const actionLabel = $derived(!ex || done || ex.kind === 'meet' ? t('continue') : t('check'));

  function act() {
    if (!ex) return closeSession();
    if (ex.kind === 'meet') return met();
    if (done) return next();
    check();
  }

  /** Keyboard: Enter checks and continues, 1–8 pick an option (or a self-check rating),
   *  E explains, R reads aloud, S skips for today, Esc leaves, ? shows the keys. */
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox');
    if (e.key === 'Escape') {
      if (help) help = false;
      else if (menu) menu = false;
      else closeSession();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (e.target instanceof HTMLTextAreaElement) return;
      if ((ex?.kind === 'free' || ex?.kind === 'self') && !done) {
        if (!revealed && !marked && ex.kind === 'self') {
          e.preventDefault();
          revealed = true;
        }
        return;
      }
      if (canAct) {
        e.preventDefault();
        act();
      }
      return;
    }
    if (typing) return;
    if (e.key === '?') {
      help = !help;
      return;
    }
    if (ex?.kind === 'choice' && !done && /^[1-8]$/.test(e.key)) {
      const option = ex.options![Number(e.key) - 1];
      if (option !== undefined) selected = option;
      return;
    }
    if ((ex?.kind === 'self' || ex?.kind === 'free') && !done && (revealed || ex.kind === 'self') && /^[1-3]$/.test(e.key) && revealed && !marked) {
      rate((['missed', 'partly', 'got'] as const)[Number(e.key) - 1]);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'e' && done && ai && !testing && !explanation) void explain();
    else if (k === 'r' && voice && ex) speak(done ? ex.answer : ex.prompt, look.lang);
    else if (k === 's' && ex && !done && !testing && s.kind !== 'practice') setAsideCurrent('skip');
  }

  const where = $derived.by(() => {
    if (testing) return `Test out · ${deck.units.find((u) => u.id === s.testOut!.unitId)?.name ?? ''}`;
    if (s.kind === 'all') return s.finished ? 'All decks' : `All decks · ${deck.name}`;
    if (s.practice) return 'Practice';
    if (!s.lessonId) return 'Review';
    const unit = deck.units.find((u) => u.lessonIds.includes(s.lessonId!));
    const lesson = deck.lessons[s.lessonId];
    return unit && unit.name !== deck.name ? `${unit.name} · ${lesson.name}` : lesson.name;
  });
  const fromLesson = $derived.by(() => {
    if (!ex || s.lessonId) return '';
    const id = noteLessons(snap(deck))[ex.noteId];
    return id ? deck.lessons[id].name : '';
  });
  const stageWord = $derived(
    !ex ? '' : testing ? (ex.reverse ? 'Other way round' : 'No hints') : (ex.kind === 'meet' ? 'New' : `Stage ${ex.stage} · ${limits.stageNames[ex.stage - 1]}`) + (ex.reverse ? ' · Other way round' : ex.cloze ? ' · Fill the gap' : ''),
  );
  const meetFront = $derived(!ex ? '' : ex.reverse || ex.cloze ? ex.prompt : deck.notes[ex.noteId]?.front ?? ex.prompt);
  let spokenFor = '';
  $effect(() => {
    // Read the question aloud as each card appears, when the deck asks for it.
    if (!ex || !voice || look.speak !== 'question' || spokenFor === ex.cardId + s.index) return;
    spokenFor = ex.cardId + s.index;
    speak(ex.kind === 'meet' ? meetFront : ex.prompt, look.lang);
  });
  $effect(() => {
    if (done && ex && voice && look.speak === 'answer') speak(ex.answer, look.lang);
  });
  const promptSize = $derived(!ex ? 30 : ex.prompt.length > 160 ? 19 : ex.prompt.length > 70 ? 23 : 30);
  const position = $derived(Math.min(s.index + 1, s.queue.length));
  const letters = 'ABCDEFGH';
  const summaryLine = $derived(s.finished ? lessonEndLine(s.correct, s.graded, !s.lessonId) : '');
  const extras = $derived(ex ? [ex.extra, ...ex.extraMore] : []);
  const isSound = (m: string) => /\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(m);
  /** Test out: how each lesson of the unit went. */
  const testLessons = $derived.by(() => {
    const t = s.testOut;
    if (!t?.result) return [];
    const unit = deck.units.find((u) => u.id === t.unitId);
    const lessonOf = noteLessons(snap(deck));
    return (unit?.lessonIds ?? []).map((id) => {
      const mine = t.answers.filter((a) => lessonOf[a.cardId.split(':')[0]] === id);
      return { id, name: deck.lessons[id]?.name ?? '', right: mine.filter((a) => a.correct).length, total: mine.length, relearn: mine.filter((a) => !a.correct).length };
    });
  });
</script>

<svelte:window onkeydown={onKey} />

<section
  class="session font-{look.font}"
  style="--scale: {scale}"
  dir={look.rtl ? 'rtl' : undefined}
  aria-live="polite"
>
  {#if s.finished}
    <div class="summary">
      {#if mode !== 'hidden'}
        <div class="thoth-big plain"><Thoth size={176} cue={finishCue} /></div>
      {/if}
      {#if testing && s.testOut?.result}
        {@const r = s.testOut.result}
        <p class="label">{where}</p>
        <h1 class="display">{r.passed ? t('unitPassed') : t('notThisTime')}</h1>
        <p class="score"><strong>{r.correct}/{r.total}</strong> <span>pass mark {r.passMark}</span></p>
        {#if mode !== 'hidden'}<p class="said">{line(r.passed ? 'testPassed' : 'testFailed')}</p>{/if}
        <p class="fine">
          {r.passed
            ? `Its lessons are open, and their cards start at stage 3 instead of 1.${r.relearn.length ? ` ${r.relearn.length} missed ${r.relearn.length === 1 ? 'card goes' : 'cards go'} back to stage 1 to relearn.` : ''}`
            : 'Nothing has changed. You can do the lessons as usual, or try again tomorrow.'}
        </p>
        {#if r.passed}
          <ul class="lessons">
            {#each testLessons as l (l.id)}
              <li class="plain">
                <span class="tick"><Icon name="check" size={16} /></span>
                <span><strong>{l.name}</strong><small>{l.right} of {l.total} right{l.relearn ? ` · ${l.relearn} to relearn` : ' · stage 3'}</small></span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="label">{where}</p>
        {#if milestone}
          <h1 class="display">{t('daysInARow', { n: milestone })}</h1>
          {#if mode !== 'hidden'}<p class="said">{line(milestone >= 30 ? 'milestoneBig' : 'milestone')}</p>{/if}
        {:else}
          <h1 class="display">{s.practice ? t('practiceComplete') : s.kind === 'all' ? t('allDecksDone') : s.lessonId ? t('lessonComplete') : t('reviewComplete')}</h1>
          {#if mode !== 'hidden'}<p class="said">{summaryLine}</p>{/if}
        {/if}
        {#if s.practice}<p class="fine">Practice does not change when your cards come back.</p>{/if}
        <dl class="stats">
          <div class="plain"><dt>Correct</dt><dd>{s.correct} of {s.graded}</dd></div>
          <div class="plain"><dt>{s.kind === 'all' ? 'Decks' : 'New'}</dt><dd>{s.kind === 'all' ? (s.decks?.length ?? 1) : s.introduced}</dd></div>
          <div class="plain"><dt>Moved up</dt><dd>{s.promoted}</dd></div>
        </dl>
        {#if s.graded > 0}
          <p class="streak"><Icon name="sun" size={22} /> {streakLine(currentStreak())}</p>
        {/if}
      {/if}
    </div>
    <div class="grow"></div>
    <button class="primary" onclick={closeSession}>Continue</button>
  {:else if ex}
    <div class="top">
      <button class="icon-btn" aria-label="Close lesson" onclick={closeSession}><Icon name="close" /></button>
      <div class="bar plain" role="progressbar" aria-valuemin={0} aria-valuemax={s.queue.length} aria-valuenow={s.index}>
        <div style="width: {(s.index / s.queue.length) * 100}%"></div>
      </div>
      <span class="count">{position} of {s.queue.length}</span>
      {#if !testing}<div class="menu-wrap">
        <button class="icon-btn" aria-label="More for this card" aria-expanded={menu} onclick={() => (menu = !menu)}><Icon name="more" /></button>
        {#if menu}
          <div class="menu plain" role="menu">
            <button role="menuitem" onclick={() => ((menu = false), setAsideCurrent('skip'))}>
              <strong>Skip for today</strong><small>It comes back tomorrow (Anki: bury)</small>
            </button>
            <button role="menuitem" onclick={() => ((menu = false), setAsideCurrent('stop'))}>
              <strong>Stop asking this one</strong><small>Resume it in Cards (Anki: suspend)</small>
            </button>
          </div>
        {/if}
      </div>{/if}
    </div>

    <div class="head">
      <p class="label">
        {where}{fromLesson && !testing ? ` · ${fromLesson}` : ''} · {stageWord}
        {#if ex.ai}<span class="tag" title="This card was written or changed by AI">AI</span>{/if}
      </p>
      {#if ex.kind !== 'meet'}
        <h1 class="display" dir="auto" style="font-size: calc({promptSize}px * var(--scale))">{ex.prompt}</h1>
        <Fields items={ex.frontMore} first={2} base={promptSize * 0.8} label="question fields" />
        {#if ex.picture}<Picture deckId={s.deckId} picture={ex.picture} revealed={done} />{/if}
        <Media deckId={s.deckId} names={ex.qmedia} />
        {#if look.hintExtra && ex.extra && !done && !testing}<p class="hint-extra" dir="auto">Hint: {ex.extra}</p>{/if}
      {/if}
      {#if voice && ex.kind !== 'meet'}
        <button class="quiet say" onclick={() => speak(ex.prompt, look.lang)}><Icon name="sound" size={16} /> Read aloud</button>
      {/if}
    </div>

    {#if ex.kind === 'meet'}
      <div class="meet card">
        {#if meetFront}<p class="display front" dir="auto">{meetFront}</p>{/if}
        <Fields items={ex.frontMore} first={2} base={20} label="question fields" />
        {#if ex.picture}<Picture deckId={s.deckId} picture={ex.picture} revealed />{/if}
        <Media deckId={s.deckId} names={ex.qmedia} />
        <hr />
        {#if ex.answer}<p class="back" dir="auto">{ex.answer}</p>{/if}
        <Fields items={ex.answerMore} first={2} base={18} label="fields" />
        <Media deckId={s.deckId} names={ex.amedia} autoplay={!ex.qmedia.some(isSound)} />
        <div class="extra"><Fields items={extras} base={16} label="extra fields" /></div>
      </div>
    {:else if ex.kind === 'choice'}
      <div class="options" role="radiogroup" aria-label="Answers">
        {#each ex.options! as option, i (option)}
          {@const isAnswer = option === ex.answer}
          {@const picked = option === selected}
          <button
            class="option card"
            class:picked={picked && !done}
            class:ok={done && isAnswer}
            class:off={done && picked && !isAnswer}
            class:dim={done && !picked && !isAnswer}
            role="radio"
            aria-checked={picked}
            disabled={done}
            onclick={() => (selected = option)}
          >
            <span class="badge">
              {#if done && isAnswer}<Icon name="check" size={16} />
              {:else if done && picked}<Icon name="cross" size={16} />
              {:else}{letters[i]}{/if}
            </span>
            <span class="text">{option}</span>
          </button>
        {/each}
      </div>
    {:else if ex.kind === 'typed'}
      <div class="typed">
        <label class="label" for="answer">Your answer</label>
        <input
          id="answer"
          class="field card {done ? (result?.correct ? 'ok' : 'off') : live}"
          bind:this={field}
          bind:value={typed}
          oninput={onType}
          readonly={done}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="done"
        />
        {#if !done && ex.live && live !== 'empty'}
          <p class="live {live}">
            <Icon name={live === 'match' ? 'check' : live === 'close' ? 'dot' : 'cross'} size={16} />
            {liveWord[live]}
          </p>
        {:else if !done && typoUsed}
          <p class="live close"><Icon name="dot" size={16} /> Check your spelling</p>
        {/if}
      </div>
    {:else if ex.kind === 'self'}
      <div class="self">
        {#if !revealed}
          <label class="label" for="free">Your answer <small>(optional: say it to yourself, or write it)</small></label>
          <textarea id="free" class="card area" rows="3" bind:value={free}></textarea>
          <button class="quiet" onclick={() => (revealed = true)}>{t('showAnswer')}</button>
        {:else}
          {#if free.trim()}<div class="meet card yours"><p class="label">You wrote</p><p class="back">{free}</p></div>{/if}
          <div class="meet card">
            <p class="label">The answer</p>
            {#if ex.answer}<p class="back" dir="auto">{ex.answer}</p>{/if}
            <Fields items={ex.answerMore} first={2} base={18} label="fields" />
            <Media deckId={s.deckId} names={ex.amedia} autoplay />
            <div class="extra"><Fields items={extras} base={16} label="extra fields" /></div>
          </div>
          {#if !done}
            <p class="label">{t('howClose')}</p>
            <div class="rates">
              <button class="rate missed" onclick={() => rate('missed')}>{t('missedIt')}<small>Again · 1</small></button>
              <button class="rate partly" onclick={() => rate('partly')}>{t('partly')}<small>Hard · 2</small></button>
              <button class="rate got" onclick={() => rate('got')}>{t('gotIt')}<small>Good · 3</small></button>
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="self">
        {#if !done && !revealed && !marked}
          <label class="label" for="free">Your answer, in your own words</label>
          <textarea id="free" class="card area" rows="4" bind:value={free} readonly={marking}></textarea>
          {#if ai}
            <button class="quiet" disabled={!free.trim() || marking} onclick={mark}>
              {marking ? 'Thoth is reading…' : 'Check with Thoth'}
            </button>
            <p class="fine">Your answer and this card are sent to your AI service for marking.</p>
          {:else}
            <button class="quiet" onclick={() => (revealed = true)}>{t('showAnswer')}</button>
            <p class="fine">Long answers are marked by AI once a connection is set up in Settings. Until then, compare for yourself.</p>
          {/if}
        {:else}
          {#if free.trim()}<div class="meet card yours"><p class="label">You wrote</p><p class="back">{free}</p></div>{/if}
          <div class="meet card"><p class="label">Answer</p><p class="back">{ex.answer}</p></div>
          {#if !done && marked}
            <p class="label">Thoth's mark: {marked.correct ? 'correct' : 'not yet'} <span class="tag">AI</span></p>
            <div class="pair">
              <button class="quiet" onclick={() => settle(marked!.correct, true, true)}>Accept</button>
              <button class="quiet" onclick={() => settle(!marked!.correct, true, true)}>
                Overrule: I was {marked.correct ? 'wrong' : 'right'}
              </button>
            </div>
          {:else if !done}
            {#if markError}<p class="fine">{markError}</p>{/if}
            <p class="label">{t('howClose')}</p>
            <div class="rates">
              <button class="rate missed" onclick={() => rate('missed')}>{t('missedIt')}<small>Again · 1</small></button>
              <button class="rate partly" onclick={() => rate('partly')}>{t('partly')}<small>Hard · 2</small></button>
              <button class="rate got" onclick={() => rate('got')}>{t('gotIt')}<small>Good · 3</small></button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="grow"></div>

    {#if done && result}
      <div class="banner {result.correct ? 'ok' : 'off'}" role="status">
        <Icon name={result.correct ? 'check' : 'cross'} size={22} />
        <div>
          <strong>{rated ? RATED[rated][0] : result.correct ? t('correct') : t('notQuite')}</strong>
          {#if rated && RATED[rated][1]}<span>{RATED[rated][1]}</span>{/if}
          {#if (!result.correct || ex.kind === 'typed') && ex.answer && ex.kind !== 'self'}<span>{t('answerIs', { answer: ex.answer })}</span>{/if}
          {#if result.promoted}<span>{t('movedUp')}</span>{/if}
          {#if s.practice}<span>{t('practiceUnchanged')}</span>{/if}
        </div>
      </div>
      {#if ex.kind !== 'self' && (ex.amedia.length || extras.some((x) => x.trim()) || ex.answerMore.length)}
        <div class="after plain">
          <Fields items={ex.answerMore} first={2} base={17} label="fields" />
          <Media deckId={s.deckId} names={ex.amedia} autoplay />
          <Fields items={extras} base={16} label="extra fields" />
        </div>
      {/if}
      {#if explanation}
        <div class="explain plain"><p class="label">Thoth explains <span class="tag">AI</span></p><p>{explanation}</p></div>
      {:else if ai && !testing}
        <button class="quiet" disabled={explaining} onclick={explain}>{explaining ? 'Thoth is thinking…' : 'Explain this'}</button>
      {/if}
    {/if}

    {#if mode === 'full'}
      <div class="thoth-row">
        <div class="portrait"><Thoth size={84} portrait {cue} mood={marking || explaining ? 'think' : 'idle'} /></div>
        <p class="bubble plain">{says}</p>
      </div>
    {/if}

    {#if (ex.kind !== 'free' && ex.kind !== 'self') || done}
      <button class="primary" disabled={!canAct} onclick={act}>{actionLabel}</button>
    {/if}
  {/if}
  <p class="sr" role="status">{announce}</p>
  {#if help}
    <div class="keys plain" role="dialog" aria-label="Keyboard shortcuts">
      <p class="label">Keyboard shortcuts</p>
      <dl>
        <dt><kbd>1</kbd>–<kbd>8</kbd></dt><dd>Pick an option (self-check: 1 missed, 2 partly, 3 got it)</dd>
        <dt><kbd>Enter</kbd></dt><dd>Check, then continue</dd>
        <dt><kbd>E</kbd></dt><dd>Explain this (with an AI connection)</dd>
        <dt><kbd>R</kbd></dt><dd>Read aloud (when the deck reads aloud)</dd>
        <dt><kbd>S</kbd></dt><dd>Skip for today</dd>
        <dt><kbd>Esc</kbd></dt><dd>Leave; your place is kept</dd>
        <dt><kbd>?</kbd></dt><dd>Show or hide this list</dd>
      </dl>
      <button class="quiet" onclick={() => (help = false)}>Close</button>
    </div>
  {/if}
</section>

<style>
  .session {
    flex: 1;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding-block: 20px 24px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .grow {
    flex: 1;
    min-height: 4px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bar {
    flex: 1;
    height: 12px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--brass);
    transition: width 0.25s ease;
  }
  .count {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head h1 {
    overflow-wrap: anywhere;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .option {
    min-height: 60px;
    padding: 8px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 19px;
    font-weight: 600;
    text-align: left;
  }
  .option .text {
    overflow-wrap: anywhere;
  }
  .badge {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    border: 2px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .option.picked {
    border: 5px solid var(--brass);
    padding: 6px 16px;
    outline: none;
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .option.picked .badge {
    border: none;
    background: var(--badge-bg);
    color: var(--badge-text);
  }
  .option.ok {
    border-color: var(--ok-line);
    outline: none;
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .option.off {
    border-color: var(--off-line);
    outline: none;
    background: var(--off-bg);
    color: var(--off-text);
  }
  .option.dim {
    opacity: 0.5;
  }

  .meet {
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  .meet .front {
    font-size: 32px;
    overflow-wrap: anywhere;
  }
  .meet hr {
    width: 64px;
    margin: 0 auto;
    border: none;
    border-top: 2px solid var(--brass);
  }
  .meet .back {
    font-size: 22px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .typed {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .field {
    width: 100%;
    min-height: 64px;
    padding: 0 18px;
    font-size: 22px;
    font-weight: 600;
  }
  .field:focus-visible {
    outline: 1px solid var(--hair);
    outline-offset: -8px;
    border-color: var(--brass);
  }
  .field.match,
  .field.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
    outline: none;
  }
  .field.close {
    border-color: var(--close-line);
    background: var(--close-bg);
    color: var(--close-text);
    outline: none;
  }
  .field.off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
    outline: none;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .live.match {
    color: var(--ok-line);
  }
  .live.close {
    color: var(--close-line);
  }
  .live.off {
    color: var(--off-line);
  }

  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 5;
    width: 260px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .menu button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 14px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
  }
  .menu button + button {
    border-top: 1px solid var(--hair);
  }
  .menu small {
    color: var(--muted);
  }
  .say {
    align-self: flex-start;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    font-size: 14px;
  }
  .hint-extra,
  .extra {
    margin: 0;
    color: var(--muted);
    font-size: calc(16px * var(--scale));
  }
  .after {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .after p {
    margin: 0;
  }
  .session :global(.option .text),
  .session :global(.back),
  .session :global(.field) {
    font-size: calc(19px * var(--scale));
  }
  .font-serif :global(h1),
  .font-serif :global(.option .text),
  .font-serif :global(.back),
  .font-serif :global(.front) {
    font-family: 'Fraunces', Georgia, serif;
  }
  .font-rounded :global(h1),
  .font-rounded :global(.option .text),
  .font-rounded :global(.back),
  .font-rounded :global(.front) {
    font-family: ui-rounded, 'Nunito', 'Arial Rounded MT Bold', system-ui, sans-serif;
  }
  .font-mono :global(h1),
  .font-mono :global(.option .text),
  .font-mono :global(.back),
  .font-mono :global(.front) {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .self {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .area {
    width: 100%;
    padding: 12px 14px;
    font-size: 17px;
    line-height: 1.4;
    resize: vertical;
  }
  .fine {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .yours {
    background: transparent;
  }
  .tag {
    display: inline-block;
    padding: 0 6px;
    border: 1.5px solid currentColor;
    font-size: 11px;
    letter-spacing: 0.08em;
    vertical-align: 1px;
  }
  .explain {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .explain p {
    margin: 0;
  }
  .pair {
    display: flex;
    gap: 12px;
  }
  .pair button {
    flex: 1;
    min-height: 52px;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 2px solid;
  }
  .banner div {
    display: flex;
    flex-direction: column;
  }
  .banner strong {
    font-size: 18px;
  }
  .banner.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .banner.off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }

  .thoth-row {
    display: flex;
    align-items: stretch;
    gap: 12px;
  }
  .portrait {
    width: 88px;
    height: 88px;
    flex: none;
    border: 2px solid var(--line);
    background: var(--thoth-bg);
    overflow: hidden;
  }
  .bubble {
    flex: 1;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    line-height: 1.4;
  }

  .summary {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-top: 12px;
    text-align: center;
  }
  .thoth-big {
    width: 200px;
    height: 220px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    background: var(--thoth-bg);
    box-shadow: inset 0 0 0 5px var(--thoth-bg), inset 0 0 0 6px var(--hair);
  }
  .summary h1 {
    font-size: 32px;
  }
  .said {
    max-width: 34ch;
  }
  .stats {
    width: 100%;
    margin: 6px 0 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .stats div {
    padding: 10px 6px;
  }
  .stats dt {
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .stats dd {
    margin: 2px 0 0;
    font-size: 20px;
    font-weight: 600;
  }
  .streak {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--muted);
  }
  .meet .extra {
    font-size: 16px;
  }
  .rates {
    display: flex;
    gap: 8px;
  }
  .rate {
    flex: 1;
    min-height: 64px;
    border: 3px solid;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: 600 16px var(--body);
    color: var(--text);
  }
  .rate small {
    font-weight: 400;
    font-size: 12px;
    color: var(--muted);
  }
  .rate.missed {
    background: var(--off-bg);
    border-color: var(--off-line);
    color: var(--off-text);
  }
  .rate.partly {
    background: var(--close-bg);
    border-color: var(--close-line);
    color: var(--close-text);
  }
  .rate.got {
    background: var(--ok-bg);
    border-color: var(--ok-line);
    color: var(--ok-text);
  }
  .score {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    justify-content: center;
  }
  .score strong {
    font: 600 44px var(--button);
  }
  .score span {
    color: var(--muted);
  }
  .lessons {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
  }
  .lessons li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
  }
  .lessons li > span:last-child {
    display: flex;
    flex-direction: column;
  }
  .lessons small {
    color: var(--muted);
  }
  .tick {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--ok-bg);
    color: var(--ok-text);
    border: 2px solid var(--ok-line);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .keys {
    position: fixed;
    right: max(16px, env(safe-area-inset-right, 0px));
    bottom: 16px;
    z-index: 20;
    max-width: 340px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .keys dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 12px;
    font-size: 14px;
  }
  .keys dd {
    margin: 0;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border: 1.5px solid var(--line);
    border-bottom-width: 3px;
    border-radius: 4px;
    font: 600 12px var(--body);
  }
</style>
