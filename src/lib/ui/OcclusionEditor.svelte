<script lang="ts">
  // Drawing the hidden parts of a picture card. Drag on the picture to add a
  // part; each part gets a name (optional: without one, its card is
  // self-checked) and a number (parts with the same number are asked together).
  import type { Occlusion, Shape } from '../core/types';
  import { freeName, mediaUrl, putMedia } from '../media';
  import Icon from './Icon.svelte';

  let { deckId, value = $bindable() }: { deckId: string; value: Occlusion | null } = $props();

  let url = $state<string | null>(null);
  let box = $state<HTMLDivElement>();
  let drag = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let start: { x: number; y: number } | null = null;
  let error = $state('');

  $effect(() => {
    const name = value?.image;
    if (!name) {
      url = null;
      return;
    }
    let live = true;
    void mediaUrl(deckId, name).then((u) => live && (url = u));
    return () => {
      live = false;
    };
  });

  async function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const name = await freeName(deckId, file.name);
    if (!(await putMedia(deckId, name, file))) {
      error = 'This device could not store the picture.';
      return;
    }
    error = '';
    value = { image: name, shapes: value?.shapes ?? [], hideAll: value?.hideAll ?? false };
  }

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  function at(e: PointerEvent) {
    const r = box!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }
  function down(e: PointerEvent) {
    if (!box || e.button !== 0) return;
    box.setPointerCapture(e.pointerId);
    start = at(e);
    drag = { ...start, w: 0, h: 0 };
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const p = at(e);
    drag = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
  }
  function up() {
    if (drag && value && drag.w > 0.015 && drag.h > 0.015) {
      const ord = Math.max(0, ...value.shapes.map((s) => s.ord)) + 1;
      value.shapes = [...value.shapes, { ord, kind: 'rect', left: drag.x, top: drag.y, width: drag.w, height: drag.h, label: '' }];
    }
    start = null;
    drag = null;
  }
  function remove(i: number) {
    if (value) value.shapes = value.shapes.filter((_, j) => j !== i);
  }
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const style = (s: Pick<Shape, 'left' | 'top' | 'width' | 'height'>) => `left:${pct(s.left)};top:${pct(s.top)};width:${pct(s.width)};height:${pct(s.height)}`;
</script>

<div class="occ">
  {#if !value?.image}
    <label class="quiet pick"><Icon name="picture" size={18} /> Choose a picture<input type="file" accept="image/*" onchange={(e) => choose(e.currentTarget.files)} /></label>
  {:else}
    <p class="hint">Drag on the picture to hide a part. Name each part to have it asked as a question; unnamed parts you check yourself.</p>
    {#if url}
      <div class="stage plain">
        <div class="box" bind:this={box} role="application" aria-label="Picture: drag to add a hidden part" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
          <img src={url} alt="" draggable="false" />
          {#each value.shapes as s, i (i)}
            <span class="shape" class:ellipse={s.kind === 'ellipse'} style={style(s)}><b>{s.ord}</b></span>
          {/each}
          {#if drag}<span class="shape drawing" style={style({ left: drag.x, top: drag.y, width: drag.w, height: drag.h })}></span>{/if}
        </div>
      </div>
    {/if}
    {#if value.shapes.length}
      <ol class="parts">
        {#each value.shapes as s, i (i)}
          <li>
            <label class="num"><span class="sr">Part number</span><input type="number" min="1" max="99" bind:value={s.ord} /></label>
            <input class="input" placeholder="Name (optional)" aria-label="Name of part {i + 1}" bind:value={s.label} dir="auto" />
            <button class="icon-btn" aria-label="Remove part {i + 1}" onclick={() => remove(i)}><Icon name="trash" size={18} /></button>
          </li>
        {/each}
      </ol>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={value.hideAll} /> Hide every part while asking about one</label>
    <label class="quiet pick small">Change picture<input type="file" accept="image/*" onchange={(e) => choose(e.currentTarget.files)} /></label>
  {/if}
  {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
</div>

<style>
  .occ {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pick {
    position: relative;
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .pick input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .stage {
    padding: 8px;
  }
  .box {
    position: relative;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    touch-action: none;
    cursor: crosshair;
    user-select: none;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 360px;
    pointer-events: none;
  }
  .shape {
    position: absolute;
    background: color-mix(in srgb, var(--ochre) 75%, transparent);
    border: 2px solid var(--line);
    display: grid;
    place-items: center;
  }
  .shape.ellipse {
    border-radius: 50%;
  }
  .shape b {
    font: 600 13px var(--body);
    color: #fbf4e2;
  }
  .drawing {
    background: transparent;
    border-style: dashed;
  }
  .parts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .parts li {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .num input {
    width: 56px;
    min-height: 44px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: 600 15px var(--body);
    text-align: center;
  }
  .input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 6px 10px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--emerald);
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .bad {
    color: var(--off-text);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
