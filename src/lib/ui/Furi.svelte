<script lang="ts" module>
  import { getContext, setContext } from 'svelte';

  /** How furigana show in a lesson: the deck's choice, how well each word is
   * known (its card's stage), whether the answer has been given (then every
   * reading shows), and what to do when a hidden reading is peeked at. */
  export interface FuriContext {
    mode: '' | 'fade' | 'always' | 'tap' | 'never';
    level: (word: string) => number;
    revealed: boolean;
    peek: (word: string) => void;
  }
  const KEY = Symbol('furigana');
  export const setFurigana = (c: FuriContext) => setContext(KEY, c);
  export const furiganaContext = () => getContext<FuriContext | undefined>(KEY);
</script>

<script lang="ts">
  // Text with furigana (Anki's 日本[にほん] form) shown as readings over the
  // words. Outside a lesson every reading shows; in one, the deck decides.
  import { t } from '../i18n';
  import { pieces } from '../furigana';

  let { text }: { text: string } = $props();
  const ctx = furiganaContext();
  const parts = $derived(text.includes('[') ? pieces(text) : null);
  let peeked = $state<Record<string, boolean>>({});

  /** 'show', 'light' (still learning: shown lighter), 'hidden' (tap to see) or 'none' (no readings at all). */
  function how(word: string): 'show' | 'light' | 'hidden' | 'none' {
    if (!ctx) return 'show';
    if (ctx.mode === 'never') return 'none';
    if (ctx.revealed || peeked[word] || ctx.mode === 'always' || ctx.mode === '') return 'show';
    if (ctx.mode === 'tap') return 'hidden';
    const stage = ctx.level(word);
    return stage >= 4 ? 'hidden' : stage === 3 ? 'light' : 'show';
  }
  function peek(word: string) {
    peeked = { ...peeked, [word]: true };
    ctx?.peek(word);
  }
</script>

{#if !parts}{text}{:else}{#each parts as p, i (i)}{#if !p.reading}{p.base}{:else}{@const h = how(p.base)}{#if h === 'none'}{p.base}{:else if h === 'hidden'}<button type="button" class="furi-hidden" lang="ja" aria-label={t('{word}: tap to see the reading', { word: p.base })} onclick={(e) => (e.stopPropagation(), peek(p.base))}><ruby>{p.base}<rt aria-hidden="true">{p.reading}</rt></ruby></button>{:else}<ruby class:light={h === 'light'} lang="ja">{p.base}<rt>{p.reading}</rt></ruby>{/if}{/if}{/each}{/if}

<style>
  ruby {
    ruby-position: over;
    ruby-align: center;
  }
  rt {
    font-size: 0.45em;
    font-weight: 400;
    color: var(--muted);
    letter-spacing: 0.02em;
  }
  .light rt {
    opacity: 0.5;
  }
  .furi-hidden {
    all: unset;
    cursor: pointer;
    border-bottom: 2px dotted var(--muted);
    line-height: inherit;
  }
  .furi-hidden rt {
    visibility: hidden;
  }
  .furi-hidden:focus-visible {
    outline: 2px solid var(--brass);
    outline-offset: 2px;
  }
</style>
