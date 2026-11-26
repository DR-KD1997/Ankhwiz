# Changelog

What changed in each version of Ankhwiz. Downloads are on the
[Releases page](https://github.com/DR-KD1997/Ankhwiz/releases).

## 0.7.1.1 · 2026-11-26

[Every change to the code since 0.7.1](https://github.com/DR-KD1997/Ankhwiz/compare/v0.7.1...v0.7.1.1)

Small fixes and improvements to the library and Deck options.

### Changed
- **A deck's … button** in the library opens its Deck options, at the new
  **Place in your library** section (below Remembering, above Card kinds).
  There you choose the deck's subject and topic, or type new ones.
- **Drag and drop in Lists:** hold a deck for a moment, then drag it onto a
  subject or a topic to move it there. The list scrolls when you drag near
  the top or bottom edge.
- **All decks › Shelves:** several topics in a subject can be open at once.
  Each topic's decks are listed under its name, with a line between topics.
- **Read aloud in Deck options:** the checkbox for reading the question or
  the answer now sits beside its title, so the language pickers below use
  the full width, the same as the one for quotes.

### Fixed
- The **Pick up where you left off** panel on the home screen looks as it
  did before 0.7.1 again.

### Notes
- Android build number 13.

## 0.7.1 · 2026-11-26

[Every change to the code since 0.7.0](https://github.com/DR-KD1997/Ankhwiz/compare/v0.7.0...v0.7.1)

Furigana for Japanese decks, pictures that work as answers, and a library that stays short however many decks you have.

### Added
- **Furigana for Japanese decks:** readings over kanji, from Anki's
  `日本[にほん]` form or ruby markup (both used to show as plain text).
  - **When a deck is Japanese** (its language is set to Japanese, or its
    cards have kana beside their kanji), its page asks once how readings
    should show. Deck options › Readings has the same choices.
  - **Fade as you learn** (recommended): readings show over new words, turn
    lighter at Assisted recall and hide once a word reaches Firm recall, on
    every card that word appears on. A dotted line marks a hidden reading:
    tap the word to see it, and that answer counts as helped. Also
    **Always**, **When tapped** and **Never**. Every reading shows once you
    have answered.
  - **Reading cards:** the same question without furigana, answered in
    kana. Kana options that differ by one sound come first (べんきょう,
    べんきょ, へんきょう); you type the reading from Assisted recall on.
    Romaji turns into kana as you type, so any keyboard works, and hiragana
    and katakana count the same. Reading cards can start **after the
    meaning is firm** (one card per new word on its first day) or **from
    the start**, or stay off.
  - **Prepare for Ankhwiz › Furigana:** on this device, it finds readings
    in a card's own fields (ruby markup, Anki's bracket form, or a field
    holding only the kana reading) and joins them to the word. With your AI
    connection, Thoth suggests readings for the rest, flagging words with
    more than one fair reading. You review Thoth's suggestions before they
    are kept.
  - Read aloud follows the readings, so 今日 is said きょう.
- **Library views:**
  - **By subject:** one tile per subject. A subject opens on its topics
    and a topic on its decks, so no screen gets long.
  - **Lists:** subjects and topics both fold. A folded topic still shows
    what's due, **Open what's due** opens only those, and **Fold all**
    closes everything.
  - **All decks:** search across deck, topic and subject names, with
    filters (Due, In progress, Not started, Finished) and pinned decks at
    the top. Below them, shelves show each subject's topics as chips, one
    open at a time. Searching or filtering switches to plain rows of
    matching decks.
  - **Due / Recent strip:** across the top of By subject and Lists. It
    shows the decks with cards due, or the ones opened most recently, with
    **Study All** beside it. Study All replaces the old "Study all decks"
    panel.

### Fixed
- **Pictures as answers:** a card whose answer is only a picture is now
  answered by picking the picture from a set of pictures, instead of from
  copies of the word "(picture)". At Assisted recall it stays multiple
  choice, since a picture can't be typed. Sound-only answers work the same
  way, with sounds that play when picked.
- "(picture)" no longer appears as the heading of a picture-only question,
  as a wrong option on other cards, or in reading aloud.
- **Picture placement:** pictures with the question and the extra fields
  are centred. Deck options › Pictures can put them on the left instead.
- **Animated GIFs** play. Short videos embedded in Anki cards (.mp4, .mov)
  now play too, looping without sound like a GIF.
- When importing, a field holding only a picture shows "(picture)" instead
  of looking empty.

### Notes
- Decks keep the same data version (5). The new Deck options are additive,
  and 0.7.0 ignores them.
- Android build number 12.

## 0.7.0 · 2026-11-22

[Every change to the code since 0.6.0](https://github.com/DR-KD1997/Ankhwiz/compare/v0.6.0...v0.7.0)

Ankhwiz now speaks ten languages, gets imported decks ready in one go, counts answers that mean the same, and arranges your library by subject. It also has a new icon.

### Added
- **Prepare for Ankhwiz** (Deck options, and offered by Thoth on a newly
  imported deck's lessons): one screen that gets a deck ready for Ankhwiz's own features.
  - **On this device, in under a minute, with nothing sent anywhere:** finds
    the deck's languages and turns on reading aloud, places it under a
    subject and topic from its Anki name or its languages, links answers that
    mean the same, and offers to clear the text of fields no card shows.
  - **Full, with Thoth** (needs your AI connection): adds wrong options and
    extra right answers, flags cards that look doubtful (they keep the label
    "thoth-check" so you can find them in Cards), names lessons by theme,
    writes notes on answers that are easy to mix up, and writes stories for
    reading rounds.
  - You see what each step found, with examples, and choose what to keep.
    A backup is made first, so Deck options › Backups can undo all of it.
    Nothing in the cards' own text changes, and preparing carries on in the
    background while you study. A deck prepared before shows "Nothing has
    changed since" until it does.
- **Answers that mean the same:** when two cards share an answer, or one
  answer has two meanings, a lesson no longer marks a fair answer wrong.
  - **Same** links count either answer as right on both cards; **Close**
    links are never offered against each other as choices. Links are found on
    this device (the same answer with another question, or the same question
    with another answer), can be suggested by Thoth, and are saved straight
    away. Each card's editor has **Answers like this, on other cards**.
  - **Pick all that fit:** when a lesson has few cards and many shared
    meanings, the question asks you to select every option that fits.
  - **Side by side:** two cards that are easy to mix up are shown together
    after a slip, with each one's meaning.
  - **Quick check:** a new card that is close to one you know asks which of
    the two means what, before it moves on.
  - **Check typed answers that don't match** (Settings › AI connection): when
    a typed answer matches none of a card's answers, Thoth decides whether it
    is fair all the same; if it is, it counts and is accepted from then on.
- **Decks arranged by subject:** Your decks can be shown **By subject**
  (shelves such as Languages › Turkish › Conversational Turkish, or Math ›
  Trigonometry › Trigonometric Ratios) or as **Lists**, most due first with
  each deck's place under its name. A subject's page shows how much of it is
  learned, and **Mix the decks** studies every deck in it in one shuffled
  session, each card keeping its own deck's schedule. **Arrange your
  library** suggests places on this device from deck names and languages,
  and Thoth can suggest the rest from what the cards are about. Moving a deck
  never changes its cards or progress, and a deck can stay unsorted.
- **Ankhwiz in ten languages** (Settings › Language): English, Türkçe,
  Español, Português (Brasil), Français, Deutsch, Italiano, Русский, 日本語
  and 简体中文, or **System default**, which follows the language the device
  runs in. Lesson and unit names, Thoth's lines, plurals, numbers and dates
  follow the chosen language. **Thoth replies in** sets the language of
  Thoth's AI replies: the app's, or another of your choice.

### Changed
- **Read aloud the question, the answer or both** for each deck: Deck
  options has a Read aloud checkbox beside the Question language and the
  Answer language.
- **New app icon:** a cream ankh under a gold arch, on Windows, Linux and
  Android.

### Notes
- Decks keep the same data version (5); links and places are new fields that
  0.6.0 simply ignores.
- The translations are a first draft. Corrections from native speakers are
  welcome as issues on GitHub.
- Android build number 11.

## 0.6.0 · 2026-11-20

[Every change to the code since 0.5.1](https://github.com/DR-KD1997/Ankhwiz/compare/v0.5.1...v0.6.0)

Build decks for any subject, from scratch or from your own files and pages, practise in three new ways, and find voices by name. Big decks open and save faster, and imports run in the background.

### Added
- **Build a deck** (Your decks › Build a deck): choose what you are learning
  (words and phrases, formulas, dates and events, or questions and answers)
  and the deck gets fields to match. Type cards, or paste rows from a
  spreadsheet, check them in a list, and add them in one go. Decks also have
  **Add cards** for this.
- **Card types:** name a type's fields, choose which is the question, the
  answer and the extra, add, remove and reorder fields, and design the
  card's layout (Anki's templates and styling) with a live preview of your
  own cards. The layout is what Anki shows, and can be shown with the answer
  in Ankhwiz too. Cards made in Ankhwiz can be given a card type of their own.
  Scripts in layouts are left out, so shared decks stay safe.
- **Build from sources with Thoth** (needs your AI connection): add PDFs,
  Word documents (.docx), text and Markdown files, and web pages to a
  deck's sources. Thoth asks three quick questions (what it is for, how much
  you know, by when), suggests units and lessons from the shape of your
  sources for you to rename, reorder or drop, writes a few sample cards you
  can steer ("shorter answers", "keep technical terms"), then writes every
  lesson's cards. Each card links to the passage it comes from: tap "From"
  on its answer to read it with the sentence highlighted. A card whose
  sentence cannot be found in the source is added switched off, for you to
  keep or delete. Only the openings of each part of your sources are sent to
  plan the outline, and only the parts a lesson uses to write its cards.
  Video is not supported.
- **On Android, share to Ankhwiz:** a web page, some text, a PDF or a Word
  document shared from another app can go straight into a deck's sources.
- **Dictation** (Practice): hear a card, from its own recording or a voice,
  and write it, at normal speed or 0.7×. Answers are checked word by word,
  so one slip doesn't fail the sentence, and a missing accent counts as
  nearly right. Keys for the language's own letters, and first letters as a
  hint.
- **Unit recall** (Practice): no questions, just three minutes to write
  everything you remember from a unit. Near spellings count, words from
  other units are recognised, and cards you miss come back in the next day's
  review.
- **Reading round** (Practice, and after a lesson): sentences from your cards
  and their example fields, made of words you have studied, easiest first,
  with questions on them. Tap any word to see its meaning on your cards.
  With your AI connection, Thoth writes short stories from the words you
  know, and can prepare some ahead for times without a connection.
- **Unused fields:** an Anki note type's fields that no card shows can be
  left out when importing, or their text deleted later in Deck options
  (a backup is made first).

### Changed
- **Languages by name and flag:** everywhere a language is chosen (deck
  options, importing, Settings › Voices, the card editor) it is shown as
  "Turkish (Türkiye)" with its flag, instead of a code like tr-TR, and found
  by one search across names in English and in the language itself,
  countries, codes and other names (Farsi, castellano, Brazil). Languages
  with a voice ready on the device come first, then those Ankhwiz can
  download a voice for. Flags are drawn by a small font that comes with
  Ankhwiz, so Windows shows them too. Settings › Voices lists the device's
  own voices for each language, and can find a voice for any language.
- **Decks are stored in a new way:** a small head with the deck's settings
  and lessons, and its cards in chunks, so changing an option rewrites only
  the head and an edit only the chunks it touched. Backups share chunks with
  the deck instead of holding whole copies, and cards are stored more
  compactly. With the 33,000-card Turkish deck, the stored deck went from
  20.7 MB to 13.4 MB.
- **Decks are read when you open them:** Ankhwiz opens to your library
  without reading any deck's cards, so it starts as quickly with many big
  decks as with one. The deck you used last is read while the library is on
  screen, so it opens straight away (0.12 s with the Turkish deck); another
  big deck takes about half a second the first time.
- **Imports run in the background:** reading and building a deck from an
  .apkg happen away from the window, which stays usable. The Turkish deck
  now imports in about 3 seconds (from 5.6).
- **The card list keeps a search index**: each card's text is prepared
  once, so a search in a big deck no longer works through every card's text
  again with each letter typed.
- **Importing picks the right question:** a field that only holds a short
  label repeated across the notes (such as a "Kind" field saying "Sentence"
  or "Word") is no longer made the question; it is shown beside it instead.

### Fixed
- **Decks imported from .apkg files in 0.5.1 were not saved,** and once one
  had been imported, nothing else in that session was saved either: closing
  Ankhwiz lost the deck and the session's progress, and the app said "This
  device is not letting the app save". Imports are saved again, and decks
  are now stored in a way that cannot run into this.

Your decks and progress carry over: the first time 0.6.0 opens, it stores
your library in the new way. After that, an older Ankhwiz cannot read it;
it shows an empty library but leaves your data alone, so going back to
0.6.0 brings everything back.

## 0.5.1.1 · 2026-11-20

[Every change to the code since 0.5.1](https://github.com/DR-KD1997/Ankhwiz/compare/v0.5.1...v0.5.1.1)

A fix for decks imported from Anki in 0.5.1.

### Fixed
- **Decks imported from .apkg files were not saved,** and once one had been
  imported, nothing else in that session was saved either: closing Ankhwiz
  lost the deck and the session's progress, and the app said "This device
  is not letting the app save". The import screen left part of the deck in
  a form the device's storage cannot copy. Imports are saved again, and if
  anything like it happens again, Ankhwiz now saves a plain copy instead of
  failing.

A deck imported in 0.5.1 and lost when the app closed cannot be brought
back: import it again in 0.5.1.1.

## 0.5.1 · 2026-11-19

[Every change to the code since 0.5.0](https://github.com/DR-KD1997/Ankhwiz/compare/v0.5.0...v0.5.1)

Large decks now run as smoothly as small ones, and Bright Scribe gets a few touches.

### Changed
- **Large decks are fast.** With a 33,000-card deck imported from Anki, each
  answer in a lesson used to take 2 to 6 seconds; it now takes about as long
  as with the built-in Spanish deck. Measured with that deck on the same
  computer:

  | | 0.5.0 | 0.5.1 |
  |---|---|---|
  | Opening the deck | 6.3 s | 0.17 s |
  | Starting a lesson | 4.3 s | 0.10 s |
  | Each answer | 2 to 6 s | under 0.12 s |
  | Changing a deck option | 5.5 s | 0.13 s |
  | Importing the deck | 13 s | 5.6 s |

  How: decks are no longer copied whenever they're used; the learning core
  keeps each deck and is sent only the cards that changed; the lesson path
  is worked out in one go and waits while a lesson is open; long units show
  their lessons a window at a time; and answers save just the cards they
  changed, with the full progress written at the end of a session.
- **Bright Scribe:** at the end of a lesson he now fits inside his frame,
  disc and all, and his beak joins his head without a seam.

Your decks and progress carry over as they are.

## 0.5.0 · 2026-11-17

[Every change to the code since 0.4.1.1](https://github.com/DR-KD1997/Ankhwiz/compare/v0.4.1.1...v0.5.0)

Sentence building, mixed voices, downloadable voices, a welcome tour, a second portrait of Thoth, and faster big decks.

### Added
- **Build the sentence**: answers of three words or more are put together
  from word tiles in the first two stages, with a few words from other
  answers mixed in. Tap the words in order (or press their numbers, and
  Backspace to take one back). Chinese, Japanese and Thai are split into
  words by the device. Deck options › Card kinds turns it on or off for a
  deck, and the card editor can leave out a single card.
- **The other way round, spread out**: when a deck asks both ways, the
  reverse cards now come later in the lesson instead of straight after
  ("Spread out", the default), or the next day among the reviews ("Next
  day"), or as before ("Straight after"). Unless it is set to Straight after,
  only one way of a note comes up for review on any day (Anki: bury
  siblings).
- **Several voices in one card**: words in quotes can be read in another
  language (Deck options › Read quotes in another language), and words can
  be marked with their own language in the card editor (select them, choose
  the language, Mark). The speaker button reads the pieces one after
  another, each in its own voice, and the words read in another voice are
  underlined on the card. Anki's `<span lang>` and `[anki:tts]` markup is
  read on import and written back on export, and decks whose templates use
  `{{tts …}}` arrive with reading aloud on in those languages.
- **Downloadable voices**: Settings › Voices offers natural-sounding Piper
  voices for over 30 languages, run on the device and working offline once
  downloaded. The first one brings the voice engine (about 30 MB); each
  voice is about 20 to 65 MB. On Android, Settings › Voices can also choose
  which of the phone's speech engines reads, and open the phone's voice
  settings.
- **Thoth's welcome tour**: at first launch Thoth adds the sample deck with
  you and walks through the first lesson on the real app. Deck options,
  importing, the card editor, Test out and Study with Thoth each explain
  themselves the first time they open, and a **?** beside each explains it
  again. Settings › Tour and tips can replay the tour, turn the tips off, or
  show them all again. Skip at any point.
- **Bright Scribe**, a second portrait style for Thoth: rounder and
  friendlier, with the same movements, and a smile at cheering moments.
  Choose it in Settings › Thoth; Classic stays the default.
- **Import progress**: importing a large deck shows a bar while the file is
  read, the lessons are built and the pictures and sounds are saved.

### Changed
- **Big decks are much faster**. Measured on a 30,000-card deck: opening the
  deck 384 → 135 ms, starting a lesson 274 → 54 ms, each new card 289 → 67
  ms. The library is now saved in parts, so answering a card saves only that
  deck's progress instead of everything, and the card list shows 400 cards
  at a time.
- **Get it opens the release page in your browser.** The update prompt and
  Settings › Updates never did anything before, because the app's window
  does not leave Ankhwiz. Links to web pages now open in your own browser
  (or, if that fails, show the address to copy). Ankhwiz does not install
  updates by itself yet: download the new version from the release page.

## 0.4.1.1 · 2026-11-16

[Every change to the code since 0.4.1](https://github.com/DR-KD1997/Ankhwiz/compare/v0.4.1...v0.4.1.1)

The first published version of 0.4.1, with one addition. Everything listed
under 0.4.1 below is part of it, including the note for Android.

### Added
- **Change a deck's fields after importing it**: Deck options › Fields lets
  you choose again which Anki fields become each note type's question,
  answer and extra, add or remove fields, and drag them into order. Your
  progress is kept as long as the main question and answer fields stay in
  place. Changing either of them makes them different cards: Ankhwiz warns
  you first, asks once more, makes a backup of the deck, and then those cards
  start again from the beginning. Text you edited in Ankhwiz is kept, and
  still goes back to Anki on export.

## 0.4.1 · 2026-11-15

[Every change to the code since 0.4.0](https://github.com/DR-KD1997/Ankhwiz/compare/v0.4.0...v0.4.1)

Sounds, voices and a new look for Thoth.

> **Android:** this version is signed with Ankhwiz's permanent release key,
> so it cannot install over 0.4.0. Back up your library first (Settings ›
> Your library › Back up all), uninstall the old app, install this version,
> then restore. Every later version installs over this one.

### Added
- **Answer sounds**: a sound for a right, a nearly right and a wrong answer,
  and for the end of a lesson. Four sets, all made on the spot with no audio
  files: Reed marimba (the default), Lyre, Temple bell and Soft pop. Choose
  one, or Off, in Settings; the play button beside the list plays its
  end-of-lesson sound.
- **Reading aloud with the device's own voices**: the Windows voices,
  speech-dispatcher on Linux (through tauri-plugin-tts) and Android's
  text-to-speech, so it now works in the Android app too. Turn on Read aloud
  in a deck's options, or when importing, and a speaker button appears by the
  question and by the answer. The question and answer can each have their own
  language, swapped on reverse cards. When a language has no voice, Ankhwiz
  says where to add one instead of reading in the wrong voice.
- **Reading by itself**, in Settings: the question as each card opens, the
  answer once it is checked, both, or off. It applies to decks with Read
  aloud on.
- **Ask both ways for each kind of card**: each Anki note type, and the
  cards made in Ankhwiz, has its own setting, in the import screen and in
  Deck options.
- **Drag fields into order**: hold a field's grip and drag it up or down, in
  the import screen and in the card editor (or use the arrow keys on the
  grip). The field dragged to the top becomes the main one.
- **Updates when Ankhwiz opens**, if you choose: once a day at most, and a
  new version shows what's new in it, with Get it, Later or Skip this
  version. Ankhwiz asks once whether you want this; Settings can change it.
  Check now in Settings also shows what's new.

### Changed
- **Thoth's new look**: a slender ibis bill, ink outlines round the sun disc
  and the crown, and six pointed rays set out from the disc. In the square
  portraits beside his words in lessons, he still has no rays.
- Android builds are signed with the release key (see above), and a tagged
  release stops rather than publishing an APK signed with a throwaway key.
- The release workflow can sign the Windows program and installer through
  SignPath once the project is accepted (`windows/SIGNING.md`).
- Deck options from 0.4.0 that read the question or the answer by itself
  keep doing so, through the new Settings choice.

## 0.4.0 · 2026-11-15

[Every change to the code since 0.3.0](https://github.com/DR-KD1997/Ankhwiz/compare/v0.3.0...v0.4.0)

Ready for everyday use: Anki decks of every shape come in properly, and the
app gains the tools for studying day after day.

### Added

**Anki decks of every shape**
- Importing matches each note type for you from its card layout, or
  recognises it as an Ankhwiz, cloze or Image Occlusion type. Every choice
  can still be changed.
- **Question and Extra can hold several fields.** A + button beside the last
  field adds another, both when importing and in the card editor. On the
  card, each field is a little smaller than the one before, down to the
  fourth, and past the third the rest wait behind a dropdown arrow. The first
  Question field is the one swapped with the answer when a deck is asked
  both ways; the others then show with the answer, so they don't give it
  away. They travel to Anki as "Question 2", "Extra 2" and so on.
- **Pictures with hidden parts**, compatible with Anki's Image Occlusion:
  imported from Anki, or drawn in the card editor by dragging on a picture.
  Named parts are asked as questions (multiple choice, then typed), and
  their names come back from Anki intact. Unnamed parts are self-checked.
  "Hide every part while asking about one" or only the part asked.
- **Self-check cards** for cards the app cannot mark: those whose Anki
  layout uses scripts or drawing, unnamed picture parts, and long answers
  without an AI connection. You see the answer and choose Missed it, Partly
  or Got it (Again, Hard, Good). Any card can be made self-check.
- Imports can group cards into units by subdeck, by tag, or as one unit.
- After an import, Thoth's suggestions for lesson names and wrong options
  can open straight away (with an AI connection).

**Studying**
- **Test out of a unit:** up to 12 questions spread over its lessons,
  without hints. Pass 10 and the unit opens with its cards at stage 3;
  missed cards go back to stage 1 to relearn. One try a day.
- **Study all decks:** every deck's due reviews in one mixed session.
- **Pick up where you left off:** a lesson, review or all-decks session left
  part way is offered again on the path and in the library.
- **Keyboard shortcuts:** 1–8 pick an option (1–3 rate a self-check card),
  Enter checks and continues, E explains, R reads aloud, S skips for today,
  Esc leaves (your place is kept), ? lists the keys.

**Your library**
- **Back up everything** in one `.ankhlib` file: every deck with its
  pictures and sounds, your progress and your settings, never your AI key.
  Restore by adding the decks you don't have, or by replacing everything.
- **Daily reminder** at a chosen time and on chosen days, only when nothing
  has been studied that day. On Android it comes even when the app is
  closed; on desktop and in a browser, while Ankhwiz is open.
- **Update check** in Settings, only when you tap it.

**Thoth**
- Animations: breathing, blinking and glancing, a shimmering sun disc and a
  glinting crown; a nod for each new card, a brighter sun for a right
  answer, a sympathetic droop for a wrong one, a hop when a card moves up a
  stage, a thoughtful look while the AI works, delight at streak milestones
  (7, 30, 100 days and more), and a warm nod after a hard lesson.
- **Moves** or **Still** in Settings; he is still whenever the system asks
  for reduced motion.
- One-time tips introducing new features.

**Builds**
- A **Windows installer**: installs for you only, without administrator
  rights, with a Start menu entry and an uninstaller.
- A **Linux AppImage** that runs on any distribution.
- A GitHub workflow that tests every push and builds every platform for a
  tagged release.

### Changed
- Stored data now carries a version and is upgraded one step at a time.
  Data from a newer Ankhwiz is left untouched instead of overwritten.
- Long answers marked without AI use the same Missed it / Partly / Got it
  rating as self-check cards.
- A lesson opens once the lesson before it is fully met, so passing a test
  out opens the unit after it.
- Keyboard focus is shown with a higher-contrast ring, and each answer's
  result is announced to screen readers.
- Thoth's lines and the lesson screen's words moved into translatable text
  (`src/lib/i18n/`), ready for languages beyond English.
- `.ankh` files now include the pictures of picture cards.
- The desktop app is credited to DR-KD1997.

### Fixed
- Android builds are now always signed with the same key, so an update
  installs over the previous version and keeps your decks. 0.4.0 installs
  over 0.3.0 directly.

## 0.3.0 · 2026-11-12

Anki's deck features, in Ankhwiz's simpler form.

- A card browser and editor with each card's history; add, move, delete;
  rename and reorder lessons and units.
- Card kinds: both ways (a deck switch) and fill the gap, one card per gap.
- Question, Answer and Extra, with field mapping on import; Also accepted,
  Wrong options and Labels.
- Pictures and sounds on either side, from Anki imports or added in the
  editor.
- Deck options: daily goal, reviews per day, a retention slider, longest
  gap, days per stage, lesson size, accents, look (text size, font,
  right-to-left), read aloud, and copying options to every deck.
- Skip for today and Stop asking this one (Anki's bury and suspend);
  tricky cards; practice rounds that never change the schedule; a progress
  page.
- Export to `.apkg` for Anki (units as subdecks, lessons as tags, progress
  optional, FSRS memory and exact stages kept) and to `.ankh`.
- Thoth can change a deck directly from a plain request, with a preview of
  each change and an optional backup.

## 0.2.0

- The learning rules moved into a shared Rust core, compiled to WebAssembly
  for every platform.
- Study with Thoth through an AI service of your own: Ask, Add cards,
  Improve, Challenge rounds and Reading passages; "Explain this" after an
  answer; marking of long written answers.
- First builds for Windows, Linux and Android, with the AI key kept in each
  device's key storage.

## 0.1.0

- The first prototype: decks split into units and lessons, five mastery
  stages, app-graded multiple choice and typed answers with fading help,
  Thoth, the sample deck, Anki `.apkg` import and pasted lists.
