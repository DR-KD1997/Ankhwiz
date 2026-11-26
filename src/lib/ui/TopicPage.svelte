<script lang="ts">
  // A subject's or topic's own page: study everything due in its decks in one
  // mixed session (each card keeps its own deck's schedule), or one deck at a
  // time, with progress for the whole topic.
  import { line } from '../core/thoth';
  import { number, plural, t } from '../i18n';
  import { decksUnder, groupDecks, pathKey, UNSORTED, type DeckRow } from '../places';
  import { data, openDeck, startAll, ui } from '../store.svelte';
  import Icon from './Icon.svelte';
  import Thoth from './Thoth.svelte';

  type Sum = { introduced: number; total: number; due: number };
  let { rows, onMove }: { rows: DeckRow<Sum>[]; onMove: (id: string) => void } = $props();

  const key = $derived(ui.topic ?? '');
  const [subject, topic] = $derived(key.split('/'));
  const mine = $derived(decksUnder(rows, key));
  const due = $derived(mine.reduce((n, r) => n + r.sum.due, 0));
  const learned = $derived(mine.reduce((n, r) => n + r.sum.introduced, 0));
  const total = $derived(mine.reduce((n, r) => n + r.sum.total, 0));
  const withDue = $derived(mine.filter((r) => r.sum.due > 0));
  let mix = $state(true);
  const first = $derived(withDue[0]);
  const unsorted = $derived(key === UNSORTED);
  const title = $derived(unsorted ? t('Not sorted yet') : topic || subject);
  // A subject's page shows its topics as tiles (one step further in); decks with no topic are listed under them.
  const topicTiles = $derived(!topic && !unsorted ? (groupDecks(mine)[0]?.topics ?? []).filter((x) => x.name) : []);
  const loose = $derived(topicTiles.length ? mine.filter((r) => !r.deck.place?.topic) : mine);
  const pctOf = (list: DeckRow<Sum>[]) => {
    const all = list.reduce((n, r) => n + r.sum.total, 0);
    return all ? Math.round((list.reduce((n, r) => n + r.sum.introduced, 0) / all) * 100) : 0;
  };

  async function study() {
    if (mix) await startAll(withDue.map((r) => r.deck.id), title);
    else if (first) openDeck(first.deck.id);
  }
</script>

<section class="topic-page">
  <header>
    <button class="icon-btn" aria-label={t('Back to the library')} onclick={() => (ui.topic = null)}><Icon name="back" /></button>
    <nav aria-label={t('Where this is')}>
      {#if topic}<button class="crumb" onclick={() => (ui.topic = subject)}>{subject} ›</button>{:else}<button class="crumb" onclick={() => (ui.topic = null)}>{t('Library')} ›</button>{/if}
      <h1 class="display">{title}</h1>
    </nav>
  </header>

  {#if data.settings.thoth === 'full'}
    <div class="thoth-row">
      <div class="portrait"><Thoth size={84} portrait /></div>
      <p class="bubble plain">
        {due ? (mix ? plural('{n} card due across your decks here. Shall we do them together?', '{n} cards due across your decks here. Shall we do them together?', due) : t('One deck at a time. Fine by me.')) : line('nothingDue')}
      </p>
    </div>
  {/if}

  {#if due}
    <div class="study plain">
      <div class="seg" role="group" aria-label={t('How to study')}>
        <button aria-pressed={mix} onclick={() => (mix = true)}>{t('Mix the decks')}</button>
        <button aria-pressed={!mix} onclick={() => (mix = false)}>{t('One deck at a time')}</button>
      </div>
      <button class="primary" onclick={study}>
        {mix ? plural('Study all due · {n} card', 'Study all due · {n} cards', due) : t('Start with {deck} · {n}', { deck: first?.deck.name ?? '', n: first?.sum.due ?? 0 })}
      </button>
      <p class="fine">{mix ? t('Cards from every deck here, shuffled together. Each card keeps its own deck’s schedule.') : t('Opens the first deck with cards due.')}</p>
    </div>
  {/if}

  <div class="stats">
    <div class="plain"><strong>{number(learned)}</strong><small>{t('cards learned')}</small></div>
    <div class="plain"><strong>{total ? Math.round((learned / total) * 100) : 0}%</strong><small>{t('of the topic')}</small></div>
    <div class="plain"><strong>{mine.length}</strong><small>{plural('deck', 'decks', mine.length)}</small></div>
  </div>

  {#if topicTiles.length}
    <p class="label">{t('Topics')}</p>
    <div class="tiles">
      {#each topicTiles as tp (tp.name)}
        <button class="tile card" onclick={() => (ui.topic = pathKey(subject, tp.name))}>
          <span class="tile-top"><strong>{tp.name}</strong>{#if tp.due}<span class="due">{tp.due}</span>{/if}</span>
          <small>{plural('{n} deck', '{n} decks', tp.decks.length)}</small>
          <span class="meter wide" aria-hidden="true"><i style="width: {pctOf(tp.decks)}%"></i></span>
          <small>{t('{n}% learned', { n: pctOf(tp.decks) })}</small>
        </button>
      {/each}
    </div>
  {/if}
  {#if loose.length}<p class="label">{topicTiles.length ? t('Other decks in {name}', { name: title }) : t('Decks in {name}', { name: title })}</p>{/if}
  <ul>
    {#each loose as r (r.deck.id)}
      <li>
        <button class="deck card" onclick={() => openDeck(r.deck.id)}>
          <span class="grow">
            {#if !topic && r.deck.place?.topic}<span class="where">{r.deck.place.topic}</span>{/if}
            <strong>{r.deck.name}</strong>
            <span class="meter" aria-hidden="true"><i style="width: {(r.sum.introduced / Math.max(1, r.sum.total)) * 100}%"></i></span>
            <small>{t('{n} of {total} learned', { n: number(r.sum.introduced), total: number(r.sum.total) })}{r.sum.due ? ` · ${plural('{n} due', '{n} due', r.sum.due)}` : ''}</small>
          </span>
          <Icon name="play" size={18} />
        </button>
        <button class="icon-btn" aria-label={t('Deck options for “{name}”', { name: r.deck.name })} onclick={() => onMove(r.deck.id)}><Icon name="more" /></button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .topic-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  nav {
    display: flex;
    flex-direction: column;
  }
  .crumb {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 0;
    color: var(--emerald);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  .thoth-row {
    display: flex;
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
    margin: 0;
  }
  .study {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .seg {
    display: flex;
    border: 2px solid var(--line);
  }
  .seg button {
    flex: 1;
    min-height: 42px;
    border: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--text);
    color: var(--surface);
  }
  .fine,
  small {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .stats div {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
  }
  .stats strong {
    font-family: var(--display);
    font-size: 24px;
    font-weight: 400;
  }
  .label {
    margin: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .deck {
    flex: 1;
    min-width: 0;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
  }
  .deck strong {
    font-family: var(--display);
    font-size: 20px;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .where {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .meter {
    height: 6px;
    background: var(--pip-off);
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--emerald);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .tile {
    min-height: 120px;
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
    font-family: var(--display);
    font-weight: 400;
    font-size: 20px;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .tile small {
    color: var(--muted);
    font-size: 13px;
  }
  .due {
    min-width: 28px;
    padding: 1px 7px;
    background: var(--badge-bg);
    color: var(--text);
    font-weight: 700;
    text-align: center;
  }
  .meter.wide {
    width: 100%;
    margin-top: auto;
  }
</style>
