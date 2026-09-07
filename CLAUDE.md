# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tessera is a mobile-first, frontend-only tile-rummy game prototype (React 19 + Vite + TypeScript). There is no backend, database, or network layer — each game deals randomly via `createDeal` (seedable with `seededRng` for tests). Opponents ("Maya", "Leo") are local AI.

## Commands

```bash
npm install
npm run dev        # vite --host 0.0.0.0 — binds all interfaces so a phone on the LAN can load it
npm run build      # tsc -b && vite build — this is also the only typecheck
npm test           # vitest run
npm run test:watch
```

Single test / filter: `npm test -- -t "uses jokers to bridge"` or `npx vitest run src/game.test.ts`.

There is no linter or formatter configured. Verification = `npm test && npm run build`.

## Deployment

GitHub Pages (repo `Stigmavlc/tessera`), auto-deployed by `.github/workflows/deploy.yml` on every push to `main` (runs tests + build first). Vite uses `base: "./"` so the same build works locally and under the Pages subpath. Live URL: https://stigmavlc.github.io/tessera/ — personalised seat labels via `?name=` (display-only, `localPlayerName` in App.tsx; engine keys stay "You").

## Architecture

The main implementation files are:

- **`src/game.ts`** — the pure rules engine. No React, no DOM, no I/O. `createDeal(rng = Math.random)` is the only source of randomness, and it's injectable (`seededRng(seed)` gives tests a deterministic generator). Every exported function is a pure transformation over `Tile[]` / `BoardGroup[]`. This is a tested layer (vitest runs with `environment: "node"`), covered by `src/game.test.ts`.
- **`src/layout.ts`** — pure free-position placement and viewport-aware tile footprints (`positionTableGroups`, `tableFootprint`). Keeps requested positions where space permits and searches nearby when groups overlap. Covered by `src/layout.test.ts`.
- **`src/interactions.ts`** — pointer-based collision targeting with compatible-meld approach areas, pointer/world conversion, centred drag previews, batch rack ordering, and snapshot rack-order restoration. Covered by `src/interactions.test.ts`.
- **`src/opponent-presentation.ts`** — pure incremental reveal frames for publicly played AI tiles. Tested independently; never exposes unplayed rack faces.
- **`src/App.tsx`** — all UI, state, drag-and-drop, gestures, and the turn loop. `GameScreen` holds ~30 `useState` hooks and is the single source of game state.
- **`src/audio.ts`** — all sound: a synthesized Web Audio turn-timer tick (last 10s, volume ramps with urgency), a ceramic tile-place click, and a looping music player for `public/audio/lobby.mp3` / `table.mp3`. CRITICAL iOS constraints baked in: fades run on a Web Audio gain node with clock-based completion (iOS ignores `element.volume` writes), and unlock requires click/keydown (pointerdown does not count) — the tap-to-begin splash in App provides the gesture. Silent no-op when files are missing. Music and effects have separate persisted settings (`tessera.music`, `tessera.sfx`, with legacy `tessera.sound` fallback); haptics use `tessera.haptics`. Settings live in `App` and flow into `GameScreen` as props.
- **`src/styles.css`** — core global styles, responsive layout, controls, and embossed table branding, with CSS custom properties in `:root`.
- **`src/physical-tiles.css`** — default realistic ivory tiles and textured terracotta rack. Imported after the main styles; scoped under `.app-stage--physical`, which is always present. No preview query parameter is required. Row ledges are non-interactive overlays and must not intercept gestures.

No CSS modules, Tailwind, or styled-components are used. Class names are BEM-ish (`.meld--invalid`, `.rack-tile--dragging`).

Keep pure rules, placement, and interaction helpers in their respective modules and UI/state in `App.tsx`. See `Project_Master_and_changelog.md` for the current product decisions and `docs/interaction-checks.md` for regression scenarios. Historical August specs do not override the September behaviour.

### The turn-commit model (most important invariant)

`turnStart: TurnSnapshot` (`App.tsx`) is an immutable baseline captured at the start of your turn. During the turn, `board` and `rack` are edited **permissively** — illegal drafts are allowed on the table on purpose. Full table legality is enforced when the turn is committed, by `validateTurn(turnStart, board, rack)` (`game.ts`), which re-derives which tiles were played by diffing rack IDs.

Because of this:

- Abandoning a turn (draw, timeout penalty, pass) does **not** replay undos — it restores wholesale from `cloneTurnSnapshot(turnStart)` (see `handleDraw`, `App.tsx`, and `handlePass`, `App.tsx`).
- `turnStartPositions` mirrors `turnStart` for the free-position layer and must be restored alongside it.
- `history: ActionSnapshot[]` is a separate per-action undo stack, cleared on every turn boundary.
- Draft-editing actions call `remember()` first and keep `turnStart` untouched.
- `handleTakeBack` restores `turnStart.board` and `turnStartPositions`, returns all turn-start rack tiles using `withRackOrder`, and clears move count, selection, hover, and history. It does not change the pool, timer, or turn owner. Restoring the full table is required: removing only newly played tiles could leave rearranged groups invalid.
- Take back and Undo are disabled when their history is empty, during opponents’ turns, after a win, or while dragging.
- Restoration preserves the current order of held rack tiles, appending returned tiles rather than silently applying a sort.

### The `new-meld` sentinel

The board array always ends with an empty draft group `{ id: "new-meld", kind: "new", tiles: [] }`. `sealDraftSlot` (`App.tsx`) renames it to a permanent id on commit and appends a fresh empty one. Many helpers filter with `group.id === "new-meld" || group.tiles.length > 0` — preserve that guard when adding board transforms, or the draft slot disappears.

Group ids created at runtime: `draft-<turn>-<move>-<tileId>`, `split-<turn>-<move>-<tileId>`, `you-<turn>`, `ai-<name>-<turnKey>-<index>`.

### Free-position table layer

Group positions live in `groupPositions: TablePositions` (world-percent coordinates), separately from `board`. Update both together. `positionTableGroups` in `src/layout.ts` preserves requested positions where possible and searches locally for non-overlapping space using `tableFootprint`. Both camera modes render this layout. Keep the footprint dimensions consistent with `.board-world` tile sizing.

### Camera lock (default) vs. free camera

`viewMode: "locked" | "free"` persists to `localStorage["tessera.viewMode"]`. It controls camera gestures only. Locked mode is labelled “Pan off”; free mode is “Pan on”. Both use `groupPositions` and `boardCamera`. Toggling must not repack groups, change their coordinates, or reset the camera. Fit remains available in both modes. The former `layoutLockedBoard` auto-arrangement was removed because it ignored the player’s intended drop positions.

### Camera (pan / pinch / zoom, free mode only)

`BoardDropZone` (`App.tsx`) implements panning and zoom with raw pointer events plus framer-motion `MotionValue`s, deliberately bypassing React state per frame; it commits to `boardCamera` state only at gesture end via `onCameraChange`. `suppressClickRef` is what distinguishes "panned the felt" from "tapped the felt to place tiles" — a tap with selected tiles places a new meld at that point. All of this is short-circuited in locked mode (see above).

### dnd-kit wiring

`tabletopCollision` in `src/interactions.ts` priority-sorts `pointerWithin` results for pointer drags. When the pointer hits only the table, a compatible group within 40 screen px horizontally and 10 px vertically can receive it. Compatibility is computed from the actual selected/dragged batch using `extendMeldAtEnd`. Do not replace this with indiscriminate proximity attraction: unrelated groups, space below a row, and off-table drops must stay independent. Compatible ends also expose 46 screen-px touch targets and insertion previews; an explicit end preserves the chosen side, including joker placement. Keyboard drags, which have no pointer coordinates, retain `closestCenter`. `worldPoint` and `centerDragOnPointer` keep the visible preview and actual placement centred on the same pointer, with the preview measured at the destination tile’s size. Droppable ids are namespaced strings parsed by prefix in `handleDragEnd` (`App.tsx`), so an id format change must be made in both places.

| id | priority | meaning |
|---|---|---|
| `board-target:<tileId>` | 0 | drop onto a specific tile → insertion index |
| `meld-end:<side>:<groupId>` | 1 | compatible insertion at the chosen left/right end |
| `group:<groupId>` | 2 | drop onto a meld or its compatible approach area |
| bare rack tile id | 3 | rack reorder (sortable) |
| `rack-drop` | 4 | return a tile to the rack |
| `board-drop` | 5 | empty felt → create/split a group at that point |

### Rack selection and layout

A single PointerSensor activates after 4 px of movement; there is no extra touch-delay sensor. A stationary rack hold selects the first tile after 300 ms and extends to the right every 180 ms. Starting a drag, releasing, cancelling, leaving the tile, losing focus, or changing visibility stops growth. Holding then dragging carries the selected batch in rack order. Suppress the trailing click after a hold so releasing does not deselect the starting tile.

Rack columns adapt to the available width. Space expands to additional readable rows and remains reserved as tiles are played, preventing the board from resizing underneath a drop. Unusually large hands scroll. The non-interactive `.rack-shelves` overlay follows the same row count and spacing as the rack grid. The realistic finish paints depth with shadows, not perspective transforms that would distort drop geometry.

### Turn loop

Driven by `useEffect`s in `GameScreen`: a 1s timer; a timeout handler using `resolveTimeout(moveCount, tableIsLegal, poolIsEmpty)` (`game.ts`), whose outcome is one of `submit` / `draw-one` / `revert-draw-one` / `pass` — there is no more 3-tile penalty draw, timing out on an unfinished illegal draft now restores the table and draws exactly one tile; and an opponent effect that runs `playOpponentTurn` after a random 3–10s "thinking" delay (computed per opponent turn, `Math.random` in the effect) and chains **Leo → Maya → you**. `turnNumber` only increments after Maya finishes.

The opponent effect runs one cancellable sequence per opponent and deal. Its own board/count updates, rack sorting, sound changes, and viewport changes must not restart it. After thinking, `opponentPlayFrames` reveals each played tile, animating a face-down pickup, drag, and drop from the opponent avatar to the actual destination rectangle over 900 ms. Reserve the destination with a blank hidden tile; do not mount its numbered face until landing. The flight state contains no tile face. Draws use a face-down tile. Reduced motion keeps staged placement without travel. Highlights and the summary persist through the next player turn; the 60-second timer begins only after the sequence settles. Read the current player rack, sound setting, and viewport through refs. Reset/unmount must cancel every pending presentation wait. The blue rack banner and header indicate the player’s turn.

Pool-empty endgame: once the pool is empty, "End turn" becomes "Pass" (`handlePass`, `App.tsx`) for you, and a stuck AI turn counts as a pass for the opponent. Three consecutive passes across the table end the round by stalemate — `scoreStalemate` (`game.ts`) awards the lowest rack total the difference from every other rack (zero-sum), rather than the normal `scoreRound` winner-takes-all-remaining-points scoring. The result sheet shows a distinct "Pool empty · no moves left" variant in this case.

### Rules specifics

- Tile identity is the id string: `${color}-${value}-${copy}` with copies `a`/`b`, plus `joker-a`/`joker-b`. Tests reference exact ids (`cobalt-7-a`, `terracotta-9-a`), so the pool generator's id scheme is load-bearing.
- Each game deals randomly: `createDeal(rng = Math.random)` (`game.ts`) shuffles a fresh pool and slices out the rack, both opponent racks, and the remaining pool. Tests inject `seededRng(seed)` (`game.ts`) for determinism; there is no more hardcoded shuffle seed or hand-authored `initialRack` — every player sees a different table each game/Play Again.
- Drops onto a meld resolve in this order in `resolveTileDrop` (`game.ts`): **split** is checked before extend — dropping a single non-joker tile that duplicates an interior value of a valid run always splits it at that point, even when a half is left as a short/incomplete draft (rulings 2026-08-06: jokers never silently change the value they represent, and players split-then-finish before End Turn) — then **extend** (append/insert if the combined meld is legal), then a permissive **draft** (anything else, legality checked at commit).
- Dragging a tile out of a *valid* table run carries that tile plus every tile to its right as one unit (`tailIds`, tail-grab); dragging from a set or an already-invalid draft only carries the single tile.
- Jokers are wildcards in `analyzeRun`/`analyzeSet`, scored at their represented value inside a meld but 30 points as a rack penalty (`tilePoints`).
- `orderMeldTiles` also orders *invalid* drafts (numeric order) so a newly placed middle tile isn't stranded at the visual end.
- The 30-point opening restriction is enforced twice: optimistically in `placeTiles`/`rearrangeTableTiles` (toast + refuse) and authoritatively in `validateTurn`. Both must agree.
- `sortRackByGroups` (777: number then colour) and `sortRackByRuns` (789: colour then number) are wired to visible buttons and available during every player’s turn. They only change rack order and never suggest moves. Manual single/batch reordering also works during opponents. Returned tiles insert at the drop position or append; drawing/restoring preserves the current arrangement.
- At the UI boundary, an incompatible rack addition to a complete meld is refused. This does not remove the engine’s permissive draft support or the deliberate split exception; incomplete groups can still be built on empty felt.
- AI strategy in `playOpponentTurn`: opening combination search (`findOpeningMelds`, ≤3 melds ≥30 pts) → up to 3 table extensions → one new rack meld → draw one → stuck. Meld search is intentionally bounded to 3- and 4-tile subsets to stay fast on large racks.

## Gotchas

- `DroppableGroup` is rendered only for `visibleBoard` (groups with tiles), and the `new-meld` sentinel can only receive tiles via a drop/tap on a rendered group — so it is never rendered, and its `group.tiles.length === 0` placeholder branch (plus `new-meld--ready` and the `groupId !== "new-meld"` guard in `placeTiles`) is unreachable in the running game.
- `musicOn` gates music; `sfxOn` gates effects and the timer tick; `haptics` gates `navigator.vibrate`. These settings persist separately.
- `Project_Master_and_changelog.md` is project documentation, not app state. Keep its current decisions aligned with the implementation.
- Position bookkeeping matters in both camera modes. Never treat “Pan off” as permission to repack the table.
- The realistic terracotta finish is the default for the normal URL and `?name=` links. `?tiles=realistic` is an obsolete preview parameter and no longer gates rendering.
- The embossed table brand and shelf overlays must remain `pointer-events: none`. Table buttons must not trigger panning or place selected tiles.

## Latest verified release

As of 2026-09-07, app commit `1a2f812` is live with the realistic rack enabled by default. GitHub Actions run `34074349311` succeeded after a normal push; the original `https://stigmavlc.github.io/tessera/?name=Mara` link was verified in a fresh browser. There is no routine manual-deployment requirement; inspect Actions before using workflow dispatch as a fallback.

Local follow-up (not yet published): easier meld association, visible turn banner, and staged opponent moves. Validation: 64 automated tests and the production build passed. Touch-emulated browser checks covered rack selection/dragging, precise placement, Take back including table rearrangements, sorting during opponents, keyboard and cancellation behaviour, and portrait/landscape layouts. Physical-phone feel and safe-area behaviour still warrant a real-device playtest.
