import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { loadKey } from './lib/ai.svelte';
import { startReminders } from './lib/reminders';
import { deckView } from './lib/core';
import { goBack, load, readAhead, saveNow } from './lib/store.svelte';

mount(App, { target: document.getElementById('app')! });
void load().then(() => {
  startReminders();
  readAhead((deck, progress) => void deckView(deck, progress));
  return loadKey();
});

// Called by the Android shell when the back button is pressed.
(window as unknown as { __ankhwizBack: () => boolean }).__ankhwizBack = goBack;

// Write anything waiting when the app goes to the background (Android may close it there).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveNow();
});
