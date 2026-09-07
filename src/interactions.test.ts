import { describe, expect, it } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { tile } from "./game";
import { moveRackSelection, tabletopCollision, withRackOrder, worldPoint } from "./interactions";

const rectangle = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
const collisionAt = (point: { x: number; y: number } | null, canAccept = false) => tabletopCollision({
  pointerCoordinates: point,
  collisionRect: rectangle(80, 135, 52, 70),
  droppableRects: new Map([
    ["board-drop", rectangle(0, 0, 390, 400)],
    ["group:nines", rectangle(60, 100, 100, 45)],
    ["board-target:nine", rectangle(85, 105, 28, 36)],
  ]),
  droppableContainers: [{ id: "board-drop" }, { id: "group:nines", data: { current: { canAccept } } }, { id: "board-target:nine" }],
} as unknown as Parameters<CollisionDetection>[0]);

describe("precise table drops", () => {
  it("accepts a compatible approach 35 px beside the group but not an incompatible one", () => {
    expect(collisionAt({ x: 195, y: 120 }, true)[0].id).toBe("group:nines");
    expect(collisionAt({ x: 195, y: 120 }, false)[0].id).toBe("board-drop");
    expect(collisionAt({ x: 100, y: 165 }, true)[0].id).toBe("board-drop");
  });
  it("keeps empty felt below a meld independent even when the large dragged rectangle overlaps it", () => {
    expect(collisionAt({ x: 100, y: 160 }).map((hit) => hit.id)).toEqual(["board-drop"]);
  });
  it("prefers the exact tile under the pointer for deliberate insertion", () => {
    expect(collisionAt({ x: 100, y: 120 })[0].id).toBe("board-target:nine");
  });
  it("does not pull an off-table drop into the closest meld", () => {
    expect(collisionAt({ x: 410, y: 150 })).toEqual([]);
  });
  it("retains keyboard targeting when there is no pointer", () => {
    expect(collisionAt(null).length).toBeGreaterThan(0);
  });
  it("converts the pointer to world coordinates after panning and zooming", () => {
    expect(worldPoint({ x: 130, y: 220 }, { left: -20, top: 100, width: 600, height: 300 })).toEqual({ x: 25, y: 40 });
  });
});

describe("rack arrangement", () => {
  const rack = [1, 2, 3, 4, 5].map((n) => tile(String(n), n, "cobalt"));
  it("moves the selected batch in rack order, even when selected out of order", () => {
    expect(moveRackSelection(rack, ["3", "1"], "5").map((t) => t.id)).toEqual(["2", "4", "5", "1", "3"]);
    expect(rack.map((t) => t.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("moves a tile over its immediate neighbour in either direction", () => {
    expect(moveRackSelection(rack, ["1"], "2").map((t) => t.id)).toEqual(["2", "1", "3", "4", "5"]);
    expect(moveRackSelection(rack, ["2"], "1").map((t) => t.id)).toEqual(["2", "1", "3", "4", "5"]);
  });
  it("can move a batch to the end and leaves a drop on its own selection alone", () => {
    expect(moveRackSelection(rack, ["1", "2"]).map((t) => t.id)).toEqual(["3", "4", "5", "1", "2"]);
    expect(moveRackSelection(rack, ["1", "2"], "2")).toBe(rack);
  });
  it("restores the table's rack tiles without throwing away the player's arrangement", () => {
    expect(withRackOrder(rack, [rack[4], rack[1], rack[0]]).map((t) => t.id)).toEqual(["5", "2", "1", "3", "4"]);
  });
});
