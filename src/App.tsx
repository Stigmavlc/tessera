import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  type CollisionDetection,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import {
  BoardGroup,
  OpponentName,
  OpponentRacks,
  Tile,
  TurnSnapshot,
  analyzeMeld,
  initialBoard,
  initialOpponentRacks,
  initialPool,
  initialRack,
  moveBoardTile,
  orderMeldTiles,
  playOpponentTurn,
  resolveTimeout,
  scoreRound,
  validateTurn,
} from "./game";

type Screen = "home" | "game";
type TurnState = "you" | "opponent";
type Winner = "You" | OpponentName;
type TablePoint = { x: number; y: number };
type TablePositions = Record<string, TablePoint>;
type BoardCamera = { x: number; y: number; zoom: number };

type ActionSnapshot = {
  rack: Tile[];
  board: BoardGroup[];
  moveCount: number;
  positions: TablePositions;
};

const cloneBoard = (groups: BoardGroup[]) => groups.map((group) => ({ ...group, tiles: [...group.tiles] }));
const cloneTurnSnapshot = (snapshot: TurnSnapshot): TurnSnapshot => ({
  rack: [...snapshot.rack],
  board: cloneBoard(snapshot.board),
  pool: [...snapshot.pool],
  hasOpened: snapshot.hasOpened,
});
const cloneOpponentRacks = (racks: OpponentRacks): OpponentRacks => ({
  Maya: [...racks.Maya],
  Leo: [...racks.Leo],
});
const clonePositions = (positions: TablePositions): TablePositions => Object.fromEntries(
  Object.entries(positions).map(([id, point]) => [id, { ...point }]),
);

const defaultCamera: BoardCamera = { x: 0, y: 6, zoom: 0.58 };
const tableSlots: TablePoint[] = [
  { x: 18, y: 12 }, { x: 50, y: 12 }, { x: 82, y: 12 },
  { x: 18, y: 30 }, { x: 50, y: 30 }, { x: 82, y: 30 },
  { x: 18, y: 48 }, { x: 50, y: 48 }, { x: 82, y: 48 },
  { x: 18, y: 66 }, { x: 50, y: 66 }, { x: 82, y: 66 },
  { x: 18, y: 84 }, { x: 50, y: 84 }, { x: 82, y: 84 },
];

const groupFootprint = (tileCount: number) => ({
  width: tileCount >= 11 ? tileCount * 4.2 : tileCount >= 8 ? tileCount * 5 : Math.max(18, tileCount * 7.1),
  height: 15,
});

const positionsOverlap = (
  first: TablePoint,
  firstSize: ReturnType<typeof groupFootprint>,
  second: TablePoint,
  secondSize: ReturnType<typeof groupFootprint>,
) => Math.abs(first.x - second.x) < (firstSize.width + secondSize.width) / 2 + 2
  && Math.abs(first.y - second.y) < (firstSize.height + secondSize.height) / 2 + 2;

const findOpenTablePoint = (
  desired: TablePoint,
  tileCount: number,
  placed: Array<{ point: TablePoint; tileCount: number }>,
): TablePoint => {
  const size = groupFootprint(tileCount);
  const clampPoint = (point: TablePoint): TablePoint => ({
    x: Math.max(size.width / 2 + 2, Math.min(98 - size.width / 2, point.x)),
    y: Math.max(9, Math.min(91, point.y)),
  });
  const candidates = [clampPoint(desired), ...tableSlots.map(clampPoint)];
  return candidates.find((candidate) => placed.every((entry) => !positionsOverlap(
    candidate,
    size,
    entry.point,
    groupFootprint(entry.tileCount),
  ))) ?? clampPoint(desired);
};

const positionTableGroups = (groups: BoardGroup[], current: TablePositions): TablePositions => {
  const occupied = groups.filter((group) => group.tiles.length > 0);
  const positioned: TablePositions = {};
  const placed: Array<{ point: TablePoint; tileCount: number }> = [];
  occupied.forEach((group, index) => {
    const desired = current[group.id] ?? tableSlots[index % tableSlots.length];
    const point = findOpenTablePoint(desired, group.tiles.length, placed);
    positioned[group.id] = point;
    placed.push({ point, tileCount: group.tiles.length });
  });
  return positioned;
};

const tabletopCollision: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (collisions.length === 0) return closestCenter(args);
  const priority = (id: string | number) => {
    const value = String(id);
    if (value.startsWith("board-target:")) return 0;
    if (value.startsWith("group:")) return 1;
    if (value !== "rack-drop" && value !== "board-drop") return 2;
    if (value === "rack-drop") return 3;
    return 4;
  };
  return [...collisions].sort((first, second) => priority(first.id) - priority(second.id));
};

const sealDraftSlot = (groups: BoardGroup[], id: string): BoardGroup[] => {
  const occupied = groups
    .filter((group) => group.tiles.length > 0)
    .map((group): BoardGroup => {
      const analysis = analyzeMeld(group.tiles);
      return {
        ...group,
        id: group.id === "new-meld" ? id : group.id,
        kind: group.kind === "new" ? (analysis.type ?? "new") : group.kind,
        tiles: [...group.tiles],
      };
    });
  return [...occupied, { id: "new-meld", kind: "new", tiles: [] }];
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Tessera">
      <div className="brand-mark" aria-hidden="true">
        <span className="brand-mark__cell brand-mark__cell--terra">●</span>
        <span className="brand-mark__cell brand-mark__cell--olive">◆</span>
        <span className="brand-mark__cell brand-mark__cell--blue">✦</span>
        <span className="brand-mark__cell brand-mark__cell--yellow">✤</span>
      </div>
      {!compact && <span className="brand-name">Tessera</span>}
    </div>
  );
}

function BotanicalCorner({ side = "left" }: { side?: "left" | "right" }) {
  return (
    <svg className={`botanical botanical--${side}`} viewBox="0 0 150 190" aria-hidden="true">
      <path d="M20 186C34 135 52 94 99 22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="37" cy="146" rx="12" ry="27" transform="rotate(-48 37 146)" />
      <ellipse cx="51" cy="118" rx="12" ry="28" transform="rotate(-43 51 118)" />
      <ellipse cx="67" cy="91" rx="11" ry="27" transform="rotate(-39 67 91)" />
      <ellipse cx="84" cy="63" rx="10" ry="25" transform="rotate(-35 84 63)" />
      <ellipse cx="55" cy="155" rx="12" ry="27" transform="rotate(43 55 155)" />
      <ellipse cx="71" cy="127" rx="12" ry="28" transform="rotate(40 71 127)" />
      <ellipse cx="87" cy="98" rx="11" ry="26" transform="rotate(37 87 98)" />
      <ellipse cx="102" cy="69" rx="10" ry="24" transform="rotate(31 102 69)" />
    </svg>
  );
}

function Avatar({ initials, tone, active = false }: { initials: string; tone: "terra" | "blue" | "olive"; active?: boolean }) {
  return (
    <span className={`avatar avatar--${tone} ${active ? "avatar--active" : ""}`} aria-hidden="true">
      <span className="avatar__sun" />
      <span className="avatar__initials">{initials}</span>
    </span>
  );
}

function TileFace({
  tile,
  decorative = false,
  selected = false,
  floating = false,
}: {
  tile: Tile;
  decorative?: boolean;
  selected?: boolean;
  floating?: boolean;
}) {
  return (
    <div
      className={`tile tile--${tile.color} ${decorative ? "tile--decorative" : ""} ${selected ? "tile--selected" : ""} ${floating ? "tile--floating" : ""}`}
    >
      <span className="tile__number">{tile.value}</span>
      <span className={`tile__pip tile__pip--${tile.color}`} aria-hidden="true" />
    </div>
  );
}

function SortableTile({ tile, selected, onSelect }: { tile: Tile; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
    data: { type: "rack-tile", tile },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <motion.button
      ref={setNodeRef}
      style={style}
      type="button"
      className={`rack-tile ${isDragging ? "rack-tile--dragging" : ""}`}
      onClick={onSelect}
      aria-label={`${tile.color} ${tile.value} tile${selected ? ", selected" : ""}`}
      whileTap={{ scale: 0.94 }}
      {...attributes}
      {...listeners}
    >
      <TileFace tile={tile} selected={selected} />
    </motion.button>
  );
}

function DraggableBoardTile({
  tile,
  groupId,
  returnable,
  onReturn,
}: {
  tile: Tile;
  groupId: string;
  returnable: boolean;
  onReturn: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: tile.id,
    data: { type: "board-tile", tile, groupId },
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `board-target:${tile.id}`,
    data: { type: "board-tile-target", tileId: tile.id, groupId },
  });
  const setNodeRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };
  return (
    <div className="board-tile-wrap">
      <motion.div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform) }}
        className={`board-tile ${isDragging ? "board-tile--dragging" : ""} ${isOver ? "board-tile--over" : ""}`}
        aria-label={`${tile.color} ${tile.value} table tile`}
        {...attributes}
        {...listeners}
      >
        <TileFace tile={tile} />
      </motion.div>
      {returnable && (
        <button
          className="draft-tile-remove"
          type="button"
          aria-label={`Return ${tile.color} ${tile.value} to your rack`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onReturn();
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      )}
    </div>
  );
}

function DroppableGroup({
  group,
  activeTile,
  selectedTiles,
  onTap,
  returnableTileIds,
  onReturnTile,
}: {
  group: BoardGroup;
  activeTile: Tile | null;
  selectedTiles: Tile[];
  onTap: (groupId: string) => void;
  returnableTileIds: Set<string>;
  onReturnTile: (tileId: string, groupId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `group:${group.id}`,
    data: { type: "board-group", groupId: group.id },
  });

  const canReceive = activeTile !== null || selectedTiles.length > 0;
  const meldAnalysis = analyzeMeld(group.tiles);
  const isDraftInvalid = group.tiles.length > 0 && !meldAnalysis.valid;
  const isFourTileSet = meldAnalysis.valid && meldAnalysis.type === "set" && group.tiles.length === 4;
  const groupLabel = `${group.kind === "run" ? "Run" : "Group"} meld`;
  const lengthClass = group.tiles.length >= 11
    ? "meld--very-long"
    : group.tiles.length >= 8
      ? "meld--long"
      : "";

  return (
    <div
      ref={setNodeRef}
      className={`meld meld--${group.id} meld--kind-${group.kind} meld--table-added ${isFourTileSet ? "meld--four-set" : ""} ${lengthClass} ${isOver ? "meld--over" : ""} ${canReceive ? "meld--receivable" : ""} ${isDraftInvalid ? "meld--invalid" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onTap(group.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (canReceive && (event.key === "Enter" || event.key === " ")) onTap(group.id);
      }}
      aria-label={group.tiles.length ? `${groupLabel}, ${group.tiles.length} tiles` : groupLabel}
    >
      <AnimatePresence initial={false}>
        {group.tiles.map((entry) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 24, scale: 0.7, rotate: -8 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 20, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 440, damping: 27 }}
          >
            <DraggableBoardTile
              tile={entry}
              groupId={group.id}
              returnable={returnableTileIds.has(entry.id)}
              onReturn={() => onReturnTile(entry.id, group.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {group.tiles.length === 0 && (
        <span className={`new-meld ${canReceive ? "new-meld--ready" : ""}`}>
          <span className="new-meld__plus">＋</span>
          New meld
        </span>
      )}
    </div>
  );
}

function HomeScreen({ onPlay }: { onPlay: () => void }) {
  const heroTiles = useMemo(
    () => [
      { id: "hero-4", value: 4, color: "terracotta" as const },
      { id: "hero-5", value: 5, color: "terracotta" as const },
      { id: "hero-6", value: 6, color: "olive" as const },
      { id: "hero-7", value: 7, color: "cobalt" as const },
      { id: "hero-8", value: 8, color: "cobalt" as const },
      { id: "hero-9", value: 9, color: "marigold" as const },
    ].map((entry) => ({ ...entry, color: entry.color === "olive" ? "graphite" as const : entry.color })),
    [],
  );

  return (
    <motion.main
      className="screen home-screen"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: -28 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <section className="home-hero">
        <BotanicalCorner />
        <div className="linen-corner" aria-hidden="true">
          <span />
        </div>
        <BrandMark />
        <div className="terra-field" aria-hidden="true">
          <div className="hero-tile-run">
            {heroTiles.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: -48, rotate: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.09 * index + 0.18, type: "spring", stiffness: 250, damping: 18 }}
                className={`hero-tile hero-tile--${index + 1}`}
              >
                <TileFace tile={entry} decorative />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-copy">
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.44 }}>
          Make your move.
        </motion.h1>
        <p>Shape runs. Break patterns. Own the table.</p>
        <motion.button className="primary-button" type="button" onClick={onPlay} whileHover={{ y: -2 }} whileTap={{ scale: 0.975 }}>
          <span>Play now</span>
          <span className="button-arrow" aria-hidden="true">↗</span>
        </motion.button>
      </section>

      <section className="active-game" aria-label="Players at this table">
        <div className="active-game__topline">
          <span><PeopleIcon /> Game night · Offline table</span>
          <span className="active-game__meta">3 players</span>
        </div>
        <div className="home-players">
          <div className="home-player"><Avatar initials="M" tone="terra" /><span>Maya</span></div>
          <span className="player-divider" aria-hidden="true">◆</span>
          <div className="home-player"><Avatar initials="L" tone="blue" /><span>Leo</span></div>
          <span className="player-divider" aria-hidden="true">◆</span>
          <div className="home-player home-player--you"><Avatar initials="Y" tone="olive" active /><span>You</span></div>
        </div>
      </section>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className="bottom-nav__item bottom-nav__item--active" type="button"><HomeIcon /><span>Home</span></button>
        <button className="bottom-nav__item bottom-nav__item--play" type="button" onClick={onPlay}><PlayIcon /><span>Play</span></button>
        <button className="bottom-nav__item" type="button"><ProfileIcon /><span>Profile</span></button>
      </nav>
    </motion.main>
  );
}

function GameScreen({ onBack }: { onBack: () => void }) {
  const [rack, setRack] = useState<Tile[]>(initialRack);
  const [board, setBoard] = useState<BoardGroup[]>(cloneBoard(initialBoard));
  const [pool, setPool] = useState<Tile[]>(initialPool);
  const [opponentRacks, setOpponentRacks] = useState<OpponentRacks>(() => cloneOpponentRacks(initialOpponentRacks));
  const [opponentOpened, setOpponentOpened] = useState<Record<OpponentName, boolean>>({ Maya: false, Leo: false });
  const [hasOpened, setHasOpened] = useState(false);
  const [turnStart, setTurnStart] = useState<TurnSnapshot>(() => ({
    rack: [...initialRack],
    board: cloneBoard(initialBoard),
    pool: [...initialPool],
    hasOpened: false,
  }));
  const [activeTile, setActiveTile] = useState<Tile | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<ActionSnapshot[]>([]);
  const [moveCount, setMoveCount] = useState(0);
  const [groupPositions, setGroupPositions] = useState<TablePositions>({});
  const [turnStartPositions, setTurnStartPositions] = useState<TablePositions>({});
  const [boardCamera, setBoardCamera] = useState<BoardCamera>(defaultCamera);
  const [timer, setTimer] = useState(60);
  const [turnState, setTurnState] = useState<TurnState>("you");
  const [activeOpponent, setActiveOpponent] = useState<OpponentName>("Leo");
  const [turnNumber, setTurnNumber] = useState(1);
  const [winner, setWinner] = useState<Winner | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [celebrating, setCelebrating] = useState(false);

  const selectedTiles = rack.filter((entry) => selectedIds.includes(entry.id));
  const turnValidation = useMemo(
    () => validateTurn(turnStart, board, rack),
    [turnStart, board, rack],
  );
  const boardHasIllegalDraft = board.some((group) => !analyzeMeld(group.tiles).valid);
  const boardIsEmpty = board.every((group) => group.tiles.length === 0);
  const visibleBoard = board.filter((group) => group.tiles.length > 0);
  const layoutPositions = useMemo(
    () => positionTableGroups(board, groupPositions),
    [board, groupPositions],
  );
  const rackColumns = Math.max(7, Math.ceil(rack.length / 2));
  const returnableTileIds = useMemo(
    () => new Set(turnStart.rack.map((entry) => entry.id)),
    [turnStart.rack],
  );
  const finalScores = useMemo(() => {
    if (!winner) return null;
    const racks: Record<Winner, Tile[]> = {
      You: rack,
      Maya: opponentRacks.Maya,
      Leo: opponentRacks.Leo,
    };
    const scores = scoreRound(winner, racks);
    const players: Winner[] = ["You", "Maya", "Leo"];
    return players.map((player) => ({
      player,
      tiles: racks[player].length,
      score: scores[player],
    }));
  }, [winner, rack, opponentRacks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 130, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (turnState !== "you" || settingsOpen || winner) return;
    const interval = window.setInterval(() => {
      setTimer((value) => {
        if (value <= 1) return 0;
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [turnState, settingsOpen, winner]);

  useEffect(() => {
    if (timer !== 0 || turnState !== "you" || settingsOpen || winner) return;

    const timeoutOutcome = resolveTimeout(moveCount, turnValidation.legal);
    if (timeoutOutcome === "submit") {
      const opened = hasOpened || turnValidation.opensPlayer;
      const committedBoard = sealDraftSlot(board, `you-${turnNumber}`);
      setHasOpened(opened);
      setBoard(committedBoard);
      setHistory([]);
      setMoveCount(0);
      setSelectedIds([]);
      if (turnValidation.winsGame) {
        setToast("Time’s up · legal winning table submitted");
        setWinner("You");
      } else {
        setToast("Time’s up · legal table submitted");
        setActiveOpponent("Leo");
        setTurnState("opponent");
      }
      return;
    }

    const penaltySize = timeoutOutcome === "penalty-three" ? 3 : 1;
    const base = cloneTurnSnapshot(turnStart);
    const penaltyTiles = base.pool.slice(0, penaltySize);
    const committed: TurnSnapshot = {
      ...base,
      rack: [...base.rack, ...penaltyTiles],
      pool: base.pool.slice(penaltyTiles.length),
    };
    setRack(committed.rack);
    setBoard(cloneBoard(committed.board));
    setGroupPositions(clonePositions(turnStartPositions));
    setPool(committed.pool);
    setHasOpened(committed.hasOpened);
    setHistory([]);
    setMoveCount(0);
    setSelectedIds([]);
    setToast(timeoutOutcome === "penalty-three" ? "Incomplete table restored · 3-tile penalty" : "Time’s up · drew one tile");
    setActiveOpponent("Leo");
    setTurnState("opponent");
  }, [timer, turnState, settingsOpen, winner, moveCount, turnValidation, hasOpened, board, turnNumber, turnStart, turnStartPositions]);

  useEffect(() => {
    if (turnState !== "opponent" || winner) return;
    const actingOpponent = activeOpponent;
    const timeout = window.setTimeout(() => {
      const result = playOpponentTurn({
        name: actingOpponent,
        rack: opponentRacks[actingOpponent],
        board,
        pool,
        turnKey: `${turnNumber}-${actingOpponent}`,
        hasOpened: opponentOpened[actingOpponent],
      });

      const nextPositions = positionTableGroups(result.board, groupPositions);
      setBoard(cloneBoard(result.board));
      setGroupPositions(nextPositions);
      setPool([...result.pool]);
      setOpponentRacks((current) => ({ ...current, [actingOpponent]: [...result.rack] }));
      if (result.opensPlayer) {
        setOpponentOpened((current) => ({ ...current, [actingOpponent]: true }));
      }
      if (result.winsGame) {
        setWinner(actingOpponent);
        return;
      }

      if (actingOpponent === "Leo") {
        setActiveOpponent("Maya");
        return;
      }

      const nextTurn: TurnSnapshot = {
        rack: [...rack],
        board: cloneBoard(result.board),
        pool: [...result.pool],
        hasOpened,
      };
      setTurnStart(nextTurn);
      setTurnStartPositions(clonePositions(nextPositions));
      setTurnNumber((value) => value + 1);
      setTurnState("you");
      setTimer(60);
      setHistory([]);
      setMoveCount(0);
      setSelectedIds([]);
    }, 1050);
    return () => window.clearTimeout(timeout);
  }, [turnState, winner, activeOpponent, opponentRacks, opponentOpened, board, pool, turnNumber, rack, hasOpened, groupPositions]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const remember = () => {
    setHistory((items) => [
      ...items,
      { rack: [...rack], board: cloneBoard(board), moveCount, positions: clonePositions(groupPositions) },
    ]);
  };

  const placeTiles = (tileIds: string[], groupId: string, targetIndex?: number) => {
    if (turnState !== "you") return;
    const movingIdSet = new Set(tileIds);
    const movingTiles = rack.filter((entry) => movingIdSet.has(entry.id));
    if (movingTiles.length === 0) return;
    const destination = board.find((group) => group.id === groupId);
    const isOwnOpeningDraft = destination?.kind === "new"
      && destination.tiles.every((entry) => returnableTileIds.has(entry.id));
    if (!hasOpened && groupId !== "new-meld" && !isOwnOpeningDraft) {
      setToast("Opening melds must use only rack tiles in a new set");
      setSelectedIds([]);
      return;
    }
    const candidateBoard = board.map((group) => {
      if (group.id !== groupId) return group;
      const nextTiles = [...group.tiles];
      const insertionIndex = targetIndex === undefined
        ? nextTiles.length
        : Math.max(0, Math.min(targetIndex, nextTiles.length));
      nextTiles.splice(insertionIndex, 0, ...movingTiles);
      return { ...group, tiles: orderMeldTiles(nextTiles) };
    });
    remember();
    setRack((items) => items.filter((entry) => !movingIdSet.has(entry.id)));
    setBoard(candidateBoard);
    setGroupPositions((current) => positionTableGroups(candidateBoard, current));
    setMoveCount((value) => value + movingTiles.length);
    setSelectedIds([]);
    if (haptics && "vibrate" in navigator) navigator.vibrate(14);
  };

  const placeTilesAsNewGroup = (tileIds: string[], position: TablePoint) => {
    if (turnState !== "you") return;
    const movingIds = new Set(tileIds);
    const movingTiles = rack.filter((entry) => movingIds.has(entry.id));
    if (movingTiles.length === 0) return;
    const groupId = `draft-${turnNumber}-${moveCount + 1}-${movingTiles[0].id}`;
    const draft: BoardGroup = { id: groupId, kind: "new", tiles: orderMeldTiles(movingTiles) };
    const nextBoard: BoardGroup[] = [
      ...board.filter((group) => group.id !== "new-meld" && group.tiles.length > 0),
      draft,
      { id: "new-meld", kind: "new", tiles: [] },
    ];
    remember();
    setRack((items) => items.filter((entry) => !movingIds.has(entry.id)));
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, { ...current, [groupId]: position }));
    setMoveCount((value) => value + movingTiles.length);
    setSelectedIds([]);
    if (haptics && "vibrate" in navigator) navigator.vibrate(14);
  };

  const rearrangeTableTile = (
    tileId: string,
    fromGroupId: string,
    toGroupId: string,
    targetIndex?: number,
  ) => {
    if (turnState !== "you" || (fromGroupId === toGroupId && targetIndex === undefined)) return;
    if (!hasOpened && !returnableTileIds.has(tileId)) {
      setToast("Table rearrangement unlocks after your 30-point opening meld");
      return;
    }
    remember();
    const nextBoard = moveBoardTile(board, tileId, fromGroupId, toGroupId, targetIndex)
      .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, current));
    setMoveCount((value) => value + 1);
  };

  const moveTableTileToNewGroup = (tileId: string, fromGroupId: string, position: TablePoint) => {
    if (turnState !== "you") return;
    if (!hasOpened && !returnableTileIds.has(tileId)) {
      setToast("Table rearrangement unlocks after your 30-point opening meld");
      return;
    }
    const source = board.find((group) => group.id === fromGroupId);
    const movingTile = source?.tiles.find((entry) => entry.id === tileId);
    if (!source || !movingTile) return;
    remember();

    if (source.tiles.length === 1) {
      setGroupPositions((current) => positionTableGroups(board, { ...current, [fromGroupId]: position }));
      setMoveCount((value) => value + 1);
      return;
    }

    const groupId = `split-${turnNumber}-${moveCount + 1}-${tileId}`;
    const nextBoard: BoardGroup[] = [
      ...board
        .filter((group) => group.id !== "new-meld")
        .map((group) => group.id === fromGroupId
          ? { ...group, tiles: group.tiles.filter((entry) => entry.id !== tileId) }
          : group)
        .filter((group) => group.tiles.length > 0),
      { id: groupId, kind: "new", tiles: [movingTile] },
      { id: "new-meld", kind: "new", tiles: [] },
    ];
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, { ...current, [groupId]: position }));
    setMoveCount((value) => value + 1);
  };

  const returnTileToRack = (tileId: string, fromGroupId: string) => {
    if (turnState !== "you") return;
    if (!returnableTileIds.has(tileId)) {
      setToast("Only tiles played from your rack this turn can come back");
      return;
    }
    const returningTile = board
      .find((group) => group.id === fromGroupId)
      ?.tiles.find((entry) => entry.id === tileId);
    if (!returningTile) return;

    remember();
    const nextBoard = board
      .map((group) => group.id === fromGroupId
        ? { ...group, tiles: group.tiles.filter((entry) => entry.id !== tileId) }
        : group)
      .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, current));
    setRack((items) => {
      const order = new Map(turnStart.rack.map((entry, index) => [entry.id, index]));
      return [...items, returningTile].sort(
        (first, second) => (order.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(second.id) ?? Number.MAX_SAFE_INTEGER),
      );
    });
    setMoveCount((value) => Math.max(0, value - 1));
    setSelectedIds([]);
  };

  const getDropPosition = (active: DragEndEvent["active"]): TablePoint => {
    const boardElement = document.querySelector<HTMLElement>(".board-world");
    const tileRect = active.rect.current.translated ?? active.rect.current.initial;
    if (!boardElement || !tileRect) return { x: 50, y: 50 };
    const boardRect = boardElement.getBoundingClientRect();
    const centerX = tileRect.left + tileRect.width / 2;
    const centerY = tileRect.top + tileRect.height / 2;
    return {
      x: Math.max(8, Math.min(92, ((centerX - boardRect.left) / boardRect.width) * 100)),
      y: Math.max(10, Math.min(90, ((centerY - boardRect.top) / boardRect.height) * 100)),
    };
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const dragged = active.data.current?.tile as Tile | undefined;
    setActiveTile(dragged ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTile(null);
    if (!over || turnState !== "you") return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const sourceType = active.data.current?.type as "rack-tile" | "board-tile" | undefined;
    const fromGroupId = active.data.current?.groupId as string | undefined;
    const draggedRackIds = sourceType === "rack-tile" && selectedIds.includes(activeId)
      ? selectedIds
      : [activeId];

    if (sourceType === "board-tile" && fromGroupId && rack.some((entry) => entry.id === overId)) {
      returnTileToRack(activeId, fromGroupId);
      return;
    }

    if (overId === "rack-drop") {
      if (sourceType === "board-tile" && fromGroupId) returnTileToRack(activeId, fromGroupId);
      return;
    }

    if (overId.startsWith("board-target:")) {
      const targetTileId = overId.slice("board-target:".length);
      const targetGroup = board.find((group) => group.tiles.some((entry) => entry.id === targetTileId));
      const targetIndex = targetGroup?.tiles.findIndex((entry) => entry.id === targetTileId) ?? -1;
      if (!targetGroup || targetIndex < 0) return;
      if (sourceType === "board-tile" && fromGroupId) {
        rearrangeTableTile(activeId, fromGroupId, targetGroup.id, targetIndex);
      } else {
        placeTiles(draggedRackIds, targetGroup.id, targetIndex);
      }
      return;
    }

    if (overId.startsWith("group:")) {
      const targetGroupId = overId.slice(6);
      if (sourceType === "board-tile" && fromGroupId) rearrangeTableTile(activeId, fromGroupId, targetGroupId);
      else placeTiles(draggedRackIds, targetGroupId);
      return;
    }
    if (overId === "board-drop") {
      const position = getDropPosition(active);
      if (sourceType === "board-tile" && fromGroupId) moveTableTileToNewGroup(activeId, fromGroupId, position);
      else placeTilesAsNewGroup(draggedRackIds, position);
      return;
    }

    const oldIndex = rack.findIndex((entry) => entry.id === activeId);
    const newIndex = rack.findIndex((entry) => entry.id === overId);
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      setRack((items) => arrayMove(items, oldIndex, newIndex));
    }
  };

  const handleGroupTap = (groupId: string) => {
    if (selectedIds.length > 0) placeTiles(selectedIds, groupId);
  };

  const handleTableTap = (position: TablePoint) => {
    if (selectedIds.length > 0) placeTilesAsNewGroup(selectedIds, position);
  };

  const handleUndo = () => {
    const previous = history.at(-1);
    if (!previous) {
      setToast("Nothing to undo yet");
      return;
    }
    setRack(previous.rack);
    setBoard(cloneBoard(previous.board));
    setGroupPositions(clonePositions(previous.positions));
    setMoveCount(previous.moveCount);
    setHistory((items) => items.slice(0, -1));
    setSelectedIds([]);
  };

  const handleDraw = () => {
    if (turnState !== "you" || winner) return;
    const base = cloneTurnSnapshot(turnStart);
    const nextTile = base.pool[0];
    if (!nextTile) {
      setToast("The pool is empty — play must continue from the rack");
      return;
    }
    const committed: TurnSnapshot = {
      ...base,
      rack: [...base.rack, nextTile],
      pool: base.pool.slice(1),
    };
    setRack(committed.rack);
    setBoard(cloneBoard(committed.board));
    setGroupPositions(clonePositions(turnStartPositions));
    setPool(committed.pool);
    setHasOpened(committed.hasOpened);
    setHistory([]);
    setMoveCount(0);
    setSelectedIds([]);
    setActiveOpponent("Leo");
    window.setTimeout(() => setTurnState("opponent"), 420);
  };

  const handleEndTurn = () => {
    if (!turnValidation.legal) {
      setToast(`Turn blocked · ${turnValidation.reason}`);
      return;
    }
    setCelebrating(true);
    const opened = hasOpened || turnValidation.opensPlayer;
    const committedBoard = sealDraftSlot(board, `you-${turnNumber}`);
    const committed: TurnSnapshot = {
      rack: [...rack],
      board: committedBoard,
      pool: [...pool],
      hasOpened: opened,
    };
    setHasOpened(opened);
    setBoard(cloneBoard(committed.board));
    setGroupPositions((current) => positionTableGroups(committed.board, current));
    setHistory([]);
    setMoveCount(0);
    window.setTimeout(() => setCelebrating(false), 900);
    if (turnValidation.winsGame) {
      setWinner("You");
    } else {
      setActiveOpponent("Leo");
      window.setTimeout(() => setTurnState("opponent"), 520);
    }
  };

  const handleTurnAction = () => {
    if (turnState !== "you" || winner) return;
    if (moveCount === 0) {
      handleDraw();
      return;
    }
    handleEndTurn();
  };

  const resetGame = () => {
    setRack(initialRack);
    setBoard(cloneBoard(initialBoard));
    setPool(initialPool);
    setOpponentRacks(cloneOpponentRacks(initialOpponentRacks));
    setOpponentOpened({ Maya: false, Leo: false });
    setHasOpened(false);
    setTurnStart({ rack: [...initialRack], board: cloneBoard(initialBoard), pool: [...initialPool], hasOpened: false });
    setGroupPositions({});
    setTurnStartPositions({});
    setBoardCamera(defaultCamera);
    setHistory([]);
    setMoveCount(0);
    setTimer(60);
    setTurnState("you");
    setActiveOpponent("Leo");
    setTurnNumber(1);
    setWinner(null);
    setSelectedIds([]);
    setSettingsOpen(false);
    setToast(null);
  };

  return (
    <motion.main
      className="screen game-screen"
      initial={{ opacity: 0, x: 36 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 36 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="game-header">
        <button className="icon-button game-back" type="button" onClick={onBack} aria-label="Back to home"><BackIcon /></button>
        <div className="turn-title">
          <span className="turn-title__eyebrow">Turn {turnNumber}</span>
          <strong>{turnState === "you" ? "Your turn" : `${activeOpponent}’s turn`}</strong>
        </div>
        <motion.div className={`timer ${turnState === "you" && timer <= 10 ? "timer--urgent" : ""}`} animate={{ scale: turnState === "you" && timer <= 5 ? [1, 1.06, 1] : 1 }} transition={{ repeat: turnState === "you" && timer <= 5 ? Infinity : 0, duration: 1 }}>
          {turnState === "you" ? `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}` : "•••"}
        </motion.div>
        <button className="icon-button game-settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><SettingsIcon /></button>
      </header>

      <section className="player-rail" aria-label="Players">
        <div className={`rail-player ${turnState === "opponent" && activeOpponent === "Maya" ? "rail-player--active" : ""}`}><Avatar initials="M" tone="terra" active={turnState === "opponent" && activeOpponent === "Maya"} /><span><strong>Maya</strong><em>{opponentRacks.Maya.length} tiles</em></span></div>
        <div className={`rail-player ${turnState === "opponent" && activeOpponent === "Leo" ? "rail-player--active" : ""}`}><Avatar initials="L" tone="blue" active={turnState === "opponent" && activeOpponent === "Leo"} /><span><strong>Leo</strong><em>{opponentRacks.Leo.length} tiles</em></span></div>
        <div className={`rail-player ${turnState === "you" ? "rail-player--active" : ""}`}><Avatar initials="Y" tone="olive" active={turnState === "you"} /><span><strong>You</strong><em>{rack.length} tiles</em></span></div>
      </section>

      <DndContext sensors={sensors} collisionDetection={tabletopCollision} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <BoardDropZone
          empty={boardIsEmpty}
          onTableTap={handleTableTap}
          camera={boardCamera}
          onCameraChange={setBoardCamera}
          world={visibleBoard.map((group) => {
            const position = layoutPositions[group.id] ?? { x: 50, y: 50 };
            return (
              <div
                className="meld-position"
                key={group.id}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
              >
                <DroppableGroup
                  group={group}
                  activeTile={activeTile}
                  selectedTiles={selectedTiles}
                  onTap={handleGroupTap}
                  returnableTileIds={turnState === "you" ? returnableTileIds : new Set<string>()}
                  onReturnTile={returnTileToRack}
                />
              </div>
            );
          })}
        >
          <div className="board-guide board-guide--tl" /><div className="board-guide board-guide--tr" />
          <div className="board-guide board-guide--bl" /><div className="board-guide board-guide--br" />
          {boardIsEmpty && (
            <div className="empty-table-copy" aria-hidden="true">
              <strong>Fresh table</strong>
              <span>Tap to place · drag or pinch to explore</span>
            </div>
          )}
          <AnimatePresence>{celebrating && <ConfettiBurst />}</AnimatePresence>
        </BoardDropZone>

        <RackDropZone
          className={`rack-section ${rack.length > 14 ? "rack-section--compact" : ""} ${rack.length > 20 ? "rack-section--crowded" : ""}`}
          label={`Your tile rack. All ${rack.length} tiles visible`}
        >
          <div className="rack-shell">
            <div
              className="rack-grid"
              style={{ "--rack-columns": rackColumns } as CSSProperties}
            >
              <SortableContext items={rack.map((entry) => entry.id)} strategy={rectSortingStrategy}>
                {rack.map((entry) => (
                  <SortableTile
                    key={entry.id}
                    tile={entry}
                    selected={selectedIds.includes(entry.id)}
                    onSelect={() => setSelectedIds((current) => current.includes(entry.id)
                      ? current.filter((id) => id !== entry.id)
                      : [...current, entry.id])}
                  />
                ))}
              </SortableContext>
            </div>
          </div>
          <p className="interaction-hint" role="status" aria-live="polite">
            <span aria-hidden="true">⌁</span>
            {toast
              ? toast
              : turnState === "opponent"
                ? `${activeOpponent} is arranging · plan your next move`
                : selectedTiles.length > 0
                  ? `${selectedTiles.length} selected · tap the felt or a meld`
                  : boardHasIllegalDraft
                    ? "Table in progress · keep arranging"
                    : moveCount > 0 && turnValidation.legal
                      ? "Legal table · end the turn"
                      : !hasOpened
                        ? "Opening needs 30 · end turn draws 1"
                        : "End turn to draw 1"}
            <span aria-hidden="true">⌁</span>
          </p>
        </RackDropZone>

        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }}>
          {activeTile ? (
            <div className="drag-stack">
              <TileFace tile={activeTile} floating />
              {selectedIds.includes(activeTile.id) && selectedIds.length > 1 && (
                <span aria-label={`${selectedIds.length} selected tiles`}>{selectedIds.length}</span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <section className="game-actions">
        <motion.button className="action-button action-button--outline" type="button" onClick={handleUndo} whileTap={{ scale: 0.96 }}>
          <UndoIcon /> <span>Undo</span>
        </motion.button>
        <motion.button
          className={`action-button action-button--solid turn-action ${moveCount > 0 && !turnValidation.legal ? "action-button--blocked" : ""}`}
          type="button"
          onClick={handleTurnAction}
          disabled={turnState !== "you"}
          whileTap={{ scale: 0.96 }}
          aria-label={moveCount === 0
            ? `Draw one tile and end turn. ${pool.length} tiles remain in the pool.`
            : turnValidation.legal ? "End turn" : "Fix the table before ending the turn"}
        >
          <span className="turn-action__label">End turn</span>
          <span className="turn-action__arrow" aria-hidden="true">→</span>
        </motion.button>
      </section>

      <AnimatePresence>
        {winner && finalScores && (
          <>
            <motion.div className="sheet-scrim result-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.section
              className="result-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Round result"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 330, damping: 31 }}
            >
              <div className="result-burst" aria-hidden="true"><span>✦</span><span>◆</span><span>✤</span></div>
              <span className="result-sheet__eyebrow">Round complete</span>
              <h2>{winner === "You" ? "Beautifully played." : `${winner} takes the table.`}</h2>
              <p>{winner === "You" ? "You cleared all of your tiles." : `${winner} cleared their rack first.`}</p>
              <div className="scoreboard" aria-label="Final scores">
                {finalScores.map((entry) => {
                  const tone = entry.player === "You" ? "olive" : entry.player === "Leo" ? "blue" : "terra";
                  const initials = entry.player === "You" ? "Y" : entry.player[0];
                  return (
                    <div className={`score-row ${entry.player === winner ? "score-row--winner" : ""}`} key={entry.player}>
                      <Avatar initials={initials} tone={tone} active={entry.player === winner} />
                      <span><strong>{entry.player}</strong><em>{entry.tiles} tile{entry.tiles === 1 ? "" : "s"} left</em></span>
                      <b>{entry.score > 0 ? "+" : ""}{entry.score}</b>
                    </div>
                  );
                })}
              </div>
              <button className="result-button" type="button" onClick={resetGame}>Play again <span aria-hidden="true">↗</span></button>
              <button className="result-home" type="button" onClick={onBack}>Back to home</button>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.button className="sheet-scrim" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.section className="settings-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}>
              <div className="sheet-handle" />
              <div className="settings-sheet__heading"><BrandMark compact /><div><span>Table settings</span><strong>Keep the game feeling good.</strong></div></div>
              <SettingRow label="Table sounds" description="Soft ceramic clicks and turn cues" value={sound} onChange={setSound} />
              <SettingRow label="Haptic taps" description="A light pulse when a tile lands" value={haptics} onChange={setHaptics} />
              <button className="reset-button" type="button" onClick={resetGame}>Reset this table</button>
              <button className="sheet-done" type="button" onClick={() => setSettingsOpen(false)}>Done</button>
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </motion.main>
  );
}

function BoardDropZone({
  children,
  world,
  empty = false,
  onTableTap,
  camera,
  onCameraChange,
}: {
  children: React.ReactNode;
  world: React.ReactNode;
  empty?: boolean;
  onTableTap: (position: TablePoint) => void;
  camera: BoardCamera;
  onCameraChange: (camera: BoardCamera) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: "board-drop", data: { type: "board" } });
  const cameraX = useMotionValue(camera.x);
  const cameraY = useMotionValue(camera.y);
  const cameraZoom = useMotionValue(camera.zoom);
  const cameraRef = useRef(camera);
  const pointersRef = useRef(new Map<number, TablePoint>());
  const panGestureRef = useRef<{
    pointerId: number;
    start: TablePoint;
    camera: BoardCamera;
  } | null>(null);
  const pinchGestureRef = useRef<{
    distance: number;
    anchor: TablePoint;
    zoom: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const wheelCommitRef = useRef<number | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
    cameraX.set(camera.x);
    cameraY.set(camera.y);
    cameraZoom.set(camera.zoom);
  }, [camera, cameraX, cameraY, cameraZoom]);

  useEffect(() => () => {
    if (wheelCommitRef.current !== null) window.clearTimeout(wheelCommitRef.current);
  }, []);

  const clampCamera = (next: BoardCamera, rect: DOMRect): BoardCamera => {
    const zoom = Math.max(0.42, Math.min(1.8, next.zoom));
    const worldWidth = rect.width * 1.7 * zoom;
    const worldHeight = rect.height * 1.7 * zoom;
    const visibleEdge = 72;
    return {
      zoom,
      x: Math.max(visibleEdge - worldWidth, Math.min(rect.width - visibleEdge, next.x)),
      y: Math.max(visibleEdge - worldHeight, Math.min(rect.height - visibleEdge, next.y)),
    };
  };

  const applyCamera = (next: BoardCamera, rect: DOMRect) => {
    const clamped = clampCamera(next, rect);
    cameraRef.current = clamped;
    cameraX.set(clamped.x);
    cameraY.set(clamped.y);
    cameraZoom.set(clamped.zoom);
    return clamped;
  };

  const startPinch = (rect: DOMRect) => {
    const points = [...pointersRef.current.values()].slice(0, 2);
    if (points.length < 2) return;
    const midpoint = {
      x: (points[0].x + points[1].x) / 2 - rect.left,
      y: (points[0].y + points[1].y) / 2 - rect.top,
    };
    const current = cameraRef.current;
    pinchGestureRef.current = {
      distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      anchor: {
        x: (midpoint.x - current.x) / current.zoom,
        y: (midpoint.y - current.y) / current.zoom,
      },
      zoom: current.zoom,
    };
    suppressClickRef.current = true;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (pointersRef.current.size === 0 && target.closest(".meld-position, .board-fit-button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.classList.add("board-stage--panning");

    if (pointersRef.current.size === 1) {
      suppressClickRef.current = false;
      panGestureRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        camera: { ...cameraRef.current },
      };
      pinchGestureRef.current = null;
      return;
    }
    startPinch(event.currentTarget.getBoundingClientRect());
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = event.currentTarget.getBoundingClientRect();

    if (pointersRef.current.size >= 2) {
      if (!pinchGestureRef.current) startPinch(rect);
      const pinch = pinchGestureRef.current;
      const points = [...pointersRef.current.values()].slice(0, 2);
      if (!pinch || points.length < 2) return;
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const midpoint = {
        x: (points[0].x + points[1].x) / 2 - rect.left,
        y: (points[0].y + points[1].y) / 2 - rect.top,
      };
      const zoom = pinch.zoom * (distance / Math.max(1, pinch.distance));
      applyCamera({
        zoom,
        x: midpoint.x - pinch.anchor.x * zoom,
        y: midpoint.y - pinch.anchor.y * zoom,
      }, rect);
      return;
    }

    const pan = panGestureRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.start.x;
    const deltaY = event.clientY - pan.start.y;
    if (Math.hypot(deltaX, deltaY) <= 7) return;
    suppressClickRef.current = true;
    applyCamera({
      ...pan.camera,
      x: pan.camera.x + deltaX,
      y: pan.camera.y + deltaY,
    }, rect);
  };

  const finishPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pinchGestureRef.current = null;

    const remaining = [...pointersRef.current.entries()][0];
    if (remaining) {
      panGestureRef.current = {
        pointerId: remaining[0],
        start: remaining[1],
        camera: { ...cameraRef.current },
      };
      return;
    }
    panGestureRef.current = null;
    event.currentTarget.classList.remove("board-stage--panning");
    onCameraChange({ ...cameraRef.current });
  };

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const current = cameraRef.current;
    const localPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const anchor = {
      x: (localPoint.x - current.x) / current.zoom,
      y: (localPoint.y - current.y) / current.zoom,
    };
    const zoom = current.zoom * Math.exp(-event.deltaY * 0.0015);
    const next = applyCamera({
      zoom,
      x: localPoint.x - anchor.x * zoom,
      y: localPoint.y - anchor.y * zoom,
    }, rect);
    if (wheelCommitRef.current !== null) window.clearTimeout(wheelCommitRef.current);
    wheelCommitRef.current = window.setTimeout(() => onCameraChange(next), 120);
  };

  const fitBoard = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const zoom = defaultCamera.zoom;
    const fitted = {
      zoom,
      x: (rect.width - rect.width * 1.7 * zoom) / 2,
      y: (rect.height - rect.height * 1.7 * zoom) / 2 + 6,
    };
    const next = applyCamera(fitted, rect);
    onCameraChange(next);
  };

  return (
    <section
      ref={setNodeRef}
      className={`board-stage ${empty ? "board-stage--empty" : ""} ${isOver ? "board-stage--over" : ""}`}
      aria-label="Game table. Tap to place selected tiles, drag empty felt to move, and pinch or use the mouse wheel to zoom"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest(".meld-position, .board-fit-button")) return;
        const worldElement = event.currentTarget.querySelector<HTMLElement>(".board-world");
        const rect = worldElement?.getBoundingClientRect();
        if (!rect) return;
        onTableTap({
          x: Math.max(8, Math.min(92, ((event.clientX - rect.left) / rect.width) * 100)),
          y: Math.max(10, Math.min(90, ((event.clientY - rect.top) / rect.height) * 100)),
        });
      }}
    >
      {children}
      <motion.div
        className="board-world"
        style={{ x: cameraX, y: cameraY, scale: cameraZoom }}
      >
        {world}
      </motion.div>
      <button
        className="board-fit-button"
        type="button"
        aria-label="Fit the whole table in view"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          fitBoard(event.currentTarget.closest<HTMLElement>(".board-stage")!);
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
        </svg>
        <span>Fit</span>
      </button>
    </section>
  );
}

function RackDropZone({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className: string;
  label: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: "rack-drop", data: { type: "rack" } });
  return (
    <section
      ref={setNodeRef}
      className={`${className} ${isOver ? "rack-section--over" : ""}`}
      aria-label={label}
    >
      {children}
    </section>
  );
}

function SettingRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><em>{description}</em></span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle" aria-hidden="true"><i /></span>
    </label>
  );
}

function ConfettiBurst() {
  const pieces = ["terra", "blue", "yellow", "olive", "blue", "terra", "yellow", "olive"];
  return (
    <motion.div className="confetti" initial={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true">
      {pieces.map((color, index) => (
        <motion.i
          key={`${color}-${index}`}
          className={`confetti__piece confetti__piece--${color}`}
          initial={{ x: 0, y: 0, rotate: 0, scale: 0 }}
          animate={{ x: (index - 3.5) * 38, y: index % 2 ? -110 : -145, rotate: 180 + index * 45, scale: [0, 1, 0.8] }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      ))}
    </motion.div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("home");

  return (
    <div className="app-stage">
      <div className="sun-disc" aria-hidden="true" />
      <div className="plate-motif" aria-hidden="true"><span /></div>
      <div className="phone-shell">
        <AnimatePresence mode="wait" initial={false}>
          {screen === "home"
            ? <HomeScreen key="home" onPlay={() => setScreen("game")} />
            : <GameScreen key="game" onBack={() => setScreen("home")} />}
        </AnimatePresence>
      </div>
      <p className="desktop-caption"><span>✦</span> A table made for touch <span>✦</span></p>
    </div>
  );
}

function PeopleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><circle cx="16.5" cy="9" r="2.5" /><path d="M3 19c.5-4 2.5-6 6-6s5.5 2 6 6M14 14c3.5-.4 6 1.3 6.5 5" /></svg>; }
function HomeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 9 5-9 5z" /></svg>; }
function ProfileIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M5 21c.6-5 3-7 7-7s6.4 2 7 7z" /></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.2 2.2M16.8 16.8 19 19M19 5l-2.2 2.2M7.2 16.8 5 19" /></svg>; }
function UndoIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7-5 5 5 5M5 12h8a6 6 0 1 1 0 12" /></svg>; }

export default App;
