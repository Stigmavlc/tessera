# Tessera — Official-Game Parity: Design

**Date:** 2026-08-06
**Status:** Approved by Ivan (all four sections) pending written-spec review
**Driver:** Feedback from the primary player (Ivan's partner), who plays the official Rummikub app (Kinkajoo Ltd) and expects its core behaviors.

## Background & Research

Tessera is a frontend-only tile-rummy prototype (React 19 + Vite + TS). The rules engine (`src/game.ts`) is pure and tested; all UI/state lives in `src/App.tsx`; there is no persistence layer.

Research (official Lemada rulebook PDF + official-app feature research + empirical play of the official web version) established:

- The rulebook's manipulation examples explicitly include splitting a run in the middle with a duplicate tile: `4-5-6-7-8` + second red 6 → `4-5-6` and `6-7-8`.
- The official app has **no camera**: the board lays out automatically and auto-zooms out as the table fills ("the layout happens automatically and there is no setting to change it" — official support). Neighboring melds slide to make room.
- Official app gestures: long-press grabs a tile plus everything to its right; drops that cannot form anything legal bounce back.
- Official app timeout behavior: revert everything moved this turn + draw 1 tile (the boxed 3-tile penalty is not implemented in the app).
- 777 button sorts the rack into groups (same number); 789 sorts into runs (by color).
- Official pool-empty rule: play continues without drawing until no one can move; lowest rack total wins with differential scoring.
- Rules Tessera already implements correctly: 30-point opening (multiple melds allowed, rack tiles only), joker meld/penalty values (represented value / 30), joker retrieval via table conservation, no 13→1 wrap, group ≤4 / run ≤13, ≥1 rack tile per play turn, zero-sum winner scoring, draw-ends-turn.

Reference: the current official rulebook PDF is freely downloadable from rummikub.com (its text was extracted and used during this research; it is not committed to the repo since the text is copyrighted).

## Goals

1. **Split-on-drop**: dropping a duplicate tile mid-run splits the run, like the official game.
2. **Lock View**: locked, auto-arranged, auto-fitting board as the default; the existing free camera behind a toggle.
3. **Random deal** every game (the current deal is identical every game).
4. **777 / 789 rack sort buttons.**
5. **Rules parity fixes**: pool-empty endgame (currently a softlock) and app-style timeout handling.

Non-goals: online play, difficulty settings, sound effects, chat/tutorial, grid-slot board rearchitecture, rack tail-grab, the official app's 5-second end-of-turn lockout (deliberately not copied), replacing stepwise undo (deliberately kept — better than the official full-turn-only undo).

## Section 1 — Drop mechanics & tail-grab

### `resolveTileDrop` (new, `src/game.ts`)

```ts
export type DropResolution = {
  kind: "extend" | "split" | "draft";
  groups: BoardGroup[];
};

export function resolveTileDrop(
  groups: BoardGroup[],
  groupId: string,
  movingTiles: Tile[],
  targetIndex: number | undefined,
  newGroupId: string,
): DropResolution;
```

Resolution order for a **single** tile dropped on a meld (RULING 2026-08-06: split is checked **before** extend — when a dropped tile duplicates an interior value of a joker-run, extending would silently re-aim the joker to a different represented value; Ivan ruled the split gesture wins and jokers never silently change value):

1. **Split** — only when the target group is currently a **legal run** and the dropped tile is a same-color number tile whose value duplicates an **interior represented value** of the run (jokers count as the value they represent, derived from the run's resolved start). Split point: the existing copy stays at the end of the left half; the dropped tile becomes the head of the right half. Fires **only if both halves are legal runs** (≥3 tiles each, re-checked with `analyzeMeld`). The right half becomes a new group with id `newGroupId`, inserted in the board array **immediately after** the parent group (adjacency matters for locked-view layout). Example: blue 7 dropped on the 7 in blue 4–9 → `4-5-6-7` + `7-8-9`. Counter-example: 5 dropped on 4-5-6 → left half would be `4-5` (2 tiles) → no split, falls through.
2. **Extend** — if `analyzeMeld([...group.tiles, tile])` is valid, insert via `orderMeldTiles` (current behavior).
3. **Draft** — insert at `targetIndex`, meld may become invalid (red highlight), exactly today's permissive behavior. Nothing ever bounces back to the rack.

Batch drops (multi-select): try extend with the whole batch, else draft. Batches never split.

Sets never split (splits are runs-only). Drops on the empty felt and rack-return behavior are unchanged.

`App.tsx` integration: `placeTiles` and `rearrangeTableTile` route drops-onto-groups through `resolveTileDrop`. On a `split` result the new group id is `split-<turn>-<move>-<tileId>` (existing naming scheme).

### Tail-grab (board runs only)

Dragging a tile that sits inside a **valid run** on the table picks up that tile **plus every tile to its right** in the meld as one stack (drag overlay shows the count badge, same as rack multi-drag). Drop targets and semantics:

- **Another meld** → batch resolveTileDrop (extend or draft).
- **Empty felt** → new group containing the tail (replaces today's single-tile split-drag; one gesture instead of three).
- **Rack** → allowed only if every tile in the tail is returnable (played from the rack this turn); otherwise reject with the existing "only tiles played this turn" toast.

Melds that are sets or invalid drafts keep today's single-tile drag. Grabbing the leftmost tile moves the whole meld (source group empties and is filtered out — existing filter logic).

Requires `moveBoardTiles(groups, tileIds, fromGroupId, toGroupId, targetIndex?)` — a batch generalization of `moveBoardTile`. `validateTurn` needs no changes (it only checks end-state conservation and legality).

## Section 2 — Lock View

### State

`viewMode: "locked" | "free"`, default `"locked"`, persisted per device in `localStorage` key `tessera.viewMode` (read once at mount, written on toggle). Toggle button (lock/unlock icon) replaces the current Fit button position; Fit renders only in free mode.

### Locked mode

- Pan / pinch / wheel handlers disabled; pointer events on the felt only serve tap-to-place.
- Positions come from a new **pure layout function** in `src/layout.ts`:

```ts
export function layoutLockedBoard(
  groups: BoardGroup[],
  viewport: { width: number; height: number },
): { positions: TablePositions; zoom: number };
```

Deterministic row packing: melds in **board-array order** (stable; split halves sit next to parents), left-aligned rows, wrapping at a fixed world width; world bounding box computed from rows; `zoom` = fit-to-viewport (clamped to the existing 0.42–1.8 range), so the view zooms out smoothly as the table grows. Same input → same output; adding a meld never reorders existing ones.

- All position/zoom changes animate via framer-motion (existing MotionValues), so AI turns visibly slide melds to make room.
- Tap-to-place and drop-on-felt still create groups; in locked mode the drop **position is ignored** and the group joins the end of the reading order.
- `groupPositions` state is not consulted in locked mode.

### Free mode

Exactly today's behavior (camera pan/pinch/wheel, drag-anywhere positioning, collision nudging via `positionTableGroups`, Fit button). On switching locked → free, `groupPositions` is seeded from the last locked layout so nothing jumps. On switching free → locked, stored positions are simply ignored (and retained for switching back).

## Section 3 — Random deal & rules fixes

### `createDeal`

```ts
export type Deal = { rack: Tile[]; opponents: OpponentRacks; pool: Tile[] };
export function seededRng(seed: number): () => number; // existing LCG, exported
export function createDeal(rng: () => number = Math.random): Deal;
```

Shuffles `createStandardPool()` (Fisher–Yates with `rng`), deals 14 × 3, remainder (64) is the pool. Tile ids keep the `${color}-${value}-${copy}` scheme. The module-level `initialRack`, `initialOpponentRacks`, `initialPool`, and the hand-authored rack are **removed**; `GameScreen` holds a `deal` created at mount, and both Play Again and Reset call `createDeal()` fresh. Tests use `createDeal(seededRng(SEED))` plus hand-built fixtures (several current tests reference exact ids from the hand-authored rack and must migrate to fixtures).

### Pool-empty endgame (fixes a softlock)

Current bug: with an empty pool and no play, the human turn can never end, and AI "stuck" results silently continue.

- When the pool is empty and `moveCount === 0`, the End Turn button becomes **Pass** (label and aria-label change) and passing ends the turn without drawing.
- Timeout in that state also resolves to a pass.
- AI `stuck` action counts as a pass (message: "X passes · pool empty").
- A new `consecutivePasses` counter resets on any turn that plays tiles and increments on each pass; at **3** (all players), the game ends in a stalemate.
- **Stalemate scoring** (new pure `scoreStalemate(racks)`): winner = lowest rack total; ties broken by fewer tiles, then turn order (You → Leo → Maya). Each loser scores −(their total − winner's total); the winner scores +(sum of those differences). Result sheet gets a "Pool empty — lowest rack wins" variant (winner may still hold tiles; copy must not claim they cleared their rack).

### Timeout

`TimeoutOutcome` becomes `"submit" | "draw-one" | "revert-draw-one" | "pass"`:

- `moveCount > 0` and table legal → **submit** (kept; kinder than the official app, which reverts even legal work).
- `moveCount > 0` and table illegal → **revert-draw-one**: restore the `turnStart` snapshot + draw 1 (replaces the current 3-tile penalty; matches the app). Toast: "Time's up · table restored · drew 1".
- `moveCount === 0`, pool non-empty → **draw-one** (unchanged).
- `moveCount === 0`, pool empty → **pass**.

## Section 4 — Rack sort (777 / 789)

Pure functions in `src/game.ts`:

- `sortRackByGroups(rack)` — **777**: number ascending, then `standardColors` order; jokers last.
- `sortRackByRuns(rack)` — **789**: color in `standardColors` order, then number ascending; jokers last.

Two small labeled buttons ("777", "789") at the rack's edge; they call `setRack(sortRackBy…(rack))`. No history entry (sorting is not a move) and no effect on `turnStart`. Sorting replaces manual arrangement, same as the official app.

## Testing

All engine logic stays in the pure layer and is tested in `src/game.test.ts` / `src/layout.test.ts` (vitest, node environment):

- `resolveTileDrop`: extend, split (rulebook example 4-5-6-7-8 + 6), split rejected when a half would be <3, split with joker-bearing runs (joker counts as represented value), set never splits, draft fallback, batch extend/draft.
- `moveBoardTiles`: batch move between groups, whole-meld move empties source, tail-to-new-group.
- `createDeal`: 106-tile conservation, 14/14/14/64 sizes, same seed → identical deal, different seeds → different deals.
- `scoreStalemate`: differential scoring sums to zero the official way; tie-breaks.
- `resolveTimeout`: four outcomes including pool-empty pass.
- `sortRackByGroups` / `sortRackByRuns`: ordering, jokers last.
- `layoutLockedBoard`: deterministic, stable order under append, zoom shrinks as content grows, positions non-overlapping.

Manual verification on a phone over LAN (`npm run dev`) for gestures: split-by-drop, tail-grab, lock toggle, locked-mode reflow during AI turns.

## Documentation updates in scope

README interaction list and CLAUDE.md (deterministic-deal notes, timeout description, dnd-kit id inventory if new droppable ids are added, "Gotchas" that this work obsoletes).

## Edge cases & decisions (resolved)

- Split placement is deterministic: existing copy ends the left half, dropped copy heads the right half. No user choice.
- Tail-grab only on melds whose current analysis is a valid run — invalid drafts keep single-tile drag (ambiguous order otherwise).
- Locked-mode drops ignore drop position; free-mode drops keep exact-position placement.
- `viewMode` is the only new persisted value; sound/haptics stay session-only.
- Stalemate pass rule is pragmatic: with an empty pool, a player may pass even if a play technically exists (detecting "no legal play exists" for a human requires a solver; the official app does not enforce it either).
- Timer behavior during opponent turns, undo semantics, and the permissive-drafting model are unchanged.
