<script lang="ts">
  import Furi from './Furi.svelte';
  // Before the second of two cards close in meaning is first met: the one
  // already known beside the new one, with a note on how they differ (written
  // by Thoth when the deck was prepared, or the cards' own notes), and a
  // one-question check. Nothing here is marked.
  import { t } from '../i18n';
  import type { Note } from '../core/types';
  import Icon from './Icon.svelte';

  let {
    known,
    fresh,
    note,
    canSpeak = false,
    say,
    qLang,
    onDone,
  }: {
    known: Note;
    fresh: Note;
    note: string;
    canSpeak?: boolean;
    say: (text: string, lang: string) => void;
    qLang: string;
    onDone: () => void;
  } = $props();

  const firstLine = (s: string) => s.replace(/<[^>]+>/g, ' ').split(/\n/)[0].trim().slice(0, 140);
  const explanation = $derived(note || [firstLine(known.extra ?? ''), firstLine(fresh.extra ?? '')].filter(Boolean).join(' · '));
  // Quick check: which question goes with the new card's answer?
  const options = $derived(Math.random() < 0.5 ? [known, fresh] : [fresh, known]);
  let picked = $state<string | null>(null);
</script>

<div class="side">
  <p class="label">{t('New card · close to one you know')}</p>
  <h1 class="display">{t('These two are easy to mix up')}</h1>
  <div class="pair">
    {#each [known, fresh] as n, i (n.id)}
      <div class="col card" class:new={i === 1}>
        <span class="tagline">{i === 0 ? t('You know') : t('New')}</span>
        <strong class="q" dir="auto"><Furi text={n.front} /></strong>
        <span class="a" dir="auto"><Furi text={n.back} /></span>
        {#if canSpeak}
          <button class="icon-btn" aria-label={t('Hear “{text}”', { text: n.front })} onclick={() => say(n.front, qLang)}><Icon name="sound" size={18} /></button>
        {/if}
      </div>
    {/each}
  </div>
  {#if explanation}
    <p class="why plain" dir="auto">{explanation}{#if note}<span class="tag">{t('Thoth')}</span>{/if}</p>
  {/if}
  <div class="check plain">
    <p>{t('Quick check: which one means “{answer}”?', { answer: fresh.back })}</p>
    <div class="row">
      {#each options as n (n.id)}
        {@const right = n.id === fresh.id}
        <button class="quiet" class:ok={picked === n.id && right} class:off={picked === n.id && !right} onclick={() => (picked = n.id)}><Furi text={n.front} /></button>
      {/each}
    </div>
    {#if picked}
      <p class="fine" role="status">
        {picked === fresh.id ? t('Right: “{q}” is “{a}”.', { q: fresh.front, a: fresh.back }) : t('That one is “{a}”. The new one is “{q}”.', { a: known.back, q: fresh.front })}
      </p>
    {/if}
  </div>
  <div class="grow"></div>
  <button class="primary" onclick={onDone}>{t('Got it: on to the new card')}</button>
</div>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    align-items: flex-start;
  }
  .col.new {
    border-color: var(--brass);
    border-width: 3px;
  }
  .tagline {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .q {
    font-family: var(--display);
    font-size: 22px;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .a {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .why {
    margin: 0;
    padding: 10px 12px;
    font-size: 16px;
    line-height: 1.45;
  }
  .tag {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border: 1.5px solid currentColor;
    font-size: 11px;
    letter-spacing: 0.08em;
  }
  .check {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .check p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row button {
    flex: 1;
  }
  .row .ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .row .off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }
  .fine {
    font-size: 14px;
    color: var(--muted);
  }
  .grow {
    flex: 1;
  }
</style>
