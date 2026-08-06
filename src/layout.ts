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
