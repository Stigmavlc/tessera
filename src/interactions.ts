import { closestCenter, pointerWithin, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import type { Tile } from "./game";
import type { TablePoint } from "./layout";

const priority = (id: string | number) => {
  const value = String(id);
  if (value.startsWith("board-target:")) return 0;
  if (value.startsWith("meld-end:")) return 1;
  if (value.startsWith("group:")) return 2;
  if (value === "board-drop") return 5;
  if (value === "rack-drop") return 4;
  return 3;
};

// A generous horizontal approach lane belongs only to a compatible meld.
// Keep the vertical tolerance narrow so a new group below stays independent.
export const tabletopCollision: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args).sort((a, b) => priority(a.id) - priority(b.id));
  if (hits[0]?.id !== "board-drop") return hits;
  const pointer = args.pointerCoordinates;
  const nearby = args.droppableContainers.flatMap((container) => {
    if (!String(container.id).startsWith("group:") || !container.data?.current?.canAccept) return [];
    const rect = args.droppableRects.get(container.id);
    if (!rect) return [];
    const dx = Math.max(rect.left - pointer.x, pointer.x - rect.right, 0);
    const dy = Math.max(rect.top - pointer.y, pointer.y - rect.bottom, 0);
    return dx <= 40 && dy <= 10 ? [{ id: container.id, distance: Math.hypot(dx, dy * 3) }] : [];
  }).sort((a, b) => a.distance - b.distance);
  return nearby.length ? [{ id: nearby[0].id }, ...hits] : hits;
};

export function pointerPosition(event: Event): TablePoint | null {
  if ("clientX" in event && "clientY" in event) {
    return { x: Number(event.clientX), y: Number(event.clientY) };
  }
  return null;
}

export function worldPoint(point: TablePoint, rect: { left: number; top: number; width: number; height: number }): TablePoint {
  return { x: (point.x - rect.left) / rect.width * 100, y: (point.y - rect.top) / rect.height * 100 };
}

// Keep the visible tile centred on the same point used for collision and drop
// placement, including after changing from rack size to board size.
export const centerDragOnPointer: Modifier = ({ activatorEvent, draggingNodeRect, overlayNodeRect, transform }) => {
  const point = activatorEvent && pointerPosition(activatorEvent);
  if (!point || !draggingNodeRect || !overlayNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + point.x - draggingNodeRect.left - overlayNodeRect.width / 2,
    y: transform.y + point.y - draggingNodeRect.top - overlayNodeRect.height / 2,
  };
};

export function moveRackSelection(rack: Tile[], ids: string[], targetId?: string): Tile[] {
  const selected = new Set(ids);
  if (targetId && selected.has(targetId)) return rack;
  const moving = rack.filter((tile) => selected.has(tile.id));
  const remaining = rack.filter((tile) => !selected.has(tile.id));
  const target = targetId ? remaining.findIndex((tile) => tile.id === targetId) : remaining.length;
  if (!moving.length || target < 0) return rack;
  const movingForward = targetId && rack.findIndex((tile) => tile.id === targetId)
    > rack.findIndex((tile) => selected.has(tile.id));
  const insertion = target + (movingForward ? 1 : 0);
  return [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
}

// Preserve manual ordering when a draw/timeout restores the turn snapshot.
export function withRackOrder(tiles: Tile[], order: Tile[]): Tile[] {
  const rank = new Map(order.map((tile, index) => [tile.id, index]));
  return [...tiles].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
