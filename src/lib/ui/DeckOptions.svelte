<script lang="ts">
  // Deck options: the everyday settings first, the rest folded under Advanced.
  // Anki's names appear as small hints for people who know them.
  import { limits } from '../core';
  import type { Look } from '../core/types';
  import { exportAnkh, exportApkg } from '../exporting';
  import { canSpeak, hasVoice, speak, voiceHelp } from '../speech';
  import {
    copyOptionsToAll,
    data,
    deleteBackup,
    deleteUnusedFields,
    makeBackup,
    openPanel,
    removeDeck,
    restoreBackup,
    setDeckAccents,
    setDeckLessonSize,
    setDeckOptions,
    setTypeBothWays,
    ui,
  } from '../store.svelte';
  import Icon from './Icon.svelte';
  import TypeFields from './TypeFields.svelte';
  import LangPicker from './LangPicker.svelte';
  import { langName } from '../languages';
  import { unusedReport } from '../fields';
  import Help from './Help.svelte';
  import { offerPart } from '../tour.svelte';
  import { onMount } from 'svelte';
  import { date, plural, stageName, t } from '../i18n';
  import { job } from '../prepare.svelte';

  onMount(() => offerPart('options'));

  const deck = $derived(data.decks[ui.deckId!]);
  const o = $derived(deck.options);
  const backups = $derived(data.backups[deck.id] ?? []);
  const otherDecks = $derived(Object.keys(data.decks).length - 1);

  let withProgress = $state(true);
  let exporting = $state('');
  let message = $state('');
  let confirmDelete = $state(false);
  let confirmRestore = $state('');

  const look = (patch: Partial<Look>) => setDeckOptions(deck.id, { look: { ...o.look, ...patch } });
  const pct = $derived(Math.round(o.retention * 100));
  const firstType = $derived(deck.anki ? Object.values(deck.anki.notetypes)[0] : null);

  // Ask both ways is set for each kind of question-and-answer card: each Anki
  // note type in the deck, and the cards made in Ankhwiz.
  const plain = $derived(Object.values(deck.notes).filter((n) => !n.cloze && !n.occlusion));
  const kinds = $derived.by(() => {
    const types = deck.anki ? Object.values(deck.anki.notetypes).filter((t) => !t.cloze && !t.occlusion) : [];
    const count = (id: string) => plain.filter((n) => n.anki?.ntid === id).length;
    const list = types.map((t) => ({ id: t.id, name: t.name, count: count(t.id), on: t.bothWays ?? o.bothWays })).filter((k) => k.count);
    const own = plain.filter((n) => !n.anki || !deck.anki?.notetypes[n.anki.ntid]).length;
    return { list, own };
  });
  const SPACING = {
    spread: t('Asked later in the same lesson, never just after. Each day, only one way of a note comes up for review (Anki: bury siblings).'),
    nextDay: t('Met the day after, among the reviews. Each day, only one way of a note comes up for review (Anki: bury siblings).'),
    together: t('Asked straight after the first way, and both can come up for review on the same day.'),
  } as const;
  const cards = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;
  // Anki note types whose fields can be chosen again (pictures with hidden parts keep theirs).
  const mappable = $derived(deck.anki ? Object.values(deck.anki.notetypes).filter((t) => !t.occlusion && Object.values(deck.notes).some((n) => n.anki?.ntid === t.id)) : []);

  // Reading aloud: is there a voice for each language on this device?
  let missing = $state<string[]>([]);
  $effect(() => {
    const langs = o.look.speak === 'off' ? [] : [...new Set([o.look.lang, o.look.langBack ?? ''].filter(Boolean))];
    let live = true;
    void Promise.all(langs.map(async (l) => ((await hasVoice(l)) === false ? l : null))).then((r) => {
      if (live) missing = r.filter((x): x is string => !!x);
    });
    return () => {
      live = false;
    };
  });
  const sample = $derived(Object.values(deck.notes).find((n) => !n.cloze && !n.occlusion && n.front && n.back));
  /** Languages this deck already uses, offered first. */
  const used = $derived([o.look.lang, o.look.langBack ?? '', o.look.quoteLang ?? ''].filter(Boolean));

  async function run(kind: 'apkg' | 'ankh') {
    exporting = kind;
    message = '';
    try {
      message = kind === 'apkg' ? await exportApkg(deck.id, withProgress) : await exportAnkh(deck.id, withProgress);
    } catch (e) {
      message = e instanceof Error ? t(e.message) : t('The deck could not be exported.');
    } finally {
      exporting = '';
    }
  }

  // Text in Anki fields that no card shows: kept for going back to Anki, and deletable.
  const unused = $derived(unusedReport(deck));
  const unusedSize = $derived(unused.reduce((t, r) => t + r.size, 0));
  let confirmUnused = $state(false);
  const sizeText = (chars: number) => (chars >= 1_000_000 ? `${(chars / 1_000_000).toFixed(1)} MB` : chars >= 1000 ? `${Math.round(chars / 1000)} KB` : `${chars} characters`);
  function dropUnused() {
    const n = deleteUnusedFields(deck.id);
    confirmUnused = false;
    message = n ? plural('Deleted the text of unused fields in {n} note. A backup was made first.', 'Deleted the text of unused fields in {n} notes. A backup was made first.', n) : t('There was nothing to delete.');
  }

  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<section class="opts">
  <header>
    <button class="icon-btn" aria-label={t('Back to lessons')} onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">{t('Deck options')}</h1>
    <Help part="options" />
  </header>

  <div class="group">
    <p class="label">{t('Prepare for Ankhwiz')}</p>
    <button class="row as-button" onclick={() => openPanel('prepare')}>
      <span>
        <strong>{job.running && job.deckId === deck.id ? t('Preparing…') : deck.prep?.pending?.length ? t('Results to check') : deck.prep?.at ? t('Prepare again') : t('Prepare this deck')}</strong>
        <small>{deck.prep?.at ? t('Last prepared on {date}. Only cards added or changed since are looked at again.', { date: date(deck.prep.at) }) : t('Voices, fair answers, lesson names and more, set up in one go: on this device, and with Thoth if the AI connection is set up.')}</small>
      </span>
      <Icon name="play" size={18} />
    </button>
  </div>

  <div class="group" data-tour="o-daily">
    <p class="label">{t('Daily goal')}</p>
    <div class="row">
      <span><strong>{t('New lessons a day')}</strong><small>{t('{x} (Anki: new cards/day)', { x: o.newLessonsPerDay ? t('Thoth says when the goal is reached; you can always go on') : t('No goal') })}</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label={t('Fewer new lessons')} disabled={o.newLessonsPerDay <= 0} onclick={() => setDeckOptions(deck.id, { newLessonsPerDay: o.newLessonsPerDay - 1 })}>−</button>
        <b>{o.newLessonsPerDay || t('Off')}</b>
        <button class="icon-btn" aria-label={t('More new lessons')} disabled={o.newLessonsPerDay >= 10} onclick={() => setDeckOptions(deck.id, { newLessonsPerDay: o.newLessonsPerDay + 1 })}>+</button>
      </span>
    </div>
    <div class="row">
      <span><strong>{t('Reviews a day')}</strong><small>{t('The rest wait until tomorrow (Anki: maximum reviews/day)')}</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label={t('Fewer reviews')} disabled={o.reviewCap <= 10} onclick={() => setDeckOptions(deck.id, { reviewCap: Math.max(10, o.reviewCap - 10) })}>−</button>
        <b>{o.reviewCap}</b>
        <button class="icon-btn" aria-label={t('More reviews')} disabled={o.reviewCap >= 999} onclick={() => setDeckOptions(deck.id, { reviewCap: Math.min(999, o.reviewCap + 10) })}>+</button>
      </span>
    </div>
  </div>

  <div class="group">
    <p class="label">{t('Remembering')}</p>
    <div class="slider plain">
      <input
        type="range"
        min="80"
        max="95"
        step="1"
        value={pct}
        aria-label={t('Remember more or review less')}
        oninput={(e) => setDeckOptions(deck.id, { retention: Number(e.currentTarget.value) / 100 })}
      />
      <span class="ends"><small>{t('Review less')}</small><small>{t('Remember more')}</small></span>
      <p>{t('Cards come back when you are likely to still remember {pct}% of them. Higher means more reviews. (Anki: desired retention)', { pct })}</p>
    </div>
  </div>

  <div class="group" data-tour="o-kinds">
    <p class="label">{t('Card kinds')}</p>
    {#if kinds.list.length}
      <div class="row kinds">
        <span><strong>{t('Ask both ways')}</strong><small>{t('Also show the answer and ask for the question, for each kind of card (Anki: reversed card)')}</small></span>
      </div>
      {#each kinds.list as k (k.id)}
        <label class="row sub">
          <span><strong>{k.name}</strong><small>{cards(k.count)}</small></span>
          <input type="checkbox" checked={k.on} onchange={(e) => setTypeBothWays(deck.id, k.id, e.currentTarget.checked)} />
        </label>
      {/each}
      <label class="row sub">
        <span><strong>{t('Cards made in Ankhwiz')}</strong><small>{kinds.own ? t('{cards}, and any you add', { cards: cards(kinds.own) }) : t('Cards you add here')}</small></span>
        <input type="checkbox" checked={o.bothWays} onchange={(e) => setTypeBothWays(deck.id, '', e.currentTarget.checked)} />
      </label>
    {:else}
      <label class="row">
        <span><strong>{t('Ask both ways')}</strong><small>{t('Also show the answer and ask for the question (Anki: reversed card)')}</small></span>
        <input type="checkbox" checked={o.bothWays} onchange={(e) => setTypeBothWays(deck.id, '', e.currentTarget.checked)} />
      </label>
    {/if}
    {#if kinds.list.some((k) => k.on) || o.bothWays}
      <label class="row">
        <span><strong>{t('Other way round')}</strong><small>{SPACING[o.reverseSpacing ?? 'spread']}</small></span>
        <select aria-label={t('When the other way round is asked')} value={o.reverseSpacing ?? 'spread'} onchange={(e) => setDeckOptions(deck.id, { reverseSpacing: e.currentTarget.value as 'spread' })}>
          <option value="spread">{t('Spread out')}</option>
          <option value="nextDay">{t('Next day')}</option>
          <option value="together">{t('Straight after')}</option>
        </select>
      </label>
    {/if}
    <label class="row">
      <span><strong>{t('Build sentences')}</strong><small>{t('In the first two stages, answers of three words or more are put together from word tiles, with a few extra words mixed in. Each card can opt out in Cards.')}</small></span>
      <input type="checkbox" checked={o.buildSentences !== false} onchange={(e) => setDeckOptions(deck.id, { buildSentences: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>{t('Require accents')}</strong><small>{t('When off, “melocoton” counts for “melocotón”')}</small></span>
      <input type="checkbox" checked={deck.strictAccents} onchange={(e) => setDeckAccents(deck.id, e.currentTarget.checked)} />
    </label>
    <p class="hint">{t('Fill-the-gap cards: in Cards, write a question with gaps like')} <code>{'{{c1::Madrid}}'}</code> {t('(Anki: cloze).')}</p>
  </div>

  {#if mappable.length}
    <div class="group">
      <p class="label">{t('Fields')}</p>
      <p class="hint">{t('Which Anki fields become the question, the answer and the extra. Changing the extra fields, or the question fields shown under the main one, keeps your progress; changing the main question or the answer starts those cards again.')}</p>
      {#each mappable as ty (ty.id)}<TypeFields {deck} type={ty} />{/each}
    </div>
  {/if}

  {#if unused.length}
    <div class="group">
      <p class="label">{t('Unused fields')}</p>
      <p class="hint">{t('These Anki fields hold text that no card shows. It is kept so the deck can go back to Anki as it came; deleting it makes the deck smaller and quicker to open.')}</p>
      {#each unused as r (r.ntid)}
        <div class="row">
          <span><strong>{r.names.join(', ')}</strong><small>{plural('{type} · text in {n} note · about {rCount}', '{type} · text in {n} notes · about {rCount}', r.notes, { type: r.type, rCount: sizeText(r.size) })}</small></span>
        </div>
      {/each}
      {#if confirmUnused}
        <p class="hint">{t('Delete the text of these fields in every note? A backup of the deck is made first. If you later choose one of these fields for the question, answer or extra, it will be empty.')}</p>
        <span class="pair">
          <button class="quiet" onclick={() => (confirmUnused = false)}>{t('Cancel')}</button>
          <button class="quiet danger" onclick={dropUnused}>{t('Delete their text')}</button>
        </span>
      {:else}
        <button class="quiet" onclick={() => (confirmUnused = true)}>{t('Delete the text of unused fields ({unusedSize})', { unusedSize: sizeText(unusedSize) })}</button>
      {/if}
    </div>
  {/if}

  <div class="group">
    <p class="label">{t('Lessons')}</p>
    <div class="row">
      <span><strong>{t('Lesson size')}</strong><small>{t('Applies to lessons not yet started. Rename and reorder lessons in Cards.')}</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label={t('Smaller lessons')} disabled={deck.lessonSize <= limits.minLesson} onclick={() => setDeckLessonSize(deck.id, deck.lessonSize - 1)}>−</button>
        <b>{deck.lessonSize}</b>
        <button class="icon-btn" aria-label={t('Larger lessons')} disabled={deck.lessonSize >= limits.maxLesson} onclick={() => setDeckLessonSize(deck.id, deck.lessonSize + 1)}>+</button>
      </span>
    </div>
  </div>

  <div class="group" data-tour="o-look">
    <p class="label">{t('Look')}</p>
    <div class="row">
      <span><strong>{t('Text size')}</strong></span>
      <div class="seg" role="group" aria-label={t('Text size')}>
        {#each [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as [v, name] (v)}
          <button aria-pressed={o.look.size === v} onclick={() => look({ size: v as Look['size'] })}>{name}</button>
        {/each}
      </div>
    </div>
    <label class="row">
      <span><strong>{t('Font for cards')}</strong></span>
      <select value={o.look.font} onchange={(e) => look({ font: e.currentTarget.value as Look['font'] })}>
        <option value="default">{t('Standard')}</option>
        <option value="serif">{t('Serif')}</option>
        <option value="rounded">{t('Rounded')}</option>
        <option value="mono">{t('Monospace')}</option>
      </select>
    </label>
    <label class="row">
      <span><strong>{t('Right-to-left text')}</strong><small>{t('Otherwise each card\'s text picks its own direction')}</small></span>
      <input type="checkbox" checked={o.look.rtl} onchange={(e) => look({ rtl: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>{t('Show Extra as a hint')}</strong><small>{t('Before answering, instead of after')}</small></span>
      <input type="checkbox" checked={o.look.hintExtra} onchange={(e) => look({ hintExtra: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>{t('Read aloud')}</strong><small>{canSpeak() ? t('A speaker button by the question and the answer, with this device’s own voices') : t('This device offers no voices here')}</small></span>
      <input type="checkbox" checked={o.look.speak !== 'off'} disabled={!canSpeak()} onchange={(e) => look({ speak: e.currentTarget.checked ? 'on' : 'off' })} />
    </label>
    {#if o.look.speak !== 'off'}
      <div class="row sub wrap">
        <span><strong>{t('Question language')}</strong><small>{t('What the question side is read in')}</small></span>
        <span class="lang">
          <LangPicker label={t('Question language')} value={o.look.lang} emptyLabel={t('The device\'s own language')} extra={used} onPick={(c) => look({ lang: c })} />
          <button class="icon-btn" aria-label={t('Try the question voice')} disabled={!canSpeak()} onclick={() => speak(sample?.front ?? deck.name, o.look.lang)}>
            <Icon name="sound" />
          </button>
          <label class="say"><input type="checkbox" checked={o.look.speakQuestion !== false} onchange={(e) => look({ speakQuestion: e.currentTarget.checked })} />{t('Read aloud')}</label>
        </span>
      </div>
      <div class="row sub wrap">
        <span><strong>{t('Answer language')}</strong><small>{t('What the answer side is read in')}</small></span>
        <span class="lang">
          <LangPicker label={t('Answer language')} value={o.look.langBack ?? ''} emptyLabel={t('Same as the question')} extra={used} onPick={(c) => look({ langBack: c })} />
          <button class="icon-btn" aria-label={t('Try the answer voice')} disabled={!canSpeak()} onclick={() => speak(sample?.back ?? deck.name, o.look.langBack || o.look.lang)}>
            <Icon name="sound" />
          </button>
          <label class="say"><input type="checkbox" checked={o.look.speakAnswer !== false} onchange={(e) => look({ speakAnswer: e.currentTarget.checked })} />{t('Read aloud')}</label>
        </span>
      </div>
      <div class="row sub wrap">
        <span><strong>{t('Read quotes in another language')}</strong><small>{t('Words in quotes, like \'la manzana\', are read in this language and the rest in the field\'s own. Words marked in Cards keep their own language.')}</small></span>
        <span class="lang">
          <LangPicker label={t('Language for words in quotes')} value={o.look.quoteLang ?? ''} emptyLabel={t('Off')} extra={used} onPick={(c) => look({ quoteLang: c })} />
        </span>
      </div>
      {#if missing.length}<p class="hint warn" role="status">{t('No voice for {x} on this device yet. {x2} Settings › Voices can download one for many languages.', { x: missing.map(langName).join(' or '), x2: voiceHelp() })}</p>{/if}
      <p class="hint">{t('To have cards read by themselves as you go, choose what is read in Settings.')}</p>
    {/if}
  </div>

  <div class="group">
    <p class="label">{t('Export')}</p>
    <label class="row">
      <span><strong>{t('Include progress')}</strong><small>{t('Stages, due dates and recent answers')}</small></span>
      <input type="checkbox" bind:checked={withProgress} />
    </label>
    <div class="exports">
      <button class="quiet" disabled={!!exporting} onclick={() => run('apkg')}>
        <Icon name="download" size={18} />
        <span><strong>{exporting === 'apkg' ? t('Exporting…') : t('For Anki (.apkg)')}</strong><small>{t('Units as subdecks, lessons as tags')}</small></span>
      </button>
      <button class="quiet" disabled={!!exporting} onclick={() => run('ankh')}>
        <Icon name="download" size={18} />
        <span><strong>{exporting === 'ankh' ? t('Exporting…') : t('For Ankhwiz (.ankh)')}</strong><small>{t('Everything, exactly as it is here')}</small></span>
      </button>
    </div>
    {#if message}<p class="hint" role="status">{message}</p>{/if}
  </div>

  <div class="group">
    <p class="label">{t('Backups')}</p>
    <p class="hint">{t('Copies of this deck kept on this device, the newest {x}. Thoth\'s changes can make one first.', { x: backups.length ? t('first') : t('kept here') })}</p>
    {#each backups as b (b.id)}
      <div class="row">
        <span><strong>{b.label}</strong><small>{t('{t} · {orderCount} notes', { t: when(b.t), orderCount: b.order.length })}</small></span>
        {#if confirmRestore === b.id}
          <span class="pair">
            <button class="quiet" onclick={() => (confirmRestore = '')}>{t('Cancel')}</button>
            <button class="quiet" onclick={async () => {
                confirmRestore = '';
                message = (await restoreBackup(deck.id, b.id)) ? t('Deck restored. The version you had is now a backup.') : t('That backup could not be read, so nothing was changed.');
              }}>{t('Restore')}</button>
          </span>
        {:else}
          <span class="pair">
            <button class="quiet" onclick={() => (confirmRestore = b.id)}>{t('Restore')}</button>
            <button class="icon-btn" aria-label={t('Delete this backup')} onclick={() => deleteBackup(deck.id, b.id)}><Icon name="trash" /></button>
          </span>
        {/if}
      </div>
    {/each}
    <button class="quiet left" onclick={() => makeBackup(deck.id, 'Made by hand')}>{t('Make a backup now')}</button>
  </div>

  <details class="group advanced">
    <summary class="label">{t('Advanced')}</summary>
    <div class="row">
      <span><strong>{t('Longest gap')}</strong><small>{t('Days between reviews at most (Anki: maximum interval)')}</small></span>
      <input
        class="num"
        type="number"
        min="7"
        max="36500"
        value={o.maxInterval}
        onchange={(e) => setDeckOptions(deck.id, { maxInterval: Math.max(7, Math.min(36500, Number(e.currentTarget.value) || 36500)) })}
      />
    </div>
    {#each [0, 1, 2] as i (i)}
      <div class="row">
        <span><strong>{t('Days to leave stage {x}', { x: i + 2 })}</strong><small>{t('{x}: separate days with a correct answer', { x: stageName(limits.stageNames[i + 1]) })}</small></span>
        <span class="stepper">
          <button class="icon-btn" aria-label={t('Fewer days')} disabled={o.stageDays[i] <= 1} onclick={() => setDeckOptions(deck.id, { stageDays: o.stageDays.map((d, j) => (j === i ? d - 1 : d)) as [number, number, number] })}>−</button>
          <b>{o.stageDays[i]}</b>
          <button class="icon-btn" aria-label={t('More days')} disabled={o.stageDays[i] >= 7} onclick={() => setDeckOptions(deck.id, { stageDays: o.stageDays.map((d, j) => (j === i ? d + 1 : d)) as [number, number, number] })}>+</button>
        </span>
      </div>
    {/each}
    {#if otherDecks > 0}
      <div class="row">
        <span><strong>{t('Use these options everywhere')}</strong><small>{plural('Copies them to your {n} other deck (Anki: presets)', 'Copies them to your {n} other decks (Anki: presets)', otherDecks)}</small></span>
        <button class="quiet" onclick={() => (message = `Options copied to ${copyOptionsToAll(deck.id)} decks.`)}>{t('Copy')}</button>
      </div>
    {/if}
    {#if firstType}
      <div class="tmpl">
        <strong>{t('Anki note type kept for export: {name}', { name: firstType.name })}</strong>
        <small>{t('Fields: {x}. Question from “{question}”, answer from “{answer}”.', { x: firstType.fields.join(', '), question: firstType.fields[firstType.question], answer: firstType.fields[firstType.answer] })}</small>
        {#each firstType.templates as ty (ty.name)}
          <details>
            <summary>{ty.name}</summary>
            <pre>{ty.qfmt}</pre>
            <pre>{ty.afmt}</pre>
          </details>
        {/each}
      </div>
    {/if}
  </details>

  <div class="group">
    <div class="row">
      <span><strong>{t('Remove deck')}</strong><small>{t('Deletes the deck, its progress and its media from this device')}</small></span>
      {#if confirmDelete}
        <span class="pair">
          <button class="quiet" onclick={() => (confirmDelete = false)}>{t('Keep')}</button>
          <button class="quiet danger" onclick={() => removeDeck(deck.id)}>{t('Remove')}</button>
        </span>
      {:else}
        <button class="icon-btn" aria-label={t('Remove deck')} onclick={() => (confirmDelete = true)}><Icon name="trash" /></button>
      {/if}
    </div>
  </div>
</section>

<style>
  .say {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .say input {
    width: 20px;
    height: 20px;
    accent-color: var(--emerald);
  }
  .as-button {
    width: 100%;
    background: var(--surface);
    border: 2px solid var(--line);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    padding: 10px 12px;
  }
  .opts {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding-block: 20px 40px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 {
    font-size: 24px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 0;
    border-top: 1px solid var(--hair);
  }
  .row.kinds {
    padding-bottom: 2px;
  }
  .row.sub {
    margin-left: 16px;
    padding: 8px 0;
    border-top-style: dashed;
  }
  .row > span:first-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 200px;
  }
  small,
  .hint {
    font-size: 14px;
    color: var(--muted);
  }
  .hint {
    margin: 0;
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .stepper b {
    min-width: 34px;
    text-align: center;
  }
  input[type='checkbox'] {
    width: 24px;
    height: 24px;
    flex: none;
    accent-color: var(--emerald);
  }
  select,
  .num {
    min-height: 44px;
    padding: 6px 10px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
  }
  .num {
    width: 110px;
  }
  .lang {
    display: inline-flex;
    align-items: flex-start;
    gap: 6px;
    flex: 1 1 260px;
    justify-content: flex-end;
    min-width: 0;
  }
  .row.wrap {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .seg {
    flex: none;
  }
  .slider {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .slider input {
    width: 100%;
    accent-color: var(--brass);
  }
  .slider p {
    margin: 0;
    font-size: 15px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
  }
  .exports {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
  }
  .exports button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    text-align: left;
    min-height: 64px;
  }
  .exports span {
    display: flex;
    flex-direction: column;
  }
  .pair {
    display: inline-flex;
    gap: 8px;
    flex: none;
  }
  .left {
    align-self: flex-start;
    padding: 0 16px;
    min-height: 44px;
  }
  .danger {
    border-color: var(--off-line);
    color: var(--off-text);
  }
  .warn {
    color: var(--close-text);
  }
  .advanced summary {
    cursor: pointer;
    padding: 6px 0;
  }
  .tmpl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--hair);
  }
  pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    max-height: 160px;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--hair);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  code {
    font-size: 13px;
  }
</style>
