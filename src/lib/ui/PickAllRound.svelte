<script lang="ts">
  import Furi from './Furi.svelte';
  // "Pick all that fit": shown after a card whose answer has others with the
  // same meaning. Every answer that fits is to be picked; the ones close in
  // meaning, and a couple of others, are not. Practice only: nothing changes
  // when the cards come back.
  import { t, plural } from '../i18n';
  import type { PickAll } from '../links';
  import Icon from './Icon.svelte';

  let { question, onDone }: { question: PickAll; onDone: () => void } = $props();

  let picked = $state<Set<number>>(new Set());
  let checked = $state(false);
  const rightCount = $derived(question.options.filter((o) => o.right).length);
  const found = $derived(question.options.filter((o, i) => o.right && picked.has(i)).length);
  const extra = $derived(question.options.filter((o, i) => !o.right && picked.has(i)).length);
  const perfect = $derived(found === rightCount && extra === 0);

  function flip(i: number) {
    if (checked) return;
    const next = new Set(picked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    picked = next;
  }
  function note(o: PickAll['options'][number], on: boolean): string {
    if (o.why === 'own') return t('The card’s own answer.');
    if (o.why === 'same') return on ? t('Linked as the same meaning.') : t('Missed: linked as the same meaning.');
    return t('That one is “{front}”.', { front: o.why });
  }
</script>

<div class="pick">
  <p class="label">{t('Pick all that fit')}</p>
  <h1 class="display" dir="auto">{t('Which of these can mean “{text}”?', { text: question.prompt })}</h1>
  <p class="fine">{t('Select every one that fits. There may be more than one.')}</p>
  <div class="options" role="group" aria-label={t('Answers')}>
    {#each question.options as o, i (o.text)}
      {@const on = picked.has(i)}
      <button
        class="option card"
        class:picked={on && !checked}
        class:ok={checked && o.right && on}
        class:miss={checked && o.right && !on}
        class:off={checked && !o.right && on}
        class:dim={checked && !o.right && !on}
        aria-pressed={on}
        onclick={() => flip(i)}
      >
        <span class="box" aria-hidden="true">{#if on}<Icon name="check" size={16} />{/if}</span>
        <span class="text" dir="auto">
          <Furi text={o.text} />
          {#if checked && (on || o.right)}<small>{note(o, on)}</small>{/if}
        </span>
      </button>
    {/each}
  </div>
  {#if checked}
    <div class="banner {perfect ? 'ok' : 'off'}" role="status">
      <Icon name={perfect ? 'check' : 'dot'} size={22} />
      <div>
        <strong>{perfect ? t('All found, nothing extra.') : t('{found} of {total} found', { found, total: rightCount })}</strong>
        {#if extra}<span>{plural('{n} that does not fit', '{n} that do not fit', extra)}</span>{/if}
        <span>{t('Practice: the schedule is unchanged')}</span>
      </div>
    </div>
  {/if}
  <div class="grow"></div>
  {#if checked}
    <button class="primary" onclick={onDone}>{t('continue')}</button>
  {:else}
    <button class="primary" disabled={!picked.size} onclick={() => (checked = true)}>{t('check')}</button>
  {/if}
</div>

<style>
  .pick {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
  }
  .pick h1 {
    margin: 0;
    font-size: 26px;
    overflow-wrap: anywhere;
  }
  .fine {
    margin: 0;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .option {
    min-height: 56px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 18px;
    font-weight: 600;
    text-align: left;
  }
  .text {
    display: flex;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
  .text small {
    font-size: 14px;
    font-weight: 400;
  }
  .box {
    width: 24px;
    height: 24px;
    flex: none;
    border: 2px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .option.picked {
    border: 5px solid var(--brass);
    padding: 6px 14px;
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .option.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .option.miss {
    border-color: var(--brass);
    border-style: dashed;
  }
  .option.off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }
  .option.dim {
    opacity: 0.6;
  }
  .grow {
    flex: 1;
  }
</style>
