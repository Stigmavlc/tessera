import { describe, expect, it } from "vitest";
import {
  BoardGroup,
  Deal,
  DropResolution,
  StalemateResult,
  Tile,
  TileColor,
  TurnSnapshot,
  addTileToGroup,
  analyzeMeld,
  createDeal,
  extendMeldAtEnd,
  initialBoard,
  isCompatibleMeldDraft,
  isValidBoard,
  moveBoardTile,
  moveBoardTiles,
  orderMeldTiles,
  playOpponentTurn,
  rackScore,
  removeBoardTiles,
  resolveTimeout,
  resolveTileDrop,
  scoreRound,
  scoreStalemate,
  seededRng,
  sortRackByGroups,
  sortRackByRuns,
  tile,
  validateTurn,
} from "./game";

const standard = (color: Exclude<TileColor, "joker">, value: number, copy: "a" | "b") =>
  tile(`${color}-${value}-${copy}`, value, color);

const fixtureRack: Tile[] = [
  standard("terracotta", 1, "a"), standard("graphite", 2, "a"), standard("marigold", 4, "b"),
  standard("cobalt", 7, "a"), standard("terracotta", 9, "a"), standard("marigold", 11, "a"),
  standard("graphite", 12, "a"), tile("joker-a", "★", "joker"), standard("cobalt", 1, "a"),
  standard("cobalt", 2, "a"), standard("terracotta", 10, "b"), standard("graphite", 10, "a"),
  standard("marigold", 10, "a"), standard("cobalt", 10, "a"),
];

const group = (id: string, tiles: BoardGroup["tiles"]): BoardGroup => ({ id, kind: "new", tiles });
const tableBoard: BoardGroup[] = [
  group("blue-run", [tile("cobalt-4-a", 4, "cobalt"), tile("cobalt-5-a", 5, "cobalt"), tile("cobalt-6-a", 6, "cobalt")]),
  group("eights", [tile("terracotta-8-a", 8, "terracotta"), tile("graphite-8-a", 8, "graphite"), tile("marigold-8-a", 8, "marigold")]),
  group("red-run", [tile("terracotta-10-a", 10, "terracotta"), tile("terracotta-11-a", 11, "terracotta"), tile("terracotta-12-a", 12, "terracotta"), tile("terracotta-13-a", 13, "terracotta")]),
  group("threes", [tile("cobalt-3-a", 3, "cobalt"), tile("marigold-3-a", 3, "marigold"), tile("graphite-3-a", 3, "graphite")]),
  group("new-meld", []),
];

describe("classic tile set", () => {
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
    rack: fixtureRack,
    board: tableBoard,
    pool: [],
    hasOpened: true,
  };

  it("accepts adding the blue 7 to the blue run", () => {
    const seven = fixtureRack.find((entry) => entry.id === "cobalt-7-a")!;
    const board = addTileToGroup(tableBoard, "blue-run", seven);
    const rack = fixtureRack.filter((entry) => entry.id !== seven.id);
    expect(validateTurn(openedStart, board, rack)).toMatchObject({ legal: true, playedTileIds: [seven.id] });
  });

  it("inserts a legal lower tile at the beginning of a run instead of appending it", () => {
    const nine = fixtureRack.find((entry) => entry.id === "terracotta-9-a")!;
    const board = addTileToGroup(tableBoard, "red-run", nine);
    expect(board.find((entry) => entry.id === "red-run")?.tiles.map((entry) => entry.value))
      .toEqual([9, 10, 11, 12, 13]);
  });

  it("blocks an incompatible rack tile and an unfinished new meld", () => {
    const nine = fixtureRack.find((entry) => entry.id === "terracotta-9-a")!;
    const wrongBoard = addTileToGroup(tableBoard, "blue-run", nine);
    expect(validateTurn(openedStart, wrongBoard, fixtureRack.filter((entry) => entry.id !== nine.id)).legal).toBe(false);

    const draftBoard = addTileToGroup(tableBoard, "new-meld", nine);
    expect(validateTurn(openedStart, draftBoard, fixtureRack.filter((entry) => entry.id !== nine.id)))
      .toMatchObject({ legal: false, reason: "A meld needs 2 more tiles." });
  });

  it("allows table manipulation only when every resulting meld is legal", () => {
    const seven = fixtureRack.find((entry) => entry.id === "cobalt-7-a")!;
    const extended = addTileToGroup(tableBoard, "blue-run", seven);
    const moved = moveBoardTile(extended, "cobalt-4-a", "blue-run", "new-meld");
    expect(validateTurn(openedStart, moved, fixtureRack.filter((entry) => entry.id !== seven.id)).legal).toBe(false);
  });

  it("requires at least one rack tile per non-draw turn", () => {
    expect(validateTurn(openedStart, tableBoard, fixtureRack))
      .toMatchObject({ legal: false, reason: "Play at least one rack tile, or draw to end the turn." });
  });

  it("resolves timeout from the current table state", () => {
    expect(resolveTimeout(0, false, false)).toBe("draw-one");
    expect(resolveTimeout(0, false, true)).toBe("pass");
    expect(resolveTimeout(3, true, false)).toBe("submit");
    expect(resolveTimeout(2, false, false)).toBe("revert-draw-one");
  });

  it("requires a 30-point opening made only from rack tiles", () => {
    const tens = fixtureRack.filter((entry) => typeof entry.value === "number" && entry.value === 10).slice(0, 3);
    const openingStart: TurnSnapshot = { ...openedStart, hasOpened: false };
    const openingBoard = tableBoard.map((entry) => entry.id === "new-meld" ? { ...entry, tiles: tens } : entry);
    const openingRack = fixtureRack.filter((entry) => !tens.some((ten) => ten.id === entry.id));
    expect(validateTurn(openingStart, openingBoard, openingRack))
      .toMatchObject({ legal: true, openingScore: 30, opensPlayer: true });
  });

  it("rejects an opening under 30 points or one that manipulates the table", () => {
    const lowRack = [tile("r5", 5, "terracotta"), tile("b5", 5, "cobalt"), tile("y5", 5, "marigold")];
    const lowStart: TurnSnapshot = { rack: lowRack, board: tableBoard, pool: [], hasOpened: false };
    const lowBoard = tableBoard.map((entry) => entry.id === "new-meld" ? { ...entry, tiles: lowRack } : entry);
    expect(validateTurn(lowStart, lowBoard, [])).toMatchObject({ legal: false, openingScore: 15 });

    const seven = fixtureRack.find((entry) => entry.id === "cobalt-7-a")!;
    const manipulated = addTileToGroup(tableBoard, "blue-run", seven);
    const notOpened: TurnSnapshot = { ...openedStart, hasOpened: false };
    expect(validateTurn(notOpened, manipulated, fixtureRack.filter((entry) => entry.id !== seven.id)))
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

describe("resolveTileDrop", () => {
  const run = (id: string, values: number[], color: Exclude<TileColor, "joker"> = "terracotta") =>
    group(id, values.map((value) => tile(`${color}-${value}`, value, color)));

  it("extends a run when the dropped tile fits", () => {
    const groups = [run("r", [4, 5, 6], "cobalt"), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("b7", 7, "cobalt")], undefined, "split-x");
    expect(result.kind).toBe("extend");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([4, 5, 6, 7]);
  });

  it("splits a run when a duplicate interior tile is dropped (rulebook example)", () => {
    const groups = [run("r", [4, 5, 6, 7, 8]), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("r6b", 6, "terracotta")], undefined, "split-x");
    expect(result.kind).toBe("split");
    const ids = result.groups.map((entry) => entry.id);
    expect(ids.indexOf("split-x")).toBe(ids.indexOf("r") + 1);
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([4, 5, 6]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.value))
      .toEqual([6, 7, 8]);
    expect(isValidBoard(result.groups)).toBe(true);
  });

  it("splits even when a half stays an incomplete draft (finish it before End Turn)", () => {
    const groups = [run("r", [8, 9, 10, 11]), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("r10b", 10, "terracotta")], undefined, "split-x");
    expect(result.kind).toBe("split");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([8, 9, 10]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.value))
      .toEqual([10, 11]);
    expect(analyzeMeld(result.groups.find((entry) => entry.id === "split-x")!.tiles).valid).toBe(false);
  });

  it("splits short runs into two incomplete drafts rather than clumping", () => {
    const groups = [run("r", [4, 5, 6]), group("new-meld", [])];
    const result = resolveTileDrop(groups, "r", [tile("r5b", 5, "terracotta")], undefined, "split-x");
    expect(result.kind).toBe("split");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.value))
      .toEqual([4, 5]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.value))
      .toEqual([5, 6]);
  });

  it("split halves inherit draft-ness: unsealed parents stay kind new, sealed runs stay run", () => {
    const draftTiles = [8, 9, 10, 11].map((value) => tile(`terracotta-${value}`, value, "terracotta"));
    const fromDraft = resolveTileDrop(
      [{ id: "d", kind: "new", tiles: draftTiles }, group("new-meld", [])],
      "d", [tile("r10b", 10, "terracotta")], undefined, "split-x",
    );
    expect(fromDraft.groups.find((entry) => entry.id === "split-x")?.kind).toBe("new");

    const fromSealed = resolveTileDrop(
      [{ id: "s", kind: "run", tiles: draftTiles }, group("new-meld", [])],
      "s", [tile("r10c", 10, "terracotta")], undefined, "split-y",
    );
    expect(fromSealed.groups.find((entry) => entry.id === "split-y")?.kind).toBe("run");
  });

  it("splits around a joker, which keeps its represented value in the left half", () => {
    const groups = [
      group("r", [tile("b9", 9, "cobalt"), tile("b10", 10, "cobalt"), tile("joker-a", "★", "joker"),
        tile("b12", 12, "cobalt"), tile("b13", 13, "cobalt")]),
      group("new-meld", []),
    ];
    const result = resolveTileDrop(groups, "r", [tile("b11", 11, "cobalt")], undefined, "split-x");
    expect(result.kind).toBe("split");
    expect(result.groups.find((entry) => entry.id === "r")?.tiles.map((entry) => entry.id))
      .toEqual(["b9", "b10", "joker-a"]);
    expect(result.groups.find((entry) => entry.id === "split-x")?.tiles.map((entry) => entry.id))
      .toEqual(["b11", "b12", "b13"]);
  });

  it("never splits sets and never splits at run edges", () => {
    const eights = group("s", [tile("r8", 8, "terracotta"), tile("k8", 8, "graphite"), tile("y8", 8, "marigold")]);
    expect(resolveTileDrop([eights, group("new-meld", [])], "s",
      [tile("r8b", 8, "terracotta")], undefined, "split-x").kind).toBe("draft");
    const edge = [run("r", [10, 11, 12, 13]), group("new-meld", [])];
    expect(resolveTileDrop(edge, "r", [tile("r13b", 13, "terracotta")], undefined, "split-x").kind).toBe("draft");
  });

  it("handles batches as extend-or-draft, never split", () => {
    const groups = [run("r", [4, 5, 6, 7, 8]), group("new-meld", [])];
    const batch = [tile("r6b", 6, "terracotta"), tile("r9b", 9, "terracotta")];
    expect(resolveTileDrop(groups, "r", batch, undefined, "split-x").kind).toBe("draft");
  });
});

describe("moveBoardTiles", () => {
  const board = () => [
    group("a", [tile("b4", 4, "cobalt"), tile("b5", 5, "cobalt"), tile("b6", 6, "cobalt"),
      tile("b7", 7, "cobalt"), tile("b8", 8, "cobalt")]),
    group("b", [tile("r6", 6, "terracotta")]),
    group("new-meld", []),
  ];

  it("moves a tail of tiles between groups and keeps meld ordering", () => {
    const result = moveBoardTiles(board(), ["b7", "b8"], "a", "b");
    expect(result.find((entry) => entry.id === "a")?.tiles.map((entry) => entry.id)).toEqual(["b4", "b5", "b6"]);
    expect(result.find((entry) => entry.id === "b")?.tiles.map((entry) => entry.value)).toEqual([6, 7, 8]);
  });

  it("can empty the source group (caller filters it out)", () => {
    const result = moveBoardTiles(board(), ["r6"], "b", "a");
    expect(result.find((entry) => entry.id === "b")?.tiles).toHaveLength(0);
  });

  it("delegates single-tile same-group reorder and ignores same-group batches", () => {
    expect(moveBoardTiles(board(), ["b7", "b8"], "a", "a", 0)).toEqual(board());
    const reordered = moveBoardTiles(board(), ["b7"], "a", "a", 0);
    expect(reordered.find((entry) => entry.id === "a")?.tiles.map((entry) => entry.value)).toEqual([4, 5, 6, 7, 8]);
  });
});

describe("rack sorting", () => {
  const rack = [
    tile("y5", 5, "marigold"), tile("joker-a", "★", "joker"), tile("r3", 3, "terracotta"),
    tile("b5", 5, "cobalt"), tile("r5", 5, "terracotta"), tile("b2", 2, "cobalt"),
  ];

  it("777 clusters same numbers across colors, jokers last", () => {
    expect(sortRackByGroups(rack).map((entry) => entry.id))
      .toEqual(["b2", "r3", "r5", "b5", "y5", "joker-a"]);
  });

  it("789 clusters colors into ascending runs, jokers last", () => {
    expect(sortRackByRuns(rack).map((entry) => entry.id))
      .toEqual(["r3", "r5", "b2", "b5", "y5", "joker-a"]);
  });

  it("does not mutate the input", () => {
    const before = rack.map((entry) => entry.id);
    sortRackByGroups(rack);
    expect(rack.map((entry) => entry.id)).toEqual(before);
  });
});

describe("scoreStalemate", () => {
  it("awards the lowest rack the differential total", () => {
    const result = scoreStalemate({
      You: [tile("r5", 5, "terracotta")],
      Leo: [tile("b3", 3, "cobalt")],
      Maya: [tile("y3", 3, "marigold"), tile("y4", 4, "marigold")],
    });
    expect(result.winner).toBe("Leo");
    expect(result.scores).toEqual({ You: -2, Leo: 6, Maya: -4 });
    expect(Object.values(result.scores).reduce((total, value) => total + value, 0)).toBe(0);
  });

  it("breaks total ties by fewer tiles, then turn order", () => {
    expect(scoreStalemate({
      You: [tile("r2", 2, "terracotta"), tile("r3", 3, "terracotta")],
      Leo: [tile("b5", 5, "cobalt")],
      Maya: [tile("y9", 9, "marigold")],
    }).winner).toBe("Leo");
    expect(scoreStalemate({
      You: [tile("r5", 5, "terracotta")],
      Leo: [tile("b5", 5, "cobalt")],
      Maya: [tile("y9", 9, "marigold")],
    }).winner).toBe("You");
  });
});


describe("approaching a meld from either end", () => {
  const blue = group("blue", [5, 6, 7, 8].map((n) => tile(`b${n}`, n, "cobalt")));
  it("builds an opening trio one tile at a time without treating a pair as legal", () => {
    const first = group("tens", [tile("b10", 10, "cobalt")]);
    const pair = extendMeldAtEnd(first, [tile("k10", 10, "graphite")], "right")!;
    expect(pair.map((t) => t.id)).toEqual(["b10", "k10"]);
    expect(analyzeMeld(pair).valid).toBe(false);
    const trio = extendMeldAtEnd(group("tens", pair), [tile("y10", 10, "marigold")], "right")!;
    expect(analyzeMeld(trio)).toMatchObject({ valid: true, score: 30 });
  });
  it("previews compatible incomplete runs but refuses unrelated pairs", () => {
    const first = group("single", [tile("b8", 8, "cobalt")]);
    expect(extendMeldAtEnd(first, [tile("b7", 7, "cobalt")], "left")?.map((t) => t.value)).toEqual([7, 8]);
    expect(extendMeldAtEnd(first, [tile("b7", 7, "cobalt")], "right")).toBeNull();
    expect(extendMeldAtEnd(first, [tile("r7", 7, "terracotta")], "left")).toBeNull();
    expect(extendMeldAtEnd(first, [tile("b8-copy", 8, "cobalt")], "right")).toBeNull();
  });
  it("can extract just the first tile and combine it with two other sevens", () => {
    const black = group("black", [7, 8, 9, 10].map((n) => tile(`k${n}`, n, "graphite")));
    const yellow = group("yellow", [7, 8, 9, 10].map((n) => tile(`y${n}`, n, "marigold")));
    const seven = group("sevens", [tile("b7", 7, "cobalt")]);
    const withBlack = moveBoardTiles([black, yellow, seven], ["k7"], "black", "sevens");
    const complete = moveBoardTiles(withBlack, ["y7"], "yellow", "sevens");
    expect(complete[0].tiles.map((t) => t.value)).toEqual([8, 9, 10]);
    expect(complete[1].tiles.map((t) => t.value)).toEqual([8, 9, 10]);
    expect(complete[2].tiles.map((t) => t.value)).toEqual([7, 7, 7]);
    expect(isValidBoard(complete)).toBe(true);
  });
  it("places blue 4 before 5–6–7–8 and blue 9 after it", () => {
    expect(extendMeldAtEnd(blue, [tile("b4", 4, "cobalt")], "left")?.map((t) => t.value)).toEqual([4, 5, 6, 7, 8]);
    expect(extendMeldAtEnd(blue, [tile("b9", 9, "cobalt")], "right")?.map((t) => t.value)).toEqual([5, 6, 7, 8, 9]);
    expect(extendMeldAtEnd(blue, [tile("b4", 4, "cobalt")], "right")).toBeNull();
  });
  it("allows a batch at the left and rejects wrong colours, gaps, and self-drops", () => {
    expect(extendMeldAtEnd(blue, [tile("b4", 4, "cobalt"), tile("b3", 3, "cobalt")], "left")?.map((t) => t.value)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(extendMeldAtEnd(blue, [tile("r4", 4, "terracotta")], "left")).toBeNull();
    expect(extendMeldAtEnd(blue, [tile("b2", 2, "cobalt")], "left")).toBeNull();
    expect(extendMeldAtEnd(blue, [blue.tiles[0]], "left")).toBeNull();
  });
  it("lets a joker fill either end without moving the existing joker", () => {
    const joker = tile("j", "★", "joker");
    expect(extendMeldAtEnd(blue, [joker], "left")?.[0].id).toBe("j");
    expect(extendMeldAtEnd(blue, [joker], "right")?.at(-1)?.id).toBe("j");
    const withJoker = group("g", [tile("b5", 5, "cobalt"), joker, tile("b7", 7, "cobalt")]);
    expect(extendMeldAtEnd(withJoker, [tile("b4", 4, "cobalt")], "left")?.map((t) => t.id)).toEqual(["b4", "b5", "j", "b7"]);
  });
  it("preserves the chosen side for equal-number sets", () => {
    const set = group("s", [tile("r7", 7, "terracotta"), tile("y7", 7, "marigold"), tile("k7", 7, "graphite")]);
    expect(extendMeldAtEnd(set, [tile("b7", 7, "cobalt")], "left")?.[0].id).toBe("b7");
    expect(extendMeldAtEnd(set, [tile("b7", 7, "cobalt")], "right")?.at(-1)?.id).toBe("b7");
  });
});

describe("joining compatible drafts", () => {
  it("rejects duplicate same-colour tiles and missing run numbers immediately", () => {
    expect(isCompatibleMeldDraft([tile("a", 4, "graphite"), tile("b", 4, "graphite")])).toBe(false);
    expect(isCompatibleMeldDraft([tile("a", 1, "cobalt"), tile("b", 3, "cobalt")])).toBe(false);
    expect(isCompatibleMeldDraft([tile("a", 1, "cobalt"), tile("b", 2, "cobalt"), tile("c", 4, "cobalt")])).toBe(false);
    expect(isCompatibleMeldDraft([tile("a", 1, "cobalt"), tile("b", 2, "graphite")])).toBe(false);
  });
  it("allows adjacent pairs, different-colour sets, and repairing a gap with a joker", () => {
    expect(isCompatibleMeldDraft([tile("a", 4, "graphite"), tile("b", 4, "cobalt")])).toBe(true);
    expect(isCompatibleMeldDraft([tile("a", 2, "cobalt"), tile("b", 1, "cobalt")])).toBe(true);
    expect(isCompatibleMeldDraft([tile("a", 1, "cobalt"), tile("j", "★", "joker"), tile("b", 3, "cobalt")])).toBe(true);
    const one = tile("a", 4, "graphite");
    expect(isCompatibleMeldDraft([one, one])).toBe(false);
  });
});

describe("lifting tiles out of runs", () => {
  const run = group("run", [1, 2, 3, 4, 5, 6, 7].map((n) => tile(`b${n}`, n, "cobalt")));
  it("separates both remaining runs when the middle tile moves to another meld", () => {
    const target = group("fours", [tile("r4", 4, "terracotta"), tile("y4", 4, "marigold")]);
    const before = [run, target, ...initialBoard];
    for (const move of [moveBoardTile(before, "b4", "run", "fours"), moveBoardTiles(before, ["b4"], "run", "fours")]) {
      expect(move.filter((g) => g.tiles.length).map((g) => g.tiles.map((t) => t.value)))
        .toEqual([[1, 2, 3], [5, 6, 7], [4, 4, 4]]);
      expect(isValidBoard(move)).toBe(true);
      expect(move.flatMap((g) => g.tiles.map((t) => t.id)).sort()).toEqual(before.flatMap((g) => g.tiles.map((t) => t.id)).sort());
      expect(move.at(-1)?.id).toBe("new-meld");
    }
    expect(run.tiles).toHaveLength(7);
  });
  it("keeps short halves separate and requires repair before committing", () => {
    const result = removeBoardTiles([run], ["b3", "b4"], "run");
    expect(result.map((g) => g.tiles.map((t) => t.value))).toEqual([[1, 2], [5, 6, 7]]);
    expect(isValidBoard(result)).toBe(false);
  });
  it("splits at the removed joker instead of closing the missing number", () => {
    const withJoker = group("j", [tile("b1", 1, "cobalt"), tile("b2", 2, "cobalt"), tile("j", "★", "joker"), tile("b4", 4, "cobalt"), tile("b5", 5, "cobalt")]);
    expect(removeBoardTiles([withJoker], ["j"], "j").map((g) => g.tiles.map((t) => t.value))).toEqual([[1, 2], [4, 5]]);
  });
  it("does not split a set or an end extraction, and leaves unrelated groups intact", () => {
    const set = group("set", [tile("r4", 4, "terracotta"), tile("y4", 4, "marigold"), tile("k4", 4, "graphite")]);
    const after = removeBoardTiles([run, set], ["y4"], "set");
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(run);
    expect(after[1].tiles.map((t) => t.id)).toEqual(["r4", "k4"]);
    expect(removeBoardTiles([run], ["b1"], "run")).toHaveLength(1);
    expect(removeBoardTiles([run], ["b7"], "run")).toHaveLength(1);
  });
  it("gives repeated splits distinct group identities", () => {
    const occupied = group("run-part-b5", [tile("k1", 1, "graphite")]);
    const result = removeBoardTiles([run, occupied, ...initialBoard], ["b4"], "run");
    expect(new Set(result.map((g) => g.id)).size).toBe(result.length);
    expect(result[1].tiles[0].id).toBe("b5");
    expect(result.at(-1)?.id).toBe("new-meld");
  });
});
