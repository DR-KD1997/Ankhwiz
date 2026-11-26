<script lang="ts">
  // The library's decks in three views:
  // - By subject: one tile per subject; a subject opens its own page (topic
  //   tiles), and a topic its decks, so no screen grows long.
  // - Lists: subjects and topics fold; a folded topic still says what is due.
  // - All decks: search, filters and pinned decks over shelves (each subject
  //   with its topics as chips, one opened at a time). Typing or a filter
  //   turns the shelves into rows of matching decks.
  // By subject and Lists have the Due / Recent strip with Study All on top.
  import { plural, t, number } from '../i18n';
  import { groupDecks, pathKey, UNSORTED, type DeckRow } from '../places';
  import { data, openDeck, save, setDeckPlace, ui } from '../store.svelte';
  import DueStrip from './DueStrip.svelte';
  import Icon from './Icon.svelte';

  type Sum = { introduced: number; total: number; due: number };
  let { rows, onMove }: { rows: DeckRow<Sum>[]; onMove: (id: string) => void } = $props();

  const view = $derived(data.settings.libraryView ?? 'subjects');
  const groups = $derived(groupDecks(rows));
  const sorted = $derived(groups.some((g) => g.name));
  const SUBJECTLESS = $derived(t('Not sorted yet'));

  function setView(v: 'subjects' | 'lists' | 'all') {
    data.settings.libraryView = v;
    save({});
  }

  // ---- Lists: what is folded ----
  const folded = $derived(new Set(data.settings.folded ?? []));
  const openTopics = $derived(new Set(data.settings.openTopics ?? []));
  function foldSubject(name: string) {
    const next = new Set(folded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    data.settings.folded = [...next];
    save({});
  }
  function foldTopic(key: string) {
    const next = new Set(openTopics);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    data.settings.openTopics = [...next];
    save({});
  }
  function openDue() {
    data.settings.folded = groups.filter((g) => !g.due).map((g) => g.name);
    data.settings.openTopics = groups.flatMap((g) => g.topics.filter((tp) => tp.due).map((tp) => pathKey(g.name, tp.name)));
    save({});
  }
  function foldAll() {
    data.settings.folded = groups.map((g) => g.name);
    data.settings.openTopics = [];
    save({});
  }

  // ---- All decks: search, filters, pins, shelves ----
  let query = $state('');
  type Filter = 'all' | 'due' | 'progress' | 'new' | 'done';
  let filter = $state<Filter>('all');
  const FILTERS: [Filter, string][] = [
    ['all', t('All')],
    ['due', t('Due')],
    ['progress', t('In progress')],
    ['new', t('Not started')],
    ['done', t('Finished')],
  ];
  const pinned = $derived(new Set(data.settings.pinned ?? []));
  function pin(id: string) {
    const next = new Set(pinned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    data.settings.pinned = [...next];
    save({});
  }
  const where = (r: DeckRow<Sum>) => (r.deck.place?.subject ? [r.deck.place.subject, r.deck.place.topic].filter(Boolean).join(' › ') : SUBJECTLESS);
  const stageOf = (r: DeckRow<Sum>): Filter => (r.sum.introduced === 0 ? 'new' : r.sum.introduced >= r.sum.total ? 'done' : 'progress');
  const searching = $derived(!!query.trim() || filter !== 'all');
  const matches = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    return rows
      .filter((r) => (filter === 'all' ? true : filter === 'due' ? r.sum.due > 0 : stageOf(r) === filter))
      .filter((r) => !q || `${r.deck.name} ${where(r)}`.toLocaleLowerCase().includes(q))
      .sort((a, b) => b.sum.due - a.sum.due || a.deck.name.localeCompare(b.deck.name));
  });
  const pins = $derived(rows.filter((r) => pinned.has(r.deck.id)));
  // Topics opened on the shelves; several can be open at once, in the order the subject lists them.
  let shelfTopics = $state<Set<string>>(new Set());
  function toggleShelf(key: string) {
    const next = new Set(shelfTopics);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    shelfTopics = next;
  }

  // ---- Lists: hold a deck, then drag it onto a subject or a topic to move it ----
  const SEP = '\u0001';
  let drag = $state<{ id: string; name: string; x: number; y: number } | null>(null);
  let over = $state<string | null>(null);
  let holdTimer = 0;
  let start = { x: 0, y: 0 };
  let dragged = false;
  function down(e: PointerEvent, r: DeckRow<Sum>) {
    if (e.button > 0) return;
    start = { x: e.clientX, y: e.clientY };
    dragged = false;
    clearTimeout(holdTimer);
    const el = e.currentTarget as HTMLElement;
    const pointer = e.pointerId;
    holdTimer = window.setTimeout(() => {
      drag = { id: r.deck.id, name: r.deck.name, x: start.x, y: start.y };
      dragged = true;
      try {
        el.setPointerCapture(pointer);
      } catch {
        /* the pointer has gone */
      }
      navigator.vibrate?.(15);
    }, 400);
  }
  function moveDrag(e: PointerEvent) {
    if (!drag) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) clearTimeout(holdTimer);
      return;
    }
    drag = { ...drag, x: e.clientX, y: e.clientY };
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop]');
    over = target?.dataset.drop ?? null;
    // Near the top or bottom edge, the list scrolls along.
    const edge = 70;
    if (e.clientY < edge) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
  }
  function upDrag() {
    clearTimeout(holdTimer);
    if (drag && over !== null) {
      const [subject, topic] = over.split(SEP);
      const d = data.decks[drag.id];
      if (d && ((d.place?.subject ?? '') !== subject || (d.place?.topic ?? '') !== topic)) setDeckPlace(drag.id, subject, topic);
    }
    drag = null;
    over = null;
  }
  function clickDeck(id: string) {
    if (dragged) {
      dragged = false;
      return;
    }
    openDeck(id);
  }
  // While dragging, a finger moving does not scroll the page.
  $effect(() => {
    if (!drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  });
  const status = (r: DeckRow<Sum>) => (r.sum.due ? plural('{n} due', '{n} due', r.sum.due) : stageOf(r) === 'new' ? t('Not started') : stageOf(r) === 'done' ? t('Learned') : t('Up to date'));

  // ---- By subject: tiles ----
  const pct = (list: DeckRow<Sum>[]) => {
    const total = list.reduce((n, r) => n + r.sum.total, 0);
    return total ? Math.round((list.reduce((n, r) => n + r.sum.introduced, 0) / total) * 100) : 0;
  };
  function openSubject(g: (typeof groups)[number]) {
    const named = g.topics.filter((x) => x.name);
    // A subject with one topic and nothing else opens straight on that topic.
    ui.topic = g.name ? (named.length === 1 && g.topics.length === 1 ? pathKey(g.name, named[0].name) : pathKey(g.name)) : UNSORTED;
  }
</script>

{#snippet deckRow(r: DeckRow<Sum>, showWhere: boolean)}
  <li class="deck-li">
    <button class="deck card" onclick={() => openDeck(r.deck.id)}>
      <span class="grow">
        {#if showWhere}<span class="where">{where(r)}</span>{/if}
        <strong>{r.deck.name}</strong>
        <small>{t('{n} of {total} learned', { n: number(r.sum.introduced), total: number(r.sum.total) })}{r.sum.due ? ` · ${plural('{n} due', '{n} due', r.sum.due)}` : ''}</small>
        <span class="meter" aria-hidden="true"><i style="width: {(r.sum.introduced / Math.max(1, r.sum.total)) * 100}%"></i></span>
      </span>
      <Icon name="play" size={18} />
    </button>
    <button class="icon-btn move" aria-label={t('Deck options for “{name}”', { name: r.deck.name })} onclick={() => onMove(r.deck.id)}><Icon name="more" /></button>
  </li>
{/snippet}

{#snippet slimRow(r: DeckRow<Sum>, withPin: boolean, showWhere: boolean, movable = false)}
  <li class="slim-li" class:lifted={drag?.id === r.deck.id}>
    {#if movable}
      <button
        class="slim movable"
        onclick={() => clickDeck(r.deck.id)}
        onpointerdown={(e) => down(e, r)}
        onpointermove={moveDrag}
        onpointerup={upDrag}
        onpointercancel={upDrag}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <span class="grow">
          <span class="name">{r.deck.name}</span>
        </span>
        <span class="status" class:has-due={r.sum.due > 0}>{status(r)}</span>
      </button>
    {:else}
    <button class="slim" onclick={() => openDeck(r.deck.id)}>
      <span class="grow">
        <span class="name">{r.deck.name}</span>
        {#if showWhere}<span class="path">{where(r)}</span>{/if}
      </span>
      <span class="status" class:has-due={r.sum.due > 0}>{status(r)}</span>
    </button>
    {/if}
    {#if withPin}
      <button class="icon-btn pin" aria-pressed={pinned.has(r.deck.id)} aria-label={pinned.has(r.deck.id) ? t('Unpin “{name}”', { name: r.deck.name }) : t('Pin “{name}”', { name: r.deck.name })} onclick={() => pin(r.deck.id)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill={pinned.has(r.deck.id) ? 'var(--brass)' : 'none'} stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"></path></svg>
      </button>
    {:else}
      <button class="icon-btn move" aria-label={t('Deck options for “{name}”', { name: r.deck.name })} onclick={() => onMove(r.deck.id)}><Icon name="more" size={18} /></button>
    {/if}
  </li>
{/snippet}

{#if sorted}
  <div class="seg" role="group" aria-label={t('How decks are shown')}>
    <button aria-pressed={view === 'subjects'} onclick={() => setView('subjects')}>{t('By subject')}</button>
    <button aria-pressed={view === 'lists'} onclick={() => setView('lists')}>{t('Lists')}</button>
    <button aria-pressed={view === 'all'} onclick={() => setView('all')}>{t('All decks')}</button>
  </div>
{/if}

{#if view !== 'all' || !sorted}
  <DueStrip {rows} />
{/if}

{#if !sorted}
  <ul>
    {#each rows as r (r.deck.id)}{@render deckRow(r, false)}{/each}
  </ul>
{:else if view === 'subjects'}
  <div class="tiles">
    {#each groups as g (g.name)}
      {@const named = g.topics.filter((x) => x.name).length}
      <button class="tile card" onclick={() => openSubject(g)}>
        <span class="tile-top">
          <strong>{g.name || SUBJECTLESS}</strong>
          {#if g.due}<span class="due">{g.due}</span>{/if}
        </span>
        <small>{[named ? plural('{n} topic', '{n} topics', named) : '', plural('{n} deck', '{n} decks', g.decks.length)].filter(Boolean).join(' · ')}</small>
        <span class="meter wide" aria-hidden="true"><i style="width: {pct(g.decks)}%"></i></span>
        <small>{t('{n}% learned', { n: pct(g.decks) })}</small>
      </button>
    {/each}
  </div>
{:else if view === 'lists'}
  <div class="fold-tools">
    <button class="quiet" onclick={openDue}>{t('Open what’s due')}</button>
    <button class="quiet" onclick={foldAll}>{t('Fold all')}</button>
  </div>
  <div class="subjects">
    {#each groups as g (g.name)}
      {@const open = !folded.has(g.name)}
      <div class="subject plain">
        <button class="head" class:over={over === g.name + SEP} data-drop={g.name + SEP} aria-expanded={open} onclick={() => foldSubject(g.name)}>
          <span class="chev" class:open aria-hidden="true"><Icon name="play" size={14} /></span>
          <span class="grow line">
            <strong>{g.name || SUBJECTLESS}</strong>
            <small>{[g.topics.filter((x) => x.name).length ? plural('{n} topic', '{n} topics', g.topics.filter((x) => x.name).length) : '', plural('{n} deck', '{n} decks', g.decks.length)].filter(Boolean).join(' · ')}</small>
          </span>
          {#if g.due}<span class="due">{g.due}</span>{/if}
        </button>
        {#if open}
          <div class="inside">
            {#each g.topics as tp (tp.name)}
              {#if tp.name}
                {@const key = pathKey(g.name, tp.name)}
                {@const topen = openTopics.has(key)}
                <div class="topic-block">
                  <button class="topic-head" class:over={over === g.name + SEP + tp.name} data-drop={g.name + SEP + tp.name} aria-expanded={topen} onclick={() => foldTopic(key)}>
                    <span class="chev small" class:open={topen} aria-hidden="true"><Icon name="play" size={11} /></span>
                    <span class="grow tname">{tp.name}</span>
                    <small>{plural('{n} deck', '{n} decks', tp.decks.length)}</small>
                    {#if tp.due}<span class="tdue">{tp.due}</span>{/if}
                  </button>
                  {#if topen}
                    <ul class="slims">
                      {#each tp.decks as r (r.deck.id)}{@render slimRow(r, false, false, true)}{/each}
                    </ul>
                  {/if}
                </div>
              {:else}
                <ul class="slims loose">
                  {#each tp.decks as r (r.deck.id)}{@render slimRow(r, false, false, true)}{/each}
                </ul>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div class="finder">
    <label class="search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>
      <span class="sr">{t('Find a deck')}</span>
      <input type="search" bind:value={query} placeholder={t('Find a deck, topic or subject')} />
    </label>
    <div class="filters" role="group" aria-label={t('Show')}>
      {#each FILTERS as [id, name] (id)}
        <button aria-pressed={filter === id} onclick={() => (filter = id)}>{name}</button>
      {/each}
    </div>
  </div>
  {#if searching}
    <p class="count">{query.trim() ? t('Matches') : FILTERS.find((f) => f[0] === filter)?.[1]} · {matches.length}</p>
    {#if matches.length}
      <ul class="slims">
        {#each matches as r (r.deck.id)}{@render slimRow(r, true, true)}{/each}
      </ul>
    {:else}
      <p class="hint">{t('Nothing matches. Try part of a name.')}</p>
    {/if}
  {:else}
    {#if pins.length}
      <p class="count">{t('Pinned')}</p>
      <div class="pins">
        {#each pins as r (r.deck.id)}
          <button class="pin-tile" onclick={() => openDeck(r.deck.id)}>
            <strong>{r.deck.name}</strong>
            <span class="status" class:has-due={r.sum.due > 0}>{status(r)}</span>
          </button>
        {/each}
      </div>
    {/if}
    <p class="count">{t('Shelves')}</p>
    <div class="shelves">
      {#each groups as g (g.name)}
        {@const opened = g.topics.filter((tp) => tp.name && shelfTopics.has(pathKey(g.name, tp.name)))}
        <div class="shelf plain">
          <div class="shelf-head">
            <strong>{g.name || SUBJECTLESS}</strong>
            <small>{plural('{n} deck', '{n} decks', g.decks.length)}</small>
          </div>
          {#if g.topics.some((tp) => tp.name)}
            <div class="chips">
              {#each g.topics.filter((tp) => tp.name) as tp (tp.name)}
                {@const key = pathKey(g.name, tp.name)}
                <button class="chip" aria-expanded={shelfTopics.has(key)} onclick={() => toggleShelf(key)}>
                  {tp.name}{#if tp.due}<span class="chip-due">{tp.due}</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
          {#each opened as tp (tp.name)}
            <div class="shelf-topic">
              <span class="shelf-topic-name">{tp.name}</span>
              <ul class="slims">
                {#each tp.decks as r (r.deck.id)}{@render slimRow(r, true, false)}{/each}
              </ul>
            </div>
          {/each}
          {#each g.topics.filter((tp) => !tp.name) as tp (tp.name)}
            <ul class="slims">
              {#each tp.decks as r (r.deck.id)}{@render slimRow(r, true, false)}{/each}
            </ul>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if drag}
  <div class="ghost" style="left: {drag.x}px; top: {drag.y}px" aria-hidden="true">{drag.name}</div>
  <p class="sr" role="status">{over !== null ? t('Drop to move “{name}” here', { name: drag.name }) : t('Drag “{name}” onto a subject or topic', { name: drag.name })}</p>
{/if}

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .deck-li,
  .slim-li {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .deck {
    flex: 1;
    min-width: 0;
    min-height: 80px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    text-align: left;
  }
  .move,
  .pin {
    align-self: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .grow.line {
    flex-direction: row;
    align-items: baseline;
    flex-wrap: wrap;
    column-gap: 8px;
  }
  strong {
    font-family: var(--display);
    font-weight: 400;
    font-size: 21px;
    overflow-wrap: anywhere;
  }
  small,
  .hint {
    font-size: 14px;
    color: var(--muted);
    margin: 0;
  }
  .where {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .meter {
    margin-top: 6px;
    height: 6px;
    background: var(--pip-off);
  }
  .meter.wide {
    width: 100%;
    margin-top: auto;
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--brass);
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
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button[aria-pressed='true'] {
    background: var(--text);
    color: var(--surface);
  }
  .due {
    min-width: 30px;
    padding: 2px 8px;
    background: var(--badge-bg);
    color: var(--text);
    font-weight: 700;
    text-align: center;
  }
  /* By subject */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .tile {
    min-height: 132px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    text-align: left;
  }
  .tile-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 6px;
  }
  .tile strong {
    line-height: 1.15;
  }
  /* Lists */
  .fold-tools {
    display: flex;
    gap: 8px;
  }
  .fold-tools button {
    flex: 1;
    min-height: 40px;
  }
  .subjects {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .subject {
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 4px 12px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .chev {
    display: flex;
    transition: transform 0.15s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .inside {
    display: flex;
    flex-direction: column;
    padding: 0 8px 8px;
  }
  .topic-block {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--hair);
  }
  .topic-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 4px 0 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .tname {
    font-weight: 700;
    font-size: 16px;
  }
  .tdue {
    min-width: 24px;
    font-weight: 700;
    color: var(--close-line);
    text-align: right;
  }
  .slims {
    gap: 4px;
    padding: 0 0 8px 26px;
  }
  .slims.loose {
    padding: 8px 0;
    border-top: 1px solid var(--hair);
  }
  .slim {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border: 2px solid var(--line);
    background: var(--ground);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .name {
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .path {
    font-size: 12px;
    color: var(--muted);
  }
  .status {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
  }
  .status.has-due {
    color: var(--close-line);
  }
  /* All decks */
  .finder {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 12px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  .search input:focus {
    outline: none;
  }
  .search:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .filters {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .filters button {
    flex: none;
    min-height: 38px;
    padding: 0 12px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .filters button[aria-pressed='true'] {
    background: var(--emerald);
    color: var(--surface);
  }
  .count {
    margin: 4px 0 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .slims:not(.loose) {
    padding-left: 0;
  }
  .inside .slims:not(.loose) {
    padding-left: 26px;
  }
  .pins {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }
  .pin-tile {
    min-height: 76px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border: 2px solid var(--line);
    background: var(--sel-bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pin-tile strong {
    font-size: 16px;
    line-height: 1.2;
  }
  .shelves {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .shelf {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
  }
  .shelf-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .shelf-head strong {
    font-size: 19px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .chip[aria-expanded='true'] {
    background: var(--emerald);
    color: var(--surface);
  }
  .chip-due {
    padding: 0 5px;
    background: var(--badge-bg);
    color: var(--text);
    font-size: 13px;
  }
  .movable {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .lifted {
    opacity: 0.4;
  }
  .head.over,
  .topic-head.over {
    outline: 3px dashed var(--brass);
    outline-offset: -3px;
    background: var(--sel-bg);
  }
  .ghost {
    position: fixed;
    z-index: 60;
    transform: translate(-50%, -120%);
    padding: 8px 14px;
    border: 2px solid var(--line);
    background: var(--sel-bg);
    color: var(--text);
    font-weight: 700;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    pointer-events: none;
    white-space: nowrap;
  }
  .shelf-topic {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 2px solid var(--hair);
  }
  .shelf-topic-name {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
