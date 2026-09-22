import { BoardGroup } from "./game";

export type TablePoint = { x: number; y: number };
export type TablePositions = Record<string, TablePoint>;
export type BoardCamera = { x: number; y: number; zoom: number };
export type TableBounds = { left: number; right: number; top: number; bottom: number };

// Keep enough movable space and the stage's aspect ratio when the phone
// rotates or browser bars reduce its height. Pass these dimensions to CSS.
export const tableWorldSize = (stage: { width: number; height: number }) => {
  const width = Math.max(1, stage.width), height = Math.max(1, stage.height);
  const scale = Math.max(1.7, 680 / width, 960 / height);
  return { width: width * scale, height: height * scale };
};

// Match the fixed world-space tile sizes in .board-world. Unlike a percentage
// estimate, this also keeps groups apart on a short, wide landscape board.
export function tableFootprint(tileCount: number, stage: { width: number; height: number }) {
  const tileWidth = tileCount >= 11 ? 29 : tileCount >= 8 ? 34 : 46;
  const gap = tileCount >= 11 ? 1 : tileCount >= 8 ? 2 : 3;
  const world = tableWorldSize(stage);
  return {
    width: (tileCount * tileWidth + Math.max(0, tileCount - 1) * gap + 14) / world.width * 100,
    height: 80 / world.height * 100,
  };
}

export function tableBounds(groups: BoardGroup[], positions: TablePositions, stage: { width: number; height: number }): TableBounds | null {
  const world = tableWorldSize(stage);
  const boxes = groups.filter((group) => group.tiles.length > 0).map((group) => {
    const position = positions[group.id];
    const size = tableFootprint(group.tiles.length, stage);
    return {
      left: (position.x - size.width / 2) * world.width / 100,
      right: (position.x + size.width / 2) * world.width / 100,
      top: (position.y - size.height / 2) * world.height / 100,
      bottom: (position.y + size.height / 2) * world.height / 100,
    };
  });
  return boxes.length ? {
    left: Math.min(...boxes.map((box) => box.left)), right: Math.max(...boxes.map((box) => box.right)),
    top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)),
  } : null;
}

// Automatic framing moves only as far as necessary; the caller defers it
// during drags. Explicit Fit centres the table at the normal tile size or below.
export function fitTableCamera(bounds: TableBounds | null, stage: { width: number; height: number }, camera: BoardCamera, center = false): BoardCamera {
  if (!bounds || stage.width <= 0 || stage.height <= 0) return camera;
  const padding = Math.min(12, stage.width / 4, stage.height / 4);
  const zoom = Math.min(center ? 0.58 : camera.zoom, (stage.width - padding * 2) / (bounds.right - bounds.left), (stage.height - padding * 2) / (bounds.bottom - bounds.top));
  const x = center ? (stage.width - (bounds.left + bounds.right) * zoom) / 2
    : Math.max(padding - bounds.left * zoom, Math.min(stage.width - padding - bounds.right * zoom, camera.x));
  const y = center ? (stage.height - (bounds.top + bounds.bottom) * zoom) / 2
    : Math.max(padding - bounds.top * zoom, Math.min(stage.height - padding - bounds.bottom * zoom, camera.y));
  return Math.abs(x - camera.x) < 0.01 && Math.abs(y - camera.y) < 0.01 && Math.abs(zoom - camera.zoom) < 0.00001
    ? camera : { x, y, zoom };
}

export function positionTableGroups(
  groups: BoardGroup[], current: TablePositions,
  stage: { width: number; height: number }, movedId?: string,
): TablePositions {
  const world = tableWorldSize(stage);
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
    if ((current[group.id] || !placed.length) && isOpen(desired)) {
      positions[group.id] = desired;
      placed.push({ point: desired, size });
      continue;
    }
    const candidates: TablePoint[] = [];
    // Search locally first instead of jumping a dropped group to a preset row.
    for (let y = size.height / 2 + 1; y <= 99 - size.height / 2; y += 2) {
      for (let x = size.width / 2 + 1; x <= 99 - size.width / 2; x += 2) candidates.push({ x, y });
    }
    const left = Math.min(...placed.map((entry) => entry.point.x - entry.size.width / 2));
    const right = Math.max(...placed.map((entry) => entry.point.x + entry.size.width / 2));
    const top = Math.min(...placed.map((entry) => entry.point.y - entry.size.height / 2));
    const bottom = Math.max(...placed.map((entry) => entry.point.y + entry.size.height / 2));
    const extent = (point: TablePoint) => Math.max(
      (Math.max(right, point.x + size.width / 2) - Math.min(left, point.x - size.width / 2)) * world.width / stage.width,
      (Math.max(bottom, point.y + size.height / 2) - Math.min(top, point.y - size.height / 2)) * world.height / stage.height,
    );
    // New AI groups should use the available screen shape. Otherwise nearest
    // placement stacks them vertically and Fit wastes most of a wide screen.
    // Explicit player positions and existing groups still stay where requested.
    candidates.sort((a, b) => (!current[group.id] ? extent(a) - extent(b) : 0)
      || Math.hypot((a.x - desired.x) * world.width, (a.y - desired.y) * world.height)
      - Math.hypot((b.x - desired.x) * world.width, (b.y - desired.y) * world.height));
    const point = candidates.find(isOpen) ?? desired;
    positions[group.id] = point;
    placed.push({ point, size });
  }
  return positions;
}
