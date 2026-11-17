<script lang="ts">
  // Layout follows window width, not platform: a narrow window (or a phone)
  // shows one column; a wide one shows the path and the lesson side by side.
  import Ai from './lib/ui/Ai.svelte';
  import Contents from './lib/ui/Contents.svelte';
  import DeckOptions from './lib/ui/DeckOptions.svelte';
  import Practice from './lib/ui/Practice.svelte';
  import Progress from './lib/ui/Progress.svelte';
  import DeckAside from './lib/ui/DeckAside.svelte';
  import Library from './lib/ui/Library.svelte';
  import Logo from './lib/ui/Logo.svelte';
  import Path from './lib/ui/Path.svelte';
  import Session from './lib/ui/Session.svelte';
  import Settings from './lib/ui/Settings.svelte';
  import UpdatePrompt from './lib/ui/UpdatePrompt.svelte';
  import Tour from './lib/ui/Tour.svelte';
  import { data, ui } from './lib/store.svelte';

  let width = $state(window.innerWidth);
  const wide = $derived(width >= 960);
  const inDeck = $derived(ui.screen === 'deck' && !!ui.deckId && !!data.decks[ui.deckId]);
</script>

<svelte:window bind:innerWidth={width} />

{#if ui.failed}
  <div class="splash">
    <Logo size={72} />
    <p><strong>Ankhwiz could not start.</strong></p>
    <p>The learning core did not load in this view ({ui.failed}). Try the desktop or Android app, or a current browser.</p>
  </div>
{:else if !ui.ready}
  <div class="splash"><Logo size={72} /></div>
{:else if ui.screen === 'settings'}
  <Settings />
{:else if ui.session?.kind === 'all' && inDeck}
  <!-- Study all decks moves between decks, so it takes the whole window. -->
  <Session />
{:else if inDeck && wide}
  <div class="split">
    <div class="left"><Path /></div>
    <div class="right">
      {#if ui.session}<Session />{:else if ui.panel === 'ai'}<Ai />{:else if ui.panel === 'options'}<DeckOptions />{:else if ui.panel === 'contents'}<Contents />{:else if ui.panel === 'progress'}<Progress />{:else if ui.panel === 'practice'}<Practice />{:else}<DeckAside />{/if}
    </div>
  </div>
{:else if inDeck}
  {#if ui.session}<Session />{:else if ui.panel === 'ai'}<Ai />{:else if ui.panel === 'options'}<DeckOptions />{:else if ui.panel === 'contents'}<Contents />{:else if ui.panel === 'progress'}<Progress />{:else if ui.panel === 'practice'}<Practice />{:else}<Path />{/if}
{:else}
  <Library />
{/if}
{#if ui.ready && !ui.failed}<UpdatePrompt /><Tour />{/if}

<style>
  .splash {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    text-align: center;
    align-items: center;
    justify-content: center;
  }
  .splash p {
    max-width: 420px;
    margin: 0;
  }
  .split {
    flex: 1;
    width: 100%;
    max-width: 1120px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  }
  .left {
    border-right: 2px solid var(--line);
    max-height: 100dvh;
    overflow-y: auto;
  }
  .right {
    display: flex;
    flex-direction: column;
    max-height: 100dvh;
    overflow-y: auto;
  }
</style>
