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

Five files carry the whole app:

- **`src/game.ts`** — the pure rules engine. No React, no DOM, no I/O. `createDeal(rng = Math.random)` is the only source of randomness, and it's injectable (`seededRng(seed)` gives tests a deterministic generator). Every exported function is a pure transformation over `Tile[]` / `BoardGroup[]`. This is a tested layer (vitest runs with `environment: "node"`), covered by `src/game.test.ts`.
- **`src/layout.ts`** — pure locked-view layout: row packing of board groups plus a fit camera (`layoutLockedBoard`). No React, no DOM. Covered by `src/layout.test.ts`.
- **`src/App.tsx`** — all UI, state, drag-and-drop, gestures, and the turn loop. `GameScreen` holds ~30 `useState` hooks and is the single source of game state.
- **`src/audio.ts`** — all sound: a synthesized Web Audio turn-timer tick (last 10s, volume ramps with urgency), a ceramic tile-place click, and a looping music player for `public/audio/lobby.mp3` / `table.mp3`. CRITICAL iOS constraints baked in: fades run on a Web Audio gain node with clock-based completion (iOS ignores `element.volume` writes), and unlock requires click/keydown (pointerdown does not count) — the tap-to-begin splash in App provides the gesture. Silent no-op when files are missing. Gated by the persisted "Table sounds" setting (`tessera.sound`; `tessera.haptics` likewise), which lives in `App` and flows into `GameScreen` as props.
- **`src/styles.css`** — one global stylesheet with CSS custom properties in `:root`. No CSS modules, no Tailwind, no styled-components. Class names are BEM-ish (`.meld--invalid`, `.rack-tile--dragging`).

Keep rules logic in `game.ts`/`layout.ts` and presentation in `App.tsx`; the split is what makes the rules testable.

### The turn-commit model (most important invariant)

`turnStart: TurnSnapshot` (`App.tsx:465`) is an immutable baseline captured at the start of your turn. During the turn, `board` and `rack` are edited **permissively** — illegal drafts are allowed on the table on purpose. Legality is only enforced when the turn is committed, by `validateTurn(turnStart, board, rack)` (`game.ts:381`), which re-derives which tiles were played by diffing rack IDs.

Because of this:
- Abandoning a turn (draw, timeout penalty, pass) does **not** replay undos — it restores wholesale from `cloneTurnSnapshot(turnStart)` (see `handleDraw`, `App.tsx:952`, and `handlePass`, `App.tsx:537`).
- `turnStartPositions` mirrors `turnStart` for the free-position layer and must be restored alongside it.
- `history: ActionSnapshot[]` is a separate per-action undo stack, cleared on every turn boundary.
- Any new board mutation must go through `remember()` first and keep `turnStart` untouched.

### The `new-meld` sentinel

The board array always ends with an empty draft group `{ id: "new-meld", kind: "new", tiles: [] }`. `sealDraftSlot` (`App.tsx:140`) renames it to a permanent id on commit and appends a fresh empty one. Many helpers filter with `group.id === "new-meld" || group.tiles.length > 0` — preserve that guard when adding board transforms, or the draft slot disappears.

Group ids created at runtime: `draft-<turn>-<move>-<tileId>`, `split-<turn>-<move>-<tileId>`, `you-<turn>`, `ai-<name>-<turnKey>-<index>`.

### Free-position table layer (free view mode only)

Group screen positions live in `groupPositions: TablePositions` (percent coordinates), **separate state from `board`**. Both must be updated together. `positionTableGroups` → `findOpenTablePoint` → `positionsOverlap` (`App.tsx:86-124`) do collision-avoided placement against `groupFootprint`, falling back to the fixed `tableSlots` grid. Recompute positions on every board change. This layer only feeds the rendered board when `viewMode === "free"` — see "Lock View" below.

### Lock View (default) vs. free camera

`viewMode: "locked" | "free"` (`App.tsx:479-480`) picks which layout and camera drive the board, and persists to `localStorage["tessera.viewMode"]`. In locked mode (the default), `layoutLockedBoard` (`src/layout.ts`) computes both group positions and the camera every render from `board` alone — `groupPositions` is ignored entirely and pan/pinch/zoom gestures in `BoardDropZone` are disabled. Toggling to free mode hands control back to `groupPositions`/`boardCamera` and re-enables gestures.

### Camera (pan / pinch / zoom, free mode only)

`BoardDropZone` (`App.tsx:1256`) implements panning and zoom with raw pointer events plus framer-motion `MotionValue`s, deliberately bypassing React state per frame; it commits to `boardCamera` state only at gesture end via `onCameraChange`. `suppressClickRef` is what distinguishes "panned the felt" from "tapped the felt to place tiles" — a tap with selected tiles places a new meld at that point. All of this is short-circuited in locked mode (see above).

### dnd-kit wiring

`tabletopCollision` (`App.tsx:126`) is a custom collision resolver that priority-sorts `pointerWithin` results. Droppable ids are namespaced strings parsed by prefix in `handleDragEnd` (`App.tsx:872`), so an id format change must be made in both places. This table is unchanged by the parity work — only the tile payload each drag carries changed (see tail-grab, below):

| id | priority | meaning |
|---|---|---|
| `board-target:<tileId>` | 0 | drop onto a specific tile → insertion index |
| `group:<groupId>` | 1 | drop onto a meld |
| bare rack tile id | 2 | rack reorder (sortable) |
| `rack-drop` | 3 | return a tile to the rack |
| `board-drop` | 4 | empty felt → create/split a group at that point |

### Turn loop

Driven by `useEffect`s in `GameScreen`: a 1s timer; a timeout handler using `resolveTimeout(moveCount, tableIsLegal, poolIsEmpty)` (`game.ts:459`), whose outcome is one of `submit` / `draw-one` / `revert-draw-one` / `pass` — there is no more 3-tile penalty draw, timing out on an unfinished illegal draft now restores the table and draws exactly one tile; and an opponent effect that runs `playOpponentTurn` after a random 3–10s "thinking" delay (computed per opponent turn, `Math.random` in the effect) and chains **Leo → Maya → you**. `turnNumber` only increments after Maya finishes.

Pool-empty endgame: once the pool is empty, "End turn" becomes "Pass" (`handlePass`, `App.tsx:537`) for you, and a stuck AI turn counts as a pass for the opponent. Three consecutive passes across the table end the round by stalemate — `scoreStalemate` (`game.ts:482`) awards the lowest rack total the difference from every other rack (zero-sum), rather than the normal `scoreRound` winner-takes-all-remaining-points scoring. The result sheet shows a distinct "Pool empty · no moves left" variant in this case.

### Rules specifics

- Tile identity is the id string: `${color}-${value}-${copy}` with copies `a`/`b`, plus `joker-a`/`joker-b`. Tests reference exact ids (`cobalt-7-a`, `terracotta-9-a`), so the pool generator's id scheme is load-bearing.
- Each game deals randomly: `createDeal(rng = Math.random)` (`game.ts:105`) shuffles a fresh pool and slices out the rack, both opponent racks, and the remaining pool. Tests inject `seededRng(seed)` (`game.ts:85`) for determinism; there is no more hardcoded shuffle seed or hand-authored `initialRack` — every player sees a different table each game/Play Again.
- Drops onto a meld resolve in this order in `resolveTileDrop` (`game.ts:340`): **split** is checked before extend — dropping a single non-joker tile that duplicates an interior value of a valid run always splits it at that point, even when a half is left as a short/incomplete draft (rulings 2026-08-06: jokers never silently change the value they represent, and players split-then-finish before End Turn) — then **extend** (append/insert if the combined meld is legal), then a permissive **draft** (anything else, legality checked at commit).
- Dragging a tile out of a *valid* table run carries that tile plus every tile to its right as one unit (`tailIds`, tail-grab); dragging from a set or an already-invalid draft only carries the single tile.
- Jokers are wildcards in `analyzeRun`/`analyzeSet`, scored at their represented value inside a meld but 30 points as a rack penalty (`tilePoints`).
- `orderMeldTiles` also orders *invalid* drafts (numeric order) so a newly placed middle tile isn't stranded at the visual end.
- The 30-point opening restriction is enforced twice: optimistically in `placeTiles`/`rearrangeTableTiles` (toast + refuse) and authoritatively in `validateTurn`. Both must agree.
- `sortRackByGroups` (number then colour) and `sortRackByRuns` (colour then number) exist in the engine and are tested, but are deliberately NOT wired to any UI — the 777/789 buttons were removed at the player's request (possible future paid add-on). The rack is never re-sorted programmatically; returned tiles insert at the drop position or append at the end.
- AI strategy in `playOpponentTurn`: opening combination search (`findOpeningMelds`, ≤3 melds ≥30 pts) → up to 3 table extensions → one new rack meld → draw one → stuck. Meld search is intentionally bounded to 3- and 4-tile subsets to stay fast on large racks.

## Gotchas

- `DroppableGroup` is rendered only for `visibleBoard` (groups with tiles), and the `new-meld` sentinel can only receive tiles via a drop/tap on a rendered group — so it is never rendered, and its `group.tiles.length === 0` placeholder branch (plus `new-meld--ready` and the `groupId !== "new-meld"` guard in `placeTiles`) is unreachable in the running game.
- `sound` gates the timer tick and background music (src/audio.ts); `haptics` gates `navigator.vibrate`. Both persist to localStorage.
- `Project_Master_and_changelog.md` is generated by a session hook, not by the app.
- `viewMode` persists at `localStorage["tessera.viewMode"]`, read once as lazy initial state on mount (`App.tsx:479-480`). Locked mode (the default) ignores `groupPositions` entirely and recomputes layout from `board` via `layoutLockedBoard` every render, so a bug in `groupPositions` bookkeeping only surfaces after switching to free view.
