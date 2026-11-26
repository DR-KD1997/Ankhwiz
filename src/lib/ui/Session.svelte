<script lang="ts">
  // One lesson, review, practice round, test out or all-decks review: shows
  // each exercise, grades it, and ends with a summary. The learner never grades
  // themselves, except on cards the app cannot check (self-check cards).
  import { tick, untrack } from 'svelte';
  import { aiReady, ask } from '../ai.svelte';
  import { checkAnswer, limits, liveFeedback, noteLessons } from '../core';
  import { langName } from '../languages';
  import { choiceLine, lessonEndLine, line, streakLine } from '../core/thoth';
  import { plural, shownName, stageName, t } from '../i18n';
  import type { Exercise, Marked } from '../core/types';
  import { acceptAnswer, closeSession, currentStreak, data, grade, linkAnswers, met, next, openPanel, overrule, setAsideCurrent, snap, takeMilestone, ui } from '../store.svelte';
  import { contrastFor, linkable, noteWithAnswer, pickAllFor, plainAnswer, type PickAll } from '../links';
  import PickAllRound from './PickAllRound.svelte';
  import SideBySide from './SideBySide.svelte';
  import { canSpeak, speakPieces, stopSpeaking, voiceHelp } from '../speech';
  import { pieces } from '../voices';
  import VoiceText from './VoiceText.svelte';
  import { chosenSounds, playSound } from '../sounds';
  import { builtRight, joinWords, makeTiles, type Tile } from '../build';
  import Fields from './Fields.svelte';
  import AnswerExtras from './AnswerExtras.svelte';
  import { mediaToken, mediaUrl, plainText } from '../media';
  import { kanaOf, plainOf, readingWords, romajiToKana } from '../furigana';
  import Furi, { setFurigana } from './Furi.svelte';
  import Media from './Media.svelte';
  import Picture from './Picture.svelte';
  import Icon from './Icon.svelte';
  import Thoth, { type Cue, type Reaction } from './Thoth.svelte';
  import { offerPart, signal } from '../tour.svelte';

  const s = $derived(ui.session!);
  const ex = $derived(s.exercise);
  const deck = $derived(data.decks[s.deckId]);
  const mode = $derived(data.settings.thoth);

  let selected = $state<string | null>(null);
  let typed = $state('');
  let done = $state(false);
  let result = $state<{ correct: boolean; promoted: boolean } | null>(null);
  let typoUsed = $state(false);
  let sawRed = $state(false);
  let revealed = $state(false);
  let says = $state('');
  let startedAt = 0;
  let field = $state<HTMLInputElement>();
  // Long answers: written freely, then marked by AI or compared by the learner.
  let free = $state('');
  let marking = $state(false);
  let marked = $state<Marked | null>(null);
  let markError = $state('');
  // Building the answer from word tiles: the tiles, and the ids put in order so far.
  let tiles = $state<Tile[]>([]);
  let built = $state<number[]>([]);
  const builtWords = $derived(built.map((id) => tiles.find((t) => t.id === id)?.text ?? ''));
  const bank = $derived(tiles.filter((t) => !built.includes(t.id)));
  // "Explain this", after an answer.
  let explaining = $state(false);
  let explanation = $state('');
  const ai = $derived(aiReady() && data.ai.noticeSeen);
  const look = $derived(deck.options.look);
  const scale = $derived(look.size === 's' ? 0.88 : look.size === 'l' ? 1.18 : 1);
  // Reading aloud: speaker buttons by the question and the answer when the deck
  // turns it on; Settings can also have them read by themselves. The question
  // and answer fields may be in different languages, swapped on reverse cards.
  const voice = $derived(look.speak !== 'off' && canSpeak());
  // Which fields are read aloud: the deck may read only its question field or
  // only its answer field. On a reverse card the answer field is asked.
  const voiceQ = $derived(voice && (!ex ? true : (ex.reverse ? look.speakAnswer : look.speakQuestion) !== false));
  const voiceA = $derived(voice && (!ex ? true : (ex.reverse || ex.cloze || ex.picture ? look.speakQuestion : look.speakAnswer) !== false));
  const autoRead = $derived(data.settings.autoRead ?? 'off');
  const qLang = $derived(!ex ? look.lang : ex.reverse ? look.langBack || look.lang : look.lang);
  const answerLang = (e: Exercise) => (e.reverse || e.cloze || e.picture ? look.lang : look.langBack || look.lang);
  const aLang = $derived(!ex ? look.lang : answerLang(ex));
  let voiceNote = $state('');
  // Words marked with their own language in the card editor, and the deck's quote rule.
  const marks = $derived(ex ? (deck.notes[ex.noteId]?.voices ?? []) : []);
  const quoteLang = $derived(look.quoteLang ?? '');
  async function say(text: string, lang: string) {
    // Words with readings are read by their readings: 今日 as きょう, not こんにち.
    text = kanaOf(plainText(text));
    if (!text.trim()) return;
    const r = await speakPieces(pieces(text, lang, marks, quoteLang));
    voiceNote = r.missing.length
      ? t('This device has no voice for {x}{x2}. {x3}', { x: r.missing.map(langName).join(' or '), x2: r.result === t('ok') ? t(', so those words were left out') : '', x3: voiceHelp() })
      : r.result === 'unavailable'
        ? t('Reading aloud is not available on this device.')
        : '';
  }
  let menu = $state(false);
  let cue = $state<Cue | null>(null);
  let cueCount = 0;
  const react = (kind: Reaction) => (cue = { kind, id: ++cueCount });
  const testing = $derived(!!s.testOut);
  let milestone = $state<number | null>(null);
  $effect(() => {
    if (s.finished && s.graded > 0 && !testing) untrack(() => (milestone = takeMilestone()));
  });
  // The end-of-lesson sound, once, when the summary appears (not after a test out that was not passed).
  $effect(() => {
    if (s.finished) untrack(() => signal('finished'));
  });
  // The first test out explains itself.
  $effect(() => {
    if (testing) untrack(() => offerPart('testout'));
  });
  let endPlayed = false;
  $effect(() => {
    if (!s.finished || endPlayed) return;
    endPlayed = true;
    if (s.graded > 0 && (!testing || s.testOut?.result?.passed)) untrack(() => playSound('end'));
  });
  const finishCue = $derived<Cue>({
    kind: milestone
      ? 'delight'
      : testing
        ? s.testOut?.result?.passed
          ? 'cheer'
          : 'encourage'
        : !s.graded
          ? 'nod'
          : s.correct / s.graded >= 0.8
            ? 'cheer'
            : s.correct / s.graded >= 0.5
              ? 'happy'
              : 'encourage',
    id: 0,
  });
  /** Said to screen readers when an answer is marked. */
  let announce = $state('');
  // Answers that mean the same: a linked answer that counted, Thoth checking a
  // typed answer, "I was right too", and the extra practice links make possible.
  let alsoFits = $state('');
  let judging = $state(false);
  let judged = $state<{ ok: boolean; why: string; text: string; kept: boolean } | null>(null);
  let rightToo = $state(false);
  let overruled = $state<'' | 'counted' | 'close' | 'accepted'>('');
  let pick = $state<PickAll | null>(null);
  const shownGroups = new Set<string>();
  let contrastSeen = $state<Set<string>>(new Set());
  const checksOn = $derived(data.settings.thothChecks !== false);
  // Furigana: the deck's choice, and how well each word with a reading is known
  // (the highest stage of a card it appears on; its reading card's, if it has one).
  const furiMode = $derived(look.furigana ?? '');
  const wordStages = $derived.by(() => {
    const m = new Map<string, number>();
    if (furiMode !== 'fade') return m;
    const prog = data.progress[s.deckId] ?? {};
    const byReading = (look.readingCards ?? 'off') !== 'off';
    for (const n of Object.values(deck.notes)) {
      if (!n.front.includes('[') && !n.back.includes('[')) continue;
      const stage = (byReading ? prog[`${n.id}:k`]?.stage : undefined) ?? prog[n.id]?.stage ?? 0;
      for (const w of [...readingWords(n.front), ...readingWords(n.back)]) m.set(w, Math.max(m.get(w) ?? 0, stage));
    }
    return m;
  });
  // A reading peeked at counts the answer as helped.
  let peeked = $state(false);
  setFurigana({
    get mode() {
      return furiMode;
    },
    level: (w: string) => wordStages.get(w) ?? 0,
    get revealed() {
      return done || ex?.kind === 'meet';
    },
    peek: () => (peeked = true),
  });
  /** An answer as one line of text: its readings in brackets after it. */
  const lineOf = (text: string) => (text.includes('[') && plainOf(text) !== text ? `${plainOf(text)} (${kanaOf(text)})` : text);
  let help = $state(false);

  function reset(e: Exercise | null) {
    peeked = false;
    selected = null;
    typed = '';
    done = false;
    result = null;
    typoUsed = false;
    sawRed = false;
    revealed = false;
    free = '';
    marking = false;
    marked = null;
    markError = '';
    explaining = false;
    explanation = '';
    rated = null;
    alsoFits = '';
    judging = false;
    judged = null;
    rightToo = false;
    overruled = '';
    pick = null;
    tiles = [];
    built = [];
    startedAt = performance.now();
    voiceNote = '';
    stopSpeaking();
    if (!e) return;
    react('nod');
    if (e.kind === 'meet') says = line('meet');
    else if (e.kind === 'choice') says = choiceLine(e.options!.length, s.lastMet === e.cardId);
    else if (e.kind === 'build') {
      says = line('build');
      // Two stray words at first, three once the card is more familiar.
      tiles = makeTiles(e.answer, e.options ?? [], e.stage >= 2 ? 3 : 2, answerLang(e));
    }
    else if (e.kind === 'typed') says = line(e.live ? 'typedLive' : 'typedPlain');
    else if (e.kind === 'self') says = line('selfCheck');
    else says = ai ? line('freeAi') : line('self');
    if (testing) says = line('testOut');
    announce = '';
    if (e.kind === 'typed') void tick().then(() => field?.focus());
  }

  $effect(() => {
    const e = ex;
    untrack(() => reset(e));
  });

  const live = $derived(
    ex?.kind === 'typed' && ex.live && !done ? liveFeedback(typed, ex.accepted, deck.strictAccents) : 'empty',
  );
  const liveWord = { empty: '', match: t('On track'), close: t('Close'), off: t('Off track') } as const;

  function onType() {
    // A reading is answered in kana: romaji typed on any keyboard turns into kana.
    if (ex?.kana) typed = romajiToKana(typed);
    if (ex?.kind === 'typed' && ex.live && liveFeedback(typed, ex.accepted, deck.strictAccents) === 'off') sawRed = true;
  }

  /** Right, but only just: after a spelling retry, rated Partly, or typed without its accents or capitals. */
  function nearly(): boolean {
    if (typoUsed || rated === 'partly') return true;
    if (ex?.kind !== 'typed') return false;
    const given = typed.trim();
    return !ex.accepted.some((a) => a.trim() === given);
  }

  function settle(correct: boolean, assisted: boolean, aiGraded = false) {
    signal('check');
    assisted = assisted || peeked;
    const r = grade({ correct, assisted, sawRed, ms: performance.now() - startedAt, aiGraded });
    playSound(correct ? (nearly() ? 'nearly' : 'right') : 'wrong');
    result = { correct, promoted: r.promoted };
    done = true;
    alsoFits = correct ? linkedMatch() : '';
    says = correct ? line(r.promoted ? 'promoted' : 'correct') : line('wrong');
    react(correct ? (r.promoted ? 'cheer' : 'happy') : 'sad');
    announce = correct ? `Correct.${r.promoted ? t(' Moved up a stage.') : ''}` : t('Not quite. The answer is {x}.', { x: lineOf(ex?.answer ?? '') });
  }

  /** What the learner gave, as text. */
  function given(): string {
    if (!ex) return '';
    return ex.kind === 'choice' ? (selected ?? '') : ex.kind === 'build' ? joinWords(builtWords, ex.answer) : ex.kind === 'typed' ? typed : free;
  }

  /** A right answer that counted because another card with the same meaning has it. */
  function linkedMatch(): string {
    if (!ex?.linked?.length) return '';
    const g = plainAnswer(given());
    const own = ex.accepted.filter((a) => !ex.linked!.includes(a)).map(plainAnswer);
    if (!g || own.includes(g)) return '';
    return ex.linked.find((a) => plainAnswer(a) === g) ?? '';
  }

  /** Another card whose answer the learner gave, for "I was right too". */
  const rightTooMatch = $derived.by(() => {
    if (!rightToo || !ex || ex.cloze || ex.picture) return null;
    const id = noteWithAnswer(deck, given(), ex.reverse, ex.noteId);
    return id ? deck.notes[id] : null;
  });
  const canRightToo = $derived(
    !!ex && done && !!result && !result.correct && !testing && !overruled && !mediaToken(ex.answer) && (ex.kind === 'choice' || ex.kind === 'typed' || ex.kind === 'build') && !!given().trim(),
  );

  function counted(how: 'counted' | 'accepted') {
    const r = overrule(true);
    rightToo = false;
    if (!r) return;
    overruled = how;
    result = { correct: true, promoted: r.promoted };
    playSound('right');
    says = t('Fair point. I’ll remember that one.');
    react('happy');
    announce = t('Counted as right.');
  }
  function sameMeaning() {
    if (!ex || !rightTooMatch) return;
    linkAnswers(s.deckId, [ex.noteId, rightTooMatch.id], 'same');
    counted('counted');
  }
  function closeMeaning() {
    if (!ex || !rightTooMatch) return;
    linkAnswers(s.deckId, [ex.noteId, rightTooMatch.id], 'close');
    rightToo = false;
    overruled = 'close';
    says = t('Close enough to confuse anyone. Noted.');
    react('nod');
  }
  function acceptGiven() {
    if (!ex) return;
    if (!ex.reverse && !ex.cloze && !ex.picture) acceptAnswer(s.deckId, ex.noteId, given());
    counted('accepted');
  }

  /** A typed answer that matched nothing: Thoth decides whether it is fair all the same. */
  async function judge() {
    if (!ex) return;
    const text = typed.trim();
    judging = true;
    says = t('Not the card’s answer. Asking Thoth whether it fits too…');
    react('nod');
    try {
      const r = await ask<Marked>('judge', snap(deck), { cardId: ex.cardId, given: text });
      judging = false;
      settle(r.correct, true, false);
      judged = { ok: r.correct, why: r.feedback, text, kept: r.correct };
      if (r.correct && !ex.reverse && !ex.cloze && !ex.picture) acceptAnswer(s.deckId, ex.noteId, text);
      if (r.feedback) says = r.feedback;
    } catch {
      judging = false;
      settle(false, !!ex.live || typoUsed);
    }
  }
  /** Undo Thoth's "also right": marked wrong after all, and no longer accepted (or accepted again). */
  function undoJudged() {
    if (!ex || !judged) return;
    const keep = !judged.kept;
    const r = overrule(keep);
    if (!r) return;
    if (!ex.reverse && !ex.cloze && !ex.picture) acceptAnswer(s.deckId, ex.noteId, judged.text, keep);
    judged = { ...judged, kept: keep };
    result = { correct: keep, promoted: r.promoted };
  }
  /** Self-check: how close the learner says they were. Partly counts as right, but hard. */
  let rated = $state<'missed' | 'partly' | 'got' | null>(null);
  function rate(how: 'missed' | 'partly' | 'got') {
    rated = how;
    settle(how !== 'missed', how === 'partly');
  }
  const RATED = { missed: [t('Missed it'), t('It comes back soon')], partly: [t('Partly'), t('Counted as a hard recall')], got: [t('Got it'), ''] } as const;

  function check() {
    if (!ex || done) return;
    if (ex.kind === 'choice') {
      if (selected === null) return;
      settle(selected === ex.answer, true);
    } else if (ex.kind === 'build') {
      if (!built.length) return;
      settle(builtRight(builtWords, ex.accepted, aLang), true);
    } else if (ex.kind === 'typed') {
      if (!typed.trim()) return;
      if (ex.kana) typed = romajiToKana(typed, true);
      const verdict = checkAnswer(typed, ex.accepted, deck.strictAccents);
      // One spelling retry before a near miss counts as wrong.
      if (verdict === 'typo' && !typoUsed && !testing) {
        typoUsed = true;
        says = line('typo');
        react('nod');
        field?.focus();
        return;
      }
      if (verdict === 'wrong' && ai && checksOn && !testing && !judging) {
        void judge();
        return;
      }
      settle(verdict === 'correct', !!ex.live || typoUsed);
    }
  }

  /** Send a freely written answer to the AI for marking. */
  async function mark() {
    if (!ex || !free.trim() || marking) return;
    marking = true;
    markError = '';
    try {
      marked = await ask<Marked>('grade', snap(deck), { noteId: ex.cardId, given: free });
      says = marked.feedback || line(marked.correct ? 'correct' : 'wrong');
    } catch (e) {
      // Without a mark, fall back to comparing the answers by eye.
      markError = e instanceof Error ? t(e.message) : t('The answer could not be marked.');
      revealed = true;
    } finally {
      marking = false;
    }
  }

  async function explain() {
    if (!ex || explaining) return;
    explaining = true;
    try {
      const given = ex.kind === 'choice' ? (selected ?? '') : ex.kind === 'build' ? joinWords(builtWords, ex.answer) : ex.kind === 'typed' ? typed : free;
      explanation = await ask<string>('explain', snap(deck), { noteId: ex.cardId, given: result?.correct ? '' : given });
    } catch (e) {
      explanation = e instanceof Error ? t(e.message) : t('No explanation could be fetched.');
    } finally {
      explaining = false;
    }
  }

  const canAct = $derived(
    !ex ? true : done || ex.kind === 'meet' ? true : ex.kind === 'choice' ? selected !== null : ex.kind === 'build' ? built.length > 0 : ex.kind === 'typed' ? typed.trim().length > 0 : false,
  );
  const actionLabel = $derived(!ex || done || ex.kind === 'meet' ? t('continue') : t('check'));

  function act() {
    if (!ex) return closeSession();
    if (ex.kind === 'meet') {
      signal('met');
      return met();
    }
    if (done) {
      if (!pick && maybePickAll()) return;
      return next();
    }
    check();
  }

  /** After a right answer, a "pick all that fit" question when the card's links make one worth it (once per group a session). */
  function maybePickAll(): boolean {
    if (!ex || testing || !result?.correct || ex.reverse || ex.cloze || ex.picture) return false;
    const q = pickAllFor(deck, ex.noteId);
    if (!q || shownGroups.has(q.group)) return false;
    shownGroups.add(q.group);
    pick = q;
    says = t('Every answer that fits, and none that doesn’t.');
    react('nod');
    return true;
  }

  /** Before a card is first met: one close in meaning that the learner already knows, shown side by side. */
  const contrast = $derived.by(() => {
    if (!ex || ex.kind !== 'meet' || ex.reverse || ex.cloze || ex.picture || contrastSeen.has(ex.cardId)) return null;
    const note = deck.notes[ex.noteId];
    if (!linkable(note)) return null;
    const c = contrastFor(deck, data.progress[s.deckId] ?? {}, ex.noteId);
    return c ? { known: c.other, fresh: note, note: c.note } : null;
  });

  /** Keyboard: Enter checks and continues, 1–8 pick an option (or a self-check rating;
   *  or, when building, 1–9 place a word and Backspace takes back the last),
   *  E explains, R reads aloud, S skips for today, Esc leaves, ? shows the keys. */
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox');
    if (e.key === 'Escape') {
      if (help) help = false;
      else if (menu) menu = false;
      else closeSession();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (pick || contrast || rightToo || judging) return;
      if ((ex?.kind === 'free' || ex?.kind === 'self') && !done) {
        if (!revealed && !marked && ex.kind === 'self') {
          e.preventDefault();
          revealed = true;
        }
        return;
      }
      if (canAct) {
        e.preventDefault();
        act();
      }
      return;
    }
    if (typing) return;
    if (e.key === '?') {
      help = !help;
      return;
    }
    if (ex?.kind === 'build' && !done) {
      if (/^[1-9]$/.test(e.key)) {
        const tile = bank[Number(e.key) - 1];
        if (tile) built = [...built, tile.id];
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        built = built.slice(0, -1);
        return;
      }
    }
    if (ex?.kind === 'choice' && !done && /^[1-8]$/.test(e.key)) {
      const option = ex.options![Number(e.key) - 1];
      if (option !== undefined) {
        selected = option;
        signal('pick');
      }
      return;
    }
    if ((ex?.kind === 'self' || ex?.kind === 'free') && !done && (revealed || ex.kind === 'self') && /^[1-3]$/.test(e.key) && revealed && !marked) {
      rate((['missed', 'partly', 'got'] as const)[Number(e.key) - 1]);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'e' && done && ai && !testing && !explanation) void explain();
    else if (k === 'r' && ex && (done ? voiceA : voiceQ)) void say(done ? ex.answer : ex.kind === 'meet' ? meetFront : ex.prompt, done ? aLang : qLang);
    else if (k === 's' && ex && !done && !testing && s.kind !== 'practice') setAsideCurrent('skip');
  }

  // Which lesson each note is in, worked out once per deck rather than for every review card.
  const lessonMaps = new WeakMap<object, Record<string, string>>();
  function lessonsOf(d: typeof deck): Record<string, string> {
    let m = lessonMaps.get(d);
    if (!m) lessonMaps.set(d, (m = noteLessons(d)));
    return m;
  }
  const where = $derived.by(() => {
    if (testing) return t('Test out · {x}', { x: deck.units.find((u) => u.id === s.testOut!.unitId)?.name ?? '' });
    if (s.kind === 'all') return s.finished ? s.title || t('All decks') : `${s.title || t('All decks')} · ${deck.name}`;
    if (s.practice) return t('Practice');
    if (!s.lessonId) return t('Review');
    const unit = deck.units.find((u) => u.lessonIds.includes(s.lessonId!));
    const lesson = deck.lessons[s.lessonId];
    return unit && unit.name !== deck.name ? `${shownName(unit.name)} · ${shownName(lesson.name)}` : shownName(lesson.name);
  });
  const fromLesson = $derived.by(() => {
    if (!ex || s.lessonId) return '';
    const id = lessonsOf(deck)[ex.noteId];
    return id ? shownName(deck.lessons[id].name) : '';
  });
  const stageWord = $derived(
    !ex ? '' : testing ? (ex.reverse ? t('Other way round') : t('No hints')) : (ex.kind === 'meet' ? t('New') : t('Stage {stage} · {name}', { stage: ex.stage, name: stageName(limits.stageNames[ex.stage - 1]) })) + (ex.reverse ? t(' · Other way round') : ex.cloze ? t(' · Fill the gap') : ''),
  );
  const meetFront = $derived(plainText(!ex ? '' : ex.reverse || ex.cloze ? ex.prompt : deck.notes[ex.noteId]?.front ?? ex.prompt));
  /** The answer as text; empty when it is a picture or a sound, which shows with the answer's media. */
  const answerText = $derived(plainText(ex?.answer));
  let spokenFor = '';
  $effect(() => {
    // Read the question by itself as each card appears, when Settings asks for it.
    if (!ex || !voiceQ || (autoRead !== 'question' && autoRead !== 'both') || spokenFor === ex.cardId + s.index) return;
    spokenFor = ex.cardId + s.index;
    const text = ex.kind === 'meet' ? meetFront : ex.prompt;
    untrack(() => void say(text, qLang));
  });
  $effect(() => {
    // And the answer once it is checked, just after the answer sound.
    if (!done || !ex || !voiceA || (autoRead !== 'answer' && autoRead !== 'both') || !ex.answer) return;
    const text = ex.answer;
    const lang = untrack(() => aLang);
    const timer = setTimeout(() => void say(text, lang), chosenSounds() ? 450 : 0);
    return () => clearTimeout(timer);
  });
  const promptSize = $derived(!ex ? 30 : ex.prompt.length > 160 ? 19 : ex.prompt.length > 70 ? 23 : 30);
  const position = $derived(Math.min(s.index + 1, s.queue.length));
  const letters = 'ABCDEFGH';
  const summaryLine = $derived(s.finished ? lessonEndLine(s.correct, s.graded, !s.lessonId) : '');
  // After a lesson, a reading round is offered when one can be made: a story
  // ready, the AI connection, or enough sentences of studied words.
  const bonus = $derived.by(() => {
    if (!s.finished || s.kind !== 'lesson' || s.practice) return false;
    const d = data.decks[s.deckId];
    if (!d) return false;
    if (aiReady() || (d.readings ?? []).some((r) => r.ai && r.best == null)) return true;
    // Without Thoth, a round from the deck's own sentences needs enough cards met (worked out when opened).
    return untrack(() => Object.keys(data.progress[s.deckId] ?? {}).length >= 20);
  });
  const extras = $derived(ex ? [ex.extra, ...ex.extraMore] : []);
  // A sound offered as an option plays when it is picked.
  let tokenPlayer: HTMLAudioElement | null = null;
  async function playToken(option: string) {
    const m = mediaToken(option);
    if (m?.kind !== 'sound' || !ex) return;
    const url = await mediaUrl(s.deckId, m.name);
    if (!url) return;
    tokenPlayer?.pause();
    tokenPlayer = new Audio(url);
    void tokenPlayer.play().catch(() => {});
  }
  const isSound = (m: string) => /\.(mp3|ogg|wav|m4a|opus|flac|aac|webm)$/i.test(m);
  /** Test out: how each lesson of the unit went. */
  const testLessons = $derived.by(() => {
    const test = s.testOut;
    if (!test?.result) return [];
    const unit = deck.units.find((u) => u.id === test.unitId);
    const lessonOf = lessonsOf(deck);
    return (unit?.lessonIds ?? []).map((id) => {
      const mine = test.answers.filter((a) => lessonOf[a.cardId.split(':')[0]] === id);
      return { id, name: deck.lessons[id]?.name ?? '', right: mine.filter((a) => a.correct).length, total: mine.length, relearn: mine.filter((a) => !a.correct).length };
    });
  });
</script>

<svelte:window onkeydown={onKey} />

<section
  class="session font-{look.font}"
  style="--scale: {scale}"
  dir={look.rtl ? 'rtl' : undefined}
  aria-live="polite"
>
  {#if s.finished}
    <div class="summary">
      {#if mode !== 'hidden'}
        <div class="thoth-big plain"><Thoth size={176} cue={finishCue} room /></div>
      {/if}
      {#if testing && s.testOut?.result}
        {@const r = s.testOut.result}
        <p class="label">{where}</p>
        <h1 class="display">{r.passed ? t('unitPassed') : t('notThisTime')}</h1>
        <p class="score"><strong>{r.correct}/{r.total}</strong> <span>{t('pass mark {passMark}', { passMark: r.passMark })}</span></p>
        {#if mode !== 'hidden'}<p class="said">{line(r.passed ? 'testPassed' : 'testFailed')}</p>{/if}
        <p class="fine">
          {r.passed
            ? t('Its lessons are open, and their cards start at stage 3 instead of 1.') + (r.relearn.length ? ' ' + plural('{n} missed card goes back to stage 1 to relearn.', '{n} missed cards go back to stage 1 to relearn.', r.relearn.length) : '')
            : t('Nothing has changed. You can do the lessons as usual, or try again tomorrow.')}
        </p>
        {#if r.passed}
          <ul class="lessons">
            {#each testLessons as l (l.id)}
              <li class="plain">
                <span class="tick"><Icon name="check" size={16} /></span>
                <span><strong>{shownName(l.name)}</strong><small>{t('{right} of {total} right{x}', { right: l.right, total: l.total, x: l.relearn ? ' · ' + t('{n} to relearn', { n: l.relearn }) : t(' · stage 3') })}</small></span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="label">{where}</p>
        {#if milestone}
          <h1 class="display">{t('daysInARow', { n: milestone })}</h1>
          {#if mode !== 'hidden'}<p class="said">{line(milestone >= 30 ? 'milestoneBig' : 'milestone')}</p>{/if}
        {:else}
          <h1 class="display">{s.practice ? t('practiceComplete') : s.kind === 'all' ? t('allDecksDone') : s.lessonId ? t('lessonComplete') : t('reviewComplete')}</h1>
          {#if mode !== 'hidden'}<p class="said">{summaryLine}</p>{/if}
        {/if}
        {#if s.practice}<p class="fine">{t('Practice does not change when your cards come back.')}</p>{/if}
        <dl class="stats" data-tour="result">
          <div class="plain"><dt>{t('Correct')}</dt><dd>{t('{correct} of {graded}', { correct: s.correct, graded: s.graded })}</dd></div>
          <div class="plain"><dt>{s.kind === 'all' ? t('Decks') : t('New')}</dt><dd>{s.kind === 'all' ? (s.decks?.length ?? 1) : s.introduced}</dd></div>
          <div class="plain"><dt>{t('Moved up')}</dt><dd>{s.promoted}</dd></div>
        </dl>
        {#if s.graded > 0}
          <p class="streak"><Icon name="sun" size={22} /> {streakLine(currentStreak())}</p>
        {/if}
      {/if}
    </div>
    <div class="grow"></div>
    {#if bonus}
      <button class="quiet bonus" onclick={() => (signal('closed'), closeSession(), openPanel('reading'))}><Icon name="layers" size={18} /> {t('Bonus: a reading round')}</button>
    {/if}
    <button class="primary" data-tour="act" onclick={() => (signal('closed'), closeSession())}>{t('Continue')}</button>
  {:else if ex}
    <div class="top">
      <button class="icon-btn" aria-label={t('Close lesson')} onclick={closeSession}><Icon name="close" /></button>
      <div class="bar plain" role="progressbar" aria-valuemin={0} aria-valuemax={s.queue.length} aria-valuenow={s.index}>
        <div style="width: {(s.index / s.queue.length) * 100}%"></div>
      </div>
      <span class="count">{t('{position} of {queueCount}', { position, queueCount: s.queue.length })}</span>
      {#if !testing}<div class="menu-wrap">
        <button class="icon-btn" aria-label={t('More for this card')} aria-expanded={menu} onclick={() => (menu = !menu)}><Icon name="more" /></button>
        {#if menu}
          <div class="menu plain" role="menu">
            <button role="menuitem" onclick={() => ((menu = false), setAsideCurrent('skip'))}>
              <strong>{t('Skip for today')}</strong><small>{t('It comes back tomorrow (Anki: bury)')}</small>
            </button>
            <button role="menuitem" onclick={() => ((menu = false), setAsideCurrent('stop'))}>
              <strong>{t('Stop asking this one')}</strong><small>{t('Resume it in Cards (Anki: suspend)')}</small>
            </button>
          </div>
        {/if}
      </div>{/if}
    </div>

    <div class="head" class:hidden={!!pick}>
      <p class="label" data-tour="stage">
        {where}{fromLesson && !testing ? ` · ${fromLesson}` : ''} · {stageWord}
        {#if ex.ai}<span class="tag" title={t('This card was written or changed by AI')}>{t('AI')}</span>{/if}
      </p>
      {#if ex.kind !== 'meet'}
        {#if ex.kana}<div class="said-row">
          <h1 class="display" lang="ja" style="font-size: calc({promptSize}px * var(--scale))">{#if ex.mark && ex.prompt.includes(ex.mark)}{ex.prompt.slice(0, ex.prompt.indexOf(ex.mark))}<mark class="kana-mark">{ex.mark}</mark>{ex.prompt.slice(ex.prompt.indexOf(ex.mark) + ex.mark.length)}{:else}{ex.prompt}{/if}</h1>
        </div>
        <p class="ask-line">{ex.mark ? t('How is the marked word read?') : t('How is it read?')}</p>
        {:else if plainText(ex.prompt)}<div class="said-row">
          <h1 class="display" dir="auto" style="font-size: calc({promptSize}px * var(--scale))"><VoiceText text={ex.picture && /^(Which part is hidden\?|What is under the hidden part\?)$/.test(ex.prompt) ? t(ex.prompt) : ex.prompt} lang={qLang} {marks} {quoteLang} show={voice} /></h1>
          {#if voiceQ && !ex.cloze}<button class="icon-btn speak" aria-label={t('Hear the question')} onclick={() => say(ex.prompt, qLang)}><Icon name="sound" /></button>{/if}
        </div>{/if}
        <Fields items={ex.frontMore} first={2} base={promptSize * 0.8} label={t('question fields')} />
        {#if ex.picture}<Picture deckId={s.deckId} picture={ex.picture} revealed={done} />{/if}
        <Media deckId={s.deckId} names={ex.qmedia} align={look.pictures ?? 'center'} />
        {#if look.hintExtra && ex.extra && !done && !testing}<p class="hint-extra" dir="auto">{t('Hint: {extra}', { extra: ex.extra })}</p>{/if}
      {/if}
      {#if voiceNote}<p class="fine voice-note" role="status">{voiceNote}</p>{/if}
    </div>

    {#if pick}
      <PickAllRound question={pick} onDone={() => ((pick = null), next())} />
    {:else if contrast}
      <SideBySide known={contrast.known} fresh={contrast.fresh} note={contrast.note} canSpeak={voiceQ} {say} {qLang} onDone={() => (contrastSeen = new Set([...contrastSeen, ex.cardId]))} />
    {:else if ex.kind === 'meet'}
      <div class="meet card">
        {#if meetFront}
          <div class="said-row">
            <p class="display front" dir="auto"><VoiceText text={meetFront} lang={qLang} {marks} {quoteLang} show={voice} /></p>
            {#if voiceQ}<button class="icon-btn speak" aria-label={t('Hear the question')} onclick={() => say(meetFront, qLang)}><Icon name="sound" /></button>{/if}
          </div>
        {/if}
        <Fields items={ex.frontMore} first={2} base={20} label={t('question fields')} />
        {#if ex.picture}<Picture deckId={s.deckId} picture={ex.picture} revealed />{/if}
        <Media deckId={s.deckId} names={ex.qmedia} align={look.pictures ?? 'center'} />
        <hr />
        {#if answerText}
          <div class="said-row">
            <p class="back" dir="auto"><VoiceText text={ex.answer} lang={aLang} {marks} {quoteLang} show={voice} /></p>
            {#if voiceA}<button class="icon-btn speak" aria-label={t('Hear the answer')} onclick={() => say(ex.answer, aLang)}><Icon name="sound" /></button>{/if}
          </div>
        {/if}
        <Fields items={ex.answerMore} first={2} base={18} label={t('fields')} />
        <Media deckId={s.deckId} names={ex.amedia} autoplay={!ex.qmedia.some(isSound)} align={look.pictures ?? 'center'} />
        <div class="extra"><Fields items={extras} base={16} label={t('extra fields')} /></div>
        <AnswerExtras deckId={s.deckId} noteId={ex.noteId} />
      </div>
    {:else if ex.kind === 'choice'}
      <div class="options" role="radiogroup" aria-label={t('Answers')} data-tour="answers">
        {#each ex.options! as option, i (option)}
          {@const isAnswer = option === ex.answer}
          {@const picked = option === selected}
          <button
            class="option card"
            class:picked={picked && !done}
            class:ok={done && isAnswer}
            class:off={done && picked && !isAnswer}
            class:dim={done && !picked && !isAnswer}
            role="radio"
            aria-checked={picked}
            disabled={done}
            onclick={() => ((selected = option), signal('pick'), playToken(option))}
          >
            <span class="badge">
              {#if done && isAnswer}<Icon name="check" size={16} />
              {:else if done && picked}<Icon name="cross" size={16} />
              {:else}{letters[i]}{/if}
            </span>
            {#if mediaToken(option)?.kind === 'picture'}
              <span class="pic"><Media deckId={s.deckId} names={[mediaToken(option)!.name]} small /></span>
            {:else if mediaToken(option)?.kind === 'sound'}
              <span class="text"><Icon name="sound" size={18} /> {t('Sound {n}', { n: i + 1 })}</span>
            {:else}
              <span class="text" lang={ex.kana ? 'ja' : undefined}><Furi text={option} /></span>
            {/if}
          </button>
        {/each}
      </div>
    {:else if ex.kind === 'build'}
      <div class="build">
        <p class="label" id="built-label">{t('Your answer')}</p>
        <div class="line card {done ? (result?.correct ? 'ok' : 'off') : ''}" role="group" aria-labelledby="built-label" dir="auto">
          {#each built as id, i (id)}
            <button class="tile placed" disabled={done} aria-label={t('{i}: take back', { i: builtWords[i] })} onclick={() => (built = built.filter((b) => b !== id))}>{builtWords[i]}</button>
          {:else}
            <span class="empty">{t('Tap the words in order')}</span>
          {/each}
        </div>
        {#if !done}
          <div class="bank" role="group" aria-label={t('Words')}>
            {#each tiles as ty (ty.id)}
              {@const n = bank.indexOf(ty)}
              {#if built.includes(ty.id)}
                <span class="tile ghost" aria-hidden="true">{ty.text}</span>
              {:else}
                <button class="tile" onclick={() => (built = [...built, ty.id])}>{#if n < 9}<small class="key" aria-hidden="true">{n + 1}</small>{/if}{ty.text}</button>
              {/if}
            {/each}
          </div>
          {#if built.length}<button class="quiet undo" onclick={() => (built = [])}>{t('Clear')}</button>{/if}
        {/if}
      </div>
    {:else if ex.kind === 'typed'}
      <div class="typed">
        <label class="label" for="answer">{t('Your answer')}</label>
        <input
          id="answer"
          class="field card {done ? (result?.correct ? 'ok' : 'off') : live}"
          bind:this={field}
          bind:value={typed}
          oninput={onType}
          readonly={done}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="done"
        />
        {#if !done && ex.live && live !== 'empty'}
          <p class="live {live}">
            <Icon name={live === 'match' ? 'check' : live === 'close' ? 'dot' : 'cross'} size={16} />
            {liveWord[live]}
          </p>
        {:else if !done && typoUsed}
          <p class="live close"><Icon name="dot" size={16} /> {t('Check your spelling')}</p>
        {/if}
      </div>
    {:else if ex.kind === 'self'}
      <div class="self">
        {#if !revealed}
          <label class="label" for="free">{t('Your answer')} <small>{t('(optional: say it to yourself, or write it)')}</small></label>
          <textarea id="free" class="card area" rows="3" bind:value={free}></textarea>
          <button class="quiet" onclick={() => (revealed = true)}>{t('showAnswer')}</button>
        {:else}
          {#if free.trim()}<div class="meet card yours"><p class="label">{t('You wrote')}</p><p class="back">{free}</p></div>{/if}
          <div class="meet card">
            <p class="label">{t('The answer')}</p>
            {#if answerText}
              <div class="said-row">
                <p class="back" dir="auto"><Furi text={ex.answer} /></p>
                {#if voiceA}<button class="icon-btn speak" aria-label={t('Hear the answer')} onclick={() => say(ex.answer, aLang)}><Icon name="sound" /></button>{/if}
              </div>
            {/if}
            <Fields items={ex.answerMore} first={2} base={18} label={t('fields')} />
            <Media deckId={s.deckId} names={ex.amedia} autoplay align={look.pictures ?? 'center'} />
            <div class="extra"><Fields items={extras} base={16} label={t('extra fields')} /></div>
          </div>
          {#if !done}
            <p class="label">{t('howClose')}</p>
            <div class="rates">
              <button class="rate missed" onclick={() => rate('missed')}>{t('missedIt')}<small>{t('Again · 1')}</small></button>
              <button class="rate partly" onclick={() => rate('partly')}>{t('partly')}<small>{t('Hard · 2')}</small></button>
              <button class="rate got" onclick={() => rate('got')}>{t('gotIt')}<small>{t('Good · 3')}</small></button>
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="self">
        {#if !done && !revealed && !marked}
          <label class="label" for="free">{t('Your answer, in your own words')}</label>
          <textarea id="free" class="card area" rows="4" bind:value={free} readonly={marking}></textarea>
          {#if ai}
            <button class="quiet" disabled={!free.trim() || marking} onclick={mark}>
              {marking ? t('Thoth is reading…') : t('Check with Thoth')}
            </button>
            <p class="fine">{t('Your answer and this card are sent to your AI service for marking.')}</p>
          {:else}
            <button class="quiet" onclick={() => (revealed = true)}>{t('showAnswer')}</button>
            <p class="fine">{t('Long answers are marked by AI once a connection is set up in Settings. Until then, compare for yourself.')}</p>
          {/if}
        {:else}
          {#if free.trim()}<div class="meet card yours"><p class="label">{t('You wrote')}</p><p class="back">{free}</p></div>{/if}
          <div class="meet card"><p class="label">{t('Answer')}</p>{#if answerText}<p class="back"><Furi text={ex.answer} /></p>{/if}<Media deckId={s.deckId} names={ex.amedia} align={look.pictures ?? 'center'} /></div>
          {#if !done && marked}
            <p class="label">{t('Thoth\'s mark: {x}', { x: marked.correct ? t('correct') : t('not yet') })} <span class="tag">{t('AI')}</span></p>
            <div class="pair">
              <button class="quiet" onclick={() => settle(marked!.correct, true, true)}>{t('Accept')}</button>
              <button class="quiet" onclick={() => settle(!marked!.correct, true, true)}>
                {t('Overrule: I was {x}', { x: marked.correct ? t('wrong') : t('right') })}
              </button>
            </div>
          {:else if !done}
            {#if markError}<p class="fine">{markError}</p>{/if}
            <p class="label">{t('howClose')}</p>
            <div class="rates">
              <button class="rate missed" onclick={() => rate('missed')}>{t('missedIt')}<small>{t('Again · 1')}</small></button>
              <button class="rate partly" onclick={() => rate('partly')}>{t('partly')}<small>{t('Hard · 2')}</small></button>
              <button class="rate got" onclick={() => rate('got')}>{t('gotIt')}<small>{t('Good · 3')}</small></button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    {#if !pick && !contrast}
    <div class="grow"></div>

    {#if judging}
      <div class="judging plain" role="status"><Icon name="dot" size={18} /> {t('Not the card’s answer. Asking Thoth whether it fits too…')}</div>
    {/if}

    {#if done && result}
      <div class="banner {result.correct ? 'ok' : 'off'}" role="status">
        <Icon name={result.correct ? 'check' : 'cross'} size={22} />
        <div>
          <strong>{rated ? RATED[rated][0] : overruled === 'counted' || overruled === 'accepted' ? t('Counted as right') : judged?.ok && judged.kept ? t('Also right') : result.correct ? t('correct') : t('notQuite')}</strong>
          {#if rated && RATED[rated][1]}<span>{RATED[rated][1]}</span>{/if}
          {#if overruled === 'counted' || overruled === 'accepted'}<span>{overruled === 'accepted' && !ex.reverse && !ex.cloze && !ex.picture ? t('“{given}” is accepted on this card from now on.', { given: given().trim() }) : t('Linked: either answer counts from now on.')}</span>
          {:else if overruled === 'close'}<span>{t('Still a mistake, but these two won’t be offered side by side again.')}</span>{/if}
          {#if judged && !overruled}<span>{judged.ok ? (judged.kept ? t('Thoth: also right.') : t('Marked wrong after all.')) : t('Thoth: not quite.')} {judged.why}</span>{/if}
          {#if !answerText}<!-- a picture or sound answer shows below -->
          {:else if alsoFits || ((overruled === 'counted' || overruled === 'accepted' || judged?.kept) && ex.answer)}<span>{t('This card’s answer: “{answer}”', { answer: lineOf(ex.answer) })}{#if alsoFits} {t('“{given}” fits too.', { given: alsoFits })}{/if}</span>
          {:else if (!result.correct || ex.kind === 'typed') && ex.answer && ex.kind !== 'self'}<span>{t('answerIs', { answer: lineOf(ex.answer) })}</span>{/if}
          {#if result.promoted}<span>{t('movedUp')}</span>{/if}
          {#if s.practice}<span>{t('practiceUnchanged')}</span>{/if}
        </div>
        {#if voiceA && answerText && ex.kind !== 'self'}<button class="icon-btn speak in-banner" aria-label={t('Hear the answer')} onclick={() => say(ex.answer, aLang)}><Icon name="sound" /></button>{/if}
      </div>
      {#if ex.kind !== 'self' && (ex.amedia.length || extras.some((x) => x.trim()) || ex.answerMore.length)}
        <div class="after plain">
          <Fields items={ex.answerMore} first={2} base={17} label={t('fields')} />
          <Media deckId={s.deckId} names={ex.amedia} autoplay align={look.pictures ?? 'center'} />
          <Fields items={extras} base={16} label={t('extra fields')} />
        </div>
      {/if}
      <AnswerExtras deckId={s.deckId} noteId={ex.noteId} />
      {#if judged?.ok}
        <button class="quiet" onclick={undoJudged}>{judged.kept ? t('Undo: mark it wrong') : t('Accept it again')}</button>
      {/if}
      {#if canRightToo}
        <button class="quiet right-too" onclick={() => (rightToo = true)}>{t('I was right too')}</button>
      {/if}
      {#if explanation}
        <div class="explain plain"><p class="label">{t('Thoth explains')} <span class="tag">{t('AI')}</span></p><p>{explanation}</p></div>
      {:else if ai && !testing}
        <button class="quiet" disabled={explaining} onclick={explain}>{explaining ? t('Thoth is thinking…') : t('Explain this')}</button>
      {/if}
    {/if}

    {/if}

    {#if mode === 'full'}
      <div class="thoth-row">
        <div class="portrait"><Thoth size={84} portrait {cue} mood={marking || explaining ? 'think' : 'idle'} /></div>
        <p class="bubble plain">{says}</p>
      </div>
    {/if}

    {#if !pick && !contrast && ((ex.kind !== 'free' && ex.kind !== 'self') || done)}
      <button class="primary" data-tour="act" disabled={!canAct || judging} onclick={act}>{actionLabel}</button>
    {/if}
  {/if}
  {#if rightToo && ex}
    <div class="sheet-back" role="presentation" onclick={() => (rightToo = false)}></div>
    <div class="sheet plain" role="dialog" aria-label={t('I was right too')}>
      {#if rightTooMatch}
        <h2 class="display">{t('How close is “{given}” to “{answer}”?', { given: given().trim(), answer: lineOf(ex.answer) })}</h2>
        <button class="choice ok" onclick={sameMeaning}><strong>{t('Same meaning')}</strong><small>{t('Count it now, and accept either answer on both cards from now on.')}</small></button>
        <button class="choice close" onclick={closeMeaning}><strong>{t('Close, but not the same')}</strong><small>{t('Keep it as a mistake, but never offer these two side by side again.')}</small></button>
      {:else}
        <h2 class="display">{t('Count “{given}” as right?', { given: given().trim() })}</h2>
        <button class="choice ok" onclick={acceptGiven}>
          <strong>{!ex.reverse && !ex.cloze && !ex.picture ? t('Yes, and accept it from now on') : t('Yes, count it this time')}</strong>
          <small>{!ex.reverse && !ex.cloze && !ex.picture ? t('It is added to this card’s accepted answers. You can remove it in the card editor.') : t('Cards asked the other way round keep their own answer.')}</small>
        </button>
      {/if}
      <button class="quiet" onclick={() => (rightToo = false)}>{t('Cancel')}</button>
    </div>
  {/if}
  <p class="sr" role="status">{announce}</p>
  {#if help}
    <div class="keys plain" role="dialog" aria-label={t('Keyboard shortcuts')}>
      <p class="label">{t('Keyboard shortcuts')}</p>
      <dl>
        <dt><kbd>1</kbd>–<kbd>8</kbd></dt><dd>{t('Pick an option (self-check: 1 missed, 2 partly, 3 got it)')}</dd>
        <dt><kbd>1</kbd>–<kbd>9</kbd>, <kbd>⌫</kbd></dt><dd>{t('Building a sentence: place the numbered word; take back the last')}</dd>
        <dt><kbd>Enter</kbd></dt><dd>{t('Check, then continue')}</dd>
        <dt><kbd>E</kbd></dt><dd>{t('Explain this (with an AI connection)')}</dd>
        <dt><kbd>R</kbd></dt><dd>{t('Read aloud (when the deck reads aloud)')}</dd>
        <dt><kbd>S</kbd></dt><dd>{t('Skip for today')}</dd>
        <dt><kbd>Esc</kbd></dt><dd>{t('Leave; your place is kept')}</dd>
        <dt><kbd>?</kbd></dt><dd>{t('Show or hide this list')}</dd>
      </dl>
      <button class="quiet" onclick={() => (help = false)}>{t('Close')}</button>
    </div>
  {/if}
</section>

<style>
  .session {
    flex: 1;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding-block: 20px 24px;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .grow {
    flex: 1;
    min-height: 4px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bar {
    flex: 1;
    height: 12px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--brass);
    transition: width 0.25s ease;
  }
  .count {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head h1 {
    overflow-wrap: anywhere;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .option {
    min-height: 60px;
    padding: 8px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 19px;
    font-weight: 600;
    text-align: left;
  }
  .option .pic {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .option .pic :global(img) {
    max-height: 96px;
  }
  .kana-mark {
    background: color-mix(in srgb, var(--brass) 30%, transparent);
    color: inherit;
    box-shadow: inset 0 -4px 0 var(--brass);
    padding: 0 2px;
  }
  .ask-line {
    margin: 0;
    color: var(--muted);
  }
  .option .text {
    overflow-wrap: anywhere;
  }
  .badge {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    border: 2px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .option.picked {
    border: 5px solid var(--brass);
    padding: 6px 16px;
    outline: none;
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .option.picked .badge {
    border: none;
    background: var(--badge-bg);
    color: var(--badge-text);
  }
  .option.ok {
    border-color: var(--ok-line);
    outline: none;
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .option.off {
    border-color: var(--off-line);
    outline: none;
    background: var(--off-bg);
    color: var(--off-text);
  }
  .option.dim {
    opacity: 0.5;
  }

  .build {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .build .line {
    min-height: 68px;
    padding: 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .build .line.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .build .line.off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }
  .build .empty {
    color: var(--muted);
    font-size: 15px;
    padding: 0 6px;
  }
  .bank {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .tile {
    position: relative;
    min-height: 48px;
    padding: 6px 14px;
    border: 2px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-size: calc(19px * var(--scale));
    font-weight: 600;
    box-shadow: 0 3px 0 var(--line);
  }
  .tile:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--line);
  }
  .tile.placed {
    box-shadow: none;
    background: var(--sel-bg);
    color: var(--sel-text);
    border-color: var(--brass);
  }
  .line.ok .tile.placed,
  .line.off .tile.placed {
    background: transparent;
    color: inherit;
    border-color: currentColor;
  }
  .tile.ghost {
    display: inline-flex;
    align-items: center;
    visibility: visible;
    color: transparent;
    border-style: dashed;
    box-shadow: none;
    background: transparent;
  }
  .tile .key {
    position: absolute;
    top: 1px;
    left: 4px;
    font-size: 10px;
    font-weight: 400;
    color: var(--muted);
  }
  @media (hover: none) {
    .tile .key {
      display: none;
    }
  }
  .undo {
    align-self: center;
    min-height: 40px;
    padding: 0 16px;
  }

  .meet {
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  .meet .front {
    font-size: 32px;
    overflow-wrap: anywhere;
  }
  .meet hr {
    width: 64px;
    margin: 0 auto;
    border: none;
    border-top: 2px solid var(--brass);
  }
  .meet .back {
    font-size: 22px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .typed {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .field {
    width: 100%;
    min-height: 64px;
    padding: 0 18px;
    font-size: 22px;
    font-weight: 600;
  }
  .field:focus-visible {
    outline: 1px solid var(--hair);
    outline-offset: -8px;
    border-color: var(--brass);
  }
  .field.match,
  .field.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
    outline: none;
  }
  .field.close {
    border-color: var(--close-line);
    background: var(--close-bg);
    color: var(--close-text);
    outline: none;
  }
  .field.off {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
    outline: none;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .live.match {
    color: var(--ok-line);
  }
  .live.close {
    color: var(--close-line);
  }
  .live.off {
    color: var(--off-line);
  }

  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 5;
    width: 260px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .menu button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 14px;
    border: none;
    background: none;
    color: var(--text);
    text-align: left;
  }
  .menu button + button {
    border-top: 1px solid var(--hair);
  }
  .menu small {
    color: var(--muted);
  }
  /* A line with a speaker button beside it. */
  .said-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .said-row > :first-child {
    flex: 1;
    min-width: 0;
  }
  /* In the centred card, balance the speaker button so the words stay centred. */
  .meet .said-row:has(.speak)::before {
    content: '';
    flex: none;
    width: 44px;
  }
  .speak {
    flex: none;
    color: var(--muted);
  }
  .speak:hover {
    color: var(--text);
  }
  .in-banner {
    margin-left: auto;
    color: inherit;
  }
  .voice-note {
    margin: 0;
  }
  .hint-extra,
  .extra {
    margin: 0;
    color: var(--muted);
    font-size: calc(16px * var(--scale));
  }
  .after {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .after p {
    margin: 0;
  }
  .session :global(.option .text),
  .session :global(.back),
  .session :global(.field) {
    font-size: calc(19px * var(--scale));
  }
  .font-serif :global(.tile),
  .font-serif :global(h1),
  .font-serif :global(.option .text),
  .font-serif :global(.back),
  .font-serif :global(.front) {
    font-family: 'Fraunces', Georgia, serif;
  }
  .font-rounded :global(.tile),
  .font-rounded :global(h1),
  .font-rounded :global(.option .text),
  .font-rounded :global(.back),
  .font-rounded :global(.front) {
    font-family: ui-rounded, 'Nunito', 'Arial Rounded MT Bold', system-ui, sans-serif;
  }
  .font-mono :global(.tile),
  .font-mono :global(h1),
  .font-mono :global(.option .text),
  .font-mono :global(.back),
  .font-mono :global(.front) {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .self {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .area {
    width: 100%;
    padding: 12px 14px;
    font-size: 17px;
    line-height: 1.4;
    resize: vertical;
  }
  .fine {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .head.hidden {
    display: none;
  }
  .judging {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 14px;
    border-style: dashed;
  }
  .right-too {
    border-color: var(--emerald);
    color: var(--emerald);
  }
  .sheet-back {
    position: fixed;
    inset: 0;
    background: rgba(20, 16, 10, 0.45);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    margin: 0 auto;
    max-width: 520px;
    padding: 18px max(16px, env(safe-area-inset-left, 0px)) calc(18px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-width: 3px 3px 0;
  }
  .sheet h2 {
    margin: 0;
    font-size: 21px;
    overflow-wrap: anywhere;
  }
  .sheet .choice {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px;
    border: 2px solid;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .sheet .choice small {
    font-size: 14px;
  }
  .sheet .choice.ok {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .sheet .choice.close {
    border-color: var(--brass);
    background: var(--sel-bg);
    color: var(--sel-text);
  }
  .yours {
    background: transparent;
  }
  .tag {
    display: inline-block;
    padding: 0 6px;
    border: 1.5px solid currentColor;
    font-size: 11px;
    letter-spacing: 0.08em;
    vertical-align: 1px;
  }
  .explain {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .explain p {
    margin: 0;
  }
  .pair {
    display: flex;
    gap: 12px;
  }
  .pair button {
    flex: 1;
    min-height: 52px;
  }

  :global(.banner) {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 2px solid;
  }
  :global(.banner div) {
    display: flex;
    flex-direction: column;
  }
  :global(.banner strong) {
    font-size: 18px;
  }
  :global(.banner.ok) {
    border-color: var(--ok-line);
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  :global(.banner.off) {
    border-color: var(--off-line);
    background: var(--off-bg);
    color: var(--off-text);
  }

  .thoth-row {
    display: flex;
    align-items: stretch;
    gap: 12px;
  }
  .portrait {
    width: 88px;
    height: 88px;
    flex: none;
    border: 2px solid var(--line);
    background: var(--thoth-bg);
    overflow: hidden;
  }
  .bubble {
    flex: 1;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    line-height: 1.4;
  }

  .summary {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-top: 12px;
    text-align: center;
  }
  .thoth-big {
    width: 200px;
    height: 220px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    background: var(--thoth-bg);
    box-shadow: inset 0 0 0 5px var(--thoth-bg), inset 0 0 0 6px var(--hair);
  }
  .summary h1 {
    font-size: 32px;
  }
  .said {
    max-width: 34ch;
  }
  .stats {
    width: 100%;
    margin: 6px 0 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .stats div {
    padding: 10px 6px;
  }
  .stats dt {
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .stats dd {
    margin: 2px 0 0;
    font-size: 20px;
    font-weight: 600;
  }
  .streak {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--muted);
  }
  .meet .extra {
    font-size: 16px;
  }
  .rates {
    display: flex;
    gap: 8px;
  }
  .rate {
    flex: 1;
    min-height: 64px;
    border: 3px solid;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: 600 16px var(--body);
    color: var(--text);
  }
  .rate small {
    font-weight: 400;
    font-size: 12px;
    color: var(--muted);
  }
  .rate.missed {
    background: var(--off-bg);
    border-color: var(--off-line);
    color: var(--off-text);
  }
  .rate.partly {
    background: var(--close-bg);
    border-color: var(--close-line);
    color: var(--close-text);
  }
  .rate.got {
    background: var(--ok-bg);
    border-color: var(--ok-line);
    color: var(--ok-text);
  }
  .score {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    justify-content: center;
  }
  .score strong {
    font: 600 44px var(--button);
  }
  .score span {
    color: var(--muted);
  }
  .lessons {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
  }
  .lessons li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
  }
  .lessons li > span:last-child {
    display: flex;
    flex-direction: column;
  }
  .lessons small {
    color: var(--muted);
  }
  .tick {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--ok-bg);
    color: var(--ok-text);
    border: 2px solid var(--ok-line);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .keys {
    position: fixed;
    right: max(16px, env(safe-area-inset-right, 0px));
    bottom: 16px;
    z-index: 20;
    max-width: 340px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .keys dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 12px;
    font-size: 14px;
  }
  .keys dd {
    margin: 0;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border: 1.5px solid var(--line);
    border-bottom-width: 3px;
    border-radius: 4px;
    font: 600 12px var(--body);
  }
</style>
