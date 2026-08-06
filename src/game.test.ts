import { describe, expect, it } from "vitest";
import {
  BoardGroup,
  Deal,
  TurnSnapshot,
  addTileToGroup,
  analyzeMeld,
  createDeal,
  createStandardPool,
  initialBoard,
  initialOpponentRacks,
  initialPool,
  initialRack,
  isValidBoard,
  moveBoardTile,
  orderMeldTiles,
  playOpponentTurn,
  rackScore,
  resolveTimeout,
  scoreRound,
  seededRng,
  tile,
  validateTurn,
} from "./game";

const group = (id: string, tiles: BoardGroup["tiles"]): BoardGroup => ({ id, kind: "new", tiles });
const tableBoard: BoardGroup[] = [
  group("blue-run", [tile("cobalt-4-a", 4, "cobalt"), tile("cobalt-5-a", 5, "cobalt"), tile("cobalt-6-a", 6, "cobalt")]),
  group("eights", [tile("terracotta-8-a", 8, "terracotta"), tile("graphite-8-a", 8, "graphite"), tile("marigold-8-a", 8, "marigold")]),
  group("red-run", [tile("terracotta-10-a", 10, "terracotta"), tile("terracotta-11-a", 11, "terracotta"), tile("terracotta-12-a", 12, "terracotta"), tile("terracotta-13-a", 13, "terracotta")]),
  group("threes", [tile("cobalt-3-a", 3, "cobalt"), tile("marigold-3-a", 3, "marigold"), tile("graphite-3-a", 3, "graphite")]),
  group("new-meld", []),
];

describe("classic tile set", () => {
  it("contains 106 physical tiles and deals 14 to the player", () => {
    expect(createStandardPool()).toHaveLength(106);
    expect(initialRack).toHaveLength(14);
    expect(initialPool).toHaveLength(64);
    expect(initialOpponentRacks.Maya).toHaveLength(14);
    expect(initialOpponentRacks.Leo).toHaveLength(14);

    const dealtIds = [
      ...initialRack,
      ...initialBoard.flatMap((entry) => entry.tiles),
      ...initialPool,
      ...initialOpponentRacks.Maya,
      ...initialOpponentRacks.Leo,
    ].map((entry) => entry.id);
    expect(dealtIds).toHaveLength(106);
    expect(new Set(dealtIds)).toHaveLength(106);
  });

  it("starts with a legal table", () => {
    expect(isValidBoard(initialBoard)).toBe(true);
    expect(initialBoard.flatMap((entry) => entry.tiles)).toHaveLength(0);
  });
});

describe("local opponents", () => {
  it("extends an existing meld only when the resulting table is legal", () => {
    const board = [
      group("run", [tile("b4", 4, "cobalt"), tile("b5", 5, "cobalt"), tile("b6", 6, "cobalt")]),
      group("new-meld", []),
    ];
    const result = playOpponentTurn({
      name: "Leo",
      rack: [tile("b7", 7, "cobalt"), tile("r1", 1, "terracotta")],
      board,
      pool: [tile("r2", 2, "terracotta")],
      turnKey: "7",
      hasOpened: true,
    });

    expect(result).toMatchObject({ action: "play", playedTileIds: ["b7"] });
    expect(result.board[0].tiles.map((entry) => entry.value)).toEqual([4, 5, 6, 7]);
    expect(isValidBoard(result.board)).toBe(true);
  });

  it("lays a complete rack meld into a new slot and leaves another draft slot", () => {
    const result = playOpponentTurn({
      name: "Maya",
      rack: [
        tile("r10", 10, "terracotta"),
        tile("b10", 10, "cobalt"),
        tile("y10", 10, "marigold"),
        tile("r1", 1, "terracotta"),
      ],
      board: [group("new-meld", [])],
      pool: [],
      turnKey: "8",
      hasOpened: true,
    });

    expect(result.action).toBe("play");
    expect(result.rack.map((entry) => entry.id)).toEqual(["r1"]);
    expect(result.board.at(-1)).toMatchObject({ id: "new-meld", tiles: [] });
    expect(isValidBoard(result.board)).toBe(true);
  });

  it("draws exactly one tile when no legal play exists", () => {
    const result = playOpponentTurn({
      name: "Leo",
      rack: [tile("r1", 1, "terracotta")],
      board: [group("new-meld", [])],
      pool: [tile("b2", 2, "cobalt"), tile("y3", 3, "marigold")],
      turnKey: "8",
      hasOpened: false,
    });

    expect(result).toMatchObject({ action: "draw", playedTileIds: [] });
    expect(result.rack.map((entry) => entry.id)).toEqual(["r1", "b2"]);
    expect(result.pool.map((entry) => entry.id)).toEqual(["y3"]);
  });

  it("scores rack values with a 30-point joker", () => {
    expect(rackScore([tile("r9", 9, "terracotta"), tile("joker", "★", "joker")])).toBe(39);
  });

  it("does not touch the table before making a 30-point opening", () => {
    const openingRack = [
      tile("r10", 10, "terracotta"),
      tile("b10", 10, "cobalt"),
      tile("y10", 10, "marigold"),
      tile("r1", 1, "terracotta"),
    ];
    const result = playOpponentTurn({
      name: "Maya",
      rack: openingRack,
      board: initialBoard,
      pool: [],
      turnKey: "1",
      hasOpened: false,
    });

    expect(result).toMatchObject({ action: "play", opensPlayer: true, playedTileIds: ["r10", "b10", "y10"] });
    expect(result.rack.map((entry) => entry.id)).toEqual(["r1"]);
    expect(isValidBoard(result.board)).toBe(true);
  });

  it("draws instead of opening below 30 points", () => {
    const result = playOpponentTurn({
      name: "Leo",
      rack: [tile("r5", 5, "terracotta"), tile("b5", 5, "cobalt"), tile("y5", 5, "marigold")],
      board: initialBoard,
      pool: [tile("k2", 2, "graphite")],
      turnKey: "1",
      hasOpened: false,
    });

    expect(result).toMatchObject({ action: "draw", opensPlayer: false, playedTileIds: [] });
    expect(result.board.flatMap((entry) => entry.tiles)).toHaveLength(0);
  });

  it("can combine separate rack melds to reach a 30-point opening", () => {
    const result = playOpponentTurn({
      name: "Maya",
      rack: [
        tile("r5", 5, "terracotta"), tile("b5", 5, "cobalt"), tile("y5", 5, "marigold"),
        tile("r6", 6, "terracotta"), tile("b6", 6, "cobalt"), tile("y6", 6, "marigold"),
      ],
      board: initialBoard,
      pool: [],
      turnKey: "1",
      hasOpened: false,
    });

    expect(result).toMatchObject({ action: "play", opensPlayer: true, winsGame: true });
    expect(result.playedTileIds).toHaveLength(6);
    expect(isValidBoard(result.board)).toBe(true);
  });

  it("awards the winner the other racks' penalties", () => {
    expect(scoreRound("You", {
      You: [],
      Maya: [tile("r9", 9, "terracotta")],
      Leo: [tile("joker", "★", "joker"), tile("b2", 2, "cobalt")],
    })).toEqual({ You: 41, Maya: -9, Leo: -32 });
  });
});

describe("meld rules", () => {
  it("accepts three or more sequential tiles of one colour", () => {
    expect(analyzeMeld([
      tile("4", 4, "cobalt"),
      tile("5", 5, "cobalt"),
      tile("6", 6, "cobalt"),
    ])).toMatchObject({ valid: true, type: "run", score: 15 });
  });

  it("accepts a 3- or 4-colour group with one value", () => {
    expect(analyzeMeld([
      tile("r8", 8, "terracotta"),
      tile("b8", 8, "cobalt"),
      tile("y8", 8, "marigold"),
      tile("k8", 8, "graphite"),
    ])).toMatchObject({ valid: true, type: "set", score: 32 });
  });

  it("rejects a group containing a duplicate colour", () => {
    expect(analyzeMeld([
      tile("r8a", 8, "terracotta"),
      tile("r8b", 8, "terracotta"),
      tile("b8", 8, "cobalt"),
    ])).toMatchObject({ valid: false, reason: "A group cannot repeat a colour." });
  });

  it("rejects mixed-colour and duplicate-number runs", () => {
    expect(analyzeMeld([
      tile("b4", 4, "cobalt"),
      tile("r5", 5, "terracotta"),
      tile("b6", 6, "cobalt"),
    ]).valid).toBe(false);
    expect(analyzeMeld([
      tile("b4a", 4, "cobalt"),
      tile("b4b", 4, "cobalt"),
      tile("b5", 5, "cobalt"),
    ])).toMatchObject({ valid: false, reason: "A run cannot repeat a number." });
  });

  it("never wraps 13 back to 1", () => {
    expect(analyzeMeld([
      tile("b12", 12, "cobalt"),
      tile("b13", 13, "cobalt"),
      tile("b1", 1, "cobalt"),
    ]).valid).toBe(false);
  });

  it("uses jokers to bridge or extend a legal run", () => {
    expect(analyzeMeld([
      tile("b10", 10, "cobalt"),
      tile("joker", "★", "joker"),
      tile("b12", 12, "cobalt"),
    ])).toMatchObject({ valid: true, type: "run", score: 33 });
    expect(analyzeMeld([
      tile("b12", 12, "cobalt"),
      tile("b13", 13, "cobalt"),
      tile("joker", "★", "joker"),
    ])).toMatchObject({ valid: true, score: 36 });
  });

  it("keeps incomplete drafts illegal", () => {
    expect(analyzeMeld([tile("r3", 3, "terracotta"), tile("b3", 3, "cobalt")]))
      .toMatchObject({ valid: false, reason: "A meld needs 1 more tile." });
  });

  it("keeps an unfinished run draft in numeric screen order", () => {
    expect(orderMeldTiles([
      tile("r9", 9, "terracotta"),
      tile("y11", 11, "marigold"),
      tile("r10", 10, "terracotta"),
    ]).map((entry) => entry.value)).toEqual([9, 10, 11]);
  });
});

describe("turn rules", () => {
  const openedStart: TurnSnapshot = {
    rack: initialRack,
    board: tableBoard,
    pool: initialPool,
    hasOpened: true,
  };

  it("accepts adding the blue 7 to the blue run", () => {
    const seven = initialRack.find((entry) => entry.id === "cobalt-7-a")!;
    const board = addTileToGroup(tableBoard, "blue-run", seven);
    const rack = initialRack.filter((entry) => entry.id !== seven.id);
    expect(validateTurn(openedStart, board, rack)).toMatchObject({ legal: true, playedTileIds: [seven.id] });
  });

  it("inserts a legal lower tile at the beginning of a run instead of appending it", () => {
    const nine = initialRack.find((entry) => entry.id === "terracotta-9-a")!;
    const board = addTileToGroup(tableBoard, "red-run", nine);
    expect(board.find((entry) => entry.id === "red-run")?.tiles.map((entry) => entry.value))
      .toEqual([9, 10, 11, 12, 13]);
  });

  it("blocks an incompatible rack tile and an unfinished new meld", () => {
    const nine = initialRack.find((entry) => entry.id === "terracotta-9-a")!;
    const wrongBoard = addTileToGroup(tableBoard, "blue-run", nine);
    expect(validateTurn(openedStart, wrongBoard, initialRack.filter((entry) => entry.id !== nine.id)).legal).toBe(false);

    const draftBoard = addTileToGroup(tableBoard, "new-meld", nine);
    expect(validateTurn(openedStart, draftBoard, initialRack.filter((entry) => entry.id !== nine.id)))
      .toMatchObject({ legal: false, reason: "A meld needs 2 more tiles." });
  });

  it("allows table manipulation only when every resulting meld is legal", () => {
    const seven = initialRack.find((entry) => entry.id === "cobalt-7-a")!;
    const extended = addTileToGroup(tableBoard, "blue-run", seven);
    const moved = moveBoardTile(extended, "cobalt-4-a", "blue-run", "new-meld");
    expect(validateTurn(openedStart, moved, initialRack.filter((entry) => entry.id !== seven.id)).legal).toBe(false);
  });

  it("requires at least one rack tile per non-draw turn", () => {
    expect(validateTurn(openedStart, tableBoard, initialRack))
      .toMatchObject({ legal: false, reason: "Play at least one rack tile, or draw to end the turn." });
  });

  it("resolves timeout from the current table state", () => {
    expect(resolveTimeout(0, false)).toBe("draw-one");
    expect(resolveTimeout(3, true)).toBe("submit");
    expect(resolveTimeout(2, false)).toBe("penalty-three");
  });

  it("requires a 30-point opening made only from rack tiles", () => {
    const tens = initialRack.filter((entry) => typeof entry.value === "number" && entry.value === 10).slice(0, 3);
    const openingStart: TurnSnapshot = { ...openedStart, hasOpened: false };
    const openingBoard = tableBoard.map((entry) => entry.id === "new-meld" ? { ...entry, tiles: tens } : entry);
    const openingRack = initialRack.filter((entry) => !tens.some((ten) => ten.id === entry.id));
    expect(validateTurn(openingStart, openingBoard, openingRack))
      .toMatchObject({ legal: true, openingScore: 30, opensPlayer: true });
  });

  it("rejects an opening under 30 points or one that manipulates the table", () => {
    const lowRack = [tile("r5", 5, "terracotta"), tile("b5", 5, "cobalt"), tile("y5", 5, "marigold")];
    const lowStart: TurnSnapshot = { rack: lowRack, board: tableBoard, pool: initialPool, hasOpened: false };
    const lowBoard = tableBoard.map((entry) => entry.id === "new-meld" ? { ...entry, tiles: lowRack } : entry);
    expect(validateTurn(lowStart, lowBoard, [])).toMatchObject({ legal: false, openingScore: 15 });

    const seven = initialRack.find((entry) => entry.id === "cobalt-7-a")!;
    const manipulated = addTileToGroup(tableBoard, "blue-run", seven);
    const notOpened: TurnSnapshot = { ...openedStart, hasOpened: false };
    expect(validateTurn(notOpened, manipulated, initialRack.filter((entry) => entry.id !== seven.id)))
      .toMatchObject({ legal: false, reason: "Your opening meld cannot use or rearrange tiles already on the table." });
  });
});

describe("createDeal", () => {
  it("deals 14 tiles to each of three players and 64 to the pool, conserving all 106", () => {
    const deal = createDeal(seededRng(1));
    expect(deal.rack).toHaveLength(14);
    expect(deal.opponents.Maya).toHaveLength(14);
    expect(deal.opponents.Leo).toHaveLength(14);
    expect(deal.pool).toHaveLength(64);
    const ids = [...deal.rack, ...deal.opponents.Maya, ...deal.opponents.Leo, ...deal.pool]
      .map((entry) => entry.id);
    expect(new Set(ids).size).toBe(106);
  });

  it("is deterministic per seed and different across seeds", () => {
    expect(createDeal(seededRng(7)).rack.map((entry) => entry.id))
      .toEqual(createDeal(seededRng(7)).rack.map((entry) => entry.id));
    expect(createDeal(seededRng(8)).rack.map((entry) => entry.id))
      .not.toEqual(createDeal(seededRng(7)).rack.map((entry) => entry.id));
  });
});
