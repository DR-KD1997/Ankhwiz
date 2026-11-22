<script lang="ts">
  // The library's decks, shown by subject (subjects fold open into topics and
  // their decks), as lists (one subject at a time, chosen with tabs), or as
  // one list of every deck, most due first. Each deck can be moved.
  import { plural, t } from '../i18n';
  import { groupDecks, pathKey, type DeckRow } from '../places';
  import { data, openDeck, save, ui } from '../store.svelte';
  import Icon from './Icon.svelte';

  type Sum = { introduced: number; total: number; due: number };
  let { rows, onMove, only = '' }: { rows: DeckRow<Sum>[]; onMove: (id: string) => void; only?: string } = $props();

  const view = $derived(data.settings.libraryView ?? 'subjects');
  const groups = $derived(groupDecks(rows));
  const sorted = $derived(groups.some((g) => g.name));
  const folded = $derived(new Set(data.settings.folded ?? []));
  let tab = $state('');
  const tabGroup = $derived(groups.find((g) => g.name === tab) ?? groups[0]);

  function setView(v: 'subjects' | 'lists' | 'all') {
    data.settings.libraryView = v;
    save();
  }
  function fold(name: string) {
    const next = new Set(folded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    data.settings.folded = [...next];
    save();
  }
  const SUBJECTLESS = $derived(t('Not sorted yet'));
  const allRows = $derived([...rows].sort((a, b) => b.sum.due - a.sum.due || a.deck.created - b.deck.created));
  const where = (r: DeckRow<Sum>) => (r.deck.place?.subject ? [r.deck.place.subject, r.deck.place.topic].filter(Boolean).join(' › ') : SUBJECTLESS);
</script>

{#snippet deckRow(r: DeckRow<Sum>, showWhere: boolean)}
  <li class="deck-li">
    <button class="deck card" onclick={() => openDeck(r.deck.id)}>
      <span class="grow">
        {#if showWhere}<span class="where">{where(r)}</span>{/if}
        <strong>{r.deck.name}</strong>
        <small>{t('{n} of {total} learned', { n: r.sum.introduced, total: r.sum.total })}{r.sum.due ? ` · ${plural('{n} due', '{n} due', r.sum.due)}` : ''}</small>
        <span class="meter" aria-hidden="true"><i style="width: {(r.sum.introduced / Math.max(1, r.sum.total)) * 100}%"></i></span>
      </span>
      <Icon name="play" size={18} />
    </button>
    <button class="icon-btn move" aria-label={t('Move “{name}”', { name: r.deck.name })} onclick={() => onMove(r.deck.id)}><Icon name="more" /></button>
  </li>
{/snippet}

{#if !only && sorted}
  <div class="seg" role="group" aria-label={t('How decks are shown')}>
    <button aria-pressed={view === 'subjects'} onclick={() => setView('subjects')}>{t('By subject')}</button>
    <button aria-pressed={view === 'lists'} onclick={() => setView('lists')}>{t('Lists')}</button>
    <button aria-pressed={view === 'all'} onclick={() => setView('all')}>{t('All decks')}</button>
  </div>
{/if}

{#if only || !sorted}
  <ul>
    {#each rows as r (r.deck.id)}{@render deckRow(r, !!only && only.indexOf('/') < 0)}{/each}
  </ul>
{:else if view === 'subjects'}
  <div class="subjects">
    {#each groups as g (g.name)}
      {@const open = !folded.has(g.name)}
      <div class="subject plain">
        <button class="head" aria-expanded={open} onclick={() => fold(g.name)}>
          <span class="chev" class:open aria-hidden="true"><Icon name="play" size={14} /></span>
          <span class="grow">
            <strong>{g.name || SUBJECTLESS}</strong>
            <small>
              {[g.topics.filter((x) => x.name).length ? plural('{n} topic', '{n} topics', g.topics.filter((x) => x.name).length) : '', plural('{n} deck', '{n} decks', g.decks.length)].filter(Boolean).join(' · ')}
            </small>
          </span>
          {#if g.due}<span class="due">{g.due}</span>{/if}
        </button>
        {#if open}
          <div class="inside">
            {#if g.name && (g.topics.filter((x) => x.name).length !== 1 || g.topics.some((x) => !x.name))}
              <button class="topic" onclick={() => (ui.topic = pathKey(g.name))}>
                <span class="grow">{g.topics.some((x) => x.name) ? t('Everything in {subject}', { subject: g.name }) : g.name}</span>
                <span class="open">{t('Open')} ›</span>
              </button>
            {/if}
            {#each g.topics as tp (tp.name)}
              {#if g.name && tp.name}
                <button class="topic" onclick={() => (ui.topic = pathKey(g.name, tp.name))}>
                  <span class="grow">{tp.name}</span>
                  <span class="open">{t('Open')} ›</span>
                </button>
              {/if}
              <ul>
                {#each tp.decks as r (r.deck.id)}{@render deckRow(r, false)}{/each}
              </ul>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else if view === 'lists'}
  <div class="tabs" role="tablist">
    {#each groups as g (g.name)}
      <button role="tab" aria-selected={tabGroup?.name === g.name} onclick={() => (tab = g.name)}>{g.name || t('Not sorted')}{g.due ? ` · ${g.due}` : ''}</button>
    {/each}
  </div>
  {#if tabGroup}
    {#if tabGroup.name}<button class="topic" onclick={() => (ui.topic = pathKey(tabGroup.name))}><span class="grow">{tabGroup.name}</span><span class="open">{t('Open')} ›</span></button>{/if}
    <ul>
      {#each tabGroup.decks as r (r.deck.id)}{@render deckRow(r, true)}{/each}
    </ul>
  {/if}
{:else}
  <p class="hint">{t('Most due first. The path under each name shows where it lives.')}</p>
  <ul>
    {#each allRows as r (r.deck.id)}{@render deckRow(r, true)}{/each}
  </ul>
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
  .deck-li {
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
  .move {
    align-self: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    min-height: 56px;
    padding: 6px 12px;
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
  .due {
    min-width: 30px;
    padding: 2px 8px;
    background: var(--brass);
    color: var(--ground, #1f1a14);
    font-weight: 700;
    text-align: center;
  }
  .inside {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 10px 10px;
  }
  .topic {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding: 4px;
    border: 0;
    border-top: 1px solid var(--hair);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
  }
  .open {
    color: var(--emerald);
    text-transform: none;
    letter-spacing: 0;
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tabs button {
    min-height: 40px;
    padding: 0 14px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .tabs button[aria-selected='true'] {
    background: var(--emerald);
    color: var(--surface);
  }
</style>
