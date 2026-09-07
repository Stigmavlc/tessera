import { BoardGroup } from "./game";

export type TablePoint = { x: number; y: number };
export type TablePositions = Record<string, TablePoint>;
export type BoardCamera = { x: number; y: number; zoom: number };

// Match the fixed world-space tile sizes in .board-world. Unlike a percentage
// estimate, this also keeps groups apart on a short, wide landscape board.
export function tableFootprint(tileCount: number, stage: { width: number; height: number }) {
  const tileWidth = tileCount >= 11 ? 29 : tileCount >= 8 ? 34 : 46;
  const gap = tileCount >= 11 ? 1 : tileCount >= 8 ? 2 : 3;
  return {
    width: (tileCount * tileWidth + Math.max(0, tileCount - 1) * gap + 14) / (stage.width * 1.7) * 100,
    height: 80 / (stage.height * 1.7) * 100,
  };
}

export function positionTableGroups(
  groups: BoardGroup[], current: TablePositions,
  stage: { width: number; height: number }, movedId?: string,
): TablePositions {
  const positions: TablePositions = {};
  const placed: Array<{ point: TablePoint; size: ReturnType<typeof tableFootprint> }> = [];
  const occupied = groups.filter((group) => group.tiles.length > 0)
    .sort((a, b) => Number(a.id === movedId) - Number(b.id === movedId));
  for (const group of occupied) {
    const size = tableFootprint(group.tiles.length, stage);
    const clamp = (point: TablePoint) => ({
      x: Math.max(size.width / 2 + 1, Math.min(99 - size.width / 2, point.x)),
      y: Math.max(size.height / 2 + 1, Math.min(99 - size.height / 2, point.y)),
    });
    const desired = clamp(current[group.id] ?? { x: 18, y: 18 });
    const isOpen = (candidate: TablePoint) => placed.every((entry) =>
      Math.abs(candidate.x - entry.point.x) >= (size.width + entry.size.width) / 2 + 1
      || Math.abs(candidate.y - entry.point.y) >= (size.height + entry.size.height) / 2 + 1);
    if (isOpen(desired)) {
      positions[group.id] = desired;
      placed.push({ point: desired, size });
      continue;
    }
    const candidates: TablePoint[] = [];
    // Search locally first instead of jumping a dropped group to a preset row.
    for (let y = size.height / 2 + 1; y <= 99 - size.height / 2; y += 2) {
      for (let x = size.width / 2 + 1; x <= 99 - size.width / 2; x += 2) candidates.push({ x, y });
    }
    candidates.sort((a, b) => Math.hypot((a.x - desired.x) * stage.width, (a.y - desired.y) * stage.height)
      - Math.hypot((b.x - desired.x) * stage.width, (b.y - desired.y) * stage.height));
    const point = candidates.find(isOpen) ?? desired;
    positions[group.id] = point;
    placed.push({ point, size });
  }
  return positions;
}
