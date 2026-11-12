<script lang="ts">
  // One lesson or review: shows each exercise, grades it, and ends with a summary.
  // The learner never grades themselves, except on cards the app cannot check.
  import { tick, untrack } from 'svelte';
  import { aiReady, ask } from '../ai.svelte';
  import { checkAnswer, limits, liveFeedback, noteLessons } from '../core';
  import { choiceLine, lessonEndLine, line, streakLine } from '../core/thoth';
  import type { Exercise, Marked } from '../core/types';
  import { closeSession, currentStreak, data, grade, met, next, setAsideCurrent, snap, ui } from '../store.svelte';
  import { canSpeak, speak } from '../speech';
  import Media from './Media.svelte';
  import Icon from './Icon.svelte';
  import Thoth from './Thoth.svelte';

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
    startedAt = performance.now();
    if (!e) return;
    if (e.kind === 'meet') says = line('meet');
    else if (e.kind === 'choice') says = choiceLine(e.options!.length, s.lastMet === e.cardId);
    else if (e.kind === 'typed') says = line(e.live ? 'typedLive' : 'typedPlain');
    else says = ai ? line('freeAi') : line('self');
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
  }

  function check() {
    if (!ex || done) return;
    if (ex.kind === 'choice') {
      if (selected === null) return;
      settle(selected === ex.answer, true);
    } else if (ex.kind === 'typed') {
      if (!typed.trim()) return;
      const verdict = checkAnswer(typed, ex.accepted, deck.strictAccents);
      // One spelling retry before a near miss counts as wrong.
      if (verdict === 'typo' && !typoUsed) {
        typoUsed = true;
        says = line('typo');
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
  const actionLabel = $derived(!ex || done || ex.kind === 'meet' ? 'Continue' : 'Check');

  function act() {
    if (!ex) return closeSession();
    if (ex.kind === 'meet') return met();
    if (done) return next();
    check();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (ex?.kind === 'free' && !done) return;
      if (canAct) {
        e.preventDefault();
        act();
      }
      return;
    }
    if (ex?.kind === 'choice' && !done && /^[1-8]$/.test(e.key)) {
      const option = ex.options![Number(e.key) - 1];
      if (option !== undefined) selected = option;
    }
  }

  const where = $derived.by(() => {
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
    !ex ? '' : (ex.kind === 'meet' ? 'New' : `Stage ${ex.stage} · ${limits.stageNames[ex.stage - 1]}`) + (ex.reverse ? ' · Other way round' : ex.cloze ? ' · Fill the gap' : ''),
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
        <div class="thoth-big plain"><Thoth size={176} /></div>
      {/if}
      <p class="label">{where}</p>
      <h1 class="display">{s.practice ? 'Practice complete' : s.lessonId ? 'Lesson complete' : 'Review complete'}</h1>
      {#if s.practice}<p class="fine">Practice does not change when your cards come back.</p>{/if}
      {#if mode !== 'hidden'}<p class="said">{summaryLine}</p>{/if}
      <dl class="stats">
        <div class="plain"><dt>Correct</dt><dd>{s.correct} of {s.graded}</dd></div>
        <div class="plain"><dt>New</dt><dd>{s.introduced}</dd></div>
        <div class="plain"><dt>Moved up</dt><dd>{s.promoted}</dd></div>
      </dl>
      {#if s.graded > 0}
        <p class="streak"><Icon name="sun" size={22} /> {streakLine(currentStreak())}</p>
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
      <div class="menu-wrap">
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
      </div>
    </div>

    <div class="head">
      <p class="label">
        {where}{fromLesson ? ` · ${fromLesson}` : ''} · {stageWord}
        {#if ex.ai}<span class="tag" title="This card was written or changed by AI">AI</span>{/if}
      </p>
      {#if ex.kind !== 'meet'}
        <h1 class="display" dir="auto" style="font-size: calc({promptSize}px * var(--scale))">{ex.prompt}</h1>
        <Media deckId={s.deckId} names={ex.qmedia} />
        {#if look.hintExtra && ex.extra && !done}<p class="hint-extra" dir="auto">Hint: {ex.extra}</p>{/if}
      {/if}
      {#if voice && ex.kind !== 'meet'}
        <button class="quiet say" onclick={() => speak(ex.prompt, look.lang)}><Icon name="sound" size={16} /> Read aloud</button>
      {/if}
    </div>

    {#if ex.kind === 'meet'}
      <div class="meet card">
        <p class="display front" dir="auto">{meetFront}</p>
        <Media deckId={s.deckId} names={ex.qmedia} />
        <hr />
        <p class="back" dir="auto">{ex.answer}</p>
        <Media deckId={s.deckId} names={ex.amedia} autoplay={!ex.qmedia.some((m) => /\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(m))} />
        {#if ex.extra}<p class="extra" dir="auto">{ex.extra}</p>{/if}
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
            <button class="quiet" onclick={() => (revealed = true)}>Show the answer</button>
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
            <p class="label">Did you have it?</p>
            <div class="pair">
              <button class="quiet" onclick={() => settle(false, true)}>No</button>
              <button class="quiet" onclick={() => settle(true, true)}>Yes</button>
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
          <strong>{result.correct ? 'Correct' : 'Not quite'}</strong>
          {#if !result.correct || ex.kind === 'typed'}<span>Answer: {ex.answer}</span>{/if}
          {#if result.promoted}<span>Moved up a stage</span>{/if}
          {#if s.practice}<span>Practice: the schedule is unchanged</span>{/if}
        </div>
      </div>
      {#if ex.amedia.length || ex.extra}
        <div class="after plain">
          <Media deckId={s.deckId} names={ex.amedia} autoplay />
          {#if ex.extra}<p dir="auto">{ex.extra}</p>{/if}
        </div>
      {/if}
      {#if explanation}
        <div class="explain plain"><p class="label">Thoth explains <span class="tag">AI</span></p><p>{explanation}</p></div>
      {:else if ai}
        <button class="quiet" disabled={explaining} onclick={explain}>{explaining ? 'Thoth is thinking…' : 'Explain this'}</button>
      {/if}
    {/if}

    {#if mode === 'full'}
      <div class="thoth-row">
        <div class="portrait"><Thoth size={84} portrait /></div>
        <p class="bubble plain">{says}</p>
      </div>
    {/if}

    {#if ex.kind !== 'free' || done}
      <button class="primary" disabled={!canAct} onclick={act}>{actionLabel}</button>
    {/if}
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
</style>
