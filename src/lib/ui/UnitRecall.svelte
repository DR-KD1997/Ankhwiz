<script lang="ts">
  import { plural, t } from '../i18n';
  // Unit recall: no questions, just a unit's name and three minutes to write
  // every word or phrase of it the learner remembers. What was missed comes
  // back in tomorrow's review instead of waiting for its date.
  import { onDestroy } from 'svelte';
  import { compareRecall, recallEntries, recallTargets, type RecallResult } from '../practice';
  import { bringForward, data, openPanel, ui } from '../store.svelte';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  // Units with cards met, the most recent first: those are worth recalling.
  const units = $derived(
    deck.units
      .map((u) => ({ u, met: recallTargets(deck, progress, u.id).filter((t) => t.met).length }))
      .filter((x) => x.met > 0)
      .reverse(),
  );
  let unitId = $state('');
  const unit = $derived(deck.units.find((u) => u.id === (unitId || units[0]?.u.id)));
  let typed = $state('');
  let showHints = $state(false);
  let started = $state(false);
  let result = $state<RecallResult | null>(null);
  let moved = $state(0);
  let left = $state(180);
  let timer: ReturnType<typeof setInterval> | undefined;
  const targets = $derived(unit ? recallTargets(deck, progress, unit.id) : []);
  const count = $derived(recallEntries(typed).length);

  function start() {
    started = true;
    result = null;
    typed = '';
    left = 180;
    clearInterval(timer);
    timer = setInterval(() => {
      left = Math.max(0, left - 1);
      if (!left) clearInterval(timer);
    }, 1000);
  }

  function compare() {
    if (!unit) return;
    clearInterval(timer);
    result = compareRecall(deck, progress, unit.id, typed);
    // Missed cards already met come back tomorrow.
    moved = bringForward(
      deck.id,
      result.missed.filter((m) => m.met).map((m) => m.noteId),
    );
  }

  const clock = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
  onDestroy(() => clearInterval(timer));
</script>

<section class="recall">
  <header>
    <button class="icon-btn" aria-label={t('Back to practice')} onclick={() => openPanel('practice')}><Icon name="back" /></button>
    <h1 class="display">{t('Unit recall')}</h1>
  </header>

  {#if !units.length}
    <p class="hint">{t('Unit recall asks for the cards of a unit from memory. Meet some cards in a lesson first.')}</p>
  {:else if !started}
    <p class="hint">{t('No questions this time. Write every word, phrase or fact you remember from a unit, one per line or separated by commas. Spelling does not need to be perfect. Cards you miss come back in tomorrow\'s review.')}</p>
    <label class="field"
      ><span>{t('Unit')}</span>
      <select class="input" bind:value={unitId}>
        {#each units as x (x.u.id)}<option value={x.u.id}>{t('{name} · {met} met', { name: x.u.name, met: x.met })}</option>{/each}
      </select></label
    >
    <label class="check"><input type="checkbox" bind:checked={showHints} /> <span>{t('Show the other side as hints')} <small>{t('Easier: you see what each card means and write the card.')}</small></span></label>
    <button class="primary" onclick={start}>{t('Start')}</button>
  {:else if !result}
    <div class="top">
      <p class="label">{t('{name} · {targetsCount} cards', { name: unit?.name, targetsCount: targets.length })}</p>
      <span class="clock" class:out={!left} aria-label={t('Time left')}>{left ? clock : t('Time’s up')}</span>
    </div>
    {#if showHints}
      <ul class="hints">{#each targets as ty (ty.noteId)}<li>{ty.hint}</li>{/each}</ul>
    {/if}
    <label class="field">
      <span>{t('What you remember')}</span>
      <textarea class="input" rows="9" bind:value={typed} autocapitalize="off" spellcheck="false" lang={deck.options.look.lang || undefined}></textarea>
    </label>
    <div class="pair">
      <span class="small">{t('{count} written', { count })}</span>
      <button class="primary" onclick={compare} disabled={!count}>{t('Compare with the unit')}</button>
    </div>
  {:else}
    <div class="score card" role="status">
      <h2 class="display">{t('{foundCount} of {targetsCount}', { foundCount: result.found.length, targetsCount: targets.length })}</h2>
      <p class="small">{result.found.filter((f) => !f.exact).length ? t('{n} nearly right.', { n: result.found.filter((f) => !f.exact).length }) + ' ' : ''}{moved ? plural('{n} missed card comes back tomorrow.', '{n} missed cards come back tomorrow.', moved) : ''}</p>
    </div>
    {#if result.found.length}
      <p class="label">{t('Remembered')}</p>
      <ul class="list">{#each result.found as f (f.target.noteId)}<li class={f.exact ? 'ok' : 'close'}><strong>{f.target.text}</strong>{#if !f.exact}<small>{t('{x}you wrote {typed}', { x: ' · ', typed: f.typed })}</small>{/if}<small>{' · '}{f.target.hint}</small></li>{/each}</ul>
    {/if}
    {#if result.missed.length}
      <p class="label">{t('Missed')}</p>
      <ul class="list">{#each result.missed as m (m.noteId)}<li class="off"><strong>{m.text}</strong><small>{' · '}{m.hint}{m.met ? '' : t(' · not met yet')}</small></li>{/each}</ul>
    {/if}
    {#if result.elsewhere.length}
      <p class="label">{t('From other units')}</p>
      <ul class="list">{#each result.elsewhere as e (e.typed)}<li><strong>{e.typed}</strong><small>{' · '}{e.unit}</small></li>{/each}</ul>
    {/if}
    {#if result.unknown.length}
      <p class="small">{t('Not on your cards: {x}', { x: result.unknown.join(', ') })}</p>
    {/if}
    <div class="pair">
      <button class="quiet" onclick={() => openPanel('practice')}>{t('Done')}</button>
      <button class="primary" onclick={start}>{t('Try again')}</button>
    </div>
  {/if}
</section>

<style>
  .recall {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    max-width: 640px;
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
  .hint,
  .small,
  small {
    color: var(--muted);
    font-size: 15px;
    margin: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
  }
  .check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .check span {
    display: flex;
    flex-direction: column;
  }
  textarea {
    font-size: 18px;
    resize: vertical;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .clock {
    font-weight: 700;
    font-size: 18px;
    padding: 4px 10px;
    border: 2px solid var(--line);
    background: var(--check-bg);
    color: var(--check-text);
  }
  .clock.out {
    background: var(--close-bg);
    color: var(--close-text);
  }
  .hints {
    margin: 0;
    padding-left: 20px;
    columns: 2;
    color: var(--muted);
  }
  .score {
    padding: 14px;
  }
  .score h2 {
    margin: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .list li {
    padding: 8px 10px;
    border: 2px solid var(--hair);
    background: var(--surface);
  }
  .list li.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
  }
  .list li.close {
    border-color: var(--close-line);
    background: var(--close-bg);
  }
  .list li.off {
    border-color: var(--off-line);
    background: var(--off-bg);
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
  }
  .pair .small {
    margin-right: auto;
  }
  .label {
    margin: 4px 0 0;
  }
</style>
