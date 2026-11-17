<script lang="ts">
  // A link to a web page outside Ankhwiz. The app's window never leaves the
  // interface, so the page opens in the learner's own browser; if that fails,
  // the address is shown so it can be copied.
  import type { Snippet } from 'svelte';
  import { openLink } from '../platform';

  let { href, children, class: cls = '', onopen }: { href: string; children: Snippet; class?: string; onopen?: () => void } = $props();
  let failed = $state(false);

  async function open(e: MouseEvent) {
    e.preventDefault();
    failed = !(await openLink(href));
    if (!failed) onopen?.();
  }
</script>

<a {href} class={cls} target="_blank" rel="noopener" onclick={open}>{@render children()}</a>
{#if failed}<span class="addr">The browser could not be opened. The address is <span class="url">{href}</span></span>{/if}

<style>
  .addr {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .url {
    user-select: all;
    -webkit-user-select: all;
    color: var(--text);
  }
</style>
