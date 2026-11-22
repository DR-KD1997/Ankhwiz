<script lang="ts">
  import { plural, t } from '../i18n';
  // Dictation: hear a card, write it. The card's own sound plays where it has
  // one; otherwise a voice reads it. Answers are checked word by word, a
  // missing accent counts as nearly right, and nothing changes the schedule.
  import { onDestroy } from 'svelte';
  import { mediaUrl } from '../media';
  import { compareWords, dictationItems, heardSide, type DictationItem, type WordResult } from '../practice';
  import { canSpeak, hasVoice, speak, stopSpeaking, voiceHelp } from '../speech';
  import { data, openPanel, ui } from '../store.svelte';
  import { langName } from '../languages';
  import Icon from './Icon.svelte';

  const deck = $derived(data.decks[ui.deckId!]);
  const progress = $derived(data.progress[ui.deckId!] ?? {});
  let unitId = $state('');
  let voiceOk = $state<boolean | null>(null);
  let items = $state<DictationItem[]>([]);
  let index = $state(0);
  let typed = $state('');
  let result = $state<{ words: WordResult[]; extra: string[]; score: number } | null>(null);
  let hints = $state(false);
  let scores = $state<number[]>([]);
  let started = $state(false);
  let box = $state<HTMLTextAreaElement>();
  const item = $derived(items[index]);
  const heard = $derived(heardSide(deck).lang);
  const done = $derived(started && index >= items.length);

  // Letters the learner's keyboard may not have, from the language's own alphabet.
  const LETTERS: Record<string, string> = {
    tr: 'çğıİöşü',
    es: 'áéíñóúü¿¡',
    fr: 'àâçéèêëîïôûùœ',
    de: 'äöüß',
    pt: 'ãáâàçéêíóôõú',
    it: 'àèéìòù',
    pl: 'ąćęłńóśźż',
    cs: 'áčďéěíňóřšťúůýž',
    sv: 'åäö',
    no: 'æøå',
    da: 'æøå',
    nl: 'éëï',
    ro: 'ăâîșț',
    hu: 'áéíóöőúüű',
    is: 'áðéíóúýþæö',
  };
  const lang = $derived(item?.lang ?? heard);
  const letters = $derived([...(LETTERS[lang.split('-')[0].toLowerCase()] ?? '')]);

  $effect(() => {
    const l = heard;
    void (l ? hasVoice(l) : Promise.resolve(null)).then((v) => (voiceOk = v));
  });

  function start() {
    items = dictationItems(deck, progress, { unitId: unitId || undefined, count: 10, canSpeak: canSpeak() && voiceOk !== false });
    index = 0;
    scores = [];
    started = true;
    next(true);
  }

  let player: HTMLAudioElement | null = null;
  async function play(rate = 1) {
    if (!item) return;
    stopSpeaking();
    player?.pause();
    if (item.audio) {
      const url = await mediaUrl(deck.id, item.audio);
      if (url) {
        player = new Audio(url);
        player.playbackRate = rate;
        void player.play().catch(() => {});
        return;
      }
    }
    void speak(item.text, item.lang, rate);
  }

  function next(first = false) {
    if (!first) index++;
    typed = '';
    result = null;
    hints = false;
    if (index < items.length) {
      queueMicrotask(() => box?.focus());
      void play();
    }
  }

  function check() {
    if (!item || result) return;
    result = compareWords(item.text, typed);
    scores = [...scores, result.score];
  }

  function add(ch: string) {
    if (!box) return;
    const a = box.selectionStart ?? typed.length;
    const b = box.selectionEnd ?? typed.length;
    typed = typed.slice(0, a) + ch + typed.slice(b);
    queueMicrotask(() => {
      box?.focus();
      box?.setSelectionRange(a + ch.length, a + ch.length);
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (result) next();
      else check();
    }
  }

  /** The first letter of each word, the rest as dots. */
  const firstLetters = (text: string) => text.replace(/([\p{L}\p{N}])([\p{L}\p{N}'’-]*)/gu, (_w, a: string, rest: string) => a + '·'.repeat(rest.length));
  const average = $derived(scores.length ? Math.round((scores.reduce((t, s) => t + s, 0) / scores.length) * 100) : 0);
  onDestroy(() => {
    player?.pause();
    stopSpeaking();
  });
</script>

<section class="dict">
  <header>
    <button class="icon-btn" aria-label={t('Back to practice')} onclick={() => openPanel('practice')}><Icon name="back" /></button>
    <h1 class="display">{t('Dictation')}</h1>
  </header>

  {#if !started}
    <p class="hint">{t('Hear a card, then write what you hear. Play it as often as you like. Words are checked one by one, so one slip does not fail the sentence, and a missing accent counts as nearly right. Practice only: nothing changes when your cards come back.')}</p>
    {#if deck.units.length > 1}
      <label class="field"
        ><span>{t('Cards from')}</span>
        <select class="input" bind:value={unitId}>
          <option value="">{t('The whole deck')}</option>
          {#each deck.units as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
        </select></label
      >
    {/if}
    {#if voiceOk === false}<p class="hint warn">{t('There is no voice for {heard} on this device, so only cards with their own sound can be used. {x}', { heard: langName(heard), x: voiceHelp() })}</p>{/if}
    <button class="primary" onclick={start}>{t('Start')}</button>
  {:else if done}
    <div class="end card">
      <h2 class="display">{items.length ? `${average}% right` : t('Nothing to write yet')}</h2>
      <p>{items.length ? plural('{n} card written from hearing.', '{n} cards written from hearing.', items.length) : t('Dictation uses cards you have met that can be heard: their own sound, or a voice for the deck’s language. Meet some cards in a lesson first, or turn on Read aloud in Deck options.')}</p>
      <div class="pair">
        <button class="quiet" onclick={() => openPanel('practice')}>{t('Done')}</button>
        {#if items.length}<button class="primary" onclick={start}>{t('Again')}</button>{/if}
      </div>
    </div>
  {:else if item}
    <p class="label">{t('Card {x} of {itemsCount}', { x: index + 1, itemsCount: items.length })}</p>
    <div class="listen">
      <button class="big" aria-label={t('Play')} onclick={() => play()}><Icon name="sound" size={36} /></button>
      <button class="slow" aria-label={t('Play slowly')} onclick={() => play(0.7)}>0.7×</button>
    </div>
    {#if hints && !result}<p class="hints" aria-label={t('First letters')}>{firstLetters(item.text)}</p>{/if}
    <label class="field">
      <span>{t('What you hear')}</span>
      <textarea class="input" rows="2" bind:this={box} bind:value={typed} onkeydown={onKey} disabled={!!result} lang={item.lang} autocapitalize="off" spellcheck="false"></textarea>
    </label>
    {#if letters.length && !result}
      <div class="keys" aria-label={t('Letters')}>
        {#each letters as ch (ch)}<button class="key" onclick={() => add(ch)}>{ch}</button>{/each}
      </div>
    {/if}
    {#if result}
      <div class="result card" role="status">
        <p class="words">
          {#each result.words as w, i (i)}<span class="w {w.state}" title={w.state === 'ok' ? t('Right') : w.state === 'close' ? t('Nearly: you wrote {typed}', { typed: w.typed }) : w.state === 'off' ? t('You wrote {typed}', { typed: w.typed }) : t('Missing')}>{w.word}</span>{' '}{/each}
        </p>
        {#if result.score < 0.999 && typed.trim()}<p class="small">{t('You wrote: {x}', { x: typed.trim() })}</p>{/if}
        {#if result.extra.length}<p class="small">{t('Not in the sentence: {x}', { x: result.extra.join(', ') })}</p>{/if}
        <p class="small">{item.meaning}</p>
        <p class="small">{result.score >= 0.999 ? t('Every word right.') : result.score >= 0.7 ? t('Nearly there: the underlined words were close.') : t('Listen again at 0.7× and compare.')}</p>
      </div>
      <button class="primary" onclick={() => next()}>{index + 1 < items.length ? t('Next') : t('Finish')}</button>
    {:else}
      <div class="pair">
        <button class="quiet" onclick={() => (hints = !hints)}>{hints ? t('Hide first letters') : t('Show first letters')}</button>
        <button class="primary" onclick={check}>{t('Check')}</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .dict {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    max-width: 640px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .hint,
  .small {
    color: var(--muted);
    font-size: 15px;
    margin: 0;
  }
  .warn {
    color: var(--close-text);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
  }
  textarea {
    font-size: 20px;
    resize: vertical;
  }
  .listen {
    display: flex;
    gap: 12px;
    justify-content: center;
    align-items: flex-end;
  }
  .big {
    width: 96px;
    height: 96px;
    border: 3px solid var(--line);
    background: var(--emerald);
    color: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .slow {
    width: 64px;
    height: 64px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-family: var(--button);
    font-weight: 600;
    cursor: pointer;
  }
  .hints {
    text-align: center;
    font-size: 22px;
    letter-spacing: 0.08em;
    margin: 0;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .key {
    min-width: 44px;
    height: 44px;
    border: 2px solid var(--hair);
    background: var(--surface);
    color: var(--text);
    font-size: 18px;
    cursor: pointer;
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
  }
  .words {
    font-size: 22px;
    margin: 0;
    line-height: 1.6;
  }
  .w.ok {
    color: var(--ok-text);
  }
  .w.close {
    background: var(--close-bg);
    border-bottom: 3px solid var(--close-line);
  }
  .w.off,
  .w.missing {
    background: var(--off-bg);
    border-bottom: 3px solid var(--off-line);
  }
  .w.missing {
    border-bottom-style: dashed;
  }
  .pair {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .end {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .end h2 {
    margin: 0;
  }
  .label {
    margin: 0;
  }
</style>
