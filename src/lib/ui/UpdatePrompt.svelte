<script lang="ts">
  // Updates when Ankhwiz opens. Once, it asks whether to look for new versions
  // at launch; if the learner says yes, it checks at most once a day and shows
  // what's new when a newer version is out. Never in a browser, which always
  // has the latest page.
  import { platform } from '../platform';
  import { data, setUpdateAtLaunch, skipVersion, ui } from '../store.svelte';
  import { checkForUpdate, dueAtLaunch, VERSION, type UpdateResult } from '../updates';
  import Icon from './Icon.svelte';
  import WhatsNew from './WhatsNew.svelte';

  let found = $state<Extract<UpdateResult, { state: 'newer' }> | null>(null);
  let hidden = $state(false);
  const installed = platform() !== 'browser';
  // Ask only once the learner has a deck, so the first launch is not a wall of questions.
  const asking = $derived(installed && !hidden && data.updates.atLaunch === undefined && Object.keys(data.decks).length > 0 && !ui.session);

  let started = false;
  $effect(() => {
    if (started || !installed || !ui.ready || !dueAtLaunch()) return;
    started = true;
    void checkForUpdate().then((r) => {
      if (r.state === 'newer' && r.version !== data.updates.skipped) found = r;
    });
  });

  function answer(on: boolean) {
    setUpdateAtLaunch(on);
    hidden = true;
    if (on && !started) {
      started = true;
      void checkForUpdate().then((r) => {
        if (r.state === 'newer' && r.version !== data.updates.skipped) found = r;
      });
    }
  }
</script>

{#if found && !ui.session}
  <div class="veil" role="presentation"></div>
  <div class="prompt plain" role="dialog" aria-modal="true" aria-labelledby="update-title">
    <p class="label">Update</p>
    <h2 id="update-title" class="display">Ankhwiz {found.version} is out</h2>
    <p class="sub">You have {VERSION}. What's new:</p>
    <WhatsNew notes={found.details || found.notes} />
    <div class="actions">
      <a class="primary link" href={found.url} target="_blank" rel="noopener" onclick={() => (found = null)}>Get it</a>
      <button class="quiet" onclick={() => (found = null)}>Later</button>
      <button class="quiet" onclick={() => (skipVersion(found!.version), (found = null))}>Skip this version</button>
    </div>
  </div>
{:else if asking}
  <div class="ask plain" role="region" aria-label="Updates">
    <Icon name="info" size={20} />
    <p><strong>Look for new versions when Ankhwiz opens?</strong> <span>Once a day at most. It asks GitHub for the latest version number and sends nothing else. You can change this in Settings.</span></p>
    <div class="pair">
      <button class="quiet" onclick={() => answer(false)}>No thanks</button>
      <button class="quiet yes" onclick={() => answer(true)}>Yes</button>
    </div>
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    background: rgba(31, 26, 20, 0.45);
    z-index: 40;
  }
  .prompt {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--surface);
  }
  .prompt .label {
    margin: 0;
  }
  h2 {
    margin: 0;
    font-size: 24px;
  }
  .sub {
    margin: 0;
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .actions > * {
    flex: 1 1 120px;
    min-height: 48px;
  }
  .link {
    display: grid;
    place-items: center;
    text-decoration: none;
  }
  .ask {
    position: fixed;
    z-index: 30;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px 10px;
    background: var(--surface);
  }
  .ask p {
    flex: 1 1 260px;
    margin: 0;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ask p span {
    color: var(--muted);
  }
  .pair {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .pair button {
    min-height: 40px;
    padding: 0 14px;
  }
  .yes {
    border-color: var(--emerald);
  }
</style>
