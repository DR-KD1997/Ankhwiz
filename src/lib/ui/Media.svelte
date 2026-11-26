<script lang="ts">
  import { t } from '../i18n';
  // Pictures and sounds attached to a card side.
  import { isAudio, isVideo, mediaUrl } from '../media';
  import Icon from './Icon.svelte';

  // Pictures are centred unless `align` says otherwise (a deck can choose left); small ones (in options and lists) sit at the start.
  let {
    deckId,
    names = [],
    autoplay = false,
    small = false,
    align = 'center',
  }: { deckId: string; names?: string[]; autoplay?: boolean; small?: boolean; align?: 'center' | 'left' } = $props();

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
  <div class="media" class:small class:center={align === 'center' && !small}>
    {#each names as name (name)}
      {#if isAudio(name)}
        <button class="quiet sound" disabled={!urls[name]} onclick={() => play(name)} aria-label={t('Play sound {name}', { name })}>
          <Icon name="sound" size={18} /> {t('Play')}
        </button>
      {:else if urls[name] && isVideo(name)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={urls[name]} autoplay loop muted playsinline></video>
      {:else if urls[name]}
        <img src={urls[name]} alt="" />
      {:else if urls[name] === null}
        <span class="missing">{t('Picture {name} is not on this device', { name })}</span>
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
  .center {
    justify-content: center;
  }
  img,
  video {
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .small img,
  .small video {
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
