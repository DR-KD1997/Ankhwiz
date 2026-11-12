<script lang="ts">
  // The Ankhwiz mark: an ankh with plain arms inside an arch.
  let { size = 40, wordmark = false }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo">
  <svg viewBox="0 0 100 120" width={size} height={size * 1.2} role="img" aria-label="Ankhwiz">
    <path d="M10 116 L10 50 A40 40 0 0 1 90 50 L90 116 Z" fill="none" stroke="var(--logo-arch)" stroke-width="3.5" />
    <ellipse cx="50" cy="40" rx="12" ry="17" fill="none" stroke="var(--logo-ankh)" stroke-width="7" />
    <rect x="24" y="60" width="52" height="8" fill="var(--logo-ankh)" />
    <path d="M45 60 L55 60 L59 108 L41 108 Z" fill="var(--logo-ankh)" />
  </svg>
  {#if wordmark}<span class="word" style="font-size: {size * 0.62}px">ANKHWIZ</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  svg {
    display: block;
    flex: none;
  }
  .word {
    font-family: var(--display);
    letter-spacing: 0.14em;
    line-height: 1;
    color: var(--wordmark);
  }
</style>
