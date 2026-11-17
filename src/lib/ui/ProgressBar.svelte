<script lang="ts">
  // A thin bar for long work such as importing a large deck. With no
  // `value` it moves back and forth, for steps whose length is unknown.
  let { label, value = null }: { label: string; value?: number | null } = $props();
  const pct = $derived(value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100));
</script>

<div class="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
  <span class="text">{label}{pct !== null ? ` · ${pct}%` : ''}</span>
  <span class="track"><span class="fill" class:moving={pct === null} style:width={pct === null ? '30%' : `${pct}%`}></span></span>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .text {
    font-size: 14px;
    color: var(--muted);
  }
  .track {
    position: relative;
    display: block;
    height: 8px;
    border: 2px solid var(--line);
    background: var(--surface);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--brass);
    transition: width 0.2s ease;
  }
  .moving {
    animation: sweep 1.3s ease-in-out infinite alternate;
  }
  @keyframes sweep {
    /* transform keeps moving even while the page is busy reading */
    from { transform: translateX(0); }
    to { transform: translateX(233%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill { transition: none; }
    .moving { animation: none; width: 100% !important; opacity: 0.5; }
  }
</style>
