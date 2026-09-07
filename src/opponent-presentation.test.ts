import { expect, it } from "vitest";
import { tile, type BoardGroup } from "./game";
import { opponentPlayFrames } from "./opponent-presentation";

it("reveals opponent tiles one at a time while preserving the existing table", () => {
  const old = [5, 6, 7].map((n) => tile(`old-${n}`, n, "cobalt"));
  const added = [8, 9].map((n) => tile(`new-${n}`, n, "cobalt"));
  const before: BoardGroup[] = [{ id: "run", kind: "run", tiles: old }, { id: "new-meld", kind: "new", tiles: [] }];
  const after: BoardGroup[] = [{ id: "run", kind: "run", tiles: [...old, ...added] }, before[1]];
  const frames = opponentPlayFrames(before, after, added.map((t) => t.id));
  expect(frames.map((f) => f.board[0].tiles.length)).toEqual([4, 5]);
  expect(frames[0].board[0].tiles.some((t) => t.id === "new-9")).toBe(false);
  expect(frames.at(-1)?.board).toEqual(after);
  expect(before[0].tiles).toEqual(old);
});

it("never presents an unplayed or duplicate tile", () => {
  const t = tile("played", 8, "cobalt");
  const after: BoardGroup[] = [{ id: "g", kind: "new", tiles: [t] }];
  expect(opponentPlayFrames([], after, ["hidden-rack-tile", t.id, t.id]).map((f) => f.tile.id)).toEqual([t.id]);
  expect(opponentPlayFrames([], [], [])).toEqual([]);
});
