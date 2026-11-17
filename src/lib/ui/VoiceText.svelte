<script lang="ts">
  // A card's text with the words read in another voice underlined: solid for
  // words marked in the card editor, dotted for words in quotes under the
  // deck's rule. Each such run carries its language, for screen readers too.
  import { runs, type Mark } from '../voices';

  let { text, lang, marks = [], quoteLang = '', show = true }: { text: string; lang: string; marks?: Mark[]; quoteLang?: string; show?: boolean } = $props();
  const parts = $derived(show ? runs(text, lang, marks, quoteLang) : [{ text, from: 'base' as const, lang }]);
</script>

{#each parts as r, i (i)}{#if r.from === 'base'}{r.text}{:else}<span class="v-{r.from}" lang={r.lang} title="Read in {r.lang}">{r.text}</span>{/if}{/each}

<style>
  span {
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 0.18em;
    text-decoration-color: var(--brass);
  }
  .v-quote {
    text-decoration-style: dotted;
  }
</style>
