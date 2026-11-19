<script lang="ts">
  // Settings › Voices: for each language the learner's decks read aloud, the
  // device's own voice or a downloaded Piper voice; on Android, which of the
  // phone's speech engines reads.
  import { downloadedVoices, downloadVoice, piperVoicesFor, removeVoice, PIPER_VOICES } from '../piper';
  import { deviceVoiceNames, hasVoice, openSpeechSettings, setSpeechEngine, speak, speechEngines, voiceHelp, type SpeechEngines } from '../speech';
  import { flagOf, langName, nativeName, sameLang, tidyLang } from '../languages';
  import LangPicker from './LangPicker.svelte';
  import { data, setPiperVoice } from '../store.svelte';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';

  /** Languages read aloud by the learner's decks, as written in their options, and any added here. */
  let added = $state<string[]>([]);
  const langs = $derived.by(() => {
    const out = new Map<string, string>();
    for (const d of Object.values(data.decks)) {
      if (d.options.look.speak === 'off') continue;
      const l = d.options.look;
      for (const x of [l.lang, l.langBack, l.quoteLang]) if (x) out.set(tidyLang(x).toLowerCase(), tidyLang(x));
      for (const n of Object.values(d.notes)) for (const v of n.voices ?? []) out.set(tidyLang(v.lang).toLowerCase(), tidyLang(v.lang));
    }
    for (const x of added) out.set(x.toLowerCase(), x);
    return [...out.values()];
  });
  // The device's own voices for each language, by name where the device lists them.
  let device = $state<Record<string, { names: string[]; ready: boolean | null }>>({});
  $effect(() => {
    const list = langs;
    let live = true;
    void Promise.all(list.map(async (l) => [l, { names: await deviceVoiceNames(l), ready: await hasVoice(l) }] as const)).then((r) => {
      if (live) device = Object.fromEntries(r);
    });
    return () => {
      live = false;
    };
  });

  let have = $state<string[]>([]);
  void downloadedVoices().then((v) => (have = v));
  /** The voice picked in each language's list, before it is downloaded. */
  let picking = $state<Record<string, string>>({});
  let busy = $state<{ lang: string; done: number; total: number } | null>(null);
  let error = $state('');

  const chosen = (lang: string) => data.settings.piperVoices?.[lang.replace('_', '-').toLowerCase()] ?? '';
  const shown = (lang: string) => picking[lang] ?? (chosen(lang) || 'device');
  const sample = (lang: string) => {
    const base = lang.split('-')[0];
    return { es: 'Hola, ¿qué tal?', fr: 'Bonjour, comment ça va ?', de: 'Hallo, wie geht es dir?', it: 'Ciao, come stai?', pt: 'Olá, tudo bem?', nl: 'Hallo, hoe gaat het?', ru: 'Привет, как дела?', zh: '你好，你好吗？', ja: 'こんにちは', tr: 'Merhaba, nasılsın?', pl: 'Cześć, jak się masz?' }[base] ?? 'Hello, how are you?';
  };

  function pick(lang: string, value: string) {
    error = '';
    if (value === 'device') {
      picking = { ...picking, [lang]: value };
      setPiperVoice(lang, null);
    } else if (have.includes(value)) {
      picking = { ...picking, [lang]: value };
      setPiperVoice(lang, value);
    } else picking = { ...picking, [lang]: value };
  }

  async function download(lang: string, id: string) {
    error = '';
    busy = { lang, done: 0, total: 1 };
    try {
      await downloadVoice(id, (done, total) => (busy = { lang, done, total }));
      have = await downloadedVoices();
      setPiperVoice(lang, id);
    } catch (e) {
      error = `${e instanceof Error ? e.message : 'The voice could not be downloaded.'} Check the connection and try again.`;
    } finally {
      busy = null;
    }
  }

  async function remove(lang: string, id: string) {
    await removeVoice(id);
    have = await downloadedVoices();
    for (const [l, v] of Object.entries(data.settings.piperVoices ?? {})) if (v === id) setPiperVoice(l, null);
    picking = { ...picking, [lang]: 'device' };
  }

  // Android: the phone's speech engines.
  let engines = $state<SpeechEngines | null>(speechEngines());
  function chooseEngine(name: string) {
    setSpeechEngine(name);
    engines = engines ? { ...engines, chosen: name } : engines;
  }
</script>

<div class="voices">
  {#if engines && engines.engines.length > 1}
    <label class="row">
      <span><strong>Speech engine</strong><small>Which of the phone's engines reads, such as Google's or one with downloadable voices</small></span>
      <select aria-label="Speech engine" value={engines.chosen} onchange={(e) => chooseEngine(e.currentTarget.value)}>
        <option value="">Phone's default</option>
        {#each engines.engines as e (e.name)}<option value={e.name}>{e.label}</option>{/each}
      </select>
    </label>
  {/if}
  {#if engines}
    <button class="quiet" onclick={() => openSpeechSettings()}><Icon name="gear" size={18} /> Add voices in the phone's settings</button>
  {/if}

  {#if !langs.length}
    <p class="hint">Turn on Read aloud in a deck's options and give its languages; then a voice can be chosen for each here.</p>
  {:else}
    {#each langs as lang (lang)}
      {@const options = piperVoicesFor(lang)}
      {@const value = shown(lang)}
      {@const v = PIPER_VOICES.find((x) => x.id === value)}
      <div class="lang">
        <label class="row">
          <span class="who">
            <span class="flag big" aria-hidden="true">{flagOf(lang) || '🌐'}</span>
            <span><strong>{langName(lang)}</strong><small>{nativeName(lang) ? `${nativeName(lang)} · ` : ''}{lang} · {chosen(lang) ? 'a downloaded voice' : "this device's own voice"}</small></span>
          </span>
          <select aria-label="Voice for {langName(lang)}" {value} disabled={!!busy} onchange={(e) => pick(lang, e.currentTarget.value)}>
            <option value="device">Device voice</option>
            {#each options as o (o.id)}<option value={o.id}>{o.name}{o.lang.toLowerCase() !== lang.toLowerCase() ? ` (${o.lang})` : ''}{have.includes(o.id) ? ' · downloaded' : ` · ${o.mb} MB`}</option>{/each}
          </select>
        </label>
        {#if busy?.lang === lang}
          <ProgressBar label={`Downloading ${Math.round(busy.done)} of about ${busy.total} MB`} value={busy.done / busy.total} />
        {:else if v && !have.includes(v.id)}
          <button class="quiet strong" onclick={() => download(lang, v.id)}><Icon name="download" size={18} /> Download {v.name} (about {v.mb + (have.length ? 0 : 30)} MB)</button>
          {#if !have.length}<p class="hint">The first voice also brings the voice engine, about 30 MB, used by every downloaded voice.</p>{/if}
        {:else if v}
          <div class="pair">
            <button class="quiet" onclick={() => speak(sample(lang), lang)}><Icon name="sound" size={18} /> Try</button>
            <button class="quiet" onclick={() => remove(lang, v.id)}>Remove download</button>
          </div>
        {:else}
          <button class="quiet try" onclick={() => speak(sample(lang), lang)}><Icon name="sound" size={18} /> Try</button>
        {/if}
        {#if device[lang]?.names.length}
          <p class="hint">On this device: {device[lang].names.join(', ')}</p>
        {:else if device[lang] && device[lang].ready === false && !chosen(lang)}
          <p class="hint warn">No voice for {langName(lang)} on this device yet. {options.length ? 'Download one above, or add one in the system: ' : ''}{voiceHelp()}</p>
        {/if}
        {#if !options.length}<p class="hint">Ankhwiz has no downloadable voice for {langName(lang)} yet.</p>{/if}
      </div>
    {/each}
    {#if error}<p class="hint bad" role="alert">{error}</p>{/if}
    <p class="hint">Downloaded voices are Piper voices: they sound more natural than many built-in ones, run on this device and work offline once downloaded. They come from the Piper project on Hugging Face.</p>
  {/if}
  <div class="add">
    <strong>Find a voice for another language</strong>
    <LangPicker label="Find a voice for a language" value="" emptyLabel="Search for a language" onPick={(c) => c && !langs.some((l) => sameLang(l, c)) && (added = [...added, c])} />
  </div>
</div>

<style>
  .voices {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lang {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1.5px solid var(--hair);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .row > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row > .who {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
  .who > span:last-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .flag.big {
    font-size: 26px;
    width: 1.3em;
    text-align: center;
    flex: none;
  }
  .warn {
    color: var(--close-text);
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1.5px solid var(--hair);
  }
  .row small,
  .hint {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
  }
  .bad {
    color: var(--off-text);
  }
  select {
    max-width: 55%;
    min-height: 44px;
    padding: 6px 10px;
    border: 2px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    color: var(--text);
  }
  .pair {
    display: flex;
    gap: 10px;
  }
  .quiet {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .strong {
    font-weight: 600;
  }
  .pair button {
    flex: 1;
  }
  .try {
    align-self: flex-start;
    padding: 0 14px;
  }
</style>
