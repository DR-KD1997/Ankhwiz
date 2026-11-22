<script lang="ts">
  // In the card editor: other cards whose answers mean the same as this one's,
  // or nearly the same. Tapping a link's label changes it (Same, Close,
  // Removed). "Find answers like this" looks on this device and, with the AI
  // connection, asks Thoth; "Check this card" asks Thoth about its wording,
  // extra answers and wrong options. Links are saved straight away.
  import { aiReady, ask } from '../ai.svelte';
  import type { Suggestion } from '../core/types';
  import { t } from '../i18n';
  import { linkable, linksOf, plainAnswer } from '../links';
  import { data, linkAnswers, snap, unlinkAnswers } from '../store.svelte';

  let {
    deckId,
    noteId,
    onAlts,
    onWrong,
  }: { deckId: string; noteId: string; onAlts: (more: string[]) => void; onWrong: (more: string[]) => void } = $props();

  const deck = $derived(data.decks[deckId]);
  const note = $derived(deck.notes[noteId]);
  const ai = $derived(aiReady() && data.ai.noticeSeen);
  const links = $derived(linksOf(deck, noteId));
  const BY = $derived({ you: t('Added by you'), thoth: t('Suggested by Thoth'), device: t('Found on this device') } as Record<string, string>);

  let found = $state<{ id: string; from: string; kind?: 'same' | 'close' }[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let error = $state('');
  let checking = $state(false);
  let checked = $state<Suggestion | null | 'none'>(null);

  function cycle(other: string, kind: 'same' | 'close') {
    if (kind === 'same') linkAnswers(deckId, [noteId, other], 'close');
    else unlinkAnswers(deckId, noteId, other);
  }

  /** Cards to compare with: the same unit first, then the rest of the deck. */
  function candidates(): string[] {
    const unit = deck.units.find((u) => u.lessonIds.some((l) => deck.lessons[l]?.noteIds.includes(noteId)));
    const near = unit ? unit.lessonIds.flatMap((l) => deck.lessons[l]?.noteIds ?? []) : [];
    const rest = Object.keys(deck.notes);
    const linked = new Set([noteId, ...links.map((l) => l.other)]);
    return [...new Set([...near, ...rest])].filter((id) => !linked.has(id) && linkable(deck.notes[id])).slice(0, 150);
  }

  async function find() {
    searching = true;
    error = '';
    const out: typeof found = [];
    const linked = new Set([noteId, ...links.map((l) => l.other)]);
    const q = plainAnswer(note.front);
    const a = plainAnswer(note.back);
    for (const n of Object.values(deck.notes)) {
      if (linked.has(n.id) || !linkable(n)) continue;
      if (plainAnswer(n.front) === q && plainAnswer(n.back) !== a) out.push({ id: n.id, from: t('Found on this device: the same question, another answer') });
      else if (plainAnswer(n.back) === a && plainAnswer(n.front) !== q) out.push({ id: n.id, from: t('Found on this device: the same answer, another question') });
    }
    if (ai) {
      try {
        const list = candidates();
        const r = await ask<{ same: string[]; close: string[] }>('similar', snap(deck), { noteId, candidates: list });
        for (const id of r.same) if (!out.some((o) => o.id === id)) out.push({ id, from: t('Suggested by Thoth: same meaning'), kind: 'same' });
        for (const id of r.close) if (!out.some((o) => o.id === id)) out.push({ id, from: t('Suggested by Thoth: close in meaning'), kind: 'close' });
      } catch (e) {
        error = e instanceof Error ? t(e.message) : t('Thoth could not be asked.');
      }
    }
    found = out;
    searching = false;
    searched = true;
  }

  function settle(id: string, kind: 'same' | 'close' | null) {
    if (kind) linkAnswers(deckId, [noteId, id], kind, found.find((f) => f.id === id)?.kind ? 'thoth' : 'you');
    found = found.filter((f) => f.id !== id);
  }

  async function checkCard() {
    checking = true;
    error = '';
    try {
      const r = await ask<Suggestion[]>('improve', snap(deck), { noteIds: [noteId] });
      checked = r[0] ?? 'none';
    } catch (e) {
      error = e instanceof Error ? t(e.message) : t('Thoth could not be asked.');
    } finally {
      checking = false;
    }
  }
</script>

{#if linkable(note)}
  <div class="links plain">
    <p class="label">{t('Answers like this, on other cards')}</p>
    {#each links as l (l.other)}
      {@const o = deck.notes[l.other]}
      <div class="row">
        <span class="grow"><strong dir="auto">{o.front} · {o.back}</strong><small>{BY[l.link.by ?? 'you'] ?? ''}</small></span>
        <button class="kind {l.kind}" aria-label={t('{text}: {kind}. Tap to change.', { text: o.back, kind: l.kind === 'same' ? t('Same') : t('Close') })} onclick={() => cycle(l.other, l.kind)}>
          {l.kind === 'same' ? t('Same') : t('Close')}
        </button>
      </div>
    {:else}
      <p class="fine">{t('None yet.')}</p>
    {/each}
    {#each found as f (f.id)}
      {@const o = deck.notes[f.id]}
      {#if o}
        <div class="found">
          <span><strong dir="auto">{o.front} · {o.back}</strong> <small>{f.from}</small></span>
          <div class="pair">
            <button class="quiet small same" onclick={() => settle(f.id, 'same')}>{t('Same')}</button>
            <button class="quiet small close" onclick={() => settle(f.id, 'close')}>{t('Close')}</button>
            <button class="quiet small" onclick={() => settle(f.id, null)}>{t('Not related')}</button>
          </div>
        </div>
      {/if}
    {/each}
    {#if searched && !found.length && !searching}<p class="fine">{t('Nothing else found.')}</p>{/if}
    <div class="pair">
      <button class="quiet small" disabled={searching} onclick={find}>
        {searching ? t('Looking…') : t('Find answers like this')}
        <small>{ai ? t('On this device + Thoth · 1 request') : t('On this device')}</small>
      </button>
      {#if ai}
        <button class="quiet small" disabled={checking} onclick={checkCard}>
          {checking ? t('Thoth is reading…') : t('Check this card')}
          <small>{t('Thoth · 1 request')}</small>
        </button>
      {/if}
    </div>
    {#if checked === 'none'}<p class="fine">{t('Thoth found nothing to change.')}</p>{/if}
    {#if checked && checked !== 'none'}
      {@const c = checked}
      <div class="check">
        {#if c.flag}<p><strong>{t('Thoth:')}</strong> {c.flag}</p>{/if}
        {#if c.alts.length}
          <p>{t('Also right: {list}', { list: c.alts.join(', ') })} <button class="quiet small" onclick={() => (onAlts(c.alts), (checked = { ...c, alts: [] }))}>{t('Add')}</button></p>
        {/if}
        {#if c.wrong.length}
          <p>{t('Wrong options: {list}', { list: c.wrong.join(', ') })} <button class="quiet small" onclick={() => (onWrong(c.wrong), (checked = { ...c, wrong: [] }))}>{t('Add')}</button></p>
        {/if}
      </div>
    {/if}
    {#if error}<p class="fine" role="alert">{error}</p>{/if}
    <p class="fine">{t('Same: either answer counts on both cards. Close: never offered against each other. Links are saved straight away.')}</p>
  </div>
{/if}

<style>
  .links {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }
  .label {
    margin: 0;
  }
  .row,
  .found {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--hair);
    padding-bottom: 6px;
  }
  .found {
    flex-direction: column;
    align-items: stretch;
    border: 2px dashed var(--brass);
    padding: 8px;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  small {
    color: var(--muted);
    font-size: 13px;
    font-weight: 400;
  }
  strong {
    overflow-wrap: anywhere;
  }
  .kind {
    min-width: 84px;
    min-height: 40px;
    border: 2px solid;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .kind.same,
  .same {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .kind.close,
  .close {
    border-color: var(--brass);
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .pair {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pair button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .fine {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .check p {
    margin: 4px 0;
  }
</style>
