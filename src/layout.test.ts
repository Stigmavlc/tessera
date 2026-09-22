import { describe, expect, it } from "vitest";
import { BoardGroup, tile } from "./game";
import { BoardCamera, fitTableCamera, positionTableGroups, tableBounds, tableFootprint } from "./layout";

const meld = (id: string, size: number): BoardGroup => ({
  id,
  kind: "run",
  tiles: Array.from({ length: size }, (_, index) => tile(`${id}-${index}`, index + 1, "cobalt")),
});

describe("automatic table framing", () => {
  it("uses the width of a short screen to keep crowded tiles larger", () => {
    const stage = { width: 519, height: 107 };
    const groups = Array.from({ length: 13 }, (_, i) => meld(`g${i}`, 4));
    const positions = positionTableGroups(groups, {}, stage);
    const camera = fitTableCamera(tableBounds(groups, positions, stage), stage, { x: 0, y: 6, zoom: 0.58 }, true);
    expect(camera.zoom).toBeGreaterThan(0.25);
  });
  it.each([{ width: 390, height: 434 }, { width: 320, height: 158 }, { width: 696, height: 170 }])("keeps successive additions visible without Fit at %o", (stage) => {
    let camera: BoardCamera = { x: 0, y: 6, zoom: 0.58 };
    let positions = {};
    for (let count = 1; count <= 16; count++) {
      const groups = Array.from({ length: count }, (_, i) => meld(`g${i}`, 4));
      positions = positionTableGroups(groups, positions, stage);
      const bounds = tableBounds(groups, positions, stage)!;
      camera = fitTableCamera(bounds, stage, camera);
      expect(bounds.left * camera.zoom + camera.x).toBeGreaterThanOrEqual(11.9);
      expect(bounds.right * camera.zoom + camera.x).toBeLessThanOrEqual(stage.width - 11.9);
      expect(bounds.top * camera.zoom + camera.y).toBeGreaterThanOrEqual(11.9);
      expect(bounds.bottom * camera.zoom + camera.y).toBeLessThanOrEqual(stage.height - 11.9);
    }
  });
  it("keeps a visible layout steady and pans before making tiles smaller", () => {
    const camera = { x: 0, y: 6, zoom: 0.58 };
    const bounds = { left: 30, right: 300, top: 50, bottom: 400 };
    expect(fitTableCamera(bounds, rect, camera)).toBe(camera);
    const moved = fitTableCamera({ ...bounds, bottom: 950 }, rect, camera);
    expect(moved.zoom).toBeLessThan(camera.zoom);
    const shifted = fitTableCamera({ ...bounds, top: 550, bottom: 950 }, rect, camera);
    expect(shifted.zoom).toBe(camera.zoom);
    expect(shifted.y).toBeLessThan(camera.y);
  });
  it("restores readable size when a taller viewport becomes available", () => {
    const camera = { x: 0, y: 6, zoom: 0.1 };
    const bounds = { left: 10, right: 500, top: 20, bottom: 500 };
    expect(fitTableCamera(bounds, rect, camera, true).zoom).toBe(0.58);
    expect(fitTableCamera(null, rect, camera)).toBe(camera);
  });
});
const rect = { width: 390, height: 520 };

describe("free table placement", () => {
  it.each([{ width: 320, height: 100 }, { width: 519, height: 95 }])("keeps a crowded 52-tile table separated at %o", (stage) => {
    const groups = Array.from({ length: 13 }, (_, i) => meld(`set-${i}`, 4));
    const positions = positionTableGroups(groups, {}, stage);
    const size = tableFootprint(4, stage);
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = positions[groups[i].id], b = positions[groups[j].id];
      expect(Math.abs(a.x - b.x) >= size.width || Math.abs(a.y - b.y) >= size.height).toBe(true);
    }
  });
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
