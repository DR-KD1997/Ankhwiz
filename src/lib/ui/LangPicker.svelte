<script lang="ts">
  // Choosing a language: by name, with its country's flag, from one search
  // that covers names in English and in the language itself, countries, codes
  // and other common names. Languages with a voice ready on this device come
  // first, then those Ankhwiz can download a voice for, then the rest.
  import { piperVoicesFor } from '../piper';
  import { hasVoice } from '../speech';
  import { COMMON_LANGS, flagOf, langMatches, langName, nativeName, sameLang, tidyLang } from '../languages';
  import Icon from './Icon.svelte';

  let {
    value,
    onPick,
    label,
    emptyLabel = '',
    extra = [],
  }: {
    value: string;
    onPick: (code: string) => void;
    /** What is being chosen, for screen readers: "Question language". */
    label: string;
    /** Offered first when the language may be left unset ("Same as the question", "Off"). */
    emptyLabel?: string;
    /** More languages to offer (those already used by the deck, say). */
    extra?: string[];
  } = $props();

  let open = $state(false);
  let query = $state('');
  let ready = $state<Record<string, boolean | null>>({});
  let search = $state<HTMLInputElement>();

  const all = $derived.by(() => {
    const out: string[] = [];
    for (const c of [...extra, ...COMMON_LANGS]) {
      const t = tidyLang(c);
      if (t && !out.some((x) => sameLang(x, t))) out.push(t);
    }
    return out;
  });
  const matching = $derived(all.filter((c) => langMatches(c, query)));
  const status = (c: string): 'ready' | 'download' | 'other' => (ready[c] ? 'ready' : piperVoicesFor(c).length ? 'download' : 'other');
  const groups = $derived([
    { id: 'ready', title: 'Ready on this device', list: matching.filter((c) => status(c) === 'ready') },
    { id: 'download', title: 'Ankhwiz can download a voice', list: matching.filter((c) => status(c) === 'download') },
    { id: 'other', title: "Add a voice in the system's settings", list: matching.filter((c) => status(c) === 'other') },
  ]);
  // A code typed in full that is not in the list can still be used.
  const typed = $derived.by(() => {
    const t = tidyLang(query);
    return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(t) && !all.some((c) => sameLang(c, t)) ? t : '';
  });

  async function toggle() {
    open = !open;
    query = '';
    if (!open) return;
    queueMicrotask(() => search?.focus());
    // Which languages already have a voice, looked up once the list is open.
    const found: Record<string, boolean | null> = {};
    await Promise.all(all.map(async (c) => (found[c] = await hasVoice(c).catch(() => null))));
    ready = found;
  }

  function pick(code: string) {
    onPick(code);
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      open = false;
    }
  }
</script>

<div class="lp" onkeydown={onKey} role="presentation">
  <button class="lp-btn" type="button" aria-expanded={open} aria-label="{label}: {value ? langName(value) : emptyLabel || 'not set'}" onclick={toggle}>
    {#if value}
      <span class="flag" aria-hidden="true">{flagOf(value) || '🌐'}</span>
      <span class="nm">{langName(value)}</span>
      <small>{tidyLang(value)}</small>
    {:else}
      <span class="nm muted">{emptyLabel || 'Choose a language'}</span>
    {/if}
    <Icon name="down" size={16} />
  </button>
  {#if open}
    <div class="lp-panel" role="dialog" aria-label={label}>
      <input class="input" type="search" bind:this={search} bind:value={query} placeholder="Search: a language, country or code" aria-label="Search languages" />
      <div class="lp-list">
        {#if emptyLabel && !query}
          <button class="lp-row" type="button" aria-pressed={!value} onclick={() => pick('')}><span class="flag" aria-hidden="true"></span><span class="nm">{emptyLabel}</span></button>
        {/if}
        {#if typed}
          <button class="lp-row" type="button" onclick={() => pick(typed)}>
            <span class="flag" aria-hidden="true">{flagOf(typed) || '🌐'}</span>
            <span class="nm">Use {typed}<small>{langName(typed) !== typed ? langName(typed) : 'a code not in the list'}</small></span>
          </button>
        {/if}
        {#each groups as g (g.id)}
          {#if g.list.length}
            <p class="lp-head">{g.title}</p>
            {#each g.list as c (c)}
              {@const own = nativeName(c)}
              <button class="lp-row" type="button" aria-pressed={sameLang(c, value)} onclick={() => pick(c)}>
                <span class="flag" aria-hidden="true">{flagOf(c) || '🌐'}</span>
                <span class="nm">{langName(c)}{#if own}<small>{own}</small>{/if}</span>
                <code>{c}</code>
              </button>
            {/each}
          {/if}
        {/each}
        {#if !matching.length && !typed}<p class="hint">No language matches “{query}”. A full code such as es-ES can be typed too.</p>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .lp {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: min(240px, 100%);
    flex: 1 1 auto;
    max-width: 380px;
  }
  .lp-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 10px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lp-btn .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lp-btn small,
  .lp-row code {
    color: var(--muted);
    font-size: 12px;
    font-family: inherit;
  }
  .muted {
    color: var(--muted);
  }
  .flag {
    width: 1.4em;
    font-size: 20px;
    text-align: center;
    flex: none;
  }
  .lp-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .lp-list {
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .lp-head {
    margin: 8px 4px 2px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .lp-row {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 6px;
    border: 0;
    border-bottom: 1px solid var(--hair);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lp-row[aria-pressed='true'] {
    background: var(--sel-bg);
    color: var(--text);
    font-weight: 600;
  }
  .lp-row .nm {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lp-row .nm small {
    color: var(--muted);
    font-size: 13px;
    font-weight: 400;
  }
</style>
