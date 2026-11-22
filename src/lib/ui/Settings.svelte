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
    setAppLanguage,
    setAutoRead,
    setLessonSize,
    setThothChecks,
    setThothLanguage,
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
  import { APP_LANGUAGES, deviceLanguage, t } from '../i18n';

  // ----- language -----
  let langOpen = $state(false);
  // The AI services' names and notes come from the core in English.
  function presetText(s: string): string {
    switch (s) {
      case 'Ollama (this computer)': return t('Ollama (this computer)');
      case 'LM Studio (this computer)': return t('LM Studio (this computer)');
      case 'Other endpoint': return t('Other endpoint');
      case "Uses Gemini's OpenAI-compatible address.": return t("Uses Gemini's OpenAI-compatible address.");
      case 'One key for models from many providers.': return t('One key for models from many providers.');
      case 'Runs on your own machine; nothing leaves it.': return t('Runs on your own machine; nothing leaves it.');
      case 'Any address that speaks the OpenAI chat format.': return t('Any address that speaks the OpenAI chat format.');
      default: return s;
    }
  }
  const appLang = $derived(data.settings.appLang ?? 'system');
  const own = (code: string) => APP_LANGUAGES.find((l) => l.code === code);
  const langNow = $derived(appLang === 'system' ? { own: t('System default'), sub: t('{language}, from this device', { language: own(deviceLanguage())?.own ?? 'English' }) } : { own: own(appLang)?.own ?? appLang, sub: own(appLang)?.english ?? '' });

  const themes: [Theme, string][] = [
    ['system', t('System')],
    ['light', t('Light')],
    ['dark', t('Dark')],
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
    { id: 'classic', name: t('Classic'), hint: t('Gold and ink, as on the logo') },
    { id: 'bright', name: t('Bright Scribe'), hint: t('Rounder and friendlier') },
  ] as const;
  const modes: [ThothMode, string, string][] = [
    ['full', t('Full'), t('Thoth guides you during lessons and on the path.')],
    ['quiet', t('Quiet'), t('Thoth appears only when a lesson ends.')],
    ['hidden', t('Hidden'), t('No mascot. His advice stays as a plain Suggestions list.')],
  ];

  // ----- sounds and reading aloud -----
  const sounds = $derived(data.settings.sounds ?? DEFAULT_SOUNDS);
  const soundAbout = $derived(sounds === 'off' ? t('No sounds when you answer.') : t('{about}. Plays for right, nearly right and wrong answers, and at the end of a lesson.', { about: t(SOUND_SETS.find((s) => s.id === sounds)?.about ?? '') }));
  const reads: [AutoRead, string][] = [
    ['off', t('Off')],
    ['question', t('Question')],
    ['answer', t('Answer')],
    ['both', t('Both')],
  ];
  const readAbout: Record<AutoRead, string> = {
    off: t('Cards are read only when you tap a speaker button.'),
    question: t('Each question is read as its card opens.'),
    answer: t('The answer is read once you check it.'),
    both: t('The question as its card opens, and the answer once you check it.'),
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
      note = e instanceof Error ? t(e.message) : t('The backup could not be made.');
    } finally {
      busy = false;
    }
  }

  // ----- reminder -----
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAMES = [t('Sunday'), t('Monday'), t('Tuesday'), t('Wednesday'), t('Thursday'), t('Friday'), t('Saturday')];
  let reminderNote = $state('');
  async function setReminderOn(on: boolean) {
    if (on && !(await askNotifications())) {
      reminderNote = t('Notifications are turned off for Ankhwiz. Allow them in your system settings, then try again.');
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
          ? t('Connected. {modelsCount} models found; choose one below.', { modelsCount: models.length })
          : t('Connected, but the service listed no models. Type a model name below.'),
      };
      if (!stored) aiNote.text += t(' The key could not be stored and will be needed again next time.');
    } catch (e) {
      aiNote = { ok: false, text: e instanceof Error ? t(e.message) : t('The connection failed.') };
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
      note = importBackup(await file.text()) ? t('Backup restored.') : t('That file is not an Ankhwiz backup.');
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
      note = e instanceof Error ? t(e.message) : t('That file could not be restored.');
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
    <p class="update bad" role="alert">{t('This device holds data from a newer Ankhwiz. It has been left untouched; update Ankhwiz to open it. Nothing you do here is saved.')}</p>
  {/if}
  <header>
    <button class="icon-btn" aria-label={t('Back')} onclick={back}><Icon name="back" /></button>
    <h1 class="display">{t('Settings')}</h1>
  </header>

  <div class="group">
    <p class="label">{t('Language')}</p>
    <div class="plain lang-box">
      <span class="lang-title">{t('App language')}</span>
      <button class="lang-btn" aria-expanded={langOpen} aria-haspopup="listbox" onclick={() => (langOpen = !langOpen)}>
        <span class="grow"><strong>{langNow.own}</strong><small>{langNow.sub}</small></span>
        <Icon name="down" size={16} />
      </button>
      {#if langOpen}
        <div class="lang-list" role="listbox" aria-label={t('App language')}>
          <button role="option" aria-selected={appLang === 'system'} onclick={() => ((langOpen = false), setAppLanguage('system'))}>
            <span class="grow"><span>{t('System default')}</span><small>{t('{language}, from this device', { language: own(deviceLanguage())?.own ?? t('English') })}</small></span>
            {#if appLang === 'system'}<Icon name="check" size={18} />{/if}
          </button>
          {#each APP_LANGUAGES as l (l.code)}
            <button role="option" lang={l.code} aria-selected={appLang === l.code} onclick={() => ((langOpen = false), setAppLanguage(l.code))}>
              <span class="grow"><span>{l.own}</span><small lang="en">{l.english}</small></span>
              {#if appLang === l.code}<Icon name="check" size={18} />{/if}
            </button>
          {/each}
          <p class="hint later">{t('More languages, including right-to-left ones, are planned for a later update.')}</p>
        </div>
      {/if}
      <label class="field">
        <span>{t('Thoth replies in')}</span>
        <select value={data.settings.thothLang ?? 'app'} onchange={(e) => setThothLanguage(e.currentTarget.value)}>
          <option value="app">{t('Same as the app')}</option>
          {#each APP_LANGUAGES as l (l.code)}<option value={l.code}>{l.own}</option>{/each}
        </select>
      </label>
      <p class="hint">{t('Cards are never translated: only Ankhwiz’s own buttons and text, and what Thoth says.')}</p>
    </div>
  </div>

  <div class="group">
    <p class="label">{t('Appearance')}</p>
    <div class="seg" role="group" aria-label={t('Theme')}>
      {#each themes as [value, name] (value)}
        <button aria-pressed={data.settings.theme === value} onclick={() => setTheme(value)}>{name}</button>
      {/each}
    </div>
  </div>

  <div class="group">
    <p class="label">{t('Thoth')}</p>
    <div class="seg" role="group" aria-label={t('Thoth')}>
      {#each modes as [value, name] (value)}
        <button aria-pressed={data.settings.thoth === value} onclick={() => setThoth(value)}>{name}</button>
      {/each}
    </div>
    <p class="hint">{modes.find((m) => m[0] === data.settings.thoth)?.[2]}</p>
    {#if data.settings.thoth !== 'hidden'}
      <div class="styles" role="radiogroup" aria-label={t('Portrait style')}>
        {#each STYLES as st (st.id)}
          {@const on = (data.settings.thothStyle ?? 'classic') === st.id}
          <button class="style" role="radio" aria-checked={on} onclick={() => setThothStyle(st.id)}>
            <span class="mini plain"><Thoth size={64} portrait look={st.id} /></span>
            <span><strong>{st.name}</strong><small>{st.hint}</small></span>
          </button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label={t('Thoth\'s movement')}>
        <button aria-pressed={data.settings.motion !== false} onclick={() => setMotion(true)}>{t('Moves')}</button>
        <button aria-pressed={data.settings.motion === false} onclick={() => setMotion(false)}>{t('Still')}</button>
      </div>
      <p class="hint">{data.settings.motion === false ? t('Thoth stays still.') : t('Thoth blinks, breathes and reacts to your answers. He also stays still if your system asks for reduced motion.')}</p>
    {/if}
  </div>

  <div class="group">
    <p class="label">{t('Sounds')}</p>
    <div class="row plain">
      <label class="field grow">
        <span>{t('Answer sounds')}</span>
        <select value={sounds} onchange={(e) => setSounds(e.currentTarget.value as SoundSet | 'off')}>
          {#each SOUND_SETS as s (s.id)}<option value={s.id}>{t(s.name)}</option>{/each}
          <option value="off">{t('Off')}</option>
        </select>
      </label>
      <button class="icon-btn play" aria-label={t('Hear the end of a lesson')} disabled={sounds === 'off'} onclick={() => sounds !== 'off' && playFrom(sounds, 'end')}><Icon name="play" /></button>
    </div>
    <p class="hint">{soundAbout}</p>
  </div>

  <div class="group">
    <p class="label">{t('Reading aloud')}</p>
    <div class="seg" role="group" aria-label={t('Read by itself')}>
      {#each reads as [value, name] (value)}
        <button aria-pressed={(data.settings.autoRead ?? 'off') === value} onclick={() => setAutoRead(value)}>{name}</button>
      {/each}
    </div>
    <p class="hint">
      {readAbout[data.settings.autoRead ?? 'off']}
      {canSpeak() ? t('This applies to decks with Read aloud turned on in their options.') : t('This device offers no voices here.')}
    </p>
  </div>

  <div class="group">
    <p class="label">{t('Voices')}</p>
    <Voices />
  </div>

  <div class="group">
    <p class="label">{t('Tour and tips')}</p>
    <label class="row plain">
      <span><strong>{t('Feature tips')}</strong><small>{t('Thoth explains Deck options, importing, the card editor, Test out and studying with him the first time you open each. The ? beside each explains it again.')}</small></span>
      <input type="checkbox" checked={data.settings.tips !== false} onchange={(e) => setTips(e.currentTarget.checked)} />
    </label>
    <div class="pair">
      <button class="quiet" onclick={replayTour}>{t('Replay the welcome tour')}</button>
      <button class="quiet" onclick={() => ((tipsReset = true), resetTips())}>{t('Show every tip again')}</button>
    </div>
    {#if tipsReset}<p class="hint" role="status">{t('Each tip shows again the next time you open its part of the app.')}</p>{/if}
  </div>

  <div class="group">
    <p class="label">{t('New decks')}</p>
    <div class="row plain">
      <span><strong>{t('Lesson size')}</strong><small>{t('New notes per lesson, {minLesson} to {maxLesson}. Each deck can also set its own.', { minLesson: limits.minLesson, maxLesson: limits.maxLesson })}</small></span>
      <span class="stepper">
        <button class="icon-btn" aria-label={t('Smaller lessons')} disabled={data.settings.lessonSize <= limits.minLesson} onclick={() => setLessonSize(data.settings.lessonSize - 1)}>−</button>
        <b>{data.settings.lessonSize}</b>
        <button class="icon-btn" aria-label={t('Larger lessons')} disabled={data.settings.lessonSize >= limits.maxLesson} onclick={() => setLessonSize(data.settings.lessonSize + 1)}>+</button>
      </span>
    </div>
  </div>

  <div class="group">
    <p class="label">{t('AI connection')}</p>
    <p class="hint">
      {t('Optional. Connect a service of your own and Thoth can answer questions, draft cards, mark long answers and write reading passages. Without it, everything else works as before.')}
    </p>
    <label class="field">
      <span>{t('Service')}</span>
      <select value={data.ai.preset} onchange={(e) => choosePreset(e.currentTarget.value)}>
        <option value="" disabled>{t('Choose a service…')}</option>
        {#each presets as p (p.id)}<option value={p.id}>{presetText(p.name)}</option>{/each}
      </select>
    </label>
    {#if data.ai.preset}
      {#if preset?.note}<p class="hint">{presetText(preset.note)}</p>{/if}
      <label class="field">
        <span>{t('Address')}</span>
        <input type="url" bind:value={data.ai.baseUrl} onchange={() => save()} placeholder={t('https://…/v1')} autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>{t('Key{x}', { x: preset && !preset.needsKey ? t(' (if the service needs one)') : '' })}</span>
        <input type="password" bind:value={keyDraft} autocomplete="off" spellcheck="false" />
      </label>
      <p class="hint">{t('The key is kept in {x}. It is never written into decks or backups, and each device needs its own.', { x: secretHome() })}</p>
      <div class="pair">
        <button class="quiet" disabled={testing || !data.ai.baseUrl.trim()} onclick={connect}>{testing ? t('Connecting…') : t('Connect and list models')}</button>
        <button class="quiet" onclick={disconnect}>{t('Remove connection')}</button>
      </div>
      {#if aiNote}<p class="hint" role="status"><strong class:bad={!aiNote.ok}>{aiNote.text}</strong></p>{/if}
      <datalist id="models">{#each models as m (m)}<option value={m}></option>{/each}</datalist>
      <label class="field">
        <span>{t('Model for quick jobs')} <small>{t('explanations, marking, questions to Thoth')}</small></span>
        <input list="models" bind:value={data.ai.fastModel} onchange={() => save()} placeholder={t('Model name')} autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>{t('Model for larger jobs')} <small>{t('writing cards and passages; leave empty to use the same one')}</small></span>
        <input list="models" bind:value={data.ai.strongModel} onchange={() => save()} placeholder={t('Model name (optional)')} autocomplete="off" spellcheck="false" />
      </label>
      {#if aiReady()}
        <p class="hint">
          {#if isLocal()}{t('Requests go to a model on this computer; nothing leaves it.')}
          {:else}{t('When you use an AI feature, the cards it needs and what you type are sent to {x}. Nothing is sent otherwise.', { x: aiHost() })}{/if}
        </p>
      {/if}
      {#if aiReady()}
        <label class="row plain">
          <span><strong>{t('Check typed answers that don’t match')}</strong><small>{t('When a typed answer matches none of a card’s answers, Thoth decides whether it is fair all the same. If it is, it counts and is accepted from then on.')}</small></span>
          <input type="checkbox" checked={data.settings.thothChecks !== false} onchange={(e) => setThothChecks(e.currentTarget.checked)} />
        </label>
      {/if}
      {#if platform() === 'browser'}
        <p class="hint">{t('In a browser, some services refuse calls from web pages. The desktop and Android apps do not have that limit.')}</p>
      {/if}
    {/if}
  </div>

  <div class="group">
    <p class="label">{t('Daily reminder')}</p>
    <div class="row plain">
      <span><strong>{t('Remind me to study')}</strong><small>{t('Only on days you haven’t studied yet')}</small></span>
      <button class="switch" role="switch" aria-checked={data.reminder.on} aria-label={t('Daily reminder')} onclick={() => void setReminderOn(!data.reminder.on)}><span></span></button>
    </div>
    {#if data.reminder.on}
      <div class="rem plain">
        <label class="time">{t('Time')} <input type="time" bind:value={data.reminder.time} onchange={reminderChanged} /></label>
        <div class="days" role="group" aria-label={t('Days')}>
          {#each DAYS as d, i (i)}
            <button class="day" aria-pressed={data.reminder.days.includes(i)} aria-label={DAY_NAMES[i]} onclick={() => toggleDay(i)}>{d}</button>
          {/each}
        </div>
        <p class="preview"><strong>{t('Ankhwiz')}</strong> · {preview}</p>
        <p class="hint">
          {remindsNatively()
            ? t('The reminder comes even when Ankhwiz is closed. Android may deliver it a few minutes late to save battery.')
            : platform() === 'desktop'
              ? t('The reminder comes while Ankhwiz is open; it can be minimised.')
              : t('In a browser, the reminder comes only while this page is open.')}
        </p>
      </div>
    {/if}
    {#if reminderNote}<p class="hint bad" role="alert">{reminderNote}</p>{/if}
  </div>

  <div class="group">
    <p class="label">{t('Your library')}</p>
    <input bind:this={picker} type="file" accept=".ankhlib,.json" hidden onchange={restore} />
    <p class="hint">{t('One file with every deck, its pictures and sounds, your progress and your settings. Your AI key is never included.')}</p>
    <div class="pair">
      <button class="quiet" disabled={busy} onclick={download}><Icon name="download" size={18} /> {busy ? t('Working…') : t('Back up all')}</button>
      <button class="quiet" disabled={busy} onclick={() => picker?.click()}><Icon name="upload" size={18} /> {t('Restore')}</button>
    </div>
    {#if restoring}
      <div class="choice plain" role="group" aria-label={t('How to restore')}>
        <p><strong>{t('How should this backup come in?')}</strong></p>
        <button class="quiet" onclick={() => void finishRestore(false)}>{t('Add the decks I don’t have')}</button>
        <button class="quiet danger" onclick={() => void finishRestore(true)}>{t('Replace everything on this device')}</button>
        <button class="link" onclick={() => (restoring = null)}>{t('Cancel')}</button>
      </div>
    {/if}
    {#if lastBackup}<p class="hint">{t('Last backup: {lastBackup}', { lastBackup })}</p>{/if}
    {#if note}<p class="hint" role="status"><strong>{note}</strong></p>{/if}
  </div>

  <div class="group">
    <p class="label">{t('Updates')}</p>
    <div class="row plain">
      <span><strong>{t('Ankhwiz {VERSION}', { VERSION })}</strong><small>{data.updates.atLaunch ? t('Also checked when Ankhwiz opens, once a day') : t('Checked only when you tap Check now')}</small></span>
      <button class="quiet" disabled={checking} onclick={check}>{checking ? t('Checking…') : t('Check now')}</button>
    </div>
    <div class="row plain">
      <span><strong>{t('Check when Ankhwiz opens')}</strong><small>{t('At most once a day; a new version shows what\'s new in it')}</small></span>
      <button class="switch" role="switch" aria-checked={!!data.updates.atLaunch} aria-label={t('Check for updates when Ankhwiz opens')} onclick={() => setUpdateAtLaunch(!data.updates.atLaunch)}><span></span></button>
    </div>
    {#if update?.state === 'newer'}
      <div class="update ok" role="status">
        <p><strong>{t('Ankhwiz {version} is available.', { version: update.version })}</strong> <OutLink href={update.url}>{t('Get it from GitHub')}</OutLink></p>
        {#if update.details}<WhatsNew notes={update.details} />{/if}
      </div>
    {:else if update?.state === 'current'}
      <p class="update" role="status">{t('You have the latest version.')}</p>
    {:else if update?.state === 'none'}
      <p class="update" role="status">{t('No releases have been published yet.')} <OutLink href={RELEASES}>{t('Releases page')}</OutLink></p>
    {:else if update?.state === 'failed'}
      <p class="update" role="status">{t('GitHub could not be reached. Try again later, or visit')} <OutLink href={RELEASES}>{t('the releases page')}</OutLink>.</p>
    {/if}
    <p class="hint">{t('Ankhwiz asks GitHub for the latest version number and sends nothing else.')}</p>
  </div>

  <div class="group">
    <p class="label">{t('Testing')}</p>
    <div class="row plain">
      <span><strong>{t('Pretend it is a later day')}</strong><small>{t('The app\'s date: {simulated}{x}', { simulated, x: data.dayOffset ? ` (+${data.dayOffset})` : '' })}</small></span>
      <span class="pair">
        {#if data.dayOffset}<button class="quiet" onclick={() => skipDays(0)}>{t('Reset')}</button>{/if}
        <button class="quiet" onclick={() => skipDays(1)}>{t('+1 day')}</button>
      </span>
    </div>
    <p class="hint">{t('Cards need correct answers on separate days to move up. This lets you try that without waiting.')}</p>
  </div>

  <div class="group">
    <p class="label">{t('Data')}</p>
    {#if confirmErase}
      <div class="pair">
        <button class="quiet" onclick={() => (confirmErase = false)}>{t('Keep everything')}</button>
        <button class="quiet danger" onclick={() => void eraseAll()}>{t('Erase all decks and progress')}</button>
      </div>
    {:else}
      <button class="quiet" onclick={() => (confirmErase = true)}>{t('Erase everything on this device…')}</button>
    {/if}
  </div>

  <p class="about">
    {t('Ankhwiz {VERSION} ({x}). Decks and progress stay on this device; there are no accounts or sync. The learning rules run in the shared Rust core. Scheduling uses the FSRS formulas until Anki\'s engine is attached.', { VERSION, x: platform() })}
  </p>
</section>

<style>
  .lang-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .lang-title {
    font-weight: 700;
  }
  .lang-btn,
  .lang-list button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 4px 12px;
    border: 2px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lang-list {
    display: flex;
    flex-direction: column;
    max-height: 420px;
    overflow-y: auto;
    border: 2px solid var(--line);
  }
  .lang-list button {
    border: 0;
    border-bottom: 1px solid var(--hair);
    background: var(--surface);
  }
  .lang-list button[aria-selected='true'] {
    background: var(--sel-bg);
    color: var(--sel-text);
    font-weight: 700;
  }
  .lang-btn .grow,
  .lang-list .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .lang-btn small,
  .lang-list small {
    color: var(--muted);
    font-size: 13px;
    font-weight: 400;
  }
  .later {
    padding: 8px 12px;
  }
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
