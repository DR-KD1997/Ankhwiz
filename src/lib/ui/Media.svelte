<script lang="ts">
  // Pictures and sounds attached to a card side.
  import { isAudio, mediaUrl } from '../media';
  import Icon from './Icon.svelte';

  let { deckId, names = [], autoplay = false, small = false }: { deckId: string; names?: string[]; autoplay?: boolean; small?: boolean } =
    $props();

  let urls = $state<Record<string, string | null>>({});
  let player: HTMLAudioElement | undefined;

  $effect(() => {
    const wanted = names;
    const id = deckId;
    let live = true;
    void Promise.all(wanted.map(async (n) => [n, await mediaUrl(id, n)] as const)).then((pairs) => {
      if (!live) return;
      urls = Object.fromEntries(pairs);
      if (autoplay) {
        const first = wanted.find((n) => isAudio(n) && urls[n]);
        if (first) play(first);
      }
    });
    return () => {
      live = false;
    };
  });

  function play(name: string) {
    const url = urls[name];
    if (!url) return;
    player?.pause();
    player = new Audio(url);
    void player.play().catch(() => {});
  }
</script>

{#if names.length}
  <div class="media" class:small>
    {#each names as name (name)}
      {#if isAudio(name)}
        <button class="quiet sound" disabled={!urls[name]} onclick={() => play(name)} aria-label="Play sound {name}">
          <Icon name="sound" size={18} /> Play
        </button>
      {:else if urls[name]}
        <img src={urls[name]} alt="" />
      {:else if urls[name] === null}
        <span class="missing">Picture {name} is not on this device</span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .media {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  img {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .small img {
    max-height: 64px;
  }
  .sound {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 14px;
  }
  .missing {
    font-size: 13px;
    color: var(--muted);
  }
</style>
