// The daily reminder: a nudge at a chosen time, on chosen days, and only on
// days nothing has been studied yet.
//
// On Android the shell keeps an alarm, so the reminder comes even when the
// app is closed; the interface only tells it the settings, what to say, and
// when something was studied. On desktop and in a browser the reminder can
// only come while Ankhwiz is open (it may be minimised): the interface checks
// the time once a minute.

import { lessonQueue, reviewQueue, today } from './core';
import { markStudiedNative, notify, remindsNatively, setNativeReminder } from './platform';
import { data, deckLoaded, now, onStudied, quickCounts, snap } from './store.svelte';

const NOTIFIED = 'ankhwiz-reminded';

/** What the reminder says: the next lesson, or how many reviews are due. */
export function reminderText(): string {
  let due = 0;
  let next: { deck: string; lesson: string; cards: number } | null = null;
  for (const deck of Object.values(data.decks)) {
    const progress = snap(data.progress[deck.id] ?? {});
    const loaded = deckLoaded(deck.id);
    // Decks not opened since Ankhwiz started are counted without reading their notes.
    due += loaded ? reviewQueue(snap(deck), progress).length : quickCounts(deck.id, now()).due;
    if (!next) {
      for (const id of deck.units.flatMap((u) => u.lessonIds)) {
        const fresh = deck.lessons[id].noteIds.some((n) => !progress[n]);
        if (fresh) {
          const cards = loaded ? lessonQueue(snap(deck), progress, id).length : deck.lessons[id].noteIds.length * 3;
          next = { deck: deck.name, lesson: deck.lessons[id].name, cards };
          break;
        }
      }
    }
  }
  if (due && (!next || due >= 10)) return `${due} ${due === 1 ? 'card is' : 'cards are'} due for review. A few minutes keeps them strong.`;
  if (next) return `Your next lesson is ready: ${next.deck}, ${next.lesson}. About ${Math.max(2, Math.round(next.cards / 4))} minutes.`;
  return 'Time for a few minutes of study.';
}

function studiedToday(): boolean {
  const day = today();
  return Object.values(data.progress).some((p) => Object.values(p).some((c) => c.hist?.at(-1)?.day === day || c.added === day));
}

function due(): boolean {
  const r = data.reminder;
  if (!r.on) return false;
  const t = new Date(now());
  if (!r.days.includes(t.getDay())) return false;
  const [h, m] = r.time.split(':').map(Number);
  if (t.getHours() * 60 + t.getMinutes() < h * 60 + m) return false;
  let last = '';
  try {
    last = localStorage.getItem(NOTIFIED) ?? '';
  } catch {
    /* no memory of it: may remind again */
  }
  return last !== String(today()) && !studiedToday();
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Apply the reminder settings. Call after load and whenever they change. */
export function applyReminder(): void {
  const r = data.reminder;
  if (remindsNatively()) {
    setNativeReminder(r.on, r.time, r.days, reminderText());
    if (studiedToday()) markStudiedNative(today());
    return;
  }
  clearInterval(timer);
  if (!r.on) return;
  const check = () => {
    if (!due()) return;
    try {
      localStorage.setItem(NOTIFIED, String(today()));
    } catch {
      /* fine */
    }
    void notify('Ankhwiz', reminderText());
  };
  check();
  timer = setInterval(check, 60_000);
}

export function startReminders(): void {
  onStudied((day) => markStudiedNative(day));
  applyReminder();
}
