<script lang="ts">
  import { t } from '../i18n';
  // The tour's layer over the real app: the screen dims except for a cut-out
  // round the control Thoth is talking about, with his line beside it. When a
  // step waits for the learner, taps reach that control (and only that one).
  import { tick } from 'svelte';
  import { currentStep, endPart, nextStep, PARTS, tour } from '../tour.svelte';
  import { data } from '../store.svelte';
  import Thoth from './Thoth.svelte';

  const step = $derived(currentStep());
  const part = $derived(tour.part ? PARTS[tour.part] : null);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
  let text = $state<HTMLParagraphElement>();
  let cueId = 0;
  const cue = $derived(step ? { kind: step.mood ?? 'nod', id: ++cueId } : null);

  /** The first visible element for the step's control. */
  function find(at: string): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${at}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  // Follow the control as the screen changes (scrolling, a new card, a window resize).
  let scrolledFor = '';
  $effect(() => {
    const s = step;
    if (!s || s.hidden) {
      rect = null;
      return;
    }
    let raf = 0;
    const follow = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      const el = s.at ? find(s.at) : null;
      if (el && scrolledFor !== `${tour.part}${tour.i}`) {
        scrolledFor = `${tour.part}${tour.i}`;
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
      }
      const r = el?.getBoundingClientRect();
      const next = r ? { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 } : null;
      if (JSON.stringify(next) !== JSON.stringify(rect)) rect = next;
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  });

  // Move focus to Thoth's line, so screen readers read it and Esc works at once.
  $effect(() => {
    if (step && !step.hidden) void tick().then(() => text?.focus({ preventScroll: true }));
  });

  /** Waiting for the learner: only when the control is on screen; otherwise Next keeps the tour going. */
  const waiting = $derived(!!step?.wait && !!rect);
  const below = $derived(!rect || rect.y + rect.h / 2 < vh * 0.55);
  const first = $derived(tour.part === 'basics' && tour.i === 0);
  const last = $derived(!!part && tour.i === part.steps.length - 1);

  function onKey(e: KeyboardEvent) {
    if (!step || step.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      endPart(first);
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if step && part && !step.hidden}
  <div class="tour" class:still={data.settings.motion === false}>
    {#if rect}
      <!-- Four panes round the cut-out, so taps can reach the control inside it. -->
      <div class="veil" style:left="0" style:top="0" style:width="100%" style:height="{Math.max(0, rect.y)}px"></div>
      <div class="veil" style:left="0" style:top="{rect.y + rect.h}px" style:width="100%" style:bottom="0"></div>
      <div class="veil" style:left="0" style:top="{rect.y}px" style:width="{Math.max(0, rect.x)}px" style:height="{rect.h}px"></div>
      <div class="veil" style:left="{rect.x + rect.w}px" style:top="{rect.y}px" style:right="0" style:height="{rect.h}px"></div>
      <div class="spot" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px"></div>
      {#if !waiting}<div class="block" style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px"></div>{/if}
    {:else}
      <div class="veil" style:inset="0"></div>
    {/if}

    <div
      class="bubble plain"
      class:top={!below}
      class:middle={!rect}
      style:top={rect && below ? `${Math.min(vh - 220, rect.y + rect.h + 12)}px` : null}
      style:bottom={rect && !below ? `${Math.min(vh - 220, vh - rect.y + 12)}px` : null}
      role="dialog"
      aria-modal="false"
      aria-label={t('Thoth: {name}, step {x} of {stepsCount}', { name: t(part.name), x: tour.i + 1, stepsCount: part.steps.length })}
    >
      {#if data.settings.thoth !== 'hidden'}<div class="face"><Thoth size={56} portrait {cue} /></div>{/if}
      <div class="body">
        <span class="count">{t('{name} · {x} of {stepsCount}', { name: t(part.name), x: tour.i + 1, stepsCount: part.steps.length })}</span>
        <p bind:this={text} tabindex="-1" aria-live="polite">{t(step.text)}</p>
        <div class="acts">
          {#if first}
            <button class="quiet" onclick={() => endPart(true)}>{t('Skip the tour')}</button>
            <button class="primary" onclick={nextStep}>{t('Show me')}</button>
          {:else}
            <button class="quiet" onclick={() => endPart()}>{t('Skip')}</button>
            {#if !waiting}<button class="primary" onclick={nextStep}>{last ? t('Done') : t('Next')}</button>{/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
  }
  .veil,
  .block {
    position: fixed;
    background: rgba(20, 16, 10, 0.55);
    pointer-events: auto;
  }
  .block {
    background: transparent;
  }
  .spot {
    position: fixed;
    border: 3px solid var(--brass);
    box-shadow: 0 0 0 3px rgba(251, 244, 226, 0.6);
    pointer-events: none;
    transition: all 0.25s ease;
  }
  .still .spot {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .spot {
      transition: none;
    }
  }
  .bubble {
    position: fixed;
    left: max(16px, env(safe-area-inset-left, 0px));
    right: max(16px, env(safe-area-inset-right, 0px));
    margin: 0 auto;
    max-width: 460px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
  }
  .bubble.middle {
    top: 50%;
    transform: translateY(-50%);
  }
  .face {
    flex: none;
    width: 56px;
    height: 56px;
    overflow: hidden;
    border: 2px solid var(--line);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .count {
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  p {
    margin: 0;
    font-size: 16px;
    line-height: 1.45;
    outline: none;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .acts button {
    min-height: 44px;
    padding: 0 18px;
  }
  .acts .primary {
    font-size: 16px;
    width: auto;
    flex: 0 0 auto;
  }
</style>
