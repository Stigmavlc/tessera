# Project Master & Changelog

## 1. Project Overview

**Project Name:** Tessera
**Created:** 2026-08-06 (prototype predates; git history starts 2026-08-06)
**Description:** Mobile-first, frontend-only tile-rummy game (React 19 + Vite + TypeScript). Single player vs two local AI opponents (Maya, Leo). Built for Ivan's partner Lluci, who plays the official tile-rummy iPhone app — her expectations from that app set the product bar. Deployed to GitHub Pages; shared via personalised `?name=` links (Lluci, Mara).

**Trademark rule (binding):** the word "Rummikub" never appears in shipped code, docs, or marketing — the game is "tile rummy". The ★ joker never becomes a smiley face.

## 2. Current Status

- [x] Core game: rules engine, drag-and-drop table, AI opponents, scoring
- [x] Official-game parity release (14-task plan, all merged): split-on-drop, Lock View, random deals, endgame/timeout fixes
- [x] Partner feedback rounds 2–3: permissive splits, hover-forgiving drops, sacred rack order, distinct tile colors, whole-group hover glow, toast spacing, gear icon, misc visual polish
- [x] Deployment: GitHub Pages via Actions (auto-deploy on push to main), `?name=` personalisation
- [ ] Possible future: 777/789 sort as paid add-on; tap-to-hurry AI turns; post-merge cleanup batch (see §4)

## 3. Architecture & Key Files

- `src/game.ts` — pure rules engine (no DOM/React). Deals (`createDeal`/`seededRng`), meld analysis, drop resolution (`resolveTileDrop`: split → extend → draft), batch moves, scoring incl. stalemate, AI turns. Tested in `src/game.test.ts`.
- `src/layout.ts` — pure locked-view layout (row packing + fit camera). Tested in `src/layout.test.ts`.
- `src/App.tsx` — all UI/state/gestures/turn loop. `CLAUDE.md` documents the invariants (turn-commit model, new-meld sentinel, dnd-kit id table, Lock View vs free camera).
- `src/styles.css` — single global stylesheet.
- `docs/superpowers/specs/2026-08-06-rummikub-parity-design.md` — design spec incl. all post-release rulings.
- `docs/superpowers/plans/2026-08-06-rummikub-parity.md` — executed implementation plan.
- `.github/workflows/deploy.yml` — test + build + deploy to GitHub Pages on push to main.

## 4. Development Notes

- **Rulings log** (details in the spec): split checked before extend; splits always fire on interior duplicates even if a half stays an incomplete draft; the rack is never re-sorted programmatically; drops integrate on hover (26px grace, dragged-tile rect, pointer drags only); 777/789 buttons removed at Lluci's request (engine sorts kept, tested, unwired — candidate paid add-on).
- **Timing:** opponents think for a random 3–10 s per turn; 60 s player timer; timeout = auto-submit legal table / restore + draw 1 / pass when pool empty.
- **Deferred cleanup batch** (from the final branch review, all minor): `insertIntoGroup` helper to kill 3× splice/clamp duplication, `MotionConfig reducedMotion="user"`, localStorage try/catch, `handleDraw` empty-pool guard, a few test gaps (sortRackByRuns non-mutation, joker-in-stalemate rack, 3-way tie, cross-group id collision), monotonic counter for split-id minting, `deal` state is write-only.
- **Verification:** `npm test && npm run build` (build is the only typecheck; no linter). 47 tests green as of 2026-08-07.
- **Deploy quirk:** pushes made via the gh-CLI OAuth token have not been triggering the Pages workflow's `on: push` — if `gh run list` shows no new run after a push, run `gh workflow run deploy.yml` (deploys current main). Verify with the bundle hash at the live URL.

## 5. Changelog

### 2026-08-07
- iOS audio engine fix: fades moved to a Web Audio gain node (iOS ignores element.volume writes — old fades never completed, so music couldn't stop/switch on iPhone); unlock listens for click/keydown (iOS doesn't count pointerdown); volume 0.4 → 0.22 → 0.1
- Tap-to-begin splash: browsers never allow sound before the first interaction, so a one-tap entry splash starts the lobby music the moment the app is "opened"
- Audio: ElevenLabs music (lobby + table tracks, 6+ min each, looping with crossfade), fade-to-black screen transition with music handoff, synthesized turn-clock tick (last 10 s, rising volume), ceramic tile-place click
- Audio controls: music / SFX split into separate persisted settings with always-visible icon toggles on the home hero and the game felt, plus the settings sheet
- Identity: app icon (brand-mark tile via Higgsfield), favicon, apple-touch-icon, PWA manifest — installs as "Tessera" from Add to Home Screen
- Settings sheet: swipe/drag down to dismiss
- Opponents: random 3–10 s thinking delay per turn
- Arrows: circled ↗ replaced with clean inline arrows (Play now, Play again)
- Home: hero tile run moved below the wordmark; player-divider dots centred on avatars
- Deployment: GitHub Pages workflow, relative Vite base, `?name=` personalised seat labels

### 2026-08-06
- Parity release (19 commits): split-on-drop, tail-grab, Lock View (locked default + free toggle, persisted), random deal every game, 777/789 sorts, pool-empty pass/stalemate endgame, app-style timeout (revert+1), docs; trademark scrub
- Partner feedback v2: splits always fire (halves may be incomplete), hover-forgiving drop targeting, rack order preserved on returns, 777/789 buttons removed, terracotta/marigold tile inks separated
- Partner feedback v3: toast spacing, whole-group hover glow + scale, gear settings icon
- Repo initialised; spec + plan authored and executed via reviewed subagent tasks

## 6. Session Context

*Status end of 2026-08-07 session: game live at https://stigmavlc.github.io/tessera/ (repo Stigmavlc/tessera). Lluci `?name=Lluci`, Mara `?name=Mara`. Full audio experience shipped: tap-to-begin splash → lobby tavern track → fade-to-black on Play with music handoff to table track → turn-clock tick (last 10 s) + ceramic tile clicks → visible music/SFX toggles both screens, persisted. Music tracks were generated by Ivan in the ElevenLabs web UI (he has an account) — regenerating/adding tracks goes through him. Music volume currently 0.1 (lowered twice; may need further taste adjustment). Awaiting Lluci's verdict on the audio round. Remember the deploy quirk (§4): push does not auto-trigger Pages; run `gh workflow run deploy.yml` after pushing. Open ideas: tap-to-hurry AI turns, 777/789 paid add-on, §4 cleanup batch, possible per-channel volume slider in settings.*
