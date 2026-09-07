import { describe, expect, it } from "vitest";
import { BoardGroup, tile } from "./game";
import { positionTableGroups, tableFootprint } from "./layout";

const meld = (id: string, size: number): BoardGroup => ({
  id,
  kind: "run",
  tiles: Array.from({ length: size }, (_, index) => tile(`${id}-${index}`, index + 1, "cobalt")),
});
const rect = { width: 390, height: 520 };

describe("free table placement", () => {
  it("is deterministic, keeps groups inside the world, and preserves positions when appending", () => {
    const groups = [meld("a", 3), meld("b", 4), meld("c", 5)];
    const positions = positionTableGroups(groups, {}, rect);
    expect(positionTableGroups(groups, {}, rect)).toEqual(positions);
    const appended = positionTableGroups([...groups, meld("d", 3)], positions, rect);
    for (const [id, point] of Object.entries(positions)) {
      expect(appended[id]).toEqual(point);
      const size = tableFootprint(groups.find((group) => group.id === id)!.tiles.length, rect);
      expect(point.x - size.width / 2).toBeGreaterThanOrEqual(0);
      expect(point.x + size.width / 2).toBeLessThanOrEqual(100);
      expect(point.y - size.height / 2).toBeGreaterThanOrEqual(0);
      expect(point.y + size.height / 2).toBeLessThanOrEqual(100);
    }
  });
  it("keeps a new trio below an existing trio exactly where it was requested", () => {
    const requested = { nines: { x: 35, y: 25 }, sevens: { x: 35, y: 55 } };
    expect(positionTableGroups([meld("nines", 3), meld("sevens", 3)], requested, rect)).toEqual(requested);
  });
  it("resolves overlap nearby without moving the stationary group", () => {
    const requested = { moved: { x: 50, y: 50 }, fixed: { x: 50, y: 50 } };
    const result = positionTableGroups([meld("moved", 3), meld("fixed", 3)], requested, rect, "moved");
    expect(result.fixed).toEqual(requested.fixed);
    expect(result.moved).not.toEqual(result.fixed);
    expect(Math.hypot(result.moved.x - 50, result.moved.y - 50)).toBeLessThan(15);
  });
  it.each([{ width: 390, height: 440 }, { width: 696, height: 186 }])("keeps actual tile footprints apart at %o", (stage) => {
    const groups = Array.from({ length: 8 }, (_, index) => meld(`g${index}`, 3));
    const positions = positionTableGroups(groups, {}, stage);
    const size = tableFootprint(3, stage);
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = positions[groups[i].id], b = positions[groups[j].id];
        expect(Math.abs(a.x - b.x) >= size.width || Math.abs(a.y - b.y) >= size.height).toBe(true);
      }
    }
  });
});
