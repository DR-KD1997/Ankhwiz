<script lang="ts">
  // Prepare for Ankhwiz, for the open deck: choose the steps (each labelled
  // with whether it runs on this device or asks Thoth), watch the run (it goes
  // on in the background), then review what came of it.
  import { aiReady } from '../ai.svelte';
  import { date, plural, t } from '../i18n';
  import {
    changedNotes,
    closeReview,
    describe,
    estimate,
    job,
    needsAi,
    presetSteps,
    runPrepare,
    settle,
    stepName,
    STEPS,
    toggleApplied,
    type StepId,
  } from '../prepare.svelte';
  import { data, openPanel, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import { isJapaneseDeck } from '../furigana';

  const deck = $derived(data.decks[ui.deckId!]);
  const prep = $derived(deck.prep);
  const ai = $derived(aiReady() && data.ai.noticeSeen);
  const mine = $derived(job.deckId === deck.id);
  const running = $derived(mine && job.running);
  const reviewing = $derived(!running && ((prep?.pending?.length ?? 0) > 0 || (prep?.applied?.length ?? 0) > 0));
  const changed = $derived(changedNotes(deck).length);
  const total = $derived(Object.keys(deck.notes).length);

  let preset = $state<'device' | 'full' | 'custom'>('full');
  let picked = $state<Set<StepId>>(new Set(presetSteps('full')));
  let showRun = $state(false);
  $effect(() => {
    if (!ai && preset === 'full') untrackPreset();
  });
  function untrackPreset() {
    preset = 'device';
    picked = new Set(presetSteps('device'));
  }
  function choose(p: 'device' | 'full' | 'custom') {
    preset = p;
    if (p !== 'custom') picked = new Set(presetSteps(p));
  }
  function flip(id: StepId) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
    preset = 'custom';
  }
  // Furigana is offered for Japanese decks only.
  const japanese = $derived(isJapaneseDeck(deck));
  const offered = $derived(STEPS.filter((s) => s.id !== 'furigana' || japanese));
  const steps = $derived([...picked].filter((id) => (id !== 'furigana' || japanese) && (ai || !needsAi(STEPS.find((s) => s.id === id)!.how))));
  const est = $derived(estimate(deck, steps));

  function start() {
    showRun = true;
    void runPrepare(deck.id, STEPS.map((s) => s.id).filter((id) => steps.includes(id)));
  }

  // Review: groups left out, and items unticked within them.
  let undone = $state<Set<string>>(new Set());
  let skipped = $state<Record<string, Set<string>>>({});
  let open = $state('');
  function flipItem(patchId: string, key: string) {
    const s = new Set(skipped[patchId] ?? []);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    skipped = { ...skipped, [patchId]: s };
  }
  function undo(id: string) {
    const now = !undone.has(id);
    toggleApplied(deck.id, id, now);
    const next = new Set(undone);
    if (now) next.add(id);
    else next.delete(id);
    undone = next;
  }
  function keepAll(keep: boolean) {
    for (const p of [...(prep?.pending ?? [])]) settle(deck.id, p.id, keep, skipped[p.id]);
  }
  function done() {
    closeReview(deck.id);
    undone = new Set();
    showRun = false;
    openPanel('path');
  }

  const STATE_WORD = $derived({ waiting: t('Waiting'), running: t('Working'), done: t('Done'), skipped: t('Skipped'), failed: t('Did not finish'), stopped: t('Not run') } as Record<string, string>);
</script>

<section class="prep">
  <header>
    <button class="icon-btn" aria-label={t('Back')} onclick={() => openPanel('path')}><Icon name="back" /></button>
    <div>
      <p class="label">{deck.name} · {plural('{n} card', '{n} cards', total)}</p>
      <h1 class="display">{t('Prepare for Ankhwiz')}</h1>
    </div>
  </header>

  {#if running || (mine && showRun)}
    <div class="status plain" role="status">
      <div class="row">
        <strong class="grow">{job.paused ? t('Paused') : job.stopping ? t('Stopping…') : running ? t('Preparing…') : t('Finished')}</strong>
        <span class="fine">{t('{done} of {total} done', { done: job.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length, total: job.steps.length })}</span>
      </div>
      <div class="bar"><div style="width: {(job.steps.filter((s) => s.state !== 'waiting' && s.state !== 'running').length / Math.max(1, job.steps.length)) * 100}%"></div></div>
      <p class="fine">{job.paused ? t('Nothing is sent while paused. Resume any time.') : t('You can leave this screen and keep studying: it carries on in the background.')}</p>
      {#if running}
        <div class="pair">
          <button class="quiet" onclick={() => (job.paused = !job.paused)}>{job.paused ? t('Resume') : t('Pause')}</button>
          <button class="quiet" onclick={() => (job.stopping = true)}>{t('Stop')}</button>
        </div>
      {/if}
    </div>
    <ul class="steps">
      {#each job.steps as s (s.id)}
        <li class="st {s.state}">
          <span class="dot" aria-hidden="true">{#if s.state === 'done'}<Icon name="check" size={12} />{/if}</span>
          <span class="grow">
            <strong>{stepName(s.id)}</strong>
            <small>{s.state === 'running' && s.of ? t('Thoth · {done} of {of}', { done: s.done ?? 0, of: s.of }) : s.detail || STATE_WORD[s.state]}</small>
          </span>
        </li>
      {/each}
    </ul>
    {#if !running}
      <button class="primary" onclick={() => (showRun = false)}>{t('See what changed')}</button>
    {/if}
  {:else if reviewing}
    <p class="fine">{t('A backup was made first: Deck options › Backups can undo all of this later too.')}</p>
    {#if prep?.applied?.length}
      <p class="label">{t('Applied · on this device')}</p>
      <div class="group plain">
        {#each prep.applied as p (p.id)}
          {@const d = describe(deck, p)}
          <div class="row line" class:undone={undone.has(p.id)}>
            <span class="grow"><strong>{d.title}</strong><small>{d.examples[0] ?? ''}</small></span>
            <button class="link" onclick={() => undo(p.id)}>{undone.has(p.id) ? t('Redo') : t('Undo')}</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if prep?.pending?.length}
      <p class="label">{t('Check before keeping')}</p>
      {#each prep.pending as p (p.id)}
        {@const d = describe(deck, p)}
        <div class="group plain">
          <div class="row">
            <strong class="grow">{d.title}</strong>
            <span class="who {d.from}">{d.from === 'thoth' ? t('Thoth') : t('This device')}</span>
          </div>
          {#each d.examples as e, i (i)}<p class="fine">{e}</p>{/each}
          {#if open === p.id && d.items.length}
            <div class="items">
              {#each d.items.slice(0, 200) as it (it.key)}
                <label class="item">
                  <input type="checkbox" checked={!skipped[p.id]?.has(it.key)} onchange={() => flipItem(p.id, it.key)} />
                  <span class="grow" dir="auto">{it.text}</span>
                  {#if it.tag}<span class="who {it.tag === 'same' ? 'device' : 'thoth'}">{it.tag === 'same' ? t('Same meaning') : t('Close')}</span>{/if}
                </label>
              {/each}
              {#if d.items.length > 200}<p class="fine">{t('And {n} more.', { n: d.items.length - 200 })}</p>{/if}
            </div>
          {/if}
          <div class="pair">
            <button class="quiet keep" onclick={() => settle(deck.id, p.id, true, skipped[p.id])}>{t('Keep')}</button>
            <button class="quiet" onclick={() => settle(deck.id, p.id, false)}>{t('Drop')}</button>
            {#if d.items.length > 1}<button class="quiet" aria-expanded={open === p.id} onclick={() => (open = open === p.id ? '' : p.id)}>{open === p.id ? t('Close list') : t('See all')}</button>{/if}
          </div>
        </div>
      {/each}
    {/if}
    {#if prep?.unfinished?.length}
      <p class="fine">{t('Not finished: {steps}. Prepare again to do the rest.', { steps: prep.unfinished.map((s) => stepName(s as StepId)).join(', ') })}</p>
    {/if}
    <div class="grow"></div>
    <div class="pair">
      {#if prep?.pending?.length}
        <button class="quiet" onclick={() => keepAll(false)}>{t('Drop all')}</button>
        <button class="primary" onclick={() => keepAll(true)}>{t('Keep all')}</button>
      {:else}
        <button class="primary" onclick={done}>{t('Done')}</button>
      {/if}
    </div>
  {:else}
    {#if prep?.at}
      <p class="fine">{t('Prepared on {date}.', { date: date(prep.at) })} {changed ? plural('{n} card is new or changed since: preparing again only looks at those.', '{n} cards are new or changed since: preparing again only looks at those.', changed) : t('Nothing has changed since.')}</p>
    {:else}
      <p class="fine">{t('Ankhwiz sets this deck up for its own features: voices, fair answers, lesson names and more. Nothing in the cards’ own text changes.')}</p>
    {/if}
    <div class="seg" role="group" aria-label={t('What to prepare')}>
      <button aria-pressed={preset === 'device'} onclick={() => choose('device')}>{t('On this device')}</button>
      <button aria-pressed={preset === 'full'} disabled={!ai} onclick={() => choose('full')}>{t('Full, with Thoth')}</button>
      <button aria-pressed={preset === 'custom'} onclick={() => choose('custom')}>{t('Custom')}</button>
    </div>
    <ul class="choose">
      {#each offered as s (s.id)}
        {@const off = needsAi(s.how) && !ai}
        {@const on = picked.has(s.id) && !off}
        <li>
          <button class="step" aria-pressed={on} disabled={off} onclick={() => flip(s.id)}>
            <span class="box" class:on aria-hidden="true">{#if on}<Icon name="check" size={14} />{/if}</span>
            <span class="grow">
              <strong>{t(s.name)}</strong>
              <span class="chips">
                {#if s.how === 'device' || s.how === 'both'}<span class="chip dev">{ai || s.how === 'device' ? t('On this device') : t('On this device only')}</span>{/if}
                {#if needsAi(s.how) || (s.how === 'both' && ai)}
                  {#if off}<span class="chip none">{t('Needs the AI connection')}</span>
                  {:else}<span class="chip ai">{est.per[s.id] ? plural('Thoth · ~{n} request', 'Thoth · ~{n} requests', est.per[s.id] ?? 0) : t('Thoth')}</span>{/if}
                {/if}
                {#if s.how === 'content'}<span class="chip content">{t('adds AI-written text')}</span>{/if}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="foot plain">
      <strong>{est.total ? `${plural('About {n} minute', 'About {n} minutes', est.minutes)} · ${plural('about {n} request', 'about {n} requests', est.total)}` : t('Under a minute · nothing leaves this device')}</strong>
      <small>{est.total ? t('Card text is sent to your AI provider for the Thoth steps. The rest runs on this device.') : ai ? t('Thoth steps are off.') : t('The AI connection isn’t set up, so only the steps on this device run. Set it up in Settings.')}</small>
      <button class="primary" disabled={!steps.length || job.running} onclick={start}>{job.running ? t('Another deck is being prepared') : prep?.at ? t('Prepare again') : t('Prepare')}</button>
    </div>
  {/if}
</section>

<style>
  .prep {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
    flex: 1;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header .label,
  h1 {
    margin: 0;
  }
  h1 {
    font-size: 24px;
  }
  .fine,
  small {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status,
  .group,
  .foot {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }
  .bar {
    height: 10px;
    border: 2px solid var(--line);
    background: var(--hair);
  }
  .bar div {
    height: 100%;
    background: var(--emerald);
    transition: width 0.3s;
  }
  .pair {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pair button {
    flex: 1;
  }
  .steps,
  .choose {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .st {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 44px;
  }
  .st .dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .st.done .dot {
    background: var(--emerald);
    color: var(--surface);
  }
  .st.running .dot {
    background: var(--brass);
  }
  .st.stopped,
  .st.skipped {
    opacity: 0.6;
  }
  .line {
    border-bottom: 1px solid var(--hair);
    padding-bottom: 6px;
  }
  .line.undone strong {
    text-decoration: line-through;
    color: var(--muted);
  }
  .link {
    background: none;
    border: 0;
    color: var(--emerald);
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
    min-height: 40px;
  }
  .who {
    font-size: 12px;
    font-weight: 700;
    padding: 1px 6px;
  }
  .who.thoth {
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .who.device {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .keep {
    background: var(--emerald);
    color: var(--surface);
  }
  .items {
    display: flex;
    flex-direction: column;
    max-height: 320px;
    overflow-y: auto;
    border-top: 1px solid var(--hair);
  }
  .item {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    border-bottom: 1px solid var(--hair);
    font-size: 15px;
  }
  .item input {
    width: 20px;
    height: 20px;
    accent-color: var(--emerald);
  }
  .seg {
    display: flex;
    border: 2px solid var(--line);
  }
  .seg button {
    flex: 1;
    min-height: 44px;
    border: 0;
    border-right: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button[aria-pressed='true'] {
    background: var(--text);
    color: var(--surface);
  }
  .seg button:disabled {
    opacity: 0.5;
  }
  .step {
    width: 100%;
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 54px;
    padding: 6px 4px;
    border: 0;
    border-bottom: 1px solid var(--hair);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .step:disabled {
    color: var(--muted);
    cursor: default;
  }
  .box {
    width: 22px;
    height: 22px;
    border: 2px solid currentColor;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .box.on {
    background: var(--emerald);
    border-color: var(--emerald);
    color: var(--surface);
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 12px;
    font-weight: 700;
    padding: 1px 6px;
  }
  .chip.dev {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .chip.ai {
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .chip.content {
    background: var(--off-bg);
    color: var(--off-text);
  }
  .chip.none {
    background: var(--hair);
    color: var(--muted);
  }
</style>
