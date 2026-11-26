<script lang="ts">
  import { firstLaunch, signal } from '../tour.svelte';
  import { onMount } from 'svelte';
  onMount(() => firstLaunch());
  // The library: every deck on this device, and three ways to add one.
  import { line } from '../core/thoth';
  import { dropPackage, importAnkh, readPackage, type AnkiPackage } from '../exporting';
  import ImportMap from './ImportMap.svelte';
  import { parseList } from '../import/paste';
  import {
    addBuiltDeck,
    addEmptyDeck,
    addFromRows,
    addSample,
    allDue,
    data,
    deckLoaded,
    dropPaused,
    quickCounts,
    now,
    openDeck,
    openPanel,
    pausedSummary,
    resumePaused,
    openDeckPlace,
    snap,
    ui,
  } from '../store.svelte';
  import { summarise } from './deckView';
  import { KINDS, type KindId } from '../cardTypes';
  import LangPicker from './LangPicker.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Thoth from './Thoth.svelte';
  import DeckShelves from './DeckShelves.svelte';
  import MoveDeck from './MoveDeck.svelte';
  import TopicPage from './TopicPage.svelte';
  import ArrangePanel from './ArrangePanel.svelte';
  import { groupDecks, pathKey } from '../places';
  import { plural, t } from '../i18n';

  let width = $state(window.innerWidth);
  const wide = $derived(width >= 960);
  let moving = $state<string | null>(null);
  let arranging = $state(false);

  const decks = $derived(
    Object.values(data.decks)
      .sort((a, b) => a.created - b.created)
      // Decks not opened yet are counted from their progress, without reading their notes.
      .map((deck) => ({ deck, sum: deckLoaded(deck.id) ? summarise(snap(deck), snap(data.progress[deck.id] ?? {}), now()) : quickCounts(deck.id, now()) })),
  );
  const hasSample = $derived(decks.some((d) => d.deck.name.includes('(sample)')));

  let pasting = $state(false);
  let building = $state(false);
  let buildName = $state('');
  let buildKind = $state<KindId | 'sources'>('words');
  let buildLang = $state('');
  let buildLangBack = $state('en-GB');
  function createBuilt() {
    if (buildKind === 'sources') {
      const id = addEmptyDeck(buildName || t('New deck'), { by: 'sources' });
      openDeck(id);
      openPanel('sources');
    } else {
      const id = addBuiltDeck(buildName, buildKind, buildKind === 'words' && buildLang ? { lang: buildLang, langBack: buildLangBack } : null);
      openDeck(id);
      openPanel('builder');
    }
    building = false;
    buildName = '';
  }
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
    return allDue().map((d) => ({ deck: data.decks[d.deckId], n: d.n }));
  });
  const dueTotal = $derived(due.reduce((t, d) => t + d.n, 0));
  const reminderText = $derived.by(() => {
    const r = data.reminder;
    if (!r.on) return '';
    const days = r.days.length === 7 ? '' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? ' on weekdays' : t(' on chosen days');
    return t('Daily reminder at {time}{days}, on days you haven’t studied', { time: r.time, days });
  });

  function report(name: string, count: number, skipped: number, id: string) {
    const units = data.decks[id].units.length;
    const lessons = Object.keys(data.decks[id].lessons).length;
    const left = skipped ? t(' {skipped} left out because a side had no text.', { skipped }) : '';
    message = {
      ok: true,
      text: plural('Added “{name}”: {count} notes in {n} lesson{x2}.{left}', 'Added “{name}”: {count} notes in {n} lessons{x2}.{left}', lessons, { name, count, x2: units > 1 ? ` across ${units} units` : '', left }),
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
      message = { ok: false, text: err instanceof Error ? t(err.message) : t('That file could not be read.') };
    } finally {
      busy = false;
      readingName = '';
    }
  }

  function createFromList() {
    const { rows, skipped } = parseList(listText);
    if (!rows.length) {
      message = { ok: false, text: t('No notes found. Put one per line, with a tab, “ = ”, semicolon or comma between question and answer.') };
      return;
    }
    const name = listName.trim() || t('My deck');
    const id = addFromRows(name, rows);
    report(name, rows.length, skipped, id);
    pasting = false;
    listName = '';
    listText = '';
  }
</script>

<svelte:window bind:innerWidth={width} />

{#snippet tree()}
  {@const groups = groupDecks(decks)}
  <nav class="tree" aria-label={t('Subjects')}>
    <button class="node top" aria-current={!ui.topic && !arranging ? 'page' : undefined} onclick={() => ((ui.topic = null), (arranging = false))}>
      <span class="grow">{t('All decks')}</span>{#if dueTotal}<b>{dueTotal}</b>{/if}
    </button>
    {#each groups as g (g.name)}
      {#if g.name}
        <button class="node top" aria-current={ui.topic === g.name ? 'page' : undefined} onclick={() => ((ui.topic = pathKey(g.name)), (arranging = false))}>
          <span class="grow">{g.name}</span>{#if g.due}<b>{g.due}</b>{/if}
        </button>
        {#each g.topics.filter((x) => x.name) as tp (tp.name)}
          <button class="node sub" aria-current={ui.topic === pathKey(g.name, tp.name) ? 'page' : undefined} onclick={() => ((ui.topic = pathKey(g.name, tp.name)), (arranging = false))}>
            <span class="grow">{tp.name}</span>{#if tp.due}<b>{tp.due}</b>{/if}
          </button>
        {/each}
      {/if}
    {/each}
    <button class="node arrange" onclick={() => (arranging = true)}><Icon name="edit" size={16} /> {t('Arrange')}</button>
  </nav>
{/snippet}

<div class="lib-wrap" class:wide={wide && decks.length > 0}>
{#if wide && decks.length}{@render tree()}{/if}
<section class="library">
  <header>
    <Logo size={44} wordmark />
    <span class="grow"></span>
    <button class="icon-btn" aria-label={t('Settings')} onclick={() => (ui.screen = 'settings')}><Icon name="gear" /></button>
  </header>

  {#if arranging}
    <ArrangePanel onMove={(id) => (moving = id)} onClose={() => (arranging = false)} />
  {:else if ui.topic}
    <TopicPage rows={decks} onMove={(id) => openDeckPlace(id)} />
  {:else}

  {#if !ui.persistent}
    <p class="note off" role="alert">{t('This device is not letting the app save. Progress will last only until you close it.')}</p>
  {/if}

  {#if decks.length === 0 && data.settings.thoth === 'full'}
    <div class="thoth-row">
      <div class="portrait"><Thoth size={84} portrait cue={{ kind: 'happy', id: 0 }} /></div>
      <p class="bubble plain">{welcome}</p>
    </div>
  {/if}

  {#if paused}
    <div class="resume card">
      <p class="label">{t('Pick up where you left off')}</p>
      <div class="resume-row">
        <span class="grow">
          <strong>{paused.what}</strong>
          <small>{t('{done} of {total} done', { done: paused.done, total: paused.total })}</small>
        </span>
        <button class="small-primary" onclick={resumePaused}><Icon name="resume" size={18} /> {t('Resume')}</button>
      </div>
      <span class="meter strong" aria-hidden="true"><i style="width: {(paused.done / Math.max(1, paused.total)) * 100}%"></i></span>
      <button class="link" onclick={dropPaused}>{t('Not now: start fresh next time')}</button>
    </div>
  {/if}

  {#if decks.length}
    <div class="group">
      <div class="group-head">
        <p class="label">{t('Your decks')}</p>
        {#if !wide}<button class="link-btn" onclick={() => (arranging = true)}><Icon name="edit" size={16} /> {t('Arrange')}</button>{/if}
      </div>
      <DeckShelves rows={decks} onMove={(id) => openDeckPlace(id)} />
    </div>
  {/if}

  <div class="group">
    {#if reminderText}<p class="reminder"><Icon name="bell" size={16} /> {reminderText}</p>{/if}
    <p class="label">{t('Add a deck')}</p>
    <input bind:this={picker} type="file" accept=".apkg,.ankh" hidden onchange={onFile} />
    <div class="adds">
      <button class="quiet" disabled={busy} onclick={() => picker?.click()}>
        <Icon name="plus" size={18} /> {busy ? t('Reading…') : t('Import a deck (.apkg or .ankh)')}
      </button>
      {#if busy && readingName}<ProgressBar label={`Reading ${readingName}…`} />{/if}
      <button class="quiet" aria-expanded={building} onclick={() => (building = !building)}><Icon name="plus" size={18} /> {t('Build a deck')}</button>
      <button class="quiet" aria-expanded={pasting} onclick={() => (pasting = !pasting)}><Icon name="plus" size={18} /> {t('Paste a list')}</button>
      {#if !hasSample}
        <button class="quiet" data-tour="sample" onclick={() => (openDeck(addSample()), signal('sample'))}><Icon name="plus" size={18} /> {t('Add the sample deck')}</button>
      {/if}
    </div>

    {#if pending}
      <ImportMap
        pkg={pending}
        onCancel={() => {
          if (pending) dropPackage(pending);
          pending = null;
        }}
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

    {#if building}
      <div class="paste plain build">
        <label>
          <span class="label">{t('Deck name')}</span>
          <input type="text" bind:value={buildName} placeholder={t('My deck')} />
        </label>
        <span class="label">{t('What are you learning?')}</span>
        <div class="kinds">
          {#each KINDS as k (k.id)}
            <button class="kind" aria-pressed={buildKind === k.id} onclick={() => (buildKind = k.id)}><strong>{t(k.name)}</strong><small>{t(k.blurb)}</small></button>
          {/each}
          <button class="kind" aria-pressed={buildKind === 'sources'} onclick={() => (buildKind = 'sources')}><strong>{t('From files or pages')}</strong><small>{t('Thoth plans lessons and writes cards from your PDFs, documents and web pages')}</small></button>
        </div>
        {#if buildKind === 'words'}
          <div class="langs2">
            <div><span class="label">{t('Words in')}</span><LangPicker label={t('Language of the words')} value={buildLang} emptyLabel={t('Not a language deck')} onPick={(c) => (buildLang = c)} /></div>
            <div><span class="label">{t('Meanings in')}</span><LangPicker label={t('Language of the meanings')} value={buildLangBack} emptyLabel={t('Same')} onPick={(c) => (buildLangBack = c)} /></div>
          </div>
        {/if}
        <button class="primary" onclick={createBuilt}>{t('Create deck')}</button>
      </div>
    {/if}

    {#if pasting}
      <div class="paste plain">
        <label>
          <span class="label">{t('Deck name')}</span>
          <input type="text" bind:value={listName} placeholder={t('My deck')} />
        </label>
        <label>
          <span class="label">{t('One note per line')}</span>
          <textarea bind:value={listText} rows="7" placeholder={'la casa = the house\nel perro = the dog\nel gato = the cat'}></textarea>
        </label>
        <p class="hint">{t('Separate question and answer with a tab, “ = ”, a semicolon or a comma. A third column names the unit.')}</p>
        <button class="primary" disabled={!listText.trim()} onclick={createFromList}>{t('Create deck')}</button>
      </div>
    {/if}

    {#if message}
      <p class="note {message.ok ? 'ok' : 'off'}" role="status">{message.text}</p>
    {/if}
  </div>
  {/if}
</section>
</div>
{#if moving}<MoveDeck deckId={moving} onClose={() => (moving = null)} />{/if}

<style>
  .lib-wrap {
    flex: 1;
    width: 100%;
    display: flex;
  }
  .lib-wrap.wide {
    max-width: 1120px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .lib-wrap.wide .library {
    max-width: 760px;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 24px 12px;
    border-right: 2px solid var(--line);
    background: var(--surface);
    position: sticky;
    top: 0;
    align-self: start;
    min-height: 100dvh;
    max-height: 100dvh;
    overflow-y: auto;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 10px;
    border: 0;
    border-left: 4px solid transparent;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .node.top {
    font-weight: 700;
  }
  .node.sub {
    padding-left: 30px;
    font-size: 15px;
  }
  .node[aria-current='page'] {
    background: var(--bg);
    border-left-color: var(--emerald);
  }
  .node b {
    font-size: 13px;
    color: var(--brass);
  }
  .node.arrange {
    margin-top: 12px;
    border: 2px dashed var(--line);
    justify-content: center;
    font-weight: 700;
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .group-head .label {
    margin: 0;
  }
  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    background: none;
    border: 0;
    color: var(--emerald);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
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
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
  }
  .kind {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 56px;
    padding: 8px 12px;
    text-align: left;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .kind small {
    color: var(--muted);
    font-size: 13px;
  }
  .kind[aria-pressed='true'] {
    background: var(--sel-bg);
    border: 3px solid var(--sel-text);
  }
  .langs2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }
  .langs2 > div {
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
  .resume-row .grow {
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
  .reminder {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
