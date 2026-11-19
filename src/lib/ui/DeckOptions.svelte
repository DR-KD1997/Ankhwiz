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
    spread: 'Asked later in the same lesson, never just after. Each day, only one way of a note comes up for review (Anki: bury siblings).',
    nextDay: 'Met the day after, among the reviews. Each day, only one way of a note comes up for review (Anki: bury siblings).',
    together: 'Asked straight after the first way, and both can come up for review on the same day.',
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
      message = e instanceof Error ? e.message : 'The deck could not be exported.';
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
    message = n ? `Deleted the text of unused fields in ${n} ${n === 1 ? 'note' : 'notes'}. A backup was made first.` : 'There was nothing to delete.';
  }

  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<section class="opts">
  <header>
    <button class="icon-btn" aria-label="Back to lessons" onclick={() => openPanel('path')}><Icon name="back" /></button>
    <h1 class="display">Deck options</h1>
    <Help part="options" />
  </header>

  <div class="group" data-tour="o-daily">
    <p class="label">Daily goal</p>
    <div class="row">
      <span><strong>New lessons a day</strong><small>{o.newLessonsPerDay ? 'Thoth says when the goal is reached; you can always go on' : 'No goal'} (Anki: new cards/day)</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label="Fewer new lessons" disabled={o.newLessonsPerDay <= 0} onclick={() => setDeckOptions(deck.id, { newLessonsPerDay: o.newLessonsPerDay - 1 })}>−</button>
        <b>{o.newLessonsPerDay || 'Off'}</b>
        <button class="icon-btn" aria-label="More new lessons" disabled={o.newLessonsPerDay >= 10} onclick={() => setDeckOptions(deck.id, { newLessonsPerDay: o.newLessonsPerDay + 1 })}>+</button>
      </span>
    </div>
    <div class="row">
      <span><strong>Reviews a day</strong><small>The rest wait until tomorrow (Anki: maximum reviews/day)</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label="Fewer reviews" disabled={o.reviewCap <= 10} onclick={() => setDeckOptions(deck.id, { reviewCap: Math.max(10, o.reviewCap - 10) })}>−</button>
        <b>{o.reviewCap}</b>
        <button class="icon-btn" aria-label="More reviews" disabled={o.reviewCap >= 999} onclick={() => setDeckOptions(deck.id, { reviewCap: Math.min(999, o.reviewCap + 10) })}>+</button>
      </span>
    </div>
  </div>

  <div class="group">
    <p class="label">Remembering</p>
    <div class="slider plain">
      <input
        type="range"
        min="80"
        max="95"
        step="1"
        value={pct}
        aria-label="Remember more or review less"
        oninput={(e) => setDeckOptions(deck.id, { retention: Number(e.currentTarget.value) / 100 })}
      />
      <span class="ends"><small>Review less</small><small>Remember more</small></span>
      <p>Cards come back when you are likely to still remember {pct}% of them. Higher means more reviews. (Anki: desired retention)</p>
    </div>
  </div>

  <div class="group" data-tour="o-kinds">
    <p class="label">Card kinds</p>
    {#if kinds.list.length}
      <div class="row kinds">
        <span><strong>Ask both ways</strong><small>Also show the answer and ask for the question, for each kind of card (Anki: reversed card)</small></span>
      </div>
      {#each kinds.list as k (k.id)}
        <label class="row sub">
          <span><strong>{k.name}</strong><small>{cards(k.count)}</small></span>
          <input type="checkbox" checked={k.on} onchange={(e) => setTypeBothWays(deck.id, k.id, e.currentTarget.checked)} />
        </label>
      {/each}
      <label class="row sub">
        <span><strong>Cards made in Ankhwiz</strong><small>{kinds.own ? `${cards(kinds.own)}, and any you add` : 'Cards you add here'}</small></span>
        <input type="checkbox" checked={o.bothWays} onchange={(e) => setTypeBothWays(deck.id, '', e.currentTarget.checked)} />
      </label>
    {:else}
      <label class="row">
        <span><strong>Ask both ways</strong><small>Also show the answer and ask for the question (Anki: reversed card)</small></span>
        <input type="checkbox" checked={o.bothWays} onchange={(e) => setTypeBothWays(deck.id, '', e.currentTarget.checked)} />
      </label>
    {/if}
    {#if kinds.list.some((k) => k.on) || o.bothWays}
      <label class="row">
        <span><strong>Other way round</strong><small>{SPACING[o.reverseSpacing ?? 'spread']}</small></span>
        <select aria-label="When the other way round is asked" value={o.reverseSpacing ?? 'spread'} onchange={(e) => setDeckOptions(deck.id, { reverseSpacing: e.currentTarget.value as 'spread' })}>
          <option value="spread">Spread out</option>
          <option value="nextDay">Next day</option>
          <option value="together">Straight after</option>
        </select>
      </label>
    {/if}
    <label class="row">
      <span><strong>Build sentences</strong><small>In the first two stages, answers of three words or more are put together from word tiles, with a few extra words mixed in. Each card can opt out in Cards.</small></span>
      <input type="checkbox" checked={o.buildSentences !== false} onchange={(e) => setDeckOptions(deck.id, { buildSentences: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>Require accents</strong><small>When off, “melocoton” counts for “melocotón”</small></span>
      <input type="checkbox" checked={deck.strictAccents} onchange={(e) => setDeckAccents(deck.id, e.currentTarget.checked)} />
    </label>
    <p class="hint">Fill-the-gap cards: in Cards, write a question with gaps like <code>{'{{c1::Madrid}}'}</code> (Anki: cloze).</p>
  </div>

  {#if mappable.length}
    <div class="group">
      <p class="label">Fields</p>
      <p class="hint">Which Anki fields become the question, the answer and the extra. Changing the extra fields, or the question fields shown under the main one, keeps your progress; changing the main question or the answer starts those cards again.</p>
      {#each mappable as t (t.id)}<TypeFields {deck} type={t} />{/each}
    </div>
  {/if}

  {#if unused.length}
    <div class="group">
      <p class="label">Unused fields</p>
      <p class="hint">These Anki fields hold text that no card shows. It is kept so the deck can go back to Anki as it came; deleting it makes the deck smaller and quicker to open.</p>
      {#each unused as r (r.ntid)}
        <div class="row">
          <span><strong>{r.names.join(', ')}</strong><small>{r.type} · text in {r.notes} {r.notes === 1 ? 'note' : 'notes'} · about {sizeText(r.size)}</small></span>
        </div>
      {/each}
      {#if confirmUnused}
        <p class="hint">Delete the text of these fields in every note? A backup of the deck is made first. If you later choose one of these fields for the question, answer or extra, it will be empty.</p>
        <span class="pair">
          <button class="quiet" onclick={() => (confirmUnused = false)}>Cancel</button>
          <button class="quiet danger" onclick={dropUnused}>Delete their text</button>
        </span>
      {:else}
        <button class="quiet" onclick={() => (confirmUnused = true)}>Delete the text of unused fields ({sizeText(unusedSize)})</button>
      {/if}
    </div>
  {/if}

  <div class="group">
    <p class="label">Lessons</p>
    <div class="row">
      <span><strong>Lesson size</strong><small>Applies to lessons not yet started. Rename and reorder lessons in Cards.</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label="Smaller lessons" disabled={deck.lessonSize <= limits.minLesson} onclick={() => setDeckLessonSize(deck.id, deck.lessonSize - 1)}>−</button>
        <b>{deck.lessonSize}</b>
        <button class="icon-btn" aria-label="Larger lessons" disabled={deck.lessonSize >= limits.maxLesson} onclick={() => setDeckLessonSize(deck.id, deck.lessonSize + 1)}>+</button>
      </span>
    </div>
  </div>

  <div class="group" data-tour="o-look">
    <p class="label">Look</p>
    <div class="row">
      <span><strong>Text size</strong></span>
      <div class="seg" role="group" aria-label="Text size">
        {#each [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as [v, name] (v)}
          <button aria-pressed={o.look.size === v} onclick={() => look({ size: v as Look['size'] })}>{name}</button>
        {/each}
      </div>
    </div>
    <label class="row">
      <span><strong>Font for cards</strong></span>
      <select value={o.look.font} onchange={(e) => look({ font: e.currentTarget.value as Look['font'] })}>
        <option value="default">Standard</option>
        <option value="serif">Serif</option>
        <option value="rounded">Rounded</option>
        <option value="mono">Monospace</option>
      </select>
    </label>
    <label class="row">
      <span><strong>Right-to-left text</strong><small>Otherwise each card's text picks its own direction</small></span>
      <input type="checkbox" checked={o.look.rtl} onchange={(e) => look({ rtl: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>Show Extra as a hint</strong><small>Before answering, instead of after</small></span>
      <input type="checkbox" checked={o.look.hintExtra} onchange={(e) => look({ hintExtra: e.currentTarget.checked })} />
    </label>
    <label class="row">
      <span><strong>Read aloud</strong><small>{canSpeak() ? 'A speaker button by the question and the answer, with this device’s own voices' : 'This device offers no voices here'}</small></span>
      <input type="checkbox" checked={o.look.speak !== 'off'} disabled={!canSpeak()} onchange={(e) => look({ speak: e.currentTarget.checked ? 'on' : 'off' })} />
    </label>
    {#if o.look.speak !== 'off'}
      <div class="row sub wrap">
        <span><strong>Question language</strong><small>What the question side is read in</small></span>
        <span class="lang">
          <LangPicker label="Question language" value={o.look.lang} emptyLabel="The device's own language" extra={used} onPick={(c) => look({ lang: c })} />
          <button class="icon-btn" aria-label="Try the question voice" disabled={!canSpeak()} onclick={() => speak(sample?.front ?? deck.name, o.look.lang)}>
            <Icon name="sound" />
          </button>
        </span>
      </div>
      <div class="row sub wrap">
        <span><strong>Answer language</strong><small>What the answer side is read in</small></span>
        <span class="lang">
          <LangPicker label="Answer language" value={o.look.langBack ?? ''} emptyLabel="Same as the question" extra={used} onPick={(c) => look({ langBack: c })} />
          <button class="icon-btn" aria-label="Try the answer voice" disabled={!canSpeak()} onclick={() => speak(sample?.back ?? deck.name, o.look.langBack || o.look.lang)}>
            <Icon name="sound" />
          </button>
        </span>
      </div>
      <div class="row sub wrap">
        <span><strong>Read quotes in another language</strong><small>Words in quotes, like 'la manzana', are read in this language and the rest in the field's own. Words marked in Cards keep their own language.</small></span>
        <span class="lang">
          <LangPicker label="Language for words in quotes" value={o.look.quoteLang ?? ''} emptyLabel="Off" extra={used} onPick={(c) => look({ quoteLang: c })} />
        </span>
      </div>
      {#if missing.length}<p class="hint warn" role="status">No voice for {missing.map(langName).join(' or ')} on this device yet. {voiceHelp()} Settings › Voices can download one for many languages.</p>{/if}
      <p class="hint">To have cards read by themselves as you go, choose what is read in Settings.</p>
    {/if}
  </div>

  <div class="group">
    <p class="label">Export</p>
    <label class="row">
      <span><strong>Include progress</strong><small>Stages, due dates and recent answers</small></span>
      <input type="checkbox" bind:checked={withProgress} />
    </label>
    <div class="exports">
      <button class="quiet" disabled={!!exporting} onclick={() => run('apkg')}>
        <Icon name="download" size={18} />
        <span><strong>{exporting === 'apkg' ? 'Exporting…' : 'For Anki (.apkg)'}</strong><small>Units as subdecks, lessons as tags</small></span>
      </button>
      <button class="quiet" disabled={!!exporting} onclick={() => run('ankh')}>
        <Icon name="download" size={18} />
        <span><strong>{exporting === 'ankh' ? 'Exporting…' : 'For Ankhwiz (.ankh)'}</strong><small>Everything, exactly as it is here</small></span>
      </button>
    </div>
    {#if message}<p class="hint" role="status">{message}</p>{/if}
  </div>

  <div class="group">
    <p class="label">Backups</p>
    <p class="hint">Copies of this deck kept on this device, the newest {backups.length ? 'first' : 'kept here'}. Thoth's changes can make one first.</p>
    {#each backups as b (b.id)}
      <div class="row">
        <span><strong>{b.label}</strong><small>{when(b.t)} · {b.order.length} notes</small></span>
        {#if confirmRestore === b.id}
          <span class="pair">
            <button class="quiet" onclick={() => (confirmRestore = '')}>Cancel</button>
            <button class="quiet" onclick={async () => {
                confirmRestore = '';
                message = (await restoreBackup(deck.id, b.id)) ? 'Deck restored. The version you had is now a backup.' : 'That backup could not be read, so nothing was changed.';
              }}>Restore</button>
          </span>
        {:else}
          <span class="pair">
            <button class="quiet" onclick={() => (confirmRestore = b.id)}>Restore</button>
            <button class="icon-btn" aria-label="Delete this backup" onclick={() => deleteBackup(deck.id, b.id)}><Icon name="trash" /></button>
          </span>
        {/if}
      </div>
    {/each}
    <button class="quiet left" onclick={() => makeBackup(deck.id, 'Made by hand')}>Make a backup now</button>
  </div>

  <details class="group advanced">
    <summary class="label">Advanced</summary>
    <div class="row">
      <span><strong>Longest gap</strong><small>Days between reviews at most (Anki: maximum interval)</small></span>
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
        <span><strong>Days to leave stage {i + 2}</strong><small>{limits.stageNames[i + 1]}: separate days with a correct answer</small></span>
        <span class="stepper">
          <button class="icon-btn" aria-label="Fewer days" disabled={o.stageDays[i] <= 1} onclick={() => setDeckOptions(deck.id, { stageDays: o.stageDays.map((d, j) => (j === i ? d - 1 : d)) as [number, number, number] })}>−</button>
          <b>{o.stageDays[i]}</b>
          <button class="icon-btn" aria-label="More days" disabled={o.stageDays[i] >= 7} onclick={() => setDeckOptions(deck.id, { stageDays: o.stageDays.map((d, j) => (j === i ? d + 1 : d)) as [number, number, number] })}>+</button>
        </span>
      </div>
    {/each}
    {#if otherDecks > 0}
      <div class="row">
        <span><strong>Use these options everywhere</strong><small>Copies them to your {otherDecks} other {otherDecks === 1 ? 'deck' : 'decks'} (Anki: presets)</small></span>
        <button class="quiet" onclick={() => (message = `Options copied to ${copyOptionsToAll(deck.id)} decks.`)}>Copy</button>
      </div>
    {/if}
    {#if firstType}
      <div class="tmpl">
        <strong>Anki note type kept for export: {firstType.name}</strong>
        <small>Fields: {firstType.fields.join(', ')}. Question from “{firstType.fields[firstType.question]}”, answer from “{firstType.fields[firstType.answer]}”.</small>
        {#each firstType.templates as t (t.name)}
          <details>
            <summary>{t.name}</summary>
            <pre>{t.qfmt}</pre>
            <pre>{t.afmt}</pre>
          </details>
        {/each}
      </div>
    {/if}
  </details>

  <div class="group">
    <div class="row">
      <span><strong>Remove deck</strong><small>Deletes the deck, its progress and its media from this device</small></span>
      {#if confirmDelete}
        <span class="pair">
          <button class="quiet" onclick={() => (confirmDelete = false)}>Keep</button>
          <button class="quiet danger" onclick={() => removeDeck(deck.id)}>Remove</button>
        </span>
      {:else}
        <button class="icon-btn" aria-label="Remove deck" onclick={() => (confirmDelete = true)}><Icon name="trash" /></button>
      {/if}
    </div>
  </div>
</section>

<style>
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
