export type TileColor = "terracotta" | "cobalt" | "marigold" | "graphite" | "joker";

export type Tile = {
  id: string;
  value: number | "★";
  color: TileColor;
};

export type BoardGroup = {
  id: string;
  kind: "run" | "set" | "new";
  tiles: Tile[];
};

export type MeldAnalysis = {
  valid: boolean;
  type: "run" | "set" | null;
  score: number;
  reason: string;
};

export type TurnSnapshot = {
  rack: Tile[];
  board: BoardGroup[];
  pool: Tile[];
  hasOpened: boolean;
};

export type TurnValidation = {
  legal: boolean;
  reason: string;
  playedTileIds: string[];
  openingScore: number;
  opensPlayer: boolean;
  winsGame: boolean;
};

export type OpponentName = "Maya" | "Leo";
export type PlayerName = "You" | OpponentName;

export type OpponentRacks = Record<OpponentName, Tile[]>;

export type AITurnResult = {
  action: "play" | "draw" | "stuck";
  board: BoardGroup[];
  rack: Tile[];
  pool: Tile[];
  playedTileIds: string[];
  message: string;
  opensPlayer: boolean;
  winsGame: boolean;
};

export type TimeoutOutcome = "submit" | "draw-one" | "penalty-three";

export const standardColors: Exclude<TileColor, "joker">[] = [
  "terracotta",
  "cobalt",
  "marigold",
  "graphite",
];

export const tile = (id: string, value: Tile["value"], color: TileColor): Tile => ({
  id,
  value,
  color,
});

const standardTile = (color: Exclude<TileColor, "joker">, value: number, copy: "a" | "b") =>
  tile(`${color}-${value}-${copy}`, value, color);

export function createStandardPool(): Tile[] {
  const tiles: Tile[] = [];
  for (const copy of ["a", "b"] as const) {
    for (const color of standardColors) {
      for (let value = 1; value <= 13; value += 1) {
        tiles.push(standardTile(color, value, copy));
      }
    }
  }
  tiles.push(tile("joker-a", "★", "joker"), tile("joker-b", "★", "joker"));
  return tiles;
}

export const initialRack: Tile[] = [
  standardTile("terracotta", 1, "a"),
  standardTile("graphite", 2, "a"),
  standardTile("marigold", 4, "b"),
  standardTile("cobalt", 7, "a"),
  standardTile("terracotta", 9, "a"),
  standardTile("marigold", 11, "a"),
  standardTile("graphite", 12, "a"),
  tile("joker-a", "★", "joker"),
  standardTile("cobalt", 1, "a"),
  standardTile("cobalt", 2, "a"),
  standardTile("terracotta", 10, "b"),
  standardTile("graphite", 10, "a"),
  standardTile("marigold", 10, "a"),
  standardTile("cobalt", 10, "a"),
];

export const initialBoard: BoardGroup[] = [{ id: "new-meld", kind: "new", tiles: [] }];

const seededShuffle = <T,>(items: T[]): T[] => {
  const result = [...items];
  let seed = 0x5e551a;
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const occupiedIds = new Set([
  ...initialRack.map((entry) => entry.id),
]);

// A deterministic fresh three-player deal: 14 tiles each and 64 in the pool.
const availableNewGameTiles = seededShuffle(
  createStandardPool().filter((entry) => !occupiedIds.has(entry.id)),
);

export const initialPool: Tile[] = availableNewGameTiles.slice(28);

export const initialOpponentRacks: OpponentRacks = {
  Maya: availableNewGameTiles.slice(0, 14),
  Leo: availableNewGameTiles.slice(14, 28),
};

const regularTiles = (tiles: Tile[]) => tiles.filter((entry) => entry.color !== "joker");

function analyzeSet(tiles: Tile[]): MeldAnalysis | null {
  if (tiles.length < 3 || tiles.length > 4) return null;
  const regular = regularTiles(tiles);
  if (regular.length === 0) return null;
  const values = regular.map((entry) => entry.value).filter((value): value is number => typeof value === "number");
  const colors = regular.map((entry) => entry.color);
  if (!values.every((value) => value === values[0])) return null;
  if (new Set(colors).size !== colors.length) {
    return { valid: false, type: "set", score: 0, reason: "A group cannot repeat a colour." };
  }
  return {
    valid: true,
    type: "set",
    score: values[0] * tiles.length,
    reason: "Legal group.",
  };
}

function analyzeRun(tiles: Tile[]): MeldAnalysis | null {
  if (tiles.length < 3 || tiles.length > 13) return null;
  const regular = regularTiles(tiles);
  if (regular.length === 0) return null;
  if (!regular.every((entry) => entry.color === regular[0].color)) return null;

  const values = regular
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  if (new Set(values).size !== values.length) {
    return { valid: false, type: "run", score: 0, reason: "A run cannot repeat a number." };
  }

  const jokerCount = tiles.length - regular.length;
  const span = values.at(-1)! - values[0] + 1;
  const missingInside = span - values.length;
  if (missingInside > jokerCount || span > tiles.length) {
    return { valid: false, type: "run", score: 0, reason: "The numbers must be consecutive." };
  }

  const remainingJokers = jokerCount - missingInside;
  const lowestStart = Math.max(1, values.at(-1)! - tiles.length + 1);
  const highestStart = Math.min(values[0], 13 - tiles.length + 1);
  if (lowestStart > highestStart || span + remainingJokers > 13) {
    return { valid: false, type: "run", score: 0, reason: "Runs stay between 1 and 13; 1 cannot follow 13." };
  }

  // When a joker could sit at either end, choose the highest legal represented value.
  const start = highestStart;
  const score = Array.from({ length: tiles.length }, (_, index) => start + index)
    .reduce((total, value) => total + value, 0);
  return { valid: true, type: "run", score, reason: "Legal run." };
}

export function analyzeMeld(tiles: Tile[]): MeldAnalysis {
  if (tiles.length === 0) return { valid: true, type: null, score: 0, reason: "Empty draft slot." };
  if (tiles.length < 3) {
    return { valid: false, type: null, score: 0, reason: `A meld needs ${3 - tiles.length} more tile${tiles.length === 2 ? "" : "s"}.` };
  }

  const set = analyzeSet(tiles);
  if (set?.valid || set?.type === "set") return set;
  const run = analyzeRun(tiles);
  if (run) return run;
  return {
    valid: false,
    type: null,
    score: 0,
    reason: "Use one number in different colours, or consecutive numbers in one colour.",
  };
}

export function isValidGroup(group: BoardGroup): boolean {
  return analyzeMeld(group.tiles).valid;
}

export function isValidBoard(groups: BoardGroup[]): boolean {
  return groups.every((group) => analyzeMeld(group.tiles).valid);
}

export function orderMeldTiles(tiles: Tile[]): Tile[] {
  const analysis = analyzeMeld(tiles);
  if (!analysis.valid) {
    const regular = regularTiles(tiles);
    const regularValues = regular
      .map((entry) => entry.value)
      .filter((value): value is number => typeof value === "number");
    if (regularValues.length > 0 && regularValues.every((value) => value === regularValues[0])) {
      return [...tiles].sort((first, second) => {
        if (first.color === "joker") return 1;
        if (second.color === "joker") return -1;
        return standardColors.indexOf(first.color) - standardColors.indexOf(second.color);
      });
    }
    // Keep unfinished drafts in readable numeric order. They may still be
    // illegal by colour, but a newly placed middle tile never gets stranded at
    // the visual end of a prospective run.
    return [...tiles].sort((first, second) => {
      if (first.color === "joker") return 1;
      if (second.color === "joker") return -1;
      return Number(first.value) - Number(second.value);
    });
  }
  if (analysis.type === "set") {
    return [...tiles].sort((first, second) => {
      if (first.color === "joker") return 1;
      if (second.color === "joker") return -1;
      return standardColors.indexOf(first.color) - standardColors.indexOf(second.color);
    });
  }
  if (analysis.type === "run") {
    const regular = regularTiles(tiles).sort((first, second) => Number(first.value) - Number(second.value));
    const jokerQueue = tiles.filter((entry) => entry.color === "joker");
    const values = regular.map((entry) => Number(entry.value));
    const start = Math.min(values[0], 13 - tiles.length + 1);
    return Array.from({ length: tiles.length }, (_, index) => {
      const value = start + index;
      return regular.find((entry) => entry.value === value) ?? jokerQueue.shift()!;
    });
  }
  return [...tiles];
}

export function addTileToGroup(groups: BoardGroup[], groupId: string, movingTile: Tile): BoardGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    return { ...group, tiles: orderMeldTiles([...group.tiles, movingTile]) };
  });
}

export function moveBoardTile(
  groups: BoardGroup[],
  tileId: string,
  fromGroupId: string,
  toGroupId: string,
  targetIndex?: number,
): BoardGroup[] {
  const movingTile = groups.flatMap((group) => group.tiles).find((entry) => entry.id === tileId);
  if (!movingTile) return groups;

  if (fromGroupId === toGroupId) {
    if (targetIndex === undefined) return groups;
    return groups.map((group) => {
      if (group.id !== fromGroupId) return group;
      const sourceIndex = group.tiles.findIndex((entry) => entry.id === tileId);
      if (sourceIndex === -1) return group;
      const reordered = group.tiles.filter((entry) => entry.id !== tileId);
      const insertionIndex = Math.max(0, Math.min(
        targetIndex > sourceIndex ? targetIndex - 1 : targetIndex,
        reordered.length,
      ));
      reordered.splice(insertionIndex, 0, movingTile);
      return { ...group, tiles: orderMeldTiles(reordered) };
    });
  }

  return groups.map((group) => {
    if (group.id === fromGroupId) return { ...group, tiles: group.tiles.filter((entry) => entry.id !== tileId) };
    if (group.id === toGroupId) {
      const nextTiles = [...group.tiles];
      const insertionIndex = targetIndex === undefined
        ? nextTiles.length
        : Math.max(0, Math.min(targetIndex, nextTiles.length));
      nextTiles.splice(insertionIndex, 0, movingTile);
      return { ...group, tiles: orderMeldTiles(nextTiles) };
    }
    return group;
  });
}

const sameIds = (first: Tile[], second: Tile[]) => {
  if (first.length !== second.length) return false;
  const secondIds = new Set(second.map((entry) => entry.id));
  return first.every((entry) => secondIds.has(entry.id));
};

export function validateTurn(start: TurnSnapshot, board: BoardGroup[], rack: Tile[]): TurnValidation {
  const startRackIds = new Set(start.rack.map((entry) => entry.id));
  const currentRackIds = new Set(rack.map((entry) => entry.id));
  const boardTiles = board.flatMap((group) => group.tiles);
  const boardIds = new Set(boardTiles.map((entry) => entry.id));
  const startBoardTiles = start.board.flatMap((group) => group.tiles);
  const playedTileIds = [...startRackIds].filter((id) => !currentRackIds.has(id));

  if (playedTileIds.some((id) => !boardIds.has(id))) {
    return { legal: false, reason: "Every tile removed from the rack must remain on the table.", playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
  }
  if (startBoardTiles.some((entry) => !boardIds.has(entry.id))) {
    return { legal: false, reason: "Tiles already on the table cannot return to a rack or pool.", playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
  }
  if (new Set(boardTiles.map((entry) => entry.id)).size !== boardTiles.length) {
    return { legal: false, reason: "A physical tile can only appear once on the table.", playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
  }

  const invalidGroup = board.find((group) => !analyzeMeld(group.tiles).valid);
  if (invalidGroup) {
    return { legal: false, reason: analyzeMeld(invalidGroup.tiles).reason, playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
  }
  if (playedTileIds.length === 0) {
    return { legal: false, reason: "Play at least one rack tile, or draw to end the turn.", playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
  }

  let openingScore = 0;
  if (!start.hasOpened) {
    for (const originalGroup of start.board) {
      if (originalGroup.tiles.length === 0) continue;
      const currentGroup = board.find((group) => group.id === originalGroup.id);
      if (!currentGroup || !sameIds(originalGroup.tiles, currentGroup.tiles)) {
        return { legal: false, reason: "Your opening meld cannot use or rearrange tiles already on the table.", playedTileIds, openingScore: 0, opensPlayer: false, winsGame: false };
      }
    }
    const playedIds = new Set(playedTileIds);
    openingScore = board
      .filter((group) => group.tiles.some((entry) => playedIds.has(entry.id)))
      .reduce((total, group) => total + analyzeMeld(group.tiles).score, 0);
    if (openingScore < 30) {
      return { legal: false, reason: `Opening melds need 30 points; this draft has ${openingScore}.`, playedTileIds, openingScore, opensPlayer: false, winsGame: false };
    }
  }

  return {
    legal: true,
    reason: rack.length === 0 ? "Rummikub — your rack is empty!" : "Every tile is in a legal meld.",
    playedTileIds,
    openingScore,
    opensPlayer: !start.hasOpened,
    winsGame: rack.length === 0,
  };
}

const tilePoints = (entry: Tile) => typeof entry.value === "number" ? entry.value : 30;

export function rackScore(rack: Tile[]): number {
  return rack.reduce((total, entry) => total + tilePoints(entry), 0);
}

export function resolveTimeout(moveCount: number, tableIsLegal: boolean): TimeoutOutcome {
  if (moveCount === 0) return "draw-one";
  return tableIsLegal ? "submit" : "penalty-three";
}

export function scoreRound(winner: PlayerName, racks: Record<PlayerName, Tile[]>): Record<PlayerName, number> {
  const players: PlayerName[] = ["You", "Maya", "Leo"];
  const penalties = Object.fromEntries(
    players.map((player) => [player, rackScore(racks[player])]),
  ) as Record<PlayerName, number>;
  const winnerScore = players
    .filter((player) => player !== winner)
    .reduce((total, player) => total + penalties[player], 0);

  return Object.fromEntries(
    players.map((player) => [player, player === winner ? winnerScore : -penalties[player]]),
  ) as Record<PlayerName, number>;
}

const cloneGroups = (groups: BoardGroup[]) => groups.map((group) => ({ ...group, tiles: [...group.tiles] }));

const findRackMelds = (rack: Tile[]): Tile[][] => {
  const melds: Tile[][] = [];

  // Any longer legal run contains a legal three- or four-tile subsection, while
  // a set can never exceed four. Searching only those sizes keeps later turns
  // quick even if an opponent has accumulated a large rack.
  const inspect = (start: number, targetSize: number, candidate: Tile[]) => {
    if (candidate.length === targetSize) {
      const analysis = analyzeMeld(candidate);
      if (!analysis.valid) return;
      melds.push([...candidate]);
      return;
    }

    const needed = targetSize - candidate.length;
    for (let index = start; index <= rack.length - needed; index += 1) {
      candidate.push(rack[index]);
      inspect(index + 1, targetSize, candidate);
      candidate.pop();
    }
  };

  inspect(0, 3, []);
  if (rack.length >= 4) inspect(0, 4, []);

  return melds.sort((first, second) => {
    const sizeDifference = second.length - first.length;
    if (sizeDifference !== 0) return sizeDifference;
    return analyzeMeld(second).score - analyzeMeld(first).score;
  });
};

const findBestRackMeld = (rack: Tile[]): Tile[] | null => findRackMelds(rack)[0] ?? null;

const findOpeningMelds = (rack: Tile[]): Tile[][] | null => {
  const melds = findRackMelds(rack);
  let best: Tile[][] | null = null;
  let bestTileCount = -1;
  let bestScore = -1;

  const inspect = (start: number, chosen: Tile[][], usedIds: Set<string>, score: number) => {
    if (score >= 30) {
      const tileCount = chosen.reduce((total, meld) => total + meld.length, 0);
      if (tileCount > bestTileCount || (tileCount === bestTileCount && score > bestScore)) {
        best = chosen.map((meld) => [...meld]);
        bestTileCount = tileCount;
        bestScore = score;
      }
      return;
    }
    if (chosen.length === 3) return;

    for (let index = start; index < melds.length; index += 1) {
      const meld = melds[index];
      if (meld.some((entry) => usedIds.has(entry.id))) continue;
      const nextIds = new Set(usedIds);
      meld.forEach((entry) => nextIds.add(entry.id));
      inspect(index + 1, [...chosen, meld], nextIds, score + analyzeMeld(meld).score);
    }
  };

  inspect(0, [], new Set(), 0);
  return best;
};

const addNewMelds = (
  board: BoardGroup[],
  melds: Tile[][],
  name: OpponentName,
  turnKey: string,
): BoardGroup[] => [
  ...cloneGroups(board).filter((group) => group.tiles.length > 0),
  ...melds.map((meld, index): BoardGroup => ({
    id: `ai-${name.toLowerCase()}-${turnKey}-${index}`,
    kind: analyzeMeld(meld).type ?? "new",
    tiles: orderMeldTiles(meld),
  })),
  { id: "new-meld", kind: "new", tiles: [] },
];

export function playOpponentTurn({
  name,
  rack,
  board,
  pool,
  turnKey,
  hasOpened,
}: {
  name: OpponentName;
  rack: Tile[];
  board: BoardGroup[];
  pool: Tile[];
  turnKey: string;
  hasOpened: boolean;
}): AITurnResult {
  let nextBoard = cloneGroups(board);
  let nextRack = [...rack];
  const playedTileIds: string[] = [];

  if (!hasOpened) {
    const openingMelds = findOpeningMelds(nextRack);
    if (openingMelds) {
      const openingIds = new Set(openingMelds.flatMap((meld) => meld.map((entry) => entry.id)));
      const openingScore = openingMelds.reduce((total, meld) => total + analyzeMeld(meld).score, 0);
      nextBoard = addNewMelds(nextBoard, openingMelds, name, turnKey);
      nextRack = nextRack.filter((entry) => !openingIds.has(entry.id));
      playedTileIds.push(...openingIds);
      return {
        action: "play",
        board: nextBoard,
        rack: nextRack,
        pool: [...pool],
        playedTileIds,
        message: `${name} opened with ${openingScore} points`,
        opensPlayer: true,
        winsGame: nextRack.length === 0,
      };
    }
  }

  // First use obvious legal extensions already available on the table. Limit a
  // turn to three extensions so play remains readable rather than instantaneous.
  while (hasOpened && playedTileIds.length < 3) {
    const candidates = nextRack
      .flatMap((entry) => nextBoard
        .filter((group) => group.tiles.length > 0)
        .map((group) => ({ entry, group, analysis: analyzeMeld([...group.tiles, entry]) })))
      .filter((candidate) => candidate.analysis.valid)
      .sort((first, second) => {
        const scoreDifference = second.analysis.score - first.analysis.score;
        if (scoreDifference !== 0) return scoreDifference;
        return tilePoints(second.entry) - tilePoints(first.entry);
      });

    const chosen = candidates[0];
    if (!chosen) break;
    nextBoard = addTileToGroup(nextBoard, chosen.group.id, chosen.entry);
    nextRack = nextRack.filter((entry) => entry.id !== chosen.entry.id);
    playedTileIds.push(chosen.entry.id);
  }

  // If there was no useful extension, create a complete meld from the rack.
  if (hasOpened && playedTileIds.length === 0) {
    const meld = findBestRackMeld(nextRack);
    if (meld) {
      nextBoard = addNewMelds(nextBoard, [meld], name, turnKey);
      const meldIds = new Set(meld.map((entry) => entry.id));
      nextRack = nextRack.filter((entry) => !meldIds.has(entry.id));
      playedTileIds.push(...meld.map((entry) => entry.id));
    }
  }

  if (playedTileIds.length > 0) {
    return {
      action: "play",
      board: nextBoard,
      rack: nextRack,
      pool: [...pool],
      playedTileIds,
      message: `${name} played ${playedTileIds.length} tile${playedTileIds.length === 1 ? "" : "s"}`,
      opensPlayer: false,
      winsGame: nextRack.length === 0,
    };
  }

  const drawnTile = pool[0];
  if (!drawnTile) {
    return {
      action: "stuck",
      board: nextBoard,
      rack: nextRack,
      pool: [],
      playedTileIds,
      message: `${name} cannot play · pool empty`,
      opensPlayer: false,
      winsGame: false,
    };
  }

  return {
    action: "draw",
    board: nextBoard,
    rack: [...nextRack, drawnTile],
    pool: pool.slice(1),
    playedTileIds,
    message: `${name} drew a tile`,
    opensPlayer: false,
    winsGame: false,
  };
}
