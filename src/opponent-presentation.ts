import type { BoardGroup, Tile } from "./game";

export type OpponentPlayFrame = { tile: Tile; board: BoardGroup[] };

// Reveal only publicly played tiles. Unplayed opponent rack faces never enter
// the presentation state; draws are represented by a face-down tile.
export function opponentPlayFrames(before: BoardGroup[], after: BoardGroup[], playedIds: string[]): OpponentPlayFrame[] {
  const visible = new Set(before.flatMap((group) => group.tiles.map((tile) => tile.id)));
  const finalTiles = new Map(after.flatMap((group) => group.tiles.map((tile) => [tile.id, tile] as const)));
  const frames: OpponentPlayFrame[] = [];
  for (const id of playedIds) {
    const tile = finalTiles.get(id);
    if (!tile || visible.has(id)) continue;
    visible.add(id);
    frames.push({ tile, board: after.map((group) => ({
      ...group, tiles: group.tiles.filter((entry) => visible.has(entry.id)),
    })).filter((group) => group.id === "new-meld" || group.tiles.length > 0) });
  }
  return frames;
}
