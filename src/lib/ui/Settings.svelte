<script lang="ts">
  import { aiHost, aiReady, aiState, isLocal, listModels, saveKey } from '../ai.svelte';
  import { aiPresets, limits } from '../core';
  import type { ThothMode } from '../core/thoth';
  import { backupLibrary, restoreLibraryFile } from '../exporting';
  import { askNotifications, platform, remindsNatively, secretHome } from '../platform';
  import { applyReminder, reminderText } from '../reminders';
  import { DEFAULT_SOUNDS, playFrom, SOUND_SETS, type SoundSet } from '../sounds';
  import { canSpeak } from '../speech';
  import { checkForUpdate, RELEASES, VERSION, type UpdateResult } from '../updates';
  import {
    data,
    eraseAll,
    importBackup,
    newer,
    now,
    save,
    setAutoRead,
    setLessonSize,
    setMotion,
    setSounds,
    setUpdateAtLaunch,
    setTheme,
    setThoth,
    setThothStyle,
    skipDays,
    ui,
    type AutoRead,
    type Theme,
  } from '../store.svelte';
  import Icon from './Icon.svelte';
  import OutLink from './OutLink.svelte';
  import Thoth from './Thoth.svelte';
  import Voices from './Voices.svelte';
  import { resetTips, startPart } from '../tour.svelte';
  import WhatsNew from './WhatsNew.svelte';

  const themes: [Theme, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];
  let tipsReset = $state(false);
  function setTips(on: boolean) {
    data.settings.tips = on;
    save();
  }
  function replayTour() {
    ui.screen = 'library';
    ui.deckId = null;
    startPart('basics');
  }
  const STYLES = [
    { id: 'classic', name: 'Classic', hint: 'Gold and ink, as on the logo' },
    { id: 'bright', name: 'Bright Scribe', hint: 'Rounder and friendlier' },
  ] as const;
  const modes: [ThothMode, string, string][] = [
    ['full', 'Full', 'Thoth guides you during lessons and on the path.'],
    ['quiet', 'Quiet', 'Thoth appears only when a lesson ends.'],
    ['hidden', 'Hidden', 'No mascot. His advice stays as a plain Suggestions list.'],
  ];

  // ----- sounds and reading aloud -----
  const sounds = $derived(data.settings.sounds ?? DEFAULT_SOUNDS);
  const soundAbout = $derived(sounds === 'off' ? 'No sounds when you answer.' : `${SOUND_SETS.find((s) => s.id === sounds)?.about}. Plays for right, nearly right and wrong answers, and at the end of a lesson.`);
  const reads: [AutoRead, string][] = [
    ['off', 'Off'],
    ['question', 'Question'],
    ['answer', 'Answer'],
    ['both', 'Both'],
  ];
  const readAbout: Record<AutoRead, string> = {
    off: 'Cards are read only when you tap a speaker button.',
    question: 'Each question is read as its card opens.',
    answer: 'The answer is read once you check it.',
    both: 'The question as its card opens, and the answer once you check it.',
  };

  let confirmErase = $state(false);
  let note = $state('');
  let picker = $state<HTMLInputElement>();

  function back() {
    ui.screen = ui.deckId && data.decks[ui.deckId] ? 'deck' : 'library';
  }

  let busy = $state(false);
  async function download() {
    busy = true;
    try {
      note = await backupLibrary();
    } catch (e) {
      note = e instanceof Error ? e.message : 'The backup could not be made.';
    } finally {
      busy = false;
    }
  }

  // ----- reminder -----
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let reminderNote = $state('');
  async function setReminderOn(on: boolean) {
    if (on && !(await askNotifications())) {
      reminderNote = 'Notifications are turned off for Ankhwiz. Allow them in your system settings, then try again.';
      return;
    }
    reminderNote = '';
    data.reminder.on = on;
    reminderChanged();
  }
  function toggleDay(d: number) {
    const days = data.reminder.days.includes(d) ? data.reminder.days.filter((x) => x !== d) : [...data.reminder.days, d].sort();
    data.reminder.days = days.length ? days : [d];
    reminderChanged();
  }
  function reminderChanged() {
    save();
    applyReminder();
  }
  const preview = $derived.by(() => {
    void data.decks;
    return reminderText();
  });

  // ----- updates -----
  let update = $state<UpdateResult | null>(null);
  let checking = $state(false);
  async function check() {
    checking = true;
    update = await checkForUpdate();
    checking = false;
  }

  // ----- AI connection -----
  const presets = aiPresets();
  const preset = $derived(presets.find((p) => p.id === data.ai.preset));
  let keyDraft = $state(aiState.key);
  let models = $state<string[]>([]);
  let aiNote = $state<{ ok: boolean; text: string } | null>(null);
  let testing = $state(false);

  function choosePreset(id: string) {
    const p = presets.find((x) => x.id === id);
    data.ai.preset = id;
    if (p && p.id !== 'custom') data.ai.baseUrl = p.baseUrl;
    data.ai.fastModel = '';
    data.ai.strongModel = '';
    models = [];
    aiNote = null;
    save();
  }

  async function connect() {
    testing = true;
    aiNote = null;
    const stored = await saveKey(keyDraft);
    try {
      models = await listModels();
      aiNote = {
        ok: true,
        text: models.length
          ? `Connected. ${models.length} models found; choose one below.`
          : 'Connected, but the service listed no models. Type a model name below.',
      };
      if (!stored) aiNote.text += ' The key could not be stored and will be needed again next time.';
    } catch (e) {
      aiNote = { ok: false, text: e instanceof Error ? e.message : 'The connection failed.' };
    } finally {
      testing = false;
    }
  }

  async function disconnect() {
    await saveKey('');
    keyDraft = '';
    Object.assign(data.ai, { preset: '', baseUrl: '', fastModel: '', strongModel: '' });
    models = [];
    aiNote = null;
    save();
  }

  let restoring = $state<Uint8Array | null>(null);
  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Backups from 0.3 and earlier were plain files with everything in them.
    if (/\.json$/i.test(file.name)) {
      note = importBackup(await file.text()) ? 'Backup restored.' : 'That file is not an Ankhwiz backup.';
      return;
    }
    restoring = new Uint8Array(await file.arrayBuffer());
    note = '';
  }
  async function finishRestore(replace: boolean) {
    const bytes = restoring;
    restoring = null;
    if (!bytes) return;
    busy = true;
    try {
      note = await restoreLibraryFile(bytes, replace);
    } catch (e) {
      note = e instanceof Error ? e.message : 'That file could not be restored.';
    } finally {
      busy = false;
    }
  }
  const lastBackup = $derived(
    data.lastBackup ? new Date(data.lastBackup).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
  );

  const simulated = $derived(
    new Date(now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  );
</script>

<section class="settings">
  {#if newer.found}
    <p class="update bad" role="alert">This device holds data from a newer Ankhwiz. It has been left untouched; update Ankhwiz to open it. Nothing you do here is saved.</p>
  {/if}
  <header>
    <button class="icon-btn" aria-label="Back" onclick={back}><Icon name="back" /></button>
    <h1 class="display">Settings</h1>
  </header>

  <div class="group">
    <p class="label">Appearance</p>
    <div class="seg" role="group" aria-label="Theme">
      {#each themes as [value, name] (value)}
        <button aria-pressed={data.settings.theme === value} onclick={() => setTheme(value)}>{name}</button>
      {/each}
    </div>
  </div>

  <div class="group">
    <p class="label">Thoth</p>
    <div class="seg" role="group" aria-label="Thoth">
      {#each modes as [value, name] (value)}
        <button aria-pressed={data.settings.thoth === value} onclick={() => setThoth(value)}>{name}</button>
      {/each}
    </div>
    <p class="hint">{modes.find((m) => m[0] === data.settings.thoth)?.[2]}</p>
    {#if data.settings.thoth !== 'hidden'}
      <div class="styles" role="radiogroup" aria-label="Portrait style">
        {#each STYLES as st (st.id)}
          {@const on = (data.settings.thothStyle ?? 'classic') === st.id}
          <button class="style" role="radio" aria-checked={on} onclick={() => setThothStyle(st.id)}>
            <span class="mini plain"><Thoth size={64} portrait look={st.id} /></span>
            <span><strong>{st.name}</strong><small>{st.hint}</small></span>
          </button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Thoth's movement">
        <button aria-pressed={data.settings.motion !== false} onclick={() => setMotion(true)}>Moves</button>
        <button aria-pressed={data.settings.motion === false} onclick={() => setMotion(false)}>Still</button>
      </div>
      <p class="hint">{data.settings.motion === false ? 'Thoth stays still.' : 'Thoth blinks, breathes and reacts to your answers. He also stays still if your system asks for reduced motion.'}</p>
    {/if}
  </div>

  <div class="group">
    <p class="label">Sounds</p>
    <div class="row plain">
      <label class="field grow">
        <span>Answer sounds</span>
        <select value={sounds} onchange={(e) => setSounds(e.currentTarget.value as SoundSet | 'off')}>
          {#each SOUND_SETS as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          <option value="off">Off</option>
        </select>
      </label>
      <button class="icon-btn play" aria-label="Hear the end of a lesson" disabled={sounds === 'off'} onclick={() => sounds !== 'off' && playFrom(sounds, 'end')}><Icon name="play" /></button>
    </div>
    <p class="hint">{soundAbout}</p>
  </div>

  <div class="group">
    <p class="label">Reading aloud</p>
    <div class="seg" role="group" aria-label="Read by itself">
      {#each reads as [value, name] (value)}
        <button aria-pressed={(data.settings.autoRead ?? 'off') === value} onclick={() => setAutoRead(value)}>{name}</button>
      {/each}
    </div>
    <p class="hint">
      {readAbout[data.settings.autoRead ?? 'off']}
      {canSpeak() ? 'This applies to decks with Read aloud turned on in their options.' : 'This device offers no voices here.'}
    </p>
  </div>

  <div class="group">
    <p class="label">Voices</p>
    <Voices />
  </div>

  <div class="group">
    <p class="label">Tour and tips</p>
    <label class="row plain">
      <span><strong>Feature tips</strong><small>Thoth explains Deck options, importing, the card editor, Test out and studying with him the first time you open each. The ? beside each explains it again.</small></span>
      <input type="checkbox" checked={data.settings.tips !== false} onchange={(e) => setTips(e.currentTarget.checked)} />
    </label>
    <div class="pair">
      <button class="quiet" onclick={replayTour}>Replay the welcome tour</button>
      <button class="quiet" onclick={() => ((tipsReset = true), resetTips())}>Show every tip again</button>
    </div>
    {#if tipsReset}<p class="hint" role="status">Each tip shows again the next time you open its part of the app.</p>{/if}
  </div>

  <div class="group">
    <p class="label">New decks</p>
    <div class="row plain">
      <span><strong>Lesson size</strong><small>New notes per lesson, {limits.minLesson} to {limits.maxLesson}. Each deck can also set its own.</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label="Smaller lessons" disabled={data.settings.lessonSize <= limits.minLesson} onclick={() => setLessonSize(data.settings.lessonSize - 1)}>−</button>
        <b>{data.settings.lessonSize}</b>
        <button class="icon-btn" aria-label="Larger lessons" disabled={data.settings.lessonSize >= limits.maxLesson} onclick={() => setLessonSize(data.settings.lessonSize + 1)}>+</button>
      </span>
    </div>
  </div>

  <div class="group">
    <p class="label">AI connection</p>
    <p class="hint">
      Optional. Connect a service of your own and Thoth can answer questions, draft cards, mark long answers and write
      reading passages. Without it, everything else works as before.
    </p>
    <label class="field">
      <span>Service</span>
      <select value={data.ai.preset} onchange={(e) => choosePreset(e.currentTarget.value)}>
        <option value="" disabled>Choose a service…</option>
        {#each presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
    {#if data.ai.preset}
      {#if preset?.note}<p class="hint">{preset.note}</p>{/if}
      <label class="field">
        <span>Address</span>
        <input type="url" bind:value={data.ai.baseUrl} onchange={() => save()} placeholder="https://…/v1" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>Key{preset && !preset.needsKey ? ' (if the service needs one)' : ''}</span>
        <input type="password" bind:value={keyDraft} autocomplete="off" spellcheck="false" />
      </label>
      <p class="hint">The key is kept in {secretHome()}. It is never written into decks or backups, and each device needs its own.</p>
      <div class="pair">
        <button class="quiet" disabled={testing || !data.ai.baseUrl.trim()} onclick={connect}>{testing ? 'Connecting…' : 'Connect and list models'}</button>
        <button class="quiet" onclick={disconnect}>Remove connection</button>
      </div>
      {#if aiNote}<p class="hint" role="status"><strong class:bad={!aiNote.ok}>{aiNote.text}</strong></p>{/if}
      <datalist id="models">{#each models as m (m)}<option value={m}></option>{/each}</datalist>
      <label class="field">
        <span>Model for quick jobs <small>explanations, marking, questions to Thoth</small></span>
        <input list="models" bind:value={data.ai.fastModel} onchange={() => save()} placeholder="Model name" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>Model for larger jobs <small>writing cards and passages; leave empty to use the same one</small></span>
        <input list="models" bind:value={data.ai.strongModel} onchange={() => save()} placeholder="Model name (optional)" autocomplete="off" spellcheck="false" />
      </label>
      {#if aiReady()}
        <p class="hint">
          {#if isLocal()}Requests go to a model on this computer; nothing leaves it.
          {:else}When you use an AI feature, the cards it needs and what you type are sent to {aiHost()}. Nothing is sent otherwise.{/if}
        </p>
      {/if}
      {#if platform() === 'browser'}
        <p class="hint">In a browser, some services refuse calls from web pages. The desktop and Android apps do not have that limit.</p>
      {/if}
    {/if}
  </div>

  <div class="group">
    <p class="label">Daily reminder</p>
    <div class="row plain">
      <span><strong>Remind me to study</strong><small>Only on days you haven’t studied yet</small></span>
      <button class="switch" role="switch" aria-checked={data.reminder.on} aria-label="Daily reminder" onclick={() => void setReminderOn(!data.reminder.on)}><span></span></button>
    </div>
    {#if data.reminder.on}
      <div class="rem plain">
        <label class="time">Time <input type="time" bind:value={data.reminder.time} onchange={reminderChanged} /></label>
        <div class="days" role="group" aria-label="Days">
          {#each DAYS as d, i (i)}
            <button class="day" aria-pressed={data.reminder.days.includes(i)} aria-label={DAY_NAMES[i]} onclick={() => toggleDay(i)}>{d}</button>
          {/each}
        </div>
        <p class="preview"><strong>Ankhwiz</strong> · {preview}</p>
        <p class="hint">
          {remindsNatively()
            ? 'The reminder comes even when Ankhwiz is closed. Android may deliver it a few minutes late to save battery.'
            : platform() === 'desktop'
              ? 'The reminder comes while Ankhwiz is open; it can be minimised.'
              : 'In a browser, the reminder comes only while this page is open.'}
        </p>
      </div>
    {/if}
    {#if reminderNote}<p class="hint bad" role="alert">{reminderNote}</p>{/if}
  </div>

  <div class="group">
    <p class="label">Your library</p>
    <input bind:this={picker} type="file" accept=".ankhlib,.json" hidden onchange={restore} />
    <p class="hint">One file with every deck, its pictures and sounds, your progress and your settings. Your AI key is never included.</p>
    <div class="pair">
      <button class="quiet" disabled={busy} onclick={download}><Icon name="download" size={18} /> {busy ? 'Working…' : 'Back up all'}</button>
      <button class="quiet" disabled={busy} onclick={() => picker?.click()}><Icon name="upload" size={18} /> Restore</button>
    </div>
    {#if restoring}
      <div class="choice plain" role="group" aria-label="How to restore">
        <p><strong>How should this backup come in?</strong></p>
        <button class="quiet" onclick={() => void finishRestore(false)}>Add the decks I don’t have</button>
        <button class="quiet danger" onclick={() => void finishRestore(true)}>Replace everything on this device</button>
        <button class="link" onclick={() => (restoring = null)}>Cancel</button>
      </div>
    {/if}
    {#if lastBackup}<p class="hint">Last backup: {lastBackup}</p>{/if}
    {#if note}<p class="hint" role="status"><strong>{note}</strong></p>{/if}
  </div>

  <div class="group">
    <p class="label">Updates</p>
    <div class="row plain">
      <span><strong>Ankhwiz {VERSION}</strong><small>{data.updates.atLaunch ? 'Also checked when Ankhwiz opens, once a day' : 'Checked only when you tap Check now'}</small></span>
      <button class="quiet" disabled={checking} onclick={check}>{checking ? 'Checking…' : 'Check now'}</button>
    </div>
    <div class="row plain">
      <span><strong>Check when Ankhwiz opens</strong><small>At most once a day; a new version shows what's new in it</small></span>
      <button class="switch" role="switch" aria-checked={!!data.updates.atLaunch} aria-label="Check for updates when Ankhwiz opens" onclick={() => setUpdateAtLaunch(!data.updates.atLaunch)}><span></span></button>
    </div>
    {#if update?.state === 'newer'}
      <div class="update ok" role="status">
        <p><strong>Ankhwiz {update.version} is available.</strong> <OutLink href={update.url}>Get it from GitHub</OutLink></p>
        {#if update.details}<WhatsNew notes={update.details} />{/if}
      </div>
    {:else if update?.state === 'current'}
      <p class="update" role="status">You have the latest version.</p>
    {:else if update?.state === 'none'}
      <p class="update" role="status">No releases have been published yet. <OutLink href={RELEASES}>Releases page</OutLink></p>
    {:else if update?.state === 'failed'}
      <p class="update" role="status">GitHub could not be reached. Try again later, or visit <OutLink href={RELEASES}>the releases page</OutLink>.</p>
    {/if}
    <p class="hint">Ankhwiz asks GitHub for the latest version number and sends nothing else.</p>
  </div>

  <div class="group">
    <p class="label">Testing</p>
    <div class="row plain">
      <span><strong>Pretend it is a later day</strong><small>The app's date: {simulated}{data.dayOffset ? ` (+${data.dayOffset})` : ''}</small></span>
      <span class="pair">
        {#if data.dayOffset}<button class="quiet" onclick={() => skipDays(0)}>Reset</button>{/if}
        <button class="quiet" onclick={() => skipDays(1)}>+1 day</button>
      </span>
    </div>
    <p class="hint">Cards need correct answers on separate days to move up. This lets you try that without waiting.</p>
  </div>

  <div class="group">
    <p class="label">Data</p>
    {#if confirmErase}
      <div class="pair">
        <button class="quiet" onclick={() => (confirmErase = false)}>Keep everything</button>
        <button class="quiet danger" onclick={() => void eraseAll()}>Erase all decks and progress</button>
      </div>
    {:else}
      <button class="quiet" onclick={() => (confirmErase = true)}>Erase everything on this device…</button>
    {/if}
  </div>

  <p class="about">
    Ankhwiz {VERSION} ({platform()}). Decks and progress stay on this device; there are no accounts or sync.
    The learning rules run in the shared Rust core. Scheduling uses the FSRS formulas until Anki's engine is attached.
  </p>
</section>

<style>
  .styles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .style {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    min-height: 84px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    text-align: left;
  }
  .style[aria-checked='true'] {
    border: 4px solid var(--brass);
    padding: 6px;
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .style > span:last-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .style small {
    font-size: 12px;
    font-weight: 400;
    opacity: 0.8;
  }
  .mini {
    flex: none;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  @media (max-width: 380px) {
    .styles {
      grid-template-columns: 1fr;
    }
  }
  .settings {
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding-block: 20px 40px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header h1 {
    font-size: 26px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint,
  .about,
  small {
    font-size: 14px;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }
  .row > span:first-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .row .play {
    align-self: flex-end;
    flex: none;
  }
  .stepper,
  .pair {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .stepper {
    flex: none;
    flex-wrap: nowrap;
  }
  .stepper b {
    min-width: 28px;
    text-align: center;
    font-size: 18px;
  }
  .stepper .icon-btn {
    font-size: 22px;
    font-weight: 600;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
  }
  .field small {
    font-weight: 400;
  }
  .field input,
  .field select {
    width: 100%;
    min-height: 46px;
    padding: 8px 12px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-weight: 400;
    border-radius: 0;
  }
  .field select {
    appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--text) 50%), linear-gradient(135deg, var(--text) 50%, transparent 50%);
    background-position: calc(100% - 20px) 50%, calc(100% - 14px) 50%;
    background-size: 6px 6px;
    background-repeat: no-repeat;
  }
  .bad {
    color: var(--off-line);
  }
  .danger {
    border-color: var(--off-line);
    color: var(--off-line);
  }
  .switch {
    flex: none;
    width: 52px;
    height: 30px;
    border-radius: 15px;
    border: 2px solid var(--line);
    background: var(--pip-off);
    position: relative;
    padding: 0;
  }
  .switch span {
    position: absolute;
    left: 3px;
    top: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface);
    border: 1.5px solid var(--line);
    transition: left 0.15s ease;
  }
  .switch[aria-checked='true'] {
    background: var(--emerald);
    border-color: var(--emerald);
  }
  .switch[aria-checked='true'] span {
    left: 25px;
  }
  .rem {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .time {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }
  .time input {
    min-height: 44px;
    padding: 0 10px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: 600 16px var(--body);
  }
  .days {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .day {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: 600 14px var(--body);
    padding: 0;
  }
  .day[aria-pressed='true'] {
    background: var(--emerald);
    border-color: var(--emerald);
    color: #fbf4e2;
  }
  .preview {
    margin: 0;
    padding: 10px 12px;
    border: 2px dashed var(--hair);
    font-size: 14px;
  }
  .choice {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .choice p {
    margin: 0;
  }
  .link {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--muted);
    text-decoration: underline;
    font: 400 14px var(--body);
  }
  .update {
    margin: 0;
    padding: 10px 12px;
    border: 2px solid var(--hair);
    font-size: 14px;
  }
  .update.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  div.update {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  div.update p {
    margin: 0;
  }
  .update.bad,
  .bad {
    color: var(--off-text);
  }
  .update.bad {
    border-color: var(--off-line);
    background: var(--off-bg);
  }
  .pair .quiet {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
</style>
