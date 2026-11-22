<script lang="ts">
  import { t } from '../i18n';
  // The "?" beside a busier part of the app: Thoth explains it again.
  import { PARTS, startPart, type Part } from '../tour.svelte';

  let { part }: { part: Part } = $props();
</script>

<button class="help" aria-label={t('Explain {name}', { name: t(PARTS[part].name) })} title={t('Explain this')} onclick={() => startPart(part)}>?</button>

<style>
  .help {
    flex: none;
    width: 32px;
    height: 32px;
    min-height: 0;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-weight: 700;
    font-size: 16px;
    line-height: 1;
    display: inline-grid;
    place-items: center;
  }
</style>
