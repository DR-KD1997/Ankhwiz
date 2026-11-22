<script lang="ts">
  import { t } from '../i18n';
  // A picture with hidden parts. The part asked about is ochre with a "?";
  // with "hide all" the other parts are covered too; otherwise they show,
  // outlined. Names appear only once answered (shown earlier, they would give
  // the answer away by elimination); then the asked part opens in green.
  import type { Mask, Picture } from '../core/types';
  import { mediaUrl } from '../media';

  let { deckId, picture, revealed = false }: { deckId: string; picture: Picture; revealed?: boolean } = $props();

  let url = $state<string | null | undefined>(undefined);
  let large = $state(false);

  $effect(() => {
    const id = deckId;
    const name = picture.image;
    let live = true;
    void mediaUrl(id, name).then((u) => {
      if (live) url = u;
    });
    return () => {
      live = false;
    };
  });

  const pct = (v: number) => `${(v * 100).toFixed(3)}`;
  const points = (m: Mask) => (m.points ?? []).map(([x, y]) => `${pct(x)},${pct(y)}`).join(' ');
  const asked = $derived(picture.masks.filter((m) => m.state === 'ask'));
  const describe = $derived(
    `Picture with ${picture.masks.length} marked ${picture.masks.length === 1 ? 'part' : 'parts'}; ${asked.length === 1 ? 'one part is' : `${asked.length} parts are`} hidden${revealed && asked[0]?.label ? `: ${asked.map((m) => m.label).join(', ')}` : ''}.`,
  );
</script>

{#if url === null}
  <p class="missing">{t('The picture {image} is not on this device.', { image: picture.image })}</p>
{:else if url}
  <button class="frame plain" class:large aria-label={`${describe} ${large ? 'Tap to make smaller.' : 'Tap to enlarge.'}`} onclick={() => (large = !large)}>
    <span class="box">
      <img src={url} alt="" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each picture.masks as m, i (i)}
          {@const cls = m.state === 'ask' ? (revealed ? 'opened' : 'ask') : m.state}
          {#if m.kind === 'polygon' && m.points?.length}
            <polygon class={cls} points={points(m)} vector-effect="non-scaling-stroke" />
          {:else if m.kind === 'ellipse'}
            <ellipse class={cls} cx={pct(m.left + m.width / 2)} cy={pct(m.top + m.height / 2)} rx={pct(m.width / 2)} ry={pct(m.height / 2)} vector-effect="non-scaling-stroke" />
          {:else}
            <rect class={cls} x={pct(m.left)} y={pct(m.top)} width={pct(m.width)} height={pct(m.height)} vector-effect="non-scaling-stroke" />
          {/if}
        {/each}
      </svg>
      {#each picture.masks as m, i (i)}
        {#if m.state === 'ask' && !revealed}
          <span class="mark q" style="left: {pct(m.left + m.width / 2)}%; top: {pct(m.top + m.height / 2)}%">?</span>
        {:else if m.label && revealed && (m.state === 'open' || m.state === 'ask')}
          <span class="mark name" class:answer={m.state === 'ask'} style="left: {pct(m.left + m.width / 2)}%; top: {pct(m.top + m.height / 2)}%">{m.label}</span>
        {/if}
      {/each}
    </span>
  </button>
{:else}
  <div class="frame plain placeholder" aria-hidden="true"></div>
{/if}

<style>
  .frame {
    display: block;
    width: 100%;
    padding: 8px;
    background: var(--surface);
    cursor: zoom-in;
  }
  .frame.large {
    cursor: zoom-out;
  }
  .placeholder {
    height: 180px;
  }
  .box {
    position: relative;
    display: block;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
  }
  .large img {
    max-height: none;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .ask {
    fill: var(--ochre);
    stroke: var(--line);
    stroke-width: 2.5;
  }
  .hidden {
    fill: #e8d7ae;
    stroke: var(--line);
    stroke-width: 1.5;
  }
  .open {
    fill: transparent;
    stroke: var(--line);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .opened {
    fill: rgba(47, 107, 58, 0.18);
    stroke: var(--ok-line);
    stroke-width: 3;
  }
  .mark {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    white-space: nowrap;
  }
  .q {
    font: 600 22px var(--button);
    color: #fbf4e2;
  }
  .name {
    font: 600 12px var(--body);
    background: var(--surface);
    color: var(--text);
    border: 1.5px solid var(--line);
    padding: 1px 6px;
  }
  .name.answer {
    background: var(--ok-bg);
    color: var(--ok-text);
    border-color: var(--ok-line);
    font-size: 14px;
  }
  .missing {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
