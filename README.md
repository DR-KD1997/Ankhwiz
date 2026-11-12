# Ankhwiz 0.3

Anki's deck features, in Ankhwiz's simpler form: a card browser and
editor, card kinds (both ways, fill the gap), Question / Answer / Extra
with field mapping on import, pictures and sounds, deck options (daily
goal, a retention slider, look, read aloud), skipping and stopping cards,
tricky cards, practice rounds, progress, and export to `.apkg` and `.ankh`.
Thoth can now change a deck directly from a plain request, with a backup
first. Learning rules live in the shared Rust core.

Nothing here talks to a server of ours: no accounts, no sync. The only
network use is the AI connection you set up yourself in Settings.

## The builds

Download them from the [Releases page](https://github.com/DR-KD1997/Ankhwiz/releases). (Windows: unzip, keep the two files together.)

| File | What it is | Tested how |
| --- | --- | --- |
| `Ankhwiz-0.3.0.html` | The whole app in one file, for any current browser | Full lesson and AI walkthroughs in Chromium |
| `Ankhwiz_0.3.0_amd64.deb` | Linux installer (Debian, Ubuntu, Mint) | Launched on a virtual screen: lessons, saving, AI requests, key storage |
| `ankhwiz-linux-x86_64` | The same Linux program without an installer | As above |
| `Ankhwiz-0.3.0-windows-x64.zip` | Windows program (portable, no installer) | Compiled on Linux; starts on a Windows stand-in up to the point of needing WebView2; never run on real Windows |
| `Ankhwiz-0.3.0-debug.apk` | Android app | Packaged and signature-checked; its interface tested in Chromium against a stand-in for the Android shell; never run on a device |

See **Build notes** below for what each one needs and what is provisional.

## Where things are

On a deck's screen, under the lesson path's top:

| Button | What it holds | Anki's name |
| --- | --- | --- |
| Study with Thoth | Ask, Add cards, **Improve** (now with "Change the deck in your own words"), Challenge, Reading | – |
| Deck options | Daily goal, Remembering slider, Card kinds, Lessons, Look, **Export**, Backups, Advanced, Remove deck | Deck options, presets |
| Cards | Every card by unit and lesson: search, labels, filters, the card editor with history, rename and reorder lessons | Browser |
| Progress | Cards by stage, the week ahead, share remembered, streak calendar, tricky cards | Statistics, leeches |
| Practice | Tricky cards, one unit, or cram: never changes the schedule | Custom study, filtered decks |

During a lesson, the **…** button holds *Skip for today* (Anki: bury) and
*Stop asking this one* (Anki: suspend).

## Try it

1. Add the sample deck, or import an Anki `.apkg` (you choose which fields become question, answer and extra) or an `.ankh`, or paste a list.
2. Do the first lesson.
3. In Settings, use **+1 day** to try tomorrow's review without waiting.
4. In Settings, set up an **AI connection**, then open **Study with Thoth** on a deck.

## What works

| Area | In this build |
| --- | --- |
| Lessons | Deck > unit > lesson path. Lessons unlock in order. Lesson size 3 to 12, per deck. |
| Stages | Five mastery stages with promotion on separate days and one-stage demotion. |
| Multiple choice | 2 to 8 options. Wrong options from the same lesson, then unit, then deck. Harder (more similar) options later. |
| Typed answers | Live green / yellow / red in stage 3, plain text in stages 4 and 5. One spelling retry. |
| Long answers | Written freely. Marked by AI as correct or not (you can overrule it); without AI you compare for yourself. |
| Grading | The app grades every answer and maps it to Again / Hard / Good / Easy. AI marks count as Again or Good only. |
| Card kinds | One way, both ways (a deck switch), fill the gap (`{{c1::…}}`, one card per gap). |
| Fields | Question, Answer, Extra (after answering, or as a hint), Also accepted, Wrong options, Labels. |
| Media | Pictures and sounds on either side, from Anki imports or added in the editor. Kept on the device. |
| Deck options | New lessons a day (a goal you can pass), reviews a day, desired retention, longest gap, days per stage, lesson size, accents, look (text size, font, right-to-left, read aloud). Copy options to every deck. |
| Editing | Card editor with per-card history; add, move, delete; rename and reorder lessons and units; backups (5 per deck) with restore. |
| Export | `.apkg` for Anki (units as subdecks, lessons as `ankh::` tags, Extra and media included, progress optional) and `.ankh` (everything, exactly). |
| Reviews | Due cards woven into lessons (three at most) and a separate review session. |
| Thoth | Built-in lines. Full, Quiet or Hidden. Hidden keeps a plain Suggestions list. |
| Streak | Counts days with a finished session. No rewards. |
| Import | `.apkg` in both Anki package formats, and pasted lists. |
| Themes | Light and dark, from the final concept. Follows the system or a manual choice. |
| Layout | One column when narrow; path and lesson side by side from 960 px. |

### AI features

Set up under Settings > AI connection. Presets for OpenAI, Google Gemini,
Grok (xAI), OpenRouter, Ollama and LM Studio, or any address that speaks the
OpenAI chat format. The app lists the service's models for you to pick: one
for quick jobs, optionally a stronger one for larger jobs.

| Feature | Where |
| --- | --- |
| Ask Thoth: questions about the deck's subject, answered from its cards first | Study with Thoth > Ask |
| Draft cards from a topic or from pasted source text | Add cards |
| More accepted answers, harder wrong options, flags on doubtful cards | Improve |
| Names for lessons | Improve |
| Challenge rounds: fresh questions that never change the schedule | Challenge |
| Reading passages with questions, written by AI or by you | Reading |
| Direct changes: describe a change, preview each edit, choose whether to keep a backup | Improve |
| "Explain this" after any answer | Lesson screen |
| Marking of long written answers | Lesson screen |

Safeguards: everything AI writes arrives as a draft to approve; cards AI
wrote or changed carry an "AI" tag; a notice before the first request says
what is sent and where; larger jobs show a token estimate first. The key is
kept by the device (Windows Credential Manager or the Linux keyring on
desktop, the Android Keystore on Android, browser storage in the one-file
version) and is never written into decks or backups.

## How it is put together

```
core/          Rust. All learning rules: stages, grading, sessions, lesson
               splitting, scheduling, AI prompts and reply checking.
               One JSON entry point. 55 tests (cargo test).
src/           The shared interface (Svelte, TypeScript). Calls the core,
               compiled to WebAssembly, through src/lib/core/index.ts.
src/lib/platform.ts
               The few services each shell provides: web requests for AI,
               key storage, saving a file.
src-tauri/     Desktop shell (Tauri 2): Windows and Linux.
android/       Interim Android shell (a web view and the same services).
scripts/       build-core.sh, build-android.sh
```

The core carries no clock, randomness or network of its own: the shell
passes the time in and sends requests out. That is what lets the same
compiled core run in a browser, on desktop and on Android.

## Round trip with Anki

Tested with Anki 26.09's own library: an exported `.apkg` imports with
every note, card, subdeck, tag, picture and due date; Anki keeps each card's
FSRS memory and the exact Ankhwiz stage (in the card's custom data). Exported
back from Anki in its current format, the deck returns to Ankhwiz with its
lessons, Extra, labels, accepted answers, wrong options, media and stages.
Notes that came from Anki go back under their own note type and fields, and
unchanged notes go back exactly as they came.

## Still stand-ins

| Here | Later |
| --- | --- |
| FSRS formulas inside the core (`core/src/schedule.rs`) | Anki's engine (`rslib`) |
| `.apkg` reading and writing in the web view (SQLite via sql.js) | Anki's own importer and exporter in the engine |
| Storage in the web view (IndexedDB) | The Anki collection file |

Not built yet: adaptive stage thresholds (they can be set by hand per deck
under Advanced), card templates you can edit (imported ones are kept for
export and shown read-only), sync.

## Develop

Needs Node 20 or newer, and Rust with the `wasm32-unknown-unknown` target to
change the core.

```
npm install
npm run dev              # interface at http://localhost:5173
npm test                 # bridge and import tests
(cd core && cargo test)  # the learning rules
npm run check            # type check
scripts/build-core.sh    # after changing core/: rebuilds the WebAssembly module
npm run build:single     # dist-single/index.html, the one-file version
```

`src/lib/core/wasm.generated.ts` is the compiled core as text. It is checked
in so the interface builds without a Rust toolchain.

## Build notes

**Linux.** `npm run tauri build` makes the `.deb`. Needs the WebKitGTK 4.1
development packages. It installs on Debian-family systems and needs
`libwebkit2gtk-4.1-0` (pulled in automatically by the installer). AppImage
and Flatpak packaging were not possible on the build machine; either can be
added with `npm run tauri build -- --bundles appimage` where downloads from
GitHub are allowed.

**Windows.** `npm run tauri build` on Windows, with Microsoft C++ Build
Tools, makes an installer. The `.exe` in `builds/` was instead cross-compiled
on Linux with the MinGW toolchain and an unofficial build of the Rust
standard library, because the usual Windows toolchain could not be
downloaded there. Treat it as a first look: it has never been started on
Windows. It needs WebView2, which is part of Windows 11 and of up-to-date
Windows 10. Keep `WebView2Loader.dll` beside the `.exe` if the zip has one.

**Android.** `scripts/build-android.sh` packages the one-file interface in a
small web-view app using only `aapt`, `javac`, `dx`, `zipalign` and
`apksigner`. It is signed with a throwaway debug key: fine for trying on
your own phone (allow installing from unknown sources), not for publishing.
Requires Android 7.0 or newer. The plan's Tauri Android shell needs Google's
SDK and NDK (`npm run tauri android init`), which were not reachable; when it
replaces this shell, the interface and core stay exactly as they are.

## Licences

Ankhwiz is AGPL-3.0-or-later (see `LICENSE`), as a derivative of Anki. Earlier
history of this repository is Anki's own, from the fork it began as. Third-party code in
the core is listed in `core/THIRD-PARTY.md`.
