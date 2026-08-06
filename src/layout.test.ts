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
