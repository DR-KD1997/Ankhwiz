<script lang="ts">
  import { shownName, t } from '../i18n';
  // Wide windows only: shown beside the path while no lesson is open.
  import { currentStreak, data, now, snap, startLesson, startReview, ui } from '../store.svelte';
  import { summarise } from './deckView';
  import Thoth from './Thoth.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const sum = $derived(summarise(snap(deck), snap(data.progress[ui.deckId!] ?? {}), now()));
  const review = $derived(sum.due > 0 && (sum.reviewFirst || !sum.nextId));

  function go() {
    if (review) startReview(deck.id);
    else if (sum.nextId) startLesson(deck.id, sum.nextId);
  }
</script>

<aside>
  {#if data.settings.thoth !== 'hidden'}
    <div class="figure plain"><Thoth size={240} /></div>
  {/if}
  <dl>
    <div class="plain"><dt>{t('Learned')}</dt><dd>{t('{introduced} of {total}', { introduced: sum.introduced, total: sum.total })}</dd></div>
    <div class="plain"><dt>{t('Due today')}</dt><dd>{sum.due}</dd></div>
    <div class="plain"><dt>{t('Streak')}</dt><dd>{currentStreak()}</dd></div>
  </dl>
  {#if review || sum.nextId}
    <button class="primary" onclick={go}>{review ? t('Review now') : t('Start {name}', { name: shownName(deck.lessons[sum.nextId!].name) })}</button>
  {/if}
</aside>

<style>
  aside {
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    padding-block: 20px 32px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .figure {
    height: 330px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    background: var(--thoth-bg);
    box-shadow: inset 0 0 0 7px var(--thoth-bg), inset 0 0 0 8px var(--hair);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  dl div {
    padding: 10px 8px;
    text-align: center;
  }
  dt {
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  dd {
    margin: 2px 0 0;
    font-size: 20px;
    font-weight: 600;
  }
</style>
