# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tessera is a mobile-first, frontend-only Rummikub-style tile game prototype (React 19 + Vite + TypeScript). There is no backend, database, network layer, or persistence — every game starts from the same deterministic deal. Opponents ("Maya", "Leo") are local AI.

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

## Architecture

Three files carry the whole app:

- **`src/game.ts`** — the pure rules engine. No React, no DOM, no I/O, no runtime randomness. Every exported function is a pure transformation over `Tile[]` / `BoardGroup[]`. This is the only tested layer (vitest runs with `environment: "node"`).
- **`src/App.tsx`** — all UI, state, drag-and-drop, gestures, and the turn loop. `GameScreen` holds ~20 `useState` hooks and is the single source of game state.
- **`src/styles.css`** — one global stylesheet with CSS custom properties in `:root`. No CSS modules, no Tailwind, no styled-components. Class names are BEM-ish (`.meld--invalid`, `.rack-tile--dragging`).

Keep rules logic in `game.ts` and presentation in `App.tsx`; the split is what makes the rules testable.

### The turn-commit model (most important invariant)

`turnStart: TurnSnapshot` (`App.tsx:479`) is an immutable baseline captured at the start of your turn. During the turn, `board` and `rack` are edited **permissively** — illegal drafts are allowed on the table on purpose. Legality is only enforced when the turn is committed, by `validateTurn(turnStart, board, rack)` (`game.ts:308`), which re-derives which tiles were played by diffing rack IDs.

Because of this:
- Abandoning a turn (draw, timeout penalty) does **not** replay undos — it restores wholesale from `cloneTurnSnapshot(turnStart)` (see `handleDraw`, `App.tsx:886`).
- `turnStartPositions` mirrors `turnStart` for the free-position layer and must be restored alongside it.
- `history: ActionSnapshot[]` is a separate per-action undo stack, cleared on every turn boundary.
- Any new board mutation must go through `remember()` first and keep `turnStart` untouched.

### The `new-meld` sentinel

The board array always ends with an empty draft group `{ id: "new-meld", kind: "new", tiles: [] }`. `sealDraftSlot` (`App.tsx:143`) renames it to a permanent id on commit and appends a fresh empty one. Many helpers filter with `group.id === "new-meld" || group.tiles.length > 0` — preserve that guard when adding board transforms, or the draft slot disappears.

Group ids created at runtime: `draft-<turn>-<move>-<tileId>`, `split-<turn>-<move>-<tileId>`, `you-<turn>`, `ai-<name>-<turnKey>-<index>`.

### Free-position table layer

Group screen positions live in `groupPositions: TablePositions` (percent coordinates), **separate state from `board`**. Both must be updated together. `positionTableGroups` → `findOpenTablePoint` → `positionsOverlap` (`App.tsx:89-127`) do collision-avoided placement against `groupFootprint`, falling back to the fixed `tableSlots` grid. Recompute positions on every board change.

### Camera (pan / pinch / zoom)

`BoardDropZone` (`App.tsx:1164`) implements panning and zoom with raw pointer events plus framer-motion `MotionValue`s, deliberately bypassing React state per frame; it commits to `boardCamera` state only at gesture end via `onCameraChange`. `suppressClickRef` is what distinguishes "panned the felt" from "tapped the felt to place tiles" — a tap with selected tiles places a new meld at that point.

### dnd-kit wiring

`tabletopCollision` (`App.tsx:129`) is a custom collision resolver that priority-sorts `pointerWithin` results. Droppable ids are namespaced strings parsed by prefix in `handleDragEnd` (`App.tsx:810`), so an id format change must be made in both places:

| id | priority | meaning |
|---|---|---|
| `board-target:<tileId>` | 0 | drop onto a specific tile → insertion index |
| `group:<groupId>` | 1 | drop onto a meld |
| bare rack tile id | 2 | rack reorder (sortable) |
| `rack-drop` | 3 | return a tile to the rack |
| `board-drop` | 4 | empty felt → create/split a group at that point |

### Turn loop

Driven by `useEffect`s in `GameScreen`: a 1s timer; a timeout handler using `resolveTimeout(moveCount, tableIsLegal)` (submit / draw-one / penalty-three); and an opponent effect that runs `playOpponentTurn` after 1050ms and chains **Leo → Maya → you**. `turnNumber` only increments after Maya finishes.

### Rules specifics

- Tile identity is the id string: `${color}-${value}-${copy}` with copies `a`/`b`, plus `joker-a`/`joker-b`. Tests reference exact ids (`cobalt-7-a`, `terracotta-9-a`), so the pool generator's id scheme is load-bearing.
- The deal is deterministic: `seededShuffle` uses a hardcoded LCG seed (`game.ts:104`), `initialRack` is hand-authored, and opponent racks + pool are sliced from the shuffle at module load. Changing any of these changes the game every player sees and can break tests.
- Jokers are wildcards in `analyzeRun`/`analyzeSet`, scored at their represented value inside a meld but 30 points as a rack penalty (`tilePoints`).
- `orderMeldTiles` also orders *invalid* drafts (numeric order) so a newly placed middle tile isn't stranded at the visual end.
- The 30-point opening restriction is enforced twice: optimistically in `placeTiles`/`rearrangeTableTile` (toast + refuse) and authoritatively in `validateTurn`. Both must agree.
- AI strategy in `playOpponentTurn`: opening combination search (`findOpeningMelds`, ≤3 melds ≥30 pts) → up to 3 table extensions → one new rack meld → draw one → stuck. Meld search is intentionally bounded to 3- and 4-tile subsets to stay fast on large racks.

## Gotchas

- `DroppableGroup` is rendered only for `visibleBoard` (groups with tiles), and the `new-meld` sentinel can only receive tiles via a drop/tap on a rendered group — so it is never rendered, and its `group.tiles.length === 0` placeholder branch (plus `new-meld--ready` and the `groupId !== "new-meld"` guard in `placeTiles`) is unreachable in the running game.
- `sound` and `haptics` are settings state; only `haptics` is wired to anything (`navigator.vibrate`). There is no audio.
- `Project_Master_and_changelog.md` is generated by a session hook, not by the app.
