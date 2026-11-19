<script lang="ts">
  // Something shared to Ankhwiz from another app (Android): a web page, some
  // text, or a document. The learner picks a deck (or a new one) and either
  // keeps it with the deck's sources or goes straight on to plan cards.
  import { onMount } from 'svelte';
  import { onShared, takeShared, type Shared } from '../platform';
  import { pageUrl, readSourceFile, readWebPage, sectionsFromText, type ReadSource } from '../sources';
  import { storeSource } from '../thothBuild';
  import { addEmptyDeck, data, openDeck, openPanel, setDeckExtras } from '../store.svelte';
  import Thoth from './Thoth.svelte';

  let item = $state<Shared | null>(null);
  let deckId = $state('');
  let newName = $state('');
  let busy = $state('');
  let error = $state('');
  const decks = $derived(Object.values(data.decks).sort((a, b) => b.created - a.created));

  function check() {
    const s = takeShared();
    if (s) {
      item = s;
      error = s.kind === 'error' ? 'That could not be read: it may be too large (over 25 MB) or not a file Ankhwiz knows.' : '';
      deckId = decks[0]?.id ?? '';
    }
  }
  onMount(() => {
    check();
    onShared(check);
  });

  const url = $derived(item?.kind === 'text' ? pageUrl(item.text.trim().split(/\s+/).find((w) => /^https?:\/\//i.test(w)) ?? item.text) : '');
  const what = $derived(item?.kind === 'file' ? item.name : item?.kind === 'text' ? (url ? url : item.subject || item.text.slice(0, 80)) : '');

  async function read(): Promise<ReadSource> {
    if (!item || item.kind === 'error') throw new Error('Nothing to read.');
    if (item.kind === 'file') {
      const raw = atob(item.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return readSourceFile(item.name, bytes);
    }
    if (url) return readWebPage(url);
    return { title: item.subject || item.text.trim().split(/\s+/).slice(0, 6).join(' '), kind: 'text', sections: sectionsFromText(item.text) };
  }

  async function add(plan: boolean) {
    error = '';
    busy = 'Reading it…';
    try {
      const r = await read();
      const id = deckId === 'new' ? addEmptyDeck(newName || r.title || 'New deck', { by: 'sources' }) : deckId;
      const entry = await storeSource(id, r);
      setDeckExtras(id, { sources: [...(data.decks[id].sources ?? []), entry] });
      item = null;
      if (plan) {
        openDeck(id);
        openPanel('sources');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'It could not be read.';
    } finally {
      busy = '';
    }
  }
</script>

{#if item}
  <div class="veil" role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Add to a deck">
      <div class="head">
        <div class="face"><Thoth size={44} portrait /></div>
        <div><strong class="display">Add to a deck</strong><small>Shared from another app</small></div>
      </div>
      {#if item.kind !== 'error'}
        <p class="what card">{what}</p>
        <label class="field"><span>Deck</span>
          <select class="input" bind:value={deckId}>
            {#each decks as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
            <option value="new">+ A new deck</option>
          </select>
        </label>
        {#if deckId === 'new'}<input class="input" bind:value={newName} placeholder="Name of the new deck" aria-label="Name of the new deck" />{/if}
        <p class="small">{url ? 'Ankhwiz reads the page’s text, as you could see it yourself.' : 'It is kept with the deck on this device.'} Nothing is sent anywhere until you ask Thoth to plan cards.</p>
      {/if}
      {#if busy}<p class="small" role="status">{busy}</p>{/if}
      {#if error}<p class="small bad" role="alert">{error}</p>{/if}
      <div class="pair">
        <button class="quiet" onclick={() => (item = null)}>{item.kind === 'error' ? 'Close' : 'Cancel'}</button>
        {#if item.kind !== 'error'}
          <button class="quiet" disabled={!!busy || !deckId} onclick={() => add(false)}>Just keep it</button>
          <button class="primary" disabled={!!busy || !deckId} onclick={() => add(true)}>Add &amp; plan cards</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(20, 16, 10, 0.55);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sheet {
    width: 100%;
    max-width: 520px;
    box-sizing: border-box;
    background: var(--surface);
    border-top: 3px solid var(--line);
    padding: 16px max(16px, env(safe-area-inset-left, 0px)) calc(16px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .head > div:last-child {
    display: flex;
    flex-direction: column;
  }
  .face {
    width: 44px;
    height: 44px;
    border: 2px solid var(--line);
    overflow: hidden;
  }
  .display {
    font-size: 20px;
    font-weight: 400;
  }
  .what {
    margin: 0;
    padding: 10px 12px;
    overflow-wrap: anywhere;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
  }
  small,
  .small {
    color: var(--muted);
    font-size: 14px;
    margin: 0;
  }
  .bad {
    color: var(--off-text);
  }
  .pair {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
