<script lang="ts">
  import { firstLaunch, signal } from '../tour.svelte';
  import { onMount } from 'svelte';
  onMount(() => firstLaunch());
  // The library: every deck on this device, and three ways to add one.
  import { line } from '../core/thoth';
  import { importAnkh, readPackage, type AnkiPackage } from '../exporting';
  import ImportMap from './ImportMap.svelte';
  import { parseList } from '../import/paste';
  import {
    addFromRows,
    addSample,
    allDue,
    data,
    dropPaused,
    now,
    openDeck,
    openPanel,
    pausedSummary,
    resumePaused,
    snap,
    startAll,
    tipDue,
    tipSeen,
    ui,
  } from '../store.svelte';
  import { summarise } from './deckView';
  import ProgressBar from './ProgressBar.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Thoth from './Thoth.svelte';

  const decks = $derived(
    Object.values(data.decks)
      .sort((a, b) => a.created - b.created)
      .map((deck) => ({ deck, sum: summarise(snap(deck), snap(data.progress[deck.id] ?? {}), now()) })),
  );
  const hasSample = $derived(decks.some((d) => d.deck.name.includes('(sample)')));

  let pasting = $state(false);
  let listName = $state('');
  let listText = $state('');
  let busy = $state(false);
  let readingName = $state('');
  let message = $state<{ ok: boolean; text: string } | null>(null);
  let picker = $state<HTMLInputElement>();
  // Raw: a package holds every note of the deck, which must not be made reactive.
  let pending = $state.raw<AnkiPackage | null>(null);
  const welcome = line('welcome');
  const paused = $derived(pausedSummary());
  // Recomputed with the deck list: reviews due in every deck, for "Study all decks".
  const due = $derived.by(() => {
    void decks;
    return allDue().map((d) => ({ deck: data.decks[d.deckId], n: d.queue.length }));
  });
  const dueTotal = $derived(due.reduce((t, d) => t + d.n, 0));
  const reminderText = $derived.by(() => {
    const r = data.reminder;
    if (!r.on) return '';
    const days = r.days.length === 7 ? '' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? ' on weekdays' : ' on chosen days';
    return `Daily reminder at ${r.time}${days}, on days you haven’t studied`;
  });

  function report(name: string, count: number, skipped: number, id: string) {
    const units = data.decks[id].units.length;
    const lessons = Object.keys(data.decks[id].lessons).length;
    const left = skipped ? ` ${skipped} left out because a side had no text.` : '';
    message = {
      ok: true,
      text: `Added “${name}”: ${count} notes in ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}${units > 1 ? ` across ${units} units` : ''}.${left}`,
    };
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    message = null;
    try {
      readingName = file.name;
      // Let the bar show before the file is read in one long step.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.ankh$/i.test(file.name)) {
        const id = await importAnkh(bytes);
        report(data.decks[id].name, Object.keys(data.decks[id].notes).length, 0, id);
      } else {
        pending = await readPackage(bytes, file.name);
      }
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : 'That file could not be read.' };
    } finally {
      busy = false;
      readingName = '';
    }
  }

  function createFromList() {
    const { rows, skipped } = parseList(listText);
    if (!rows.length) {
      message = { ok: false, text: 'No notes found. Put one per line, with a tab, “ = ”, semicolon or comma between question and answer.' };
      return;
    }
    const name = listName.trim() || 'My deck';
    const id = addFromRows(name, rows);
    report(name, rows.length, skipped, id);
    pasting = false;
    listName = '';
    listText = '';
  }
</script>

<section class="library">
  <header>
    <Logo size={44} wordmark />
    <span class="grow"></span>
    <button class="icon-btn" aria-label="Settings" onclick={() => (ui.screen = 'settings')}><Icon name="gear" /></button>
  </header>

  {#if !ui.persistent}
    <p class="note off" role="alert">This device is not letting the app save. Progress will last only until you close it.</p>
  {/if}

  {#if decks.length === 0 && data.settings.thoth === 'full'}
    <div class="thoth-row">
      <div class="portrait"><Thoth size={84} portrait cue={{ kind: 'happy', id: 0 }} /></div>
      <p class="bubble plain">{welcome}</p>
    </div>
  {/if}

  {#if paused}
    <div class="resume card">
      <p class="label">Pick up where you left off</p>
      <div class="resume-row">
        <span class="grow">
          <strong>{paused.what}</strong>
          <small>{paused.done} of {paused.total} done</small>
        </span>
        <button class="small-primary" onclick={resumePaused}><Icon name="resume" size={18} /> Resume</button>
      </div>
      <span class="meter strong" aria-hidden="true"><i style="width: {(paused.done / Math.max(1, paused.total)) * 100}%"></i></span>
      <button class="link" onclick={dropPaused}>Not now: start fresh next time</button>
    </div>
  {/if}

  {#if due.length > 1}
    <button class="all card" onclick={() => startAll()}>
      <span class="grow">
        <strong>Study all decks</strong>
        <small>{dueTotal} {dueTotal === 1 ? 'review' : 'reviews'} due · about {Math.max(1, Math.round(dueTotal / 3))} {Math.round(dueTotal / 3) <= 1 ? 'minute' : 'minutes'}</small>
        <span class="chips">{#each due as d (d.deck.id)}<span class="chip">{d.deck.name} {d.n}</span>{/each}</span>
        <small>One mixed session. Each card still counts toward its own deck.</small>
      </span>
      <Icon name="play" size={18} />
    </button>
    {#if tipDue('all-decks')}
      <div class="tip plain" role="note">
        <p class="label tip-label"><Icon name="bulb" size={16} /> New: Study all decks</p>
        <p>When several decks have reviews due, do them all in one go from here.</p>
        <button class="quiet" onclick={() => tipSeen('all-decks')}>Got it</button>
      </div>
    {/if}
  {/if}

  {#if decks.length}
    <div class="group">
      <p class="label">Your decks</p>
      <ul>
        {#each decks as d (d.deck.id)}
          <li>
            <button class="deck card" onclick={() => openDeck(d.deck.id)}>
              <span class="grow">
                <strong>{d.deck.name}</strong>
                <small>{d.sum.introduced} of {d.sum.total} learned{d.sum.due ? ` · ${d.sum.due} due` : ''}</small>
                <span class="meter" aria-hidden="true"><i style="width: {(d.sum.introduced / Math.max(1, d.sum.total)) * 100}%"></i></span>
              </span>
              <Icon name="play" size={18} />
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="group">
    {#if reminderText}<p class="reminder"><Icon name="bell" size={16} /> {reminderText}</p>{/if}
    <p class="label">Add a deck</p>
    <input bind:this={picker} type="file" accept=".apkg,.ankh" hidden onchange={onFile} />
    <div class="adds">
      <button class="quiet" disabled={busy} onclick={() => picker?.click()}>
        <Icon name="plus" size={18} /> {busy ? 'Reading…' : 'Import a deck (.apkg or .ankh)'}
      </button>
      {#if busy && readingName}<ProgressBar label={`Reading ${readingName}…`} />{/if}
      <button class="quiet" aria-expanded={pasting} onclick={() => (pasting = !pasting)}><Icon name="plus" size={18} /> Paste a list</button>
      {#if !hasSample}
        <button class="quiet" data-tour="sample" onclick={() => (openDeck(addSample()), signal('sample'))}><Icon name="plus" size={18} /> Add the sample deck</button>
      {/if}
    </div>

    {#if pending}
      <ImportMap
        pkg={pending}
        onCancel={() => (pending = null)}
        onDone={(r) => {
          const name = data.decks[r.id].name;
          pending = null;
          report(name, r.notes, r.skipped, r.id);
          if (r.suggest) {
            // Straight to Thoth's suggestions for the new deck.
            openDeck(r.id);
            ui.aiTab = 'improve';
            openPanel('ai');
          }
        }}
      />
    {/if}

    {#if pasting}
      <div class="paste plain">
        <label>
          <span class="label">Deck name</span>
          <input type="text" bind:value={listName} placeholder="My deck" />
        </label>
        <label>
          <span class="label">One note per line</span>
          <textarea bind:value={listText} rows="7" placeholder={'la casa = the house\nel perro = the dog\nel gato = the cat'}></textarea>
        </label>
        <p class="hint">Separate question and answer with a tab, “ = ”, a semicolon or a comma. A third column names the unit.</p>
        <button class="primary" disabled={!listText.trim()} onclick={createFromList}>Create deck</button>
      </div>
    {/if}

    {#if message}
      <p class="note {message.ok ? 'ok' : 'off'}" role="status">{message.text}</p>
    {/if}
  </div>
</section>

<style>
  .library {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding-block: 24px 40px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  header {
    display: flex;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .deck {
    width: 100%;
    min-height: 84px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    text-align: left;
  }
  strong {
    font-family: var(--display);
    font-weight: 400;
    font-size: 22px;
    overflow-wrap: anywhere;
  }
  small {
    font-size: 14px;
    color: var(--muted);
  }
  .meter {
    margin-top: 6px;
    height: 6px;
    background: var(--pip-off);
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--brass);
  }
  .adds {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .adds button {
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }
  .paste {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .paste label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  input[type='text'],
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--ground);
    font-size: 16px;
  }
  textarea {
    resize: vertical;
    font-family: var(--body);
  }
  .hint {
    font-size: 14px;
    color: var(--muted);
  }
  .note {
    padding: 12px 14px;
    border: 2px solid;
  }
  .note.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .note.off {
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
  }
  .resume {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--sel-bg);
    border-color: var(--brass);
  }
  .resume .label {
    margin: 0;
    color: var(--sel-text);
  }
  .resume-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }
  .resume-row .grow,
  .all .grow {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .small-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px;
    background: var(--check-bg);
    color: var(--check-text);
    border: 3px solid var(--check-line);
    font: 600 16px var(--body);
  }
  .meter.strong {
    height: 8px;
  }
  .link {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 4px 0;
    min-height: 32px;
    color: var(--muted);
    font: 400 13px var(--body);
    text-decoration: underline;
  }
  .all {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    text-align: left;
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 2px 0;
  }
  .chip {
    font-size: 13px;
    font-weight: 600;
    padding: 2px 8px;
    border: 1.5px solid var(--hair);
  }
  .tip {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-color: var(--emerald);
  }
  .tip p {
    margin: 0;
  }
  .tip-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--emerald);
  }
  .tip .quiet {
    align-self: flex-start;
  }
  .reminder {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
