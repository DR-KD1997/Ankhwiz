<script lang="ts">
  // Arranging the library: suggested places for decks not sorted yet (from a
  // deck's Anki name or its languages, on this device; or from Thoth), and
  // every deck with a way to move it.
  import { aiReady, ask } from '../ai.svelte';
  import { t } from '../i18n';
  import { knownPlaces } from '../places';
  import { placeOnDevice } from '../prepare.svelte';
  import { data, ensureDeck, setDeckPlace } from '../store.svelte';
  import Icon from './Icon.svelte';

  let { onMove, onClose }: { onMove: (id: string) => void; onClose: () => void } = $props();

  const ai = $derived(aiReady() && data.ai.noticeSeen);
  type Tip = { deckId: string; subject: string; topic: string; why: string; thoth: boolean; state?: 'yes' | 'no' };
  const unsorted = $derived(Object.values(data.decks).filter((d) => !d.place?.subject));
  let tips = $state<Tip[]>([]);
  let asked = $state(false);
  let asking = $state(false);
  let error = $state('');
  $effect(() => {
    // Suggestions this device can make, worked out once when the panel opens.
    if (tips.length) return;
    tips = unsorted
      .map((d) => ({ d, p: placeOnDevice(d) }))
      .filter((x) => x.p)
      .map(({ d, p }) => ({ deckId: d.id, subject: p!.subject, topic: p!.topic, why: p!.from === 'name' ? t('On this device · from the deck’s Anki name') : t('On this device · from its card languages'), thoth: false }));
  });
  const leftForThoth = $derived(unsorted.filter((d) => !tips.some((x) => x.deckId === d.id)));

  async function askThoth() {
    asking = true;
    error = '';
    const existing = [...knownPlaces(Object.values(data.decks)).entries()].flatMap(([s, ts]) => [s, ...ts]);
    for (const d of leftForThoth) {
      try {
        await ensureDeck(d.id);
        const r = await ask<{ subject: string; topic: string }>('place', data.decks[d.id], { existing });
        tips = [...tips, { deckId: d.id, subject: r.subject, topic: r.topic, why: t('Thoth · from what the cards are about'), thoth: true }];
      } catch (e) {
        error = e instanceof Error ? t(e.message) : t('Thoth could not be asked.');
      }
    }
    asked = true;
    asking = false;
  }
  function settle(i: number, yes: boolean) {
    const tip = tips[i];
    if (yes) setDeckPlace(tip.deckId, tip.subject, tip.topic);
    tips = tips.map((x, j) => (j === i ? { ...x, state: yes ? 'yes' : 'no' } : x));
  }
  const where = (s: string, tp: string) => (tp ? `${s} › ${tp}` : s);
</script>

<section class="arrange">
  <header>
    <button class="icon-btn" aria-label={t('Back to the library')} onclick={onClose}><Icon name="back" /></button>
    <h1 class="display">{t('Arrange your library')}</h1>
  </header>

  {#if tips.length || (ai && leftForThoth.length)}
    <p class="label">{t('Suggestions')}</p>
    {#each tips as tip, i (tip.deckId)}
      {@const d = data.decks[tip.deckId]}
      {#if d}
        <div class="tip plain" class:done={tip.state}>
          <span><strong>{d.name}</strong> → {where(tip.subject, tip.topic)}</span>
          <span class="chip" class:ai={tip.thoth}>{tip.why}</span>
          {#if !tip.state}
            <div class="pair">
              <button class="primary" onclick={() => settle(i, true)}>{t('Move it')}</button>
              <button class="quiet" onclick={() => settle(i, false)}>{t('No thanks')}</button>
            </div>
          {:else}
            <p class="fine" role="status">{tip.state === 'yes' ? t('Moved.') : t('Left where it is.')}</p>
          {/if}
        </div>
      {/if}
    {/each}
    {#if ai && leftForThoth.length && !asked}
      <button class="quiet" disabled={asking} onclick={askThoth}>
        {asking ? t('Thoth is reading…') : t('Ask Thoth about the other {n}', { n: leftForThoth.length })}
        <small>{t('Thoth · 1 request a deck')}</small>
      </button>
    {/if}
    {#if error}<p class="fine" role="alert">{error}</p>{/if}
  {/if}

  <p class="label">{t('Move a deck')}</p>
  <ul>
    {#each Object.values(data.decks).sort((a, b) => a.name.localeCompare(b.name)) as d (d.id)}
      <li class="plain">
        <span class="grow"><strong>{d.name}</strong><small>{d.place?.subject ? where(d.place.subject, d.place.topic ?? '') : t('Not sorted yet')}</small></span>
        <button class="quiet" onclick={() => onMove(d.id)}>{t('Move')}</button>
      </li>
    {/each}
  </ul>
  <p class="fine">{t('Moving a deck never changes its cards or progress. Subjects and topics are only how the library is arranged; a deck can also stay unsorted.')}</p>
</section>

<style>
  .arrange {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .label {
    margin: 4px 0 0;
  }
  .tip {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
  }
  .tip.done {
    opacity: 0.75;
  }
  .chip {
    align-self: flex-start;
    font-size: 12px;
    font-weight: 700;
    padding: 1px 6px;
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .chip.ai {
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair button {
    flex: 1;
    min-height: 44px;
  }
  .fine,
  small {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .quiet small {
    display: block;
  }
</style>
