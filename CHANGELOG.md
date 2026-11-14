# Changelog

What changed in each version of Ankhwiz. Downloads are on the
[Releases page](https://github.com/DR-KD1997/Ankhwiz/releases).

## 0.4.0 · 2026-11-15

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
