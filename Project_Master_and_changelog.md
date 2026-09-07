# Project Master & Changelog

## 1. Project Overview

**Project Name:** Tessera
**Created:** 2026-08-06 (prototype predates; git history starts 2026-08-06)
**Description:** Mobile-first, frontend-only tile-rummy game (React 19 + Vite + TypeScript). Single player vs two local AI opponents (Maya, Leo). Built for Ivan's partner Lluci, who plays the official tile-rummy iPhone app — her expectations from that app set the product bar. Deployed to GitHub Pages; shared via personalised `?name=` links (Lluci, Mara).

**Trademark rule (binding):** the word "Rummikub" never appears in shipped code, docs, or marketing — the game is "tile rummy". The ★ joker never becomes a smiley face.

## 2. Current Status

- [x] Core tile-rummy rules, local AI opponents, scoring, opening melds, and endgame
- [x] Responsive selection, progressive hold-to-select, and batch dragging
- [x] 789 / 777 rack sorting and manual arrangement during every player’s turn
- [x] Precise pointer-based drops, separate placement on empty felt, and board-sized drag previews
- [x] Camera lock preserves group positions; pan/pinch/zoom and Fit remain available
- [x] Readable large racks and full-width mobile landscape play
- [x] One-tap Take back for the entire current turn, alongside single-action Undo
- [x] Plain textured felt with embossed Tessera branding; white dots and corner guides removed
- [x] Realistic ivory tiles and a textured terracotta rack with raised row ledges, now the default
- [x] Terracotta-rack release published to GitHub Pages and verified using the original Mara link
- [x] Local follow-up: compatible meld previews/approach areas, prominent turn band, and staged opponent moves
- [ ] Publish the interaction follow-up after local review
- [ ] Physical-phone playtesting of touch feel, rotation, safe areas, and browser bars
- [ ] Optional future work: tap-to-hurry AI turns and the deferred cleanup items below

## 3. Architecture & Key Files

- `src/game.ts` — pure rules engine: deals, meld analysis, split/extend/draft resolution, batch moves, scoring, and AI. Tests: `src/game.test.ts`.
- `src/layout.ts` — free-position group placement and tile footprints sized for the viewport. Searches nearby space when groups overlap; no automatic locked-view row packing. Tests: `src/layout.test.ts`.
- `src/interactions.ts` — pointer collision priorities, pointer/world coordinates, drag-preview centring, batch rack reordering, and restoration of rack order. Tests: `src/interactions.test.ts`.
- `src/opponent-presentation.ts` — incremental public tile reveal frames, with tests.
- `src/App.tsx` — UI, state, gestures, turn loop, camera, Take back, rack shelves, and embossed table branding.
- `src/styles.css` — core layout, colours, responsive views, table branding, and controls.
- `src/physical-tiles.css` — default realistic tile and terracotta rack finish; imported after the main stylesheet. Appearance uses CSS shading rather than perspective transforms that would distort hit areas.
- `src/audio.ts` — music, tile sounds, and turn-clock sound; existing audio behaviour retained.
- `CLAUDE.md` — current architecture and invariants for future development.
- `docs/interaction-checks.md` — repeatable touch, rack, recovery, keyboard, and viewport checks.
- `docs/superpowers/` — historical design specifications and completed plans. Where older rulings conflict with this document, the September 2026 decisions below describe the current implementation.
- `.github/workflows/deploy.yml` — tests, build, and GitHub Pages deployment on pushes to `main`.

## 4. Development Notes

### Current interaction decisions

- **Sorting is a convenience.** 789 orders by colour then number; 777 orders by number then colour. Both are available during everyone’s turn. They only reorder the player’s rack and do not suggest board moves. The earlier paid-add-on idea is superseded.
- **Rack arrangement is preserved.** Manual batch and single-tile reordering work during opponents’ turns, without restarting their thinking delay. Drawing or restoring a draft preserves the order of currently held tiles and appends returning/missing tiles.
- **Selection:** a stationary hold begins selecting at 300 ms and extends right every 180 ms. Moving more than 4 px starts dragging and stops selection growth; releasing or cancelling stops the hold timer.
- **Precise placement:** use the actual pointer for both hit-testing and placement. A compatible meld accepts nearby drops within 40 screen px horizontally and 10 px vertically. Its eligible ends show previews with 46 px touch targets; explicit left/right insertion honours the chosen side. Incompatible groups do not attract tiles. Empty felt below the row creates a separate group; an off-table drop does not fall back to the nearest meld. Keyboard targeting still uses nearest-centre logic.
- **Drafts:** incomplete groups and deliberate duplicate-run splits remain supported. An incompatible rack addition to a complete meld is refused without consuming the tile. Legality, opening points, and conservation still apply at End Turn.
- **Stable board:** camera locking does not repack the table. Rack space stays expanded as tiles are played so the board does not resize under a drop. Large hands use additional readable rows, with scrolling when required.
- **Take back:** restore `turnStart.board`, return the turn’s rack tiles using the current rack order, and restore `turnStartPositions`. Clear selection, move count, and Undo history. Do not draw, reset the timer, or end the turn. This also repairs table groups split or rearranged during the draft. Disabled with no draft history, outside the player’s turn, after a win, or while dragging.
- **Turn visibility:** a blue band beside the rack, matching header, and repeated timer identify your turn. Opponents place public tiles one at a time with travel from their seat, persistent highlights, and an action summary. Draws remain face down. Reduced motion retains the sequence without travel. Your full minute starts after both opponents finish.
- **Timeout:** opponents think for 3–10 seconds; player turns last 60 seconds. A legal draft submits; an unfinished draft restores the table and draws exactly one tile; an idle turn draws one, or passes when the pool is empty. There is no double-penalty draw.

### Visual direction

The accepted finish is warm terracotta, not the dark charcoal used in the first rack experiment. Preserve the ivory tile faces, moulded edges, recessed-looking coloured numbers, geometric colour markers, fine texture, and supporting ledges for each rack row. The table keeps its subtle embossed Tessera mark and plain felt without white dot patterns or corner guides.

The realistic finish started behind `?tiles=realistic`, then became the default. The original `?name=Mara` link now shows it automatically. Old preview links remain usable, but the parameter has no visual effect.

### Verification and release

- `npm test` and `npm run build` passed with **64 tests**. The build also typechecks; no linter is configured.
- Browser checks covered a deterministic 24-tile rack, touch hold-and-drag, precise placement below an existing group, overlay sizing, off-table cancellation, sorting and manual reordering during opponents, uninterrupted AI, keyboard reordering/Escape, touch cancellation, sorting after a draw, and Take back on empty and occupied tables.
- Viewports checked across the session: portrait 390×844, 375×667, and 320×568; landscape 844×390 and 667×375; desktop 1280×900. Physical-device feel remains a manual check.
- Latest verified app commit: `1a2f812` — make the realistic terracotta rack the default. [Successful deployment](https://github.com/Stigmavlc/tessera/actions/runs/34074349311).
- The live original link was checked in a fresh browser: [Play as Mara](https://stigmavlc.github.io/tessera/?name=Mara). It rendered the terracotta finish, both shelf rows, 14 starting tiles, and the Mara label without a preview parameter.
- Push-triggered deployment worked in this session. The August note that pushes always need a manual workflow dispatch is no longer a current requirement. Check Actions after pushing; use manual dispatch only if a run does not start.
- Local browser scripts and screenshots in `.playwright-mcp/` are ignored diagnostic artifacts, not portable committed test infrastructure. Use `docs/interaction-checks.md` for durable reproduction steps.

### Deferred cleanup

The earlier optional cleanup list remains: deduplicate meld insertion logic; use `MotionConfig reducedMotion="user"`; guard localStorage access; guard `handleDraw` against an empty pool internally; broaden a few engine edge-case tests; use a monotonic split-ID counter; remove redundant `deal` state. These were not part of this release.

## 5. Changelog

### 2026-09-07 — interaction follow-up (local, not yet published)

- Added compatible-meld insertion previews, broad left/right targets, and selective nearby association. Verified blue 4 joins blue 5–8 even from an approximate drop; a new trio below stays separate. Explicit side targets preserve joker/end placement.
- Added the blue Your turn band beside the rack and matching header.
- Opponents now lift and drag each tile face down, reveal its number only on landing, update their tile count incrementally, and leave additions highlighted. Their action summary persists into your turn; drawing uses a face-down tile. Sorting does not restart their sequence.
- Checked 64 unit tests, production build, the blue-run reproduction, staged AI turns, and portrait/landscape layouts.

### 2026-09-07 — published rack release

- Converted player feedback into faster selection, progressive hold-to-select, accurate batch dragging, and consistent pointer-based board placement.
- Restored visible 789 / 777 sorting as normal rack controls. Enabled manual rack arrangement during opponents and stopped rack changes from restarting AI thinking timers.
- Removed proximity snapping and automatic table repacking from the default camera mode. Drag previews now match board tile size; rack height remains stable as tiles are played.
- Added readable large-hand rows, stronger tile ink colours, and full-width landscape play.
- Added Take back to restore the entire current turn without drawing or resetting the timer. Retained Undo for individual actions.
- Removed the felt’s white dots and corner guides; added the existing Tessera logo with subtle relief.
- Built a realistic-rack preview with textured surfaces, ivory tiles, moulded thickness, recessed-looking numbers, and supporting ledges. Revised its dark rack to warm terracotta after user feedback.
- Promoted the realistic terracotta finish from a URL-gated experiment to the default appearance, resolving why the original shared link still showed the old rack.
- Verified 57 automated tests, the production build, mobile/browser interactions, successful Pages deployment, and the actual original live link.
- Release commits: `1c2358a` (interactions and mobile layout), `7fd92bd` (Take back, branding, rack appearance), `1a2f812` (default realistic rack).
- Updated the project master, architecture guidance, README, and regression notes so future work follows the new decisions.

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

*Published rack release:* the terracotta-rack version is live at https://stigmavlc.github.io/tessera/ and the original personalised links work unchanged (`?name=Mara`, `?name=Lluci`). The realistic terracotta rack is now the default, not a preview. The final release was pushed and deployed successfully; the original Mara URL was browser-verified. The user approved the realistic tile treatment and requested a warmer rack colour, which is implemented.

Next useful step is a real-phone playtest, particularly holding and dragging selections, placing below existing melds, Take back near timeout, and rotating with a large rack. No gameplay task is currently outstanding from this session. Optional cleanup is listed in §4.

Existing audio context is unchanged: music tracks came from Ivan, music volume was last set to 0.1, and the iOS Web Audio/gesture-unlock constraints still apply. The documentation updates in this final handoff are local folder changes; the app release status above refers to commit `1a2f812`.
