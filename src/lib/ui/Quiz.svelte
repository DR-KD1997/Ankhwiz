<script lang="ts">
  // A run of multiple-choice questions, used by challenge rounds and reading
  // tests. It reports the score; it never touches the review schedule.
  import type { ReadingQuestion } from '../core/types';
  import Icon from './Icon.svelte';

  let {
    questions,
    onDone,
    whys = [],
  }: { questions: ReadingQuestion[]; onDone: (correct: number) => void; whys?: string[] } = $props();

  let index = $state(0);
  let picked = $state<number | null>(null);
  let checked = $state(false);
  let correct = $state(0);
  const q = $derived(questions[index]);
  const letters = 'ABCDEFGH';

  function act() {
    if (!checked) {
      if (picked === null) return;
      checked = true;
      if (picked === q.answer) correct++;
      return;
    }
    if (index + 1 >= questions.length) return onDone(correct);
    index++;
    picked = null;
    checked = false;
  }
</script>

<div class="quiz">
  <p class="label">Question {index + 1} of {questions.length}</p>
  <h2 class="display">{q.question}</h2>
  <div class="options" role="radiogroup" aria-label="Answers">
    {#each q.options as option, i (i)}
      <button
        class="option card"
        class:picked={picked === i && !checked}
        class:ok={checked && i === q.answer}
        class:off={checked && picked === i && i !== q.answer}
        role="radio"
        aria-checked={picked === i}
        disabled={checked}
        onclick={() => (picked = i)}
      >
        <span class="badge">
          {#if checked && i === q.answer}<Icon name="check" size={16} />
          {:else if checked && picked === i}<Icon name="cross" size={16} />
          {:else}{letters[i]}{/if}
        </span>
        <span>{option}</span>
      </button>
    {/each}
  </div>
  {#if checked && whys[index]}<p class="why plain">{whys[index]}</p>{/if}
  <button class="primary" disabled={picked === null} onclick={act}>
    {!checked ? 'Check' : index + 1 >= questions.length ? 'Finish' : 'Continue'}
  </button>
</div>

<style>
  .quiz {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    font-size: 22px;
    overflow-wrap: anywhere;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .option {
    min-height: 54px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 17px;
    font-weight: 600;
    text-align: left;
  }
  .option span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .badge {
    width: 30px;
    height: 30px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--badge-bg);
    color: var(--badge-text);
    font-size: 15px;
  }
  .picked {
    border-color: var(--brass);
    background: var(--sel-bg);
  }
  .ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }
  .option:disabled {
    opacity: 1;
  }
  .why {
    margin: 0;
    padding: 10px 14px;
  }
</style>
