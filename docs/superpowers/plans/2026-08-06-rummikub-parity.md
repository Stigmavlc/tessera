# Rummikub Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Tessera's mechanics to official-game parity: split-on-drop, locked auto-fit board view, random deals, 777/789 rack sort, pool-empty endgame, and app-style timeout handling.

**Architecture:** All rules logic stays in the pure, DOM-free engine (`src/game.ts`, tested in node env). A new pure layout module (`src/layout.ts`) computes locked-view geometry. `src/App.tsx` only wires state and gestures to those pure functions. Spec: `docs/superpowers/specs/2026-08-06-rummikub-parity-design.md`.

**Tech Stack:** React 19, TypeScript (strict), Vite, vitest, @dnd-kit, framer-motion. **No new dependencies.**

## Global Constraints

- `npm test` and `npm run build` must pass at every commit (`build` is also the only typecheck).
- No DOM/React imports in `src/game.ts` or `src/layout.ts` — they must stay pure and node-testable.
- No linter exists; match surrounding code style (2-space indent, `entry`/`group`/`first`/`second` naming, arrow helpers).
- Tile id scheme `${color}-${value}-${copy}` and the `new-meld` sentinel group (board array always ends with `{ id: "new-meld", kind: "new", tiles: [] }`) are load-bearing — never change them.
- Board transforms must preserve the filter idiom `group.id === "new-meld" || group.tiles.length > 0`.
- localStorage key for view mode is exactly `tessera.viewMode`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01KmvcgGUSPF8GJBA5db7tAY`

---

### Task 1: `seededRng` + `createDeal` (engine)

**Files:**
- Modify: `src/game.ts` (add below `createStandardPool`; do NOT remove the `initial*` constants yet — Task 8 does that)
- Test: `src/game.test.ts`

**Interfaces:**
- Produces: `seededRng(seed: number): () => number`, `type Deal = { rack: Tile[]; opponents: OpponentRacks; pool: Tile[] }`, `createDeal(rng?: () => number): Deal`

- [ ] **Step 1: Write the failing tests** (append a new `describe` to `src/game.test.ts`; add `Deal, createDeal, seededRng` to the existing import from `./game`)

```ts
describe("createDeal", () => {
  it("deals 14 tiles to each of three players and 64 to the pool, conserving all 106", () => {
    const deal = createDeal(seededRng(1));
    expect(deal.rack).toHaveLength(14);
    expect(deal.opponents.Maya).toHaveLength(14);
    expect(deal.opponents.Leo).toHaveLength(14);
    expect(deal.pool).toHaveLength(64);
    const ids = [...deal.rack, ...deal.opponents.Maya, ...deal.opponents.Leo, ...deal.pool]
      .map((entry) => entry.id);
    expect(new Set(ids).size).toBe(106);
  });

  it("is deterministic per seed and different across seeds", () => {
    expect(createDeal(seededRng(7)).rack.map((entry) => entry.id))
      .toEqual(createDeal(seededRng(7)).rack.map((entry) => entry.id));
    expect(createDeal(seededRng(8)).rack.map((entry) => entry.id))
      .not.toEqual(createDeal(seededRng(7)).rack.map((entry) => entry.id));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/game.test.ts -t "createDeal"`
Expected: FAIL — `createDeal` is not exported.

- [ ] **Step 3: Implement** (in `src/game.ts`, after `createStandardPool`)

```ts
export const seededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const shuffleTiles = (tiles: Tile[], rng: () => number): Tile[] => {
  const result = [...tiles];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

export type Deal = { rack: Tile[]; opponents: OpponentRacks; pool: Tile[] };

// A fresh three-player deal: 14 tiles each and 64 in the pool.
export function createDeal(rng: () => number = Math.random): Deal {
  const tiles = shuffleTiles(createStandardPool(), rng);
  return {
    rack: tiles.slice(0, 14),
    opponents: { Maya: tiles.slice(14, 28), Leo: tiles.slice(28, 42) },
    pool: tiles.slice(42),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test` — all tests green (26 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/game.ts src/game.test.ts
git commit -m "feat: add seedable random deal factory"
```

---

### Task 2: `resolveTileDrop` — extend → split → draft (engine)

**Files:**
- Modify: `src/game.ts` (add after `moveBoardTile`)
- Test: `src/game.test.ts`

**Interfaces:**
- Consumes: `analyzeMeld`, `orderMeldTiles` (existing), module-private `regularTiles`.
- Produces: `type DropResolution = { kind: "extend" | "split" | "draft"; groups: BoardGroup[] }`, `resolveTileDrop(groups: BoardGroup[], groupId: string, movingTiles: Tile[], targetIndex: number | undefined, newGroupId: string): DropResolution`. On split, the new group (id `newGroupId`, right half) sits **immediately after** the parent in the returned array.

- [ ] **Step 1: Write the failing tests**

```ts
describe("resolveTileDrop", () => {
  const run = (id: string, values: number[], color: Exclude<TileColor, "joker"> = "terracotta") =>
    group(id, values.map((value) => tile(`${color}-${value}`, value, color)));

  it("extends a run when the dropped tile fits", () => {
    const groups = [run("r", [4, 5, 6], "cobalt"), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("b7", 7, "cobalt")], undefined, "split-x");
    expect(result.kind).toBe("extend");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([4, 5, 6, 7]);
  });

  it("splits a run when a duplicate interior tile is dropped (rulebook example)", () => {
    const groups = [run("r", [4, 5, 6, 7, 8]), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("r6b", 6, "terracotta")], undefined, "split-x");
    expect(result.kind).toBe("split");
    const ids = result.groups.map((entry) => entry.id);
    expect(ids.indexOf("split-x")).toBe(ids.indexOf("r") + 1);
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([4, 5, 6]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.value))
      .toEqual([6, 7, 8]);
    expect(isValidBoard(result.groups)).toBe(true);
  });

  it("refuses a split that would leave a short half and falls back to draft", () => {
    const groups = [run("r", [4, 5, 6]), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("r5b", 5, "terracotta")], undefined, "split-x");
    expect(result.kind).toBe("draft");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles).toHaveLength(4);
  });

  it("splits around a joker, which keeps its represented value in the left half", () => {
    const groups = [
      group("r", [tile("b9", 9, "cobalt"), tile("b10", 10, "cobalt"), tile("joker-a", "★", "joker"),
        tile("b12", 12, "cobalt"), tile("b13", 13, "cobalt")]),
      group("new-meld", []),
    ];
    const result = resolveTileDrop(groups, "r", [tile("b11", 11, "cobalt")], undefined, "split-x");
    expect(result.kind).toBe("split");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.id))
      .toEqual(["b9", "b10", "joker-a"]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.id))
      .toEqual(["b11", "b12", "b13"]);
  });

  it("never splits sets and never splits at run edges", () => {
    const eights = group("s", [tile("r8", 8, "terracotta"), tile("k8", 8, "graphite"), tile("y8", 8, "marigold")]);
    expect(resolveTileDrop([eights, group("new-meld", [])], "s",
      [tile("r8b", 8, "terracotta")], undefined, "split-x").kind).toBe("draft");
    const edge = [run("r", [10, 11, 12, 13]), group("new-meld", [])];
    expect(resolveTileDrop(edge, "r", [tile("r13b", 13, "terracotta")], undefined, "split-x").kind).toBe("draft");
  });

  it("handles batches as extend-or-draft, never split", () => {
    const groups = [run("r", [4, 5, 6, 7, 8]), group("new-meld", [])];
    const batch = [tile("r6b", 6, "terracotta"), tile("r9b", 9, "terracotta")];
    expect(resolveTileDrop(groups, "r", batch, undefined, "split-x").kind).toBe("draft");
  });
});
```

Add `TileColor, DropResolution` (type) and `resolveTileDrop` to the test file's import as needed.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/game.test.ts -t "resolveTileDrop"` → FAIL (not exported).

- [ ] **Step 3: Implement** (in `src/game.ts` after `moveBoardTile`)

```ts
export type DropResolution = { kind: "extend" | "split" | "draft"; groups: BoardGroup[] };

const splitRunWithTile = (group: BoardGroup, dropped: Tile): { left: Tile[]; right: Tile[] } | null => {
  const analysis = analyzeMeld(group.tiles);
  if (!analysis.valid || analysis.type !== "run") return null;
  if (dropped.color === "joker" || typeof dropped.value !== "number") return null;
  const ordered = orderMeldTiles(group.tiles);
  const firstRegularIndex = ordered.findIndex((entry) => entry.color !== "joker");
  if (dropped.color !== ordered[firstRegularIndex].color) return null;
  // Ordered valid runs are consecutive, so each slot's represented value is start + index.
  const start = Number(ordered[firstRegularIndex].value) - firstRegularIndex;
  const splitIndex = dropped.value - start;
  if (splitIndex <= 0 || splitIndex >= ordered.length - 1) return null;
  const left = ordered.slice(0, splitIndex + 1);
  const right = [dropped, ...ordered.slice(splitIndex + 1)];
  if (!analyzeMeld(left).valid || !analyzeMeld(right).valid) return null;
  return { left, right };
};

export function resolveTileDrop(
  groups: BoardGroup[],
  groupId: string,
  movingTiles: Tile[],
  targetIndex: number | undefined,
  newGroupId: string,
): DropResolution {
  const target = groups.find((group) => group.id === groupId);
  if (!target || movingTiles.length === 0) return { kind: "draft", groups };

  const insert = (): BoardGroup[] => groups.map((group) => {
    if (group.id !== groupId) return group;
    const nextTiles = [...group.tiles];
    const insertionIndex = targetIndex === undefined
      ? nextTiles.length
      : Math.max(0, Math.min(targetIndex, nextTiles.length));
    nextTiles.splice(insertionIndex, 0, ...movingTiles);
    return { ...group, tiles: orderMeldTiles(nextTiles) };
  });

  if (analyzeMeld([...target.tiles, ...movingTiles]).valid) return { kind: "extend", groups: insert() };

  if (movingTiles.length === 1) {
    const split = splitRunWithTile(target, movingTiles[0]);
    if (split) {
      const nextGroups = groups.flatMap((group): BoardGroup[] => group.id === groupId
        ? [{ ...group, tiles: split.left }, { id: newGroupId, kind: "run", tiles: split.right }]
        : [group]);
      return { kind: "split", groups: nextGroups };
    }
  }

  return { kind: "draft", groups: insert() };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` all green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: tiered drop resolution with rulebook run splitting"`

---

### Task 3: `moveBoardTiles` batch move (engine)

**Files:**
- Modify: `src/game.ts` (add after `moveBoardTile`)
- Test: `src/game.test.ts`

**Interfaces:**
- Produces: `moveBoardTiles(groups: BoardGroup[], tileIds: string[], fromGroupId: string, toGroupId: string, targetIndex?: number): BoardGroup[]`. Same-group calls delegate to `moveBoardTile` for a single id and are a no-op for batches. Does NOT filter empty groups (callers do, preserving the `new-meld` idiom).

- [ ] **Step 1: Write the failing tests**

```ts
describe("moveBoardTiles", () => {
  const board = () => [
    group("a", [tile("b4", 4, "cobalt"), tile("b5", 5, "cobalt"), tile("b6", 6, "cobalt"),
      tile("b7", 7, "cobalt"), tile("b8", 8, "cobalt")]),
    group("b", [tile("r6", 6, "terracotta")]),
    group("new-meld", []),
  ];

  it("moves a tail of tiles between groups and keeps meld ordering", () => {
    const result = moveBoardTiles(board(), ["b7", "b8"], "a", "b");
    expect(result.find((entry) => entry.id === "a")?.tiles.map((entry) => entry.id)).toEqual(["b4", "b5", "b6"]);
    expect(result.find((entry) => entry.id === "b")?.tiles.map((entry) => entry.value)).toEqual([6, 7, 8]);
  });

  it("can empty the source group (caller filters it out)", () => {
    const result = moveBoardTiles(board(), ["r6"], "b", "a");
    expect(result.find((entry) => entry.id === "b")?.tiles).toHaveLength(0);
  });

  it("delegates single-tile same-group reorder and ignores same-group batches", () => {
    expect(moveBoardTiles(board(), ["b7", "b8"], "a", "a", 0)).toEqual(board());
    const reordered = moveBoardTiles(board(), ["b7"], "a", "a", 0);
    expect(reordered.find((entry) => entry.id === "a")?.tiles.map((entry) => entry.value)).toEqual([4, 5, 6, 7, 8]);
  });
});
```

(The last assertion passes because `orderMeldTiles` re-sorts valid runs regardless of insertion point — that is the existing contract.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/game.test.ts -t "moveBoardTiles"` → FAIL.

- [ ] **Step 3: Implement**

```ts
export function moveBoardTiles(
  groups: BoardGroup[],
  tileIds: string[],
  fromGroupId: string,
  toGroupId: string,
  targetIndex?: number,
): BoardGroup[] {
  if (fromGroupId === toGroupId) {
    return tileIds.length === 1
      ? moveBoardTile(groups, tileIds[0], fromGroupId, toGroupId, targetIndex)
      : groups;
  }
  const movingIdSet = new Set(tileIds);
  const movingTiles = groups
    .find((group) => group.id === fromGroupId)?.tiles
    .filter((entry) => movingIdSet.has(entry.id)) ?? [];
  if (movingTiles.length === 0) return groups;

  return groups.map((group) => {
    if (group.id === fromGroupId) {
      return { ...group, tiles: group.tiles.filter((entry) => !movingIdSet.has(entry.id)) };
    }
    if (group.id === toGroupId) {
      const nextTiles = [...group.tiles];
      const insertionIndex = targetIndex === undefined
        ? nextTiles.length
        : Math.max(0, Math.min(targetIndex, nextTiles.length));
      nextTiles.splice(insertionIndex, 0, ...movingTiles);
      return { ...group, tiles: orderMeldTiles(nextTiles) };
    }
    return group;
  });
}
```

- [ ] **Step 4: Run to verify pass** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: batch board tile moves for tail-grab"`

---

### Task 4: 777 / 789 sort functions (engine)

**Files:**
- Modify: `src/game.ts` (add after `rackScore`)
- Test: `src/game.test.ts`

**Interfaces:**
- Produces: `sortRackByGroups(rack: Tile[]): Tile[]` (777: number asc, then color in `standardColors` order), `sortRackByRuns(rack: Tile[]): Tile[]` (789: color, then number). Jokers always last. Pure — returns a new array.

- [ ] **Step 1: Write the failing tests**

```ts
describe("rack sorting", () => {
  const rack = [
    tile("y5", 5, "marigold"), tile("joker-a", "★", "joker"), tile("r3", 3, "terracotta"),
    tile("b5", 5, "cobalt"), tile("r5", 5, "terracotta"), tile("b2", 2, "cobalt"),
  ];

  it("777 clusters same numbers across colors, jokers last", () => {
    expect(sortRackByGroups(rack).map((entry) => entry.id))
      .toEqual(["b2", "r3", "r5", "b5", "y5", "joker-a"]);
  });

  it("789 clusters colors into ascending runs, jokers last", () => {
    expect(sortRackByRuns(rack).map((entry) => entry.id))
      .toEqual(["r3", "r5", "b2", "b5", "y5", "joker-a"]);
  });

  it("does not mutate the input", () => {
    const before = rack.map((entry) => entry.id);
    sortRackByGroups(rack);
    expect(rack.map((entry) => entry.id)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/game.test.ts -t "rack sorting"` → FAIL.

- [ ] **Step 3: Implement**

```ts
const jokerRank = (entry: Tile) => Number(entry.color === "joker");
const valueRank = (entry: Tile) => typeof entry.value === "number" ? entry.value : 0;
const colorRank = (entry: Tile) => entry.color === "joker"
  ? standardColors.length
  : standardColors.indexOf(entry.color);

export function sortRackByGroups(rack: Tile[]): Tile[] {
  return [...rack].sort((first, second) => jokerRank(first) - jokerRank(second)
    || valueRank(first) - valueRank(second)
    || colorRank(first) - colorRank(second));
}

export function sortRackByRuns(rack: Tile[]): Tile[] {
  return [...rack].sort((first, second) => jokerRank(first) - jokerRank(second)
    || colorRank(first) - colorRank(second)
    || valueRank(first) - valueRank(second));
}
```

- [ ] **Step 4: Run to verify pass** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: 777/789 rack sort functions"`

---

### Task 5: `scoreStalemate` (engine)

**Files:**
- Modify: `src/game.ts` (add after `scoreRound`)
- Test: `src/game.test.ts`

**Interfaces:**
- Consumes: `rackScore` (existing).
- Produces: `type StalemateResult = { winner: PlayerName; scores: Record<PlayerName, number> }`, `scoreStalemate(racks: Record<PlayerName, Tile[]>): StalemateResult`. Winner = lowest rack total; ties → fewer tiles → turn order You → Leo → Maya. Losers score −(their total − winner's); winner scores the positive sum; scores sum to zero.

- [ ] **Step 1: Write the failing tests**

```ts
describe("scoreStalemate", () => {
  it("awards the lowest rack the differential total", () => {
    const result = scoreStalemate({
      You: [tile("r5", 5, "terracotta")],
      Leo: [tile("b3", 3, "cobalt")],
      Maya: [tile("y3", 3, "marigold"), tile("y4", 4, "marigold")],
    });
    expect(result.winner).toBe("Leo");
    expect(result.scores).toEqual({ You: -2, Leo: 6, Maya: -4 });
    expect(Object.values(result.scores).reduce((total, value) => total + value, 0)).toBe(0);
  });

  it("breaks total ties by fewer tiles, then turn order", () => {
    expect(scoreStalemate({
      You: [tile("r2", 2, "terracotta"), tile("r3", 3, "terracotta")],
      Leo: [tile("b5", 5, "cobalt")],
      Maya: [tile("y9", 9, "marigold")],
    }).winner).toBe("Leo");
    expect(scoreStalemate({
      You: [tile("r5", 5, "terracotta")],
      Leo: [tile("b5", 5, "cobalt")],
      Maya: [tile("y9", 9, "marigold")],
    }).winner).toBe("You");
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
export type StalemateResult = { winner: PlayerName; scores: Record<PlayerName, number> };

// Pool-empty ending: lowest rack total wins; each loser scores the negative
// difference to the winner, and the winner collects the sum (zero-sum).
export function scoreStalemate(racks: Record<PlayerName, Tile[]>): StalemateResult {
  const players: PlayerName[] = ["You", "Leo", "Maya"];
  const winner = players.reduce((best, player) => {
    const difference = rackScore(racks[player]) - rackScore(racks[best]);
    if (difference < 0) return player;
    if (difference === 0 && racks[player].length < racks[best].length) return player;
    return best;
  });
  const winnerTotal = rackScore(racks[winner]);
  const scores = Object.fromEntries(players.map((player) => [
    player,
    player === winner ? 0 : winnerTotal - rackScore(racks[player]),
  ])) as Record<PlayerName, number>;
  scores[winner] = -Object.values(scores).reduce((total, value) => total + value, 0);
  return { winner, scores };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: pool-empty stalemate scoring"`

---

### Task 6: timeout `revert-draw-one` replaces the 3-tile penalty (engine + App wiring)

**Files:**
- Modify: `src/game.ts` (`TimeoutOutcome`, `resolveTimeout`)
- Modify: `src/App.tsx` (timeout effect in `GameScreen` — the block computing `penaltySize`)
- Test: `src/game.test.ts` (existing test "resolves timeout from the current table state")

**Interfaces:**
- Produces: `type TimeoutOutcome = "submit" | "draw-one" | "revert-draw-one"` (Task 13 later adds `"pass"` and a third parameter). `resolveTimeout(moveCount, tableIsLegal)` semantics: idle → draw-one; legal draft → submit; illegal draft → revert-draw-one.

- [ ] **Step 1: Update the test** (replace the existing `resolveTimeout` expectations)

```ts
  it("resolves timeout from the current table state", () => {
    expect(resolveTimeout(0, false)).toBe("draw-one");
    expect(resolveTimeout(3, true)).toBe("submit");
    expect(resolveTimeout(2, false)).toBe("revert-draw-one");
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/game.test.ts -t "timeout"` → FAIL (`penalty-three`).

- [ ] **Step 3: Implement.** In `src/game.ts`:

```ts
export type TimeoutOutcome = "submit" | "draw-one" | "revert-draw-one";

export function resolveTimeout(moveCount: number, tableIsLegal: boolean): TimeoutOutcome {
  if (moveCount === 0) return "draw-one";
  return tableIsLegal ? "submit" : "revert-draw-one";
}
```

In `src/App.tsx`, in the timeout effect, replace:

```ts
    const penaltySize = timeoutOutcome === "penalty-three" ? 3 : 1;
    const base = cloneTurnSnapshot(turnStart);
    const penaltyTiles = base.pool.slice(0, penaltySize);
```

with:

```ts
    const base = cloneTurnSnapshot(turnStart);
    const penaltyTiles = base.pool.slice(0, 1);
```

and replace the toast line:

```ts
    setToast(timeoutOutcome === "penalty-three" ? "Incomplete table restored · 3-tile penalty" : "Time’s up · drew one tile");
```

with:

```ts
    setToast(timeoutOutcome === "revert-draw-one" ? "Time’s up · table restored · drew 1" : "Time’s up · drew one tile");
```

- [ ] **Step 4: Verify** — `npm test && npm run build`.
- [ ] **Step 5: Commit** — `git commit -am "feat: app-style timeout — revert and draw one, no 3-tile penalty"`

---

### Task 7: `src/layout.ts` — locked-view layout engine

**Files:**
- Create: `src/layout.ts`
- Modify: `src/App.tsx` (delete its local `groupFootprint`, `TablePoint`, `TablePositions` definitions; import them from `./layout`; keep everything else identical)
- Test: `src/layout.test.ts` (new file)

**Interfaces:**
- Consumes: `BoardGroup` from `./game`.
- Produces (all from `./layout`): `type TablePoint = { x: number; y: number }`, `type TablePositions = Record<string, TablePoint>`, `type BoardCamera = { x: number; y: number; zoom: number }`, `groupFootprint(tileCount: number): { width: number; height: number }` (moved verbatim from App.tsx), and:
  `layoutLockedBoard(groups: BoardGroup[], rect: { width: number; height: number }): { positions: TablePositions; camera: BoardCamera }`
  Row-packs occupied groups in board-array order; positions are world-percent centers; camera fits + centers the content (zoom clamped to [0.3, 0.62]).
- Note: `App.tsx` also defines `BoardCamera` locally — replace with the import.

- [ ] **Step 1: Write the failing tests** (`src/layout.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { BoardGroup, tile } from "./game";
import { layoutLockedBoard } from "./layout";

const meld = (id: string, size: number): BoardGroup => ({
  id,
  kind: "run",
  tiles: Array.from({ length: size }, (_, index) => tile(`${id}-${index}`, index + 1, "cobalt")),
});
const rect = { width: 390, height: 520 };

describe("layoutLockedBoard", () => {
  it("is deterministic and keeps every meld inside the world", () => {
    const groups = [meld("a", 3), meld("b", 4), meld("c", 5)];
    const first = layoutLockedBoard(groups, rect);
    expect(layoutLockedBoard(groups, rect)).toEqual(first);
    for (const point of Object.values(first.positions)) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(100);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(100);
    }
  });

  it("keeps existing positions stable when a meld is appended", () => {
    const base = [meld("a", 3), meld("b", 4)];
    const before = layoutLockedBoard(base, rect).positions;
    const after = layoutLockedBoard([...base, meld("c", 5)], rect).positions;
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
  });

  it("zooms out as the table grows and never exceeds the resting zoom", () => {
    const small = layoutLockedBoard([meld("a", 3)], rect).camera.zoom;
    const big = layoutLockedBoard(
      Array.from({ length: 12 }, (_, index) => meld(`g${index}`, 5)), rect).camera.zoom;
    expect(small).toBeLessThanOrEqual(0.62);
    expect(big).toBeLessThan(small);
    expect(big).toBeGreaterThanOrEqual(0.3);
  });

  it("wraps rows instead of overflowing the right edge", () => {
    const wide = layoutLockedBoard(Array.from({ length: 6 }, (_, index) => meld(`g${index}`, 6)), rect);
    const rows = new Set(Object.values(wide.positions).map((point) => point.y));
    expect(rows.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/layout.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/layout.ts`**

```ts
import { BoardGroup } from "./game";

export type TablePoint = { x: number; y: number };
export type TablePositions = Record<string, TablePoint>;
export type BoardCamera = { x: number; y: number; zoom: number };

// Moved verbatim from App.tsx — footprint in world-percent units, matched to
// the CSS tile compression for long melds.
export const groupFootprint = (tileCount: number) => ({
  width: tileCount >= 11 ? tileCount * 4.2 : tileCount >= 8 ? tileCount * 5 : Math.max(18, tileCount * 7.1),
  height: 15,
});

const MARGIN_X = 4;
const TOP_Y = 12;
const ROW_HEIGHT = 17;
const GAP_X = 3;
const WORLD_SCALE = 1.7; // .board-world renders at 170% of the stage (see clampCamera)
const MAX_ZOOM = 0.62;
const MIN_ZOOM = 0.3;

// Deterministic reading-order row packing plus a camera that fits and centers
// the content. Same input → same output; appending never moves earlier melds.
export function layoutLockedBoard(
  groups: BoardGroup[],
  rect: { width: number; height: number },
): { positions: TablePositions; camera: BoardCamera } {
  const occupied = groups.filter((group) => group.tiles.length > 0);
  const positions: TablePositions = {};
  let cursorX = MARGIN_X;
  let row = 0;
  let contentRight = MARGIN_X + 30;
  for (const group of occupied) {
    const { width } = groupFootprint(group.tiles.length);
    if (cursorX > MARGIN_X && cursorX + width > 100 - MARGIN_X) {
      row += 1;
      cursorX = MARGIN_X;
    }
    positions[group.id] = { x: Math.min(cursorX + width / 2, 100 - MARGIN_X - width / 2), y: TOP_Y + row * ROW_HEIGHT };
    cursorX += width + GAP_X;
    contentRight = Math.max(contentRight, cursorX - GAP_X);
  }

  const contentBottom = TOP_Y + row * ROW_HEIGHT + ROW_HEIGHT / 2 + 4;
  const zoom = Math.max(MIN_ZOOM, Math.min(
    MAX_ZOOM,
    94 / (WORLD_SCALE * (contentRight + MARGIN_X)),
    92 / (WORLD_SCALE * contentBottom),
  ));
  const centerX = (MARGIN_X + contentRight) / 2;
  const centerY = (TOP_Y - ROW_HEIGHT / 2 + contentBottom) / 2;
  return {
    positions,
    camera: {
      zoom,
      x: rect.width / 2 - (centerX / 100) * rect.width * WORLD_SCALE * zoom,
      y: rect.height / 2 - (centerY / 100) * rect.height * WORLD_SCALE * zoom,
    },
  };
}
```

In `src/App.tsx`: delete the local `type TablePoint`, `type TablePositions`, `type BoardCamera`, and `const groupFootprint` definitions and add to the imports:

```ts
import { BoardCamera, TablePoint, TablePositions, groupFootprint } from "./layout";
```

(Task 11 adds `layoutLockedBoard` to this import when it becomes used.)

- [ ] **Step 4: Verify** — `npm test && npm run build`.
- [ ] **Step 5: Commit** — `git commit -am "feat: pure locked-view layout engine"`

---

### Task 8: wire random deals; delete the fixed deal (App + tests)

**Files:**
- Modify: `src/game.ts` (delete `initialRack`, `seededShuffle`, `occupiedIds`, `availableNewGameTiles`, `initialPool`, `initialOpponentRacks`; keep `initialBoard`)
- Modify: `src/App.tsx` (`GameScreen` state init + `resetGame`)
- Modify: `src/game.test.ts` (migrate fixtures)

**Interfaces:**
- Consumes: `createDeal`, `seededRng` (Task 1).
- Produces: `GameScreen` deals fresh on mount and on every reset. Test files use a local `fixtureRack` constant — the exact 14 tiles the old `initialRack` contained (ids preserved: `cobalt-7-a`, `terracotta-9-a`, `joker-a`, the four 10s, etc.).

- [ ] **Step 1: Migrate tests.** In `src/game.test.ts`, remove `initialRack`, `initialPool`, `initialOpponentRacks` from the import (keep `initialBoard`) and add near the top:

```ts
const standard = (color: Exclude<TileColor, "joker">, value: number, copy: "a" | "b") =>
  tile(`${color}-${value}-${copy}`, value, color);

const fixtureRack: Tile[] = [
  standard("terracotta", 1, "a"), standard("graphite", 2, "a"), standard("marigold", 4, "b"),
  standard("cobalt", 7, "a"), standard("terracotta", 9, "a"), standard("marigold", 11, "a"),
  standard("graphite", 12, "a"), tile("joker-a", "★", "joker"), standard("cobalt", 1, "a"),
  standard("cobalt", 2, "a"), standard("terracotta", 10, "b"), standard("graphite", 10, "a"),
  standard("marigold", 10, "a"), standard("cobalt", 10, "a"),
];
```

(Import `Tile, TileColor` types if not already.) Then:
- Replace every `initialRack` reference with `fixtureRack`, every `pool: initialPool` with `pool: []`.
- Rewrite the first test ("contains 106 physical tiles...") to use `createDeal(seededRng(1))` (the Task 1 test already covers this — merge them: keep the Task 1 version, delete the old test, and keep the "starts with a legal table" test using `initialBoard`).

- [ ] **Step 2: Delete the constants** from `src/game.ts` (`initialRack`, `seededShuffle`, `occupiedIds`, `availableNewGameTiles`, `initialPool`, `initialOpponentRacks` — keep `initialBoard`).

- [ ] **Step 3: Rewire `GameScreen`.** Replace the state initializers at the top of `GameScreen`:

```ts
  const [deal, setDeal] = useState<Deal>(() => createDeal());
  const [rack, setRack] = useState<Tile[]>(deal.rack);
  const [board, setBoard] = useState<BoardGroup[]>(cloneBoard(initialBoard));
  const [pool, setPool] = useState<Tile[]>(deal.pool);
  const [opponentRacks, setOpponentRacks] = useState<OpponentRacks>(() => cloneOpponentRacks(deal.opponents));
  ...
  const [turnStart, setTurnStart] = useState<TurnSnapshot>(() => ({
    rack: [...deal.rack],
    board: cloneBoard(initialBoard),
    pool: [...deal.pool],
    hasOpened: false,
  }));
```

And in `resetGame`, replace the first six setter lines with:

```ts
    const nextDeal = createDeal();
    setDeal(nextDeal);
    setRack(nextDeal.rack);
    setBoard(cloneBoard(initialBoard));
    setPool(nextDeal.pool);
    setOpponentRacks(cloneOpponentRacks(nextDeal.opponents));
    setOpponentOpened({ Maya: false, Leo: false });
    setHasOpened(false);
    setTurnStart({ rack: [...nextDeal.rack], board: cloneBoard(initialBoard), pool: [...nextDeal.pool], hasOpened: false });
```

Update the `./game` import in App.tsx: remove `initialOpponentRacks, initialPool, initialRack`, add `Deal, createDeal`.

- [ ] **Step 4: Verify** — `npm test && npm run build`, then `npm run dev`: two consecutive games (Play again) must show different racks.
- [ ] **Step 5: Commit** — `git commit -am "feat: fresh random deal every game"`

---

### Task 9: wire split-on-drop into the table (App)

**Files:**
- Modify: `src/App.tsx` (`placeTiles`, `rearrangeTableTile`)

**Interfaces:**
- Consumes: `resolveTileDrop` (Task 2), `moveBoardTile` (existing).
- Produces: rack→meld and table→meld drops both resolve extend/split/draft. Split group ids follow the existing scheme: `split-${turnNumber}-${moveCount + 1}-${tileId}`.

- [ ] **Step 1: Rewrite `placeTiles`'s board computation.** Replace the `candidateBoard` block:

```ts
    const candidateBoard = board.map((group) => {
      if (group.id !== groupId) return group;
      const nextTiles = [...group.tiles];
      const insertionIndex = targetIndex === undefined
        ? nextTiles.length
        : Math.max(0, Math.min(targetIndex, nextTiles.length));
      nextTiles.splice(insertionIndex, 0, ...movingTiles);
      return { ...group, tiles: orderMeldTiles(nextTiles) };
    });
```

with:

```ts
    const splitId = `split-${turnNumber}-${moveCount + 1}-${movingTiles[0].id}`;
    const resolution = resolveTileDrop(board, groupId, movingTiles, targetIndex, splitId);
    const candidateBoard = resolution.groups;
```

and replace the following `setGroupPositions` call with one that seeds the split half beside its parent:

```ts
    setGroupPositions((current) => {
      const seeded = resolution.kind === "split" && current[groupId]
        ? { ...current, [splitId]: { x: current[groupId].x + 12, y: current[groupId].y } }
        : current;
      return positionTableGroups(candidateBoard, seeded);
    });
```

- [ ] **Step 2: Rewrite `rearrangeTableTile`.** Replace its body after the guards (`remember();` onward) with:

```ts
    remember();
    if (fromGroupId === toGroupId) {
      const nextBoard = moveBoardTile(board, tileId, fromGroupId, toGroupId, targetIndex)
        .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
      setBoard(nextBoard);
      setGroupPositions((current) => positionTableGroups(nextBoard, current));
      setMoveCount((value) => value + 1);
      return;
    }
    const movingTile = board.find((group) => group.id === fromGroupId)?.tiles
      .find((entry) => entry.id === tileId);
    if (!movingTile) return;
    const removed = board.map((group) => group.id === fromGroupId
      ? { ...group, tiles: group.tiles.filter((entry) => entry.id !== tileId) }
      : group);
    const splitId = `split-${turnNumber}-${moveCount + 1}-${tileId}`;
    const resolution = resolveTileDrop(removed, toGroupId, [movingTile], targetIndex, splitId);
    const nextBoard = resolution.groups
      .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
    setBoard(nextBoard);
    setGroupPositions((current) => {
      const seeded = resolution.kind === "split" && current[toGroupId]
        ? { ...current, [splitId]: { x: current[toGroupId].x + 12, y: current[toGroupId].y } }
        : current;
      return positionTableGroups(nextBoard, seeded);
    });
    setMoveCount((value) => value + 1);
```

Add `resolveTileDrop` to the `./game` import (and remove `orderMeldTiles` if `placeTiles` was its last user — `placeTilesAsNewGroup` still uses it, so keep it).

- [ ] **Step 3: Verify** — `npm test && npm run build`, then on the dev server: place a 5-run, end turn, next turn drop the duplicate middle tile on it → it must split into two melds side by side.
- [ ] **Step 4: Commit** — `git commit -am "feat: split-on-drop for table runs"`

---

### Task 10: tail-grab for table runs (App)

**Files:**
- Modify: `src/App.tsx` (`DroppableGroup`, `DraggableBoardTile`, `GameScreen` drag state + `handleDragEnd`, `returnTileToRack` → batch, DragOverlay)
- Modify: `src/styles.css` (add `.board-tile--tail-lifted`)

**Interfaces:**
- Consumes: `moveBoardTiles` (Task 3), `analyzeMeld`.
- Produces: dragging a tile in a valid run carries `tailIds` (that tile + all to its right) through dnd-kit's `data`; all board-tile drop branches operate on the batch. `returnTilesToRack(tileIds: string[], fromGroupId: string)` replaces the single-tile version (the tile-remove ✕ button calls it with one id).

- [ ] **Step 1: Thread tail ids through drag data.** In `DroppableGroup`, compute per-tile tails and pass to `DraggableBoardTile`:

```ts
  const isValidRun = meldAnalysis.valid && meldAnalysis.type === "run";
```

and in the tile map: `tailIds={isValidRun ? group.tiles.slice(index).map((tail) => tail.id) : [entry.id]}` (change the map callback to `(entry, index) => ...`). `DraggableBoardTile` accepts `tailIds: string[]` and includes it in `useDraggable`'s data: `data: { type: "board-tile", tile, groupId, tailIds }`. It also adds `tail-lifted` styling: accept `lifted: boolean` prop, add `board-tile--tail-lifted` class when true; `DroppableGroup` passes `lifted={activeTailIds.includes(entry.id) && activeTile?.id !== entry.id}` from a new prop `activeTailIds: string[]`.

- [ ] **Step 2: Track the active tail in `GameScreen`.**

```ts
  const [activeTailIds, setActiveTailIds] = useState<string[]>([]);
```

In `handleDragStart`: `setActiveTailIds((active.data.current?.tailIds as string[] | undefined) ?? []);`
In `handleDragEnd` (first line, next to `setActiveTile(null)`): `setActiveTailIds([]);`
Pass `activeTailIds` into every `DroppableGroup`.

- [ ] **Step 3: Batch the board-tile drop branches in `handleDragEnd`.** Compute once after `draggedRackIds`:

```ts
    const draggedBoardIds = sourceType === "board-tile"
      ? ((active.data.current?.tailIds as string[] | undefined) ?? [activeId])
      : [];
```

Then update each branch:
- rack-return branches call `returnTilesToRack(draggedBoardIds, fromGroupId)`.
- `board-target:` branch: `rearrangeTableTiles(draggedBoardIds, fromGroupId, targetGroup.id, targetIndex)`.
- `group:` branch: `rearrangeTableTiles(draggedBoardIds, fromGroupId, targetGroupId)`.
- `board-drop` branch: `moveTableTilesToNewGroup(draggedBoardIds, fromGroupId, position)`.

- [ ] **Step 4: Generalize the three helpers.** Rename with batch signatures, single-id behavior unchanged:

`returnTilesToRack(tileIds: string[], fromGroupId: string)` — guard: every id must be in `returnableTileIds`, else the existing toast; collect `returningTiles` from the group in order; filter them out; splice all into the rack with the existing turn-start ordering sort; `setMoveCount((value) => Math.max(0, value - tileIds.length))`.

`rearrangeTableTiles(tileIds, fromGroupId, toGroupId, targetIndex?)` — same guards as today (`hasOpened` / returnable check applies to **every** id); single id + same group → keep `moveBoardTile` path via `moveBoardTiles`; cross-group single id → keep the Task 9 `resolveTileDrop` path; cross-group batch → `moveBoardTiles(board, tileIds, fromGroupId, toGroupId, targetIndex)` then the standard filter + `positionTableGroups`.

`moveTableTilesToNewGroup(tileIds, fromGroupId, position)` — like today's `moveTableTileToNewGroup` but filters the whole id set out of the source and creates `{ id: groupId, kind: "new", tiles: <the moved tiles in group order> }`; if the tail is the entire group, keep today's reposition-only behavior.

Update the ✕-button call site (`onReturn`) to `returnTilesToRack([entry.id], group.id)`.

- [ ] **Step 5: Overlay badge.** In the `DragOverlay`, reuse the existing `drag-stack` count for tails:

```tsx
              {(selectedIds.includes(activeTile.id) && selectedIds.length > 1) || activeTailIds.length > 1 ? (
                <span aria-label={`${Math.max(selectedIds.length, activeTailIds.length)} tiles`}>
                  {Math.max(selectedIds.length, activeTailIds.length)}
                </span>
              ) : null}
```

- [ ] **Step 6: CSS** — add near `.board-tile--dragging`:

```css
.board-tile--tail-lifted { opacity: 0.35; }
```

- [ ] **Step 7: Verify** — `npm test && npm run build`; dev server: drag the middle tile of a table run → the badge shows the tail count, dropping on felt moves the whole tail, dropping on another meld extends/splits/drafts it, sets still drag single tiles.
- [ ] **Step 8: Commit** — `git commit -am "feat: tail-grab dragging for table runs"`

---

### Task 11: Lock View (App)

**Files:**
- Modify: `src/App.tsx` (`GameScreen` view-mode state; `BoardDropZone` gesture gating + camera animation + buttons)
- Modify: `src/styles.css` (`.board-lock-button`)

**Interfaces:**
- Consumes: `layoutLockedBoard` (Task 7).
- Produces: `viewMode: "locked" | "free"`, default locked, persisted at `tessera.viewMode`. `BoardDropZone` gains props `viewMode: "locked" | "free"`, `onToggleViewMode: () => void`, `onMeasure: (size: { width: number; height: number }) => void`.

- [ ] **Step 1: State + persistence in `GameScreen`.**

```ts
  const [viewMode, setViewMode] = useState<"locked" | "free">(() =>
    localStorage.getItem("tessera.viewMode") === "free" ? "free" : "locked");
  const [stageSize, setStageSize] = useState({ width: 390, height: 480 });
  const lockedLayout = useMemo(
    () => layoutLockedBoard(board, stageSize),
    [board, stageSize],
  );
```

Replace the `layoutPositions` memo with:

```ts
  const layoutPositions = useMemo(
    () => viewMode === "locked" ? lockedLayout.positions : positionTableGroups(board, groupPositions),
    [viewMode, lockedLayout, board, groupPositions],
  );
```

Toggle handler (seeds free mode so nothing jumps):

```ts
  const toggleViewMode = () => {
    setViewMode((current) => {
      const next = current === "locked" ? "free" : "locked";
      if (next === "free") {
        setGroupPositions(clonePositions(lockedLayout.positions));
        setBoardCamera(lockedLayout.camera);
      }
      localStorage.setItem("tessera.viewMode", next);
      return next;
    });
  };
```

Pass to `BoardDropZone`: `viewMode={viewMode}`, `onToggleViewMode={toggleViewMode}`, `onMeasure={setStageSize}`, and `camera={viewMode === "locked" ? lockedLayout.camera : boardCamera}`.

- [ ] **Step 2: `BoardDropZone` changes.**
  - New props: `viewMode`, `onToggleViewMode`, `onMeasure`.
  - Measure: `const stageRef = useRef<HTMLElement | null>(null);` — merge with the droppable ref (`ref={(node) => { setNodeRef(node); stageRef.current = node; }}`), then:

```ts
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const report = () => onMeasure({ width: element.clientWidth, height: element.clientHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

  - Camera sync: replace the existing `useEffect` body that `.set()`s the MotionValues with a mode-aware version (import `animate` from framer-motion):

```ts
  useEffect(() => {
    cameraRef.current = camera;
    if (viewMode === "locked") {
      animate(cameraX, camera.x, { type: "spring", stiffness: 170, damping: 26 });
      animate(cameraY, camera.y, { type: "spring", stiffness: 170, damping: 26 });
      animate(cameraZoom, camera.zoom, { type: "spring", stiffness: 170, damping: 26 });
    } else {
      cameraX.set(camera.x);
      cameraY.set(camera.y);
      cameraZoom.set(camera.zoom);
    }
  }, [camera, viewMode, cameraX, cameraY, cameraZoom]);
```

  - Gate gestures: first line of `handlePointerDown`, `handlePointerMove`, and `handleWheel`: `if (viewMode === "locked") return;` (taps still work — the `onClick` handler is untouched; `suppressClickRef` stays false in locked mode).
  - Buttons: render the Fit button only when `viewMode === "free"`, and add beside it:

```tsx
      <button
        className="board-lock-button"
        type="button"
        aria-label={viewMode === "locked" ? "Unlock the table view" : "Lock the table view"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onToggleViewMode(); }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          {viewMode === "locked"
            ? <path d="M6 9V6a4 4 0 1 1 8 0v3M5 9h10v7H5z" />
            : <path d="M6 9V6a4 4 0 0 1 7.6-1.6M5 9h10v7H5z" />}
        </svg>
        <span>{viewMode === "locked" ? "Locked" : "Free"}</span>
      </button>
```

  - Animate meld repositions: in `GameScreen`'s `world` render, change the `meld-position` div to a motion.div:

```tsx
              <motion.div
                className="meld-position"
                key={group.id}
                initial={false}
                animate={{ left: `${position.x}%`, top: `${position.y}%` }}
                transition={{ type: "spring", stiffness: 260, damping: 28 }}
              >
```

- [ ] **Step 3: CSS.** Copy `.board-fit-button`'s rules to a shared selector (`.board-fit-button, .board-lock-button { ... }` — the existing block) and offset the lock button so both fit: add `.board-lock-button { right: 76px; }` if `.board-fit-button` is anchored right, or stack them with a shared container — match the existing button's positioning block exactly and shift by its width + 8px.

- [ ] **Step 4: Verify** — `npm test && npm run build`; dev server: default view is locked (no panning, melds in tidy rows, zoom shrinks as AI plays); toggle → free panning works, positions preserved; reload → choice remembered.
- [ ] **Step 5: Commit** — `git commit -am "feat: locked auto-fit board view with free-camera toggle"`

---

### Task 12: 777 / 789 rack buttons (App)

**Files:**
- Modify: `src/App.tsx` (rack section in `GameScreen`)
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `sortRackByGroups`, `sortRackByRuns` (Task 4).

- [ ] **Step 1: Buttons.** Inside `RackDropZone`, immediately before `<div className="rack-shell">`:

```tsx
          <div className="rack-tools" aria-label="Sort your rack">
            <button type="button" onClick={() => setRack(sortRackByGroups(rack))} aria-label="Sort into groups of one number">777</button>
            <button type="button" onClick={() => setRack(sortRackByRuns(rack))} aria-label="Sort into colour runs">789</button>
          </div>
```

Add both functions to the `./game` import.

- [ ] **Step 2: CSS** (near `.rack-shell`):

```css
.rack-tools {
  position: absolute;
  top: -14px;
  right: 14px;
  z-index: 3;
  display: flex;
  gap: 6px;
}

.rack-tools button {
  padding: 3px 9px;
  border: 1.5px solid var(--line);
  border-radius: 999px;
  background: var(--cream-bright);
  font-family: var(--serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.rack-tools button:active { transform: scale(0.95); }
```

`.rack-section` already has `position: relative` — verify, and add it if not.

- [ ] **Step 3: Verify** — `npm run build`; dev server: 777 clusters numbers, 789 clusters colors, jokers land last, drag-reorder still works after sorting.
- [ ] **Step 4: Commit** — `git commit -am "feat: 777/789 rack sort buttons"`

---

### Task 13: pool-empty endgame — pass, stalemate, differential scores (engine + App)

**Files:**
- Modify: `src/game.ts` (`resolveTimeout` third parameter + `"pass"` outcome)
- Modify: `src/App.tsx` (`GameScreen`: pass state/flow, AI pass, stalemate end, result sheet variant)
- Test: `src/game.test.ts`

**Interfaces:**
- Consumes: `scoreStalemate` (Task 5).
- Produces: `resolveTimeout(moveCount: number, tableIsLegal: boolean, poolIsEmpty: boolean): TimeoutOutcome` with `TimeoutOutcome = "submit" | "draw-one" | "revert-draw-one" | "pass"`.

- [ ] **Step 1: Engine test update** (extend the timeout test):

```ts
  it("resolves timeout from the current table state", () => {
    expect(resolveTimeout(0, false, false)).toBe("draw-one");
    expect(resolveTimeout(0, false, true)).toBe("pass");
    expect(resolveTimeout(3, true, false)).toBe("submit");
    expect(resolveTimeout(2, false, false)).toBe("revert-draw-one");
  });
```

- [ ] **Step 2: Run to verify failure**, then implement:

```ts
export type TimeoutOutcome = "submit" | "draw-one" | "revert-draw-one" | "pass";

export function resolveTimeout(moveCount: number, tableIsLegal: boolean, poolIsEmpty: boolean): TimeoutOutcome {
  if (moveCount === 0) return poolIsEmpty ? "pass" : "draw-one";
  return tableIsLegal ? "submit" : "revert-draw-one";
}
```

- [ ] **Step 3: App state.** In `GameScreen`:

```ts
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [endedByStalemate, setEndedByStalemate] = useState(false);
```

A shared ender:

```ts
  const endByStalemate = (racks: Record<PlayerName, Tile[]>) => {
    setEndedByStalemate(true);
    setWinner(scoreStalemate(racks).winner);
  };
```

(Import `PlayerName, scoreStalemate` from `./game`; `Winner` in App is assignment-compatible with `PlayerName`.)

`handlePass`:

```ts
  const handlePass = () => {
    const base = cloneTurnSnapshot(turnStart);
    setRack(base.rack);
    setBoard(cloneBoard(base.board));
    setGroupPositions(clonePositions(turnStartPositions));
    setHistory([]);
    setMoveCount(0);
    setSelectedIds([]);
    const nextPasses = consecutivePasses + 1;
    if (nextPasses >= 3) {
      endByStalemate({ You: base.rack, Maya: opponentRacks.Maya, Leo: opponentRacks.Leo });
      return;
    }
    setConsecutivePasses(nextPasses);
    setToast("Pool empty · you pass");
    setActiveOpponent("Leo");
    window.setTimeout(() => setTurnState("opponent"), 420);
  };
```

`handleTurnAction`: `if (moveCount === 0) { pool.length === 0 ? handlePass() : handleDraw(); return; }`. In `handleDraw` and `handleEndTurn`, add `setConsecutivePasses(0);`. Remove the now-dead "pool is empty" toast branch from `handleDraw`. In `resetGame`, reset both new states.

Timeout effect: change the call to `resolveTimeout(moveCount, turnValidation.legal, turnStart.pool.length === 0)` and add before the submit branch:

```ts
    if (timeoutOutcome === "pass") {
      handlePass();
      return;
    }
```

(Add `handlePass`'s dependencies to the effect's dep array as needed — `consecutivePasses`, `opponentRacks`.)

- [ ] **Step 4: AI passes.** In the opponent-turn effect, after computing `result`:

```ts
      if (result.action === "stuck") {
        const nextPasses = consecutivePasses + 1;
        if (nextPasses >= 3) {
          endByStalemate({
            You: rack,
            Maya: actingOpponent === "Maya" ? result.rack : opponentRacks.Maya,
            Leo: actingOpponent === "Leo" ? result.rack : opponentRacks.Leo,
          });
          return;
        }
        setConsecutivePasses(nextPasses);
      } else {
        setConsecutivePasses(0);
      }
```

(Place it right after `setOpponentRacks`; add `consecutivePasses` to the dep array.)

- [ ] **Step 5: Button label + result sheet.** Turn-action button content:

```tsx
          <span className="turn-action__label">{moveCount === 0 && pool.length === 0 ? "Pass" : "End turn"}</span>
```

and its `aria-label` idle branch: `` moveCount === 0 ? (pool.length === 0 ? "Pass — the pool is empty." : `Draw one tile and end turn. ${pool.length} tiles remain in the pool.`) : ... ``

`finalScores` memo — use stalemate scores when applicable:

```ts
    const scores = endedByStalemate ? scoreStalemate(racks).scores : scoreRound(winner, racks);
```

(add `endedByStalemate` to the memo deps). Result sheet copy:

```tsx
              <span className="result-sheet__eyebrow">{endedByStalemate ? "Pool empty · no moves left" : "Round complete"}</span>
              <h2>{winner === "You" ? (endedByStalemate ? "Narrow victory." : "Beautifully played.") : `${winner} takes the table.`}</h2>
              <p>{endedByStalemate
                ? "Nobody could move — lowest rack total wins."
                : winner === "You" ? "You cleared all of your tiles." : `${winner} cleared their rack first.`}</p>
```

- [ ] **Step 6: Verify** — `npm test && npm run build`. Dev-server spot check is impractical for a 64-tile pool; instead temporarily set `pool: tiles.slice(42, 44)` in `createDeal`, confirm the pass→stalemate flow and result sheet, then revert the temporary change before committing.
- [ ] **Step 7: Commit** — `git commit -am "feat: pool-empty pass flow and stalemate scoring"`

---

### Task 14: docs — README + CLAUDE.md

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README.** Update the interaction list: replace the "Fresh empty-board start with 14 tiles per player and 64 in the pool" bullet with "Fresh random deal every game — 14 tiles per player, 64 in the pool"; replace the timer bullet's "penalizes an illegal draft" with "restores the table and draws one on an unfinished draft"; add bullets: "Drop a duplicate tile mid-run to split it into two melds, exactly like the boxed rules", "Drag a run's tail (a tile plus everything right of it) as one stack", "Locked auto-arranging table view by default, free camera one tap away", "777 / 789 one-tap rack sorting", "Pool-empty endgame: pass turns and lowest-rack differential scoring".

- [ ] **Step 2: CLAUDE.md.** Required edits:
  - Project paragraph: replace "every game starts from the same deterministic deal" with "each game deals randomly via `createDeal` (seedable with `seededRng` for tests)".
  - Architecture: add `src/layout.ts` ("pure locked-view layout: row packing + fit camera; tested in `layout.test.ts`") to the file list ("Three files" → "Four files").
  - Rules specifics: delete the "deal is deterministic / seededShuffle" bullet; add "Drops onto melds resolve extend → split → draft via `resolveTileDrop`; splits only fire when both halves are legal runs".
  - Turn loop: timeout outcomes are now submit / draw-one / revert-draw-one / pass; note the pass/stalemate ending (three consecutive passes on an empty pool → `scoreStalemate`).
  - Gotchas: remove any stale claims this work invalidates (check each bullet); add "`viewMode` persists at localStorage `tessera.viewMode`; locked mode ignores `groupPositions` entirely".

- [ ] **Step 3: Verify** — read both files once top-to-bottom for stale statements (e.g., README's old timer wording, CLAUDE.md's dnd id table is unchanged by this work — droppable ids stayed the same).
- [ ] **Step 4: Commit** — `git commit -am "docs: update README and CLAUDE.md for parity release"`

---

## Final acceptance (after all tasks)

- [ ] `npm test` — full suite green.
- [ ] `npm run build` — clean.
- [ ] Phone smoke test over LAN (`npm run dev`): split-by-drop, tail-grab, locked default + toggle + persistence, 777/789, random deals on Play Again, timeout revert+1.
- [ ] `git log --oneline` shows one commit per task.
