<script lang="ts">
  import { aiHost, aiReady, aiState, isLocal, listModels, saveKey } from '../ai.svelte';
  import { aiPresets, limits } from '../core';
  import type { ThothMode } from '../core/thoth';
  import { platform, saveFile, secretHome } from '../platform';
  import {
    data,
    eraseAll,
    exportBackup,
    importBackup,
    now,
    save,
    setLessonSize,
    setTheme,
    setThoth,
    skipDays,
    ui,
    type Theme,
  } from '../store.svelte';
  import Icon from './Icon.svelte';

  const themes: [Theme, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];
  const modes: [ThothMode, string, string][] = [
    ['full', 'Full', 'Thoth guides you during lessons and on the path.'],
    ['quiet', 'Quiet', 'Thoth appears only when a lesson ends.'],
    ['hidden', 'Hidden', 'No mascot. His advice stays as a plain Suggestions list.'],
  ];

  let confirmErase = $state(false);
  let note = $state('');
  let picker = $state<HTMLInputElement>();

  function back() {
    ui.screen = ui.deckId && data.decks[ui.deckId] ? 'deck' : 'library';
  }

  async function download() {
    const day = new Date().toISOString().slice(0, 10);
    note = await saveFile(`ankhwiz-backup-${day}.json`, exportBackup());
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

  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    note = importBackup(await file.text()) ? 'Backup restored.' : 'That file is not an Ankhwiz backup.';
  }

  const simulated = $derived(
    new Date(now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  );
</script>

<section class="settings">
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
        <input type="url" bind:value={data.ai.baseUrl} onchange={save} placeholder="https://…/v1" autocomplete="off" spellcheck="false" />
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
        <input list="models" bind:value={data.ai.fastModel} onchange={save} placeholder="Model name" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span>Model for larger jobs <small>writing cards and passages; leave empty to use the same one</small></span>
        <input list="models" bind:value={data.ai.strongModel} onchange={save} placeholder="Model name (optional)" autocomplete="off" spellcheck="false" />
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
    <p class="label">Backup</p>
    <input bind:this={picker} type="file" accept=".json,application/json" hidden onchange={restore} />
    <div class="pair">
      <button class="quiet" onclick={download}>Save a backup</button>
      <button class="quiet" onclick={() => picker?.click()}>Restore a backup</button>
    </div>
    <p class="hint">A backup holds every deck and your progress. It is a plain file for now; the .ankh format comes later.</p>
    {#if note}<p class="hint" role="status"><strong>{note}</strong></p>{/if}
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
    Ankhwiz 0.3 ({platform()}). Decks and progress stay on this device; there are no accounts or sync.
    The learning rules run in the shared Rust core. Scheduling uses the FSRS formulas until Anki's engine is attached.
  </p>
</section>

<style>
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
</style>
