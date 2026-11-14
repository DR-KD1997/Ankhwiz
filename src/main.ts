import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { loadKey } from './lib/ai.svelte';
import { startReminders } from './lib/reminders';
import { goBack, load } from './lib/store.svelte';

mount(App, { target: document.getElementById('app')! });
void load().then(() => {
  startReminders();
  return loadKey();
});

// Called by the Android shell when the back button is pressed.
(window as unknown as { __ankhwizBack: () => boolean }).__ankhwizBack = goBack;
