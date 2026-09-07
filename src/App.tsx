import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import {
  BoardGroup,
  Deal,
  OpponentName,
  OpponentRacks,
  PlayerName,
  Tile,
  TurnSnapshot,
  analyzeMeld,
  createDeal,
  initialBoard,
  moveBoardTiles,
  orderMeldTiles,
  playOpponentTurn,
  resolveTileDrop,
  resolveTimeout,
  scoreRound,
  scoreStalemate,
  sortRackByGroups,
  sortRackByRuns,
  validateTurn,
} from "./game";
import { playTick, playTilePlace, setMusic } from "./audio";
import { BoardCamera, TablePoint, TablePositions, positionTableGroups as arrangeTableGroups } from "./layout";
import { centerDragOnPointer, moveRackSelection, pointerPosition, tabletopCollision, withRackOrder, worldPoint } from "./interactions";

type Screen = "home" | "game";
type TurnState = "you" | "opponent";
type Winner = "You" | OpponentName;

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

// Personalised share links: ?name=Mara relabels the local seat everywhere the
// UI shows it. Engine state keeps the internal "You" key — display only.
const localPlayerName = (new URLSearchParams(window.location.search).get("name")?.trim() || "You").slice(0, 12);
const localPlayerInitial = localPlayerName.charAt(0).toUpperCase();

const defaultCamera: BoardCamera = { x: 0, y: 6, zoom: 0.58 };
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

function SortableTile({ tile, selected, lifted, onSelect, onExtend }: {
  tile: Tile; selected: boolean; lifted: boolean; onSelect: () => void; onExtend: (count: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
    data: { type: "rack-tile", tile },
  });
  const holdTimer = useRef<number | undefined>(undefined);
  const holdStarted = useRef(false);
  const origin = useRef<TablePoint | null>(null);
  const extendRef = useRef(onExtend);
  extendRef.current = onExtend;
  const stopHold = () => { window.clearTimeout(holdTimer.current); origin.current = null; };
  useEffect(() => {
    window.addEventListener("pointerup", stopHold);
    window.addEventListener("pointercancel", stopHold);
    window.addEventListener("blur", stopHold);
    document.addEventListener("visibilitychange", stopHold);
    return () => {
      stopHold();
      window.removeEventListener("pointerup", stopHold);
      window.removeEventListener("pointercancel", stopHold);
      window.removeEventListener("blur", stopHold);
      document.removeEventListener("visibilitychange", stopHold);
    };
  }, []);
  useEffect(() => { if (isDragging) stopHold(); }, [isDragging]);

  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      className={`rack-tile ${isDragging || lifted ? "rack-tile--dragging" : ""}`}
      data-tile-id={tile.id}
      onClick={() => {
        if (holdStarted.current) { holdStarted.current = false; return; }
        onSelect();
      }}
      aria-label={`${tile.color} ${tile.value} tile${selected ? ", selected" : ""}`}
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        if (!event.isPrimary || event.button !== 0) return;
        stopHold();
        holdStarted.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        let count = 1;
        const extend = () => {
          holdStarted.current = true;
          extendRef.current(count++);
          holdTimer.current = window.setTimeout(extend, 180);
        };
        holdTimer.current = window.setTimeout(extend, 300);
      }}
      onPointerMove={(event) => {
        if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 4) stopHold();
      }}
      onPointerLeave={stopHold}
    >
      <TileFace tile={tile} selected={selected} />
    </button>
  );
}

function DraggableBoardTile({
  tile,
  groupId,
  tailIds,
  returnable,
  lifted,
  onReturn,
}: {
  tile: Tile;
  groupId: string;
  tailIds: string[];
  returnable: boolean;
  lifted: boolean;
  onReturn: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: tile.id,
    data: { type: "board-tile", tile, groupId, tailIds },
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
        className={`board-tile ${isDragging ? "board-tile--dragging" : ""} ${isOver ? "board-tile--over" : ""} ${lifted ? "board-tile--tail-lifted" : ""}`}
        data-tile-id={tile.id}
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
  activeTailIds,
  hot,
  selectedTiles,
  onTap,
  returnableTileIds,
  onReturnTile,
}: {
  group: BoardGroup;
  activeTile: Tile | null;
  activeTailIds: string[];
  hot: boolean;
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
  const isValidRun = meldAnalysis.valid && meldAnalysis.type === "run";
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
      className={`meld meld--${group.id} meld--kind-${group.kind} meld--table-added ${isFourTileSet ? "meld--four-set" : ""} ${lengthClass} ${isOver ? "meld--over" : ""} ${hot ? "meld--hot" : ""} ${canReceive ? "meld--receivable" : ""} ${isDraftInvalid ? "meld--invalid" : ""}`}
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
        {group.tiles.map((entry, index) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.09 }}
          >
            <DraggableBoardTile
              tile={entry}
              groupId={group.id}
              tailIds={isValidRun ? group.tiles.slice(index).map((tail) => tail.id) : [entry.id]}
              returnable={returnableTileIds.has(entry.id)}
              lifted={activeTailIds.includes(entry.id) && activeTile?.id !== entry.id}
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

function AudioToggle({ kind, on, onChange }: {
  kind: "music" | "sfx";
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  const label = kind === "music"
    ? on ? "Turn background music off" : "Turn background music on"
    : on ? "Turn sound effects off" : "Turn sound effects on";
  return (
    <button
      className={`audio-toggle ${on ? "" : "audio-toggle--off"}`}
      type="button"
      aria-label={label}
      aria-pressed={on}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!on);
      }}
    >
      {kind === "music"
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5.5L19 4v12" /><circle cx="6.6" cy="18" r="2.5" /><circle cx="16.6" cy="16" r="2.5" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9.5v5H8l5 4v-13l-5 4z" /><path d="M16.5 9a4.4 4.4 0 0 1 0 6" /></svg>}
    </button>
  );
}

function HomeScreen({ onPlay, musicOn, sfxOn, onMusicChange, onSfxChange }: {
  onPlay: () => void;
  musicOn: boolean;
  sfxOn: boolean;
  onMusicChange: (value: boolean) => void;
  onSfxChange: (value: boolean) => void;
}) {
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
        <div className="home-audio">
          <AudioToggle kind="music" on={musicOn} onChange={onMusicChange} />
          <AudioToggle kind="sfx" on={sfxOn} onChange={onSfxChange} />
        </div>
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
          <span className="button-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
          </span>
        </motion.button>
      </section>

      <section className="active-game" aria-label="Players at this table">
        <div className="active-game__topline">
          <span><PeopleIcon /> Game night · Offline table</span>
          <span className="active-game__meta">3 players</span>
        </div>
        <div className="home-players">
          <div className="home-player home-player--you"><Avatar initials={localPlayerInitial} tone="olive" active /><span>{localPlayerName}</span></div>
          <span className="player-divider" aria-hidden="true">◆</span>
          <div className="home-player"><Avatar initials="L" tone="blue" /><span>Leo</span></div>
          <span className="player-divider" aria-hidden="true">◆</span>
          <div className="home-player"><Avatar initials="M" tone="terra" /><span>Maya</span></div>
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

function GameScreen({ onBack, musicOn, sfxOn, haptics, onMusicChange, onSfxChange, onHapticsChange }: {
  onBack: () => void;
  musicOn: boolean;
  sfxOn: boolean;
  haptics: boolean;
  onMusicChange: (value: boolean) => void;
  onSfxChange: (value: boolean) => void;
  onHapticsChange: (value: boolean) => void;
}) {
  const [deal, setDeal] = useState<Deal>(() => createDeal());
  const [rack, setRack] = useState<Tile[]>(deal.rack);
  const [board, setBoard] = useState<BoardGroup[]>(cloneBoard(initialBoard));
  const [pool, setPool] = useState<Tile[]>(deal.pool);
  const [opponentRacks, setOpponentRacks] = useState<OpponentRacks>(() => cloneOpponentRacks(deal.opponents));
  const [opponentOpened, setOpponentOpened] = useState<Record<OpponentName, boolean>>({ Maya: false, Leo: false });
  const [hasOpened, setHasOpened] = useState(false);
  const [turnStart, setTurnStart] = useState<TurnSnapshot>(() => ({
    rack: [...deal.rack],
    board: cloneBoard(initialBoard),
    pool: [...deal.pool],
    hasOpened: false,
  }));
  const [activeTile, setActiveTile] = useState<Tile | null>(null);
  const [activeTailIds, setActiveTailIds] = useState<string[]>([]);
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<ActionSnapshot[]>([]);
  const [moveCount, setMoveCount] = useState(0);
  const [groupPositions, setGroupPositions] = useState<TablePositions>({});
  const [turnStartPositions, setTurnStartPositions] = useState<TablePositions>({});
  const [boardCamera, setBoardCamera] = useState<BoardCamera>(defaultCamera);
  const [viewMode, setViewMode] = useState<"locked" | "free">(() =>
    localStorage.getItem("tessera.viewMode") === "free" ? "free" : "locked");
  const [stageSize, setStageSize] = useState({ width: 390, height: 480 });
  const [landscape, setLandscape] = useState(() => window.matchMedia("(orientation: landscape) and (max-height: 600px)").matches);
  const [overlaySize, setOverlaySize] = useState({ width: 46, height: 62 });
  const rackRef = useRef(rack);
  rackRef.current = rack;
  useEffect(() => {
    const query = window.matchMedia("(orientation: landscape) and (max-height: 600px)");
    const update = () => setLandscape(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const positionTableGroups = (groups: BoardGroup[], positions: TablePositions, movedId?: string) =>
    arrangeTableGroups(groups, positions, stageSize, movedId);
  const [timer, setTimer] = useState(60);
  const [turnState, setTurnState] = useState<TurnState>("you");
  const [activeOpponent, setActiveOpponent] = useState<OpponentName>("Leo");
  const [turnNumber, setTurnNumber] = useState(1);
  const [winner, setWinner] = useState<Winner | null>(null);
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [endedByStalemate, setEndedByStalemate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const selectedTiles = rack.filter((entry) => selectedIds.includes(entry.id));
  const activeDragCount = activeTailIds.length
    || (activeTile && selectedIds.includes(activeTile.id) ? selectedIds.length : 1);
  const turnValidation = useMemo(
    () => validateTurn(turnStart, board, rack),
    [turnStart, board, rack],
  );
  const boardHasIllegalDraft = board.some((group) => !analyzeMeld(group.tiles).valid);
  const boardIsEmpty = board.every((group) => group.tiles.length === 0);
  const visibleBoard = board.filter((group) => group.tiles.length > 0);
  const layoutPositions = useMemo(
    () => arrangeTableGroups(board, groupPositions, stageSize),
    [board, groupPositions, stageSize],
  );
  const rackCapacity = Math.max(7, Math.floor((stageSize.width - 42) / 38));
  const rackColumns = Math.min(rackCapacity, Math.max(7, Math.ceil(rack.length / (landscape ? 1 : 2))));
  const rackRows = Math.max(landscape ? 1 : 2, Math.ceil(rack.length / rackColumns));
  const [rackSpace, setRackSpace] = useState({ portrait: 2, landscape: 1 });
  const rackOrientation = landscape ? "landscape" : "portrait";
  const visibleRackRows = Math.max(rackSpace[rackOrientation], Math.min(rackRows, landscape ? 2 : 3));
  useEffect(() => {
    setRackSpace((current) => current[rackOrientation] === visibleRackRows
      ? current : { ...current, [rackOrientation]: visibleRackRows });
  }, [rackOrientation, visibleRackRows]);
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
    const scores = endedByStalemate ? scoreStalemate(racks).scores : scoreRound(winner, racks);
    const players: Winner[] = ["You", "Leo", "Maya"];
    return players.map((player) => ({
      player,
      tiles: racks[player].length,
      score: scores[player],
    }));
  }, [winner, rack, opponentRacks, endedByStalemate]);

  const endByStalemate = (racks: Record<PlayerName, Tile[]>) => {
    setEndedByStalemate(true);
    setWinner(scoreStalemate(racks).winner);
  };

  const handlePass = () => {
    const base = { ...cloneTurnSnapshot(turnStart), rack: withRackOrder(turnStart.rack, rack) };
    setRack(base.rack);
    setBoard(cloneBoard(base.board));
    setGroupPositions(clonePositions(turnStartPositions));
    setHistory([]);
    setMoveCount(0);
    setSelectedIds([]);
    setTimer(60);
    const nextPasses = consecutivePasses + 1;
    if (nextPasses >= 3) {
      endByStalemate({ You: base.rack, Maya: opponentRacks.Maya, Leo: opponentRacks.Leo });
      return;
    }
    setConsecutivePasses(nextPasses);
    setToast("Pool empty · you pass");
    setActiveOpponent("Leo");
    window.setTimeout(() => setTurnState("opponent"), 420);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
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

    const timeoutOutcome = resolveTimeout(moveCount, turnValidation.legal, turnStart.pool.length === 0);
    if (timeoutOutcome === "pass") {
      handlePass();
      return;
    }
    if (timeoutOutcome === "submit") {
      const opened = hasOpened || turnValidation.opensPlayer;
      const committedBoard = sealDraftSlot(board, `you-${turnNumber}`);
      setHasOpened(opened);
      setBoard(committedBoard);
      setHistory([]);
      setMoveCount(0);
      setSelectedIds([]);
      setConsecutivePasses(0);
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

    const base = { ...cloneTurnSnapshot(turnStart), rack: withRackOrder(turnStart.rack, rack) };
    const penaltyTiles = base.pool.slice(0, 1);
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
    setToast(timeoutOutcome === "revert-draw-one" ? "Time’s up · table restored · drew 1" : "Time’s up · drew one tile");
    setActiveOpponent("Leo");
    setTurnState("opponent");
  }, [timer, turnState, settingsOpen, winner, moveCount, turnValidation, hasOpened, board, turnNumber, turnStart, turnStartPositions, consecutivePasses, opponentRacks]);

  useEffect(() => {
    if (turnState !== "opponent" || winner) return;
    const actingOpponent = activeOpponent;
    // Each opponent "thinks" for a random 3-10 seconds so their turns feel
    // like a real player deliberating rather than an instant machine.
    const thinkingDelay = 3000 + Math.random() * 7000;
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
      if (result.action === "stuck") {
        const nextPasses = consecutivePasses + 1;
        if (nextPasses >= 3) {
          endByStalemate({
            You: rackRef.current,
            Maya: actingOpponent === "Maya" ? result.rack : opponentRacks.Maya,
            Leo: actingOpponent === "Leo" ? result.rack : opponentRacks.Leo,
          });
          return;
        }
        setConsecutivePasses(nextPasses);
      } else {
        setConsecutivePasses(0);
      }
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
        rack: [...rackRef.current],
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
    }, thinkingDelay);
    return () => window.clearTimeout(timeout);
  }, [turnState, winner, activeOpponent, opponentRacks, opponentOpened, board, pool, turnNumber, hasOpened, groupPositions, consecutivePasses]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Last-10-seconds clock tick, louder as the turn runs out (Table sounds).
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (timer > 10 || timer <= 0) {
      lastTickRef.current = null;
      return;
    }
    if (!sfxOn || turnState !== "you" || settingsOpen || winner) return;
    if (lastTickRef.current === timer) return;
    lastTickRef.current = timer;
    playTick((10 - timer) / 10, timer % 2 === 0);
  }, [timer, sfxOn, turnState, settingsOpen, winner]);

  const remember = () => {
    setToast(null);
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
    // Pre-opening, every table group made only of this turn's rack tiles is
    // the player's own opening draft, whatever its kind — splits of an
    // unsealed draft must stay finishable.
    const isOwnOpeningDraft = destination !== undefined
      && destination.tiles.length > 0
      && destination.tiles.every((entry) => returnableTileIds.has(entry.id));
    if (!hasOpened && groupId !== "new-meld" && !isOwnOpeningDraft) {
      setToast("Opening melds must use only rack tiles in a new set");
      setSelectedIds([]);
      return;
    }
    const splitId = `split-${turnNumber}-${moveCount + 1}-${movingTiles[0].id}`;
    const resolution = resolveTileDrop(board, groupId, movingTiles, targetIndex, splitId);
    // A deliberate split may create incomplete halves; an unrelated rack tile
    // should not damage an otherwise complete meld just because it was hit.
    if (resolution.kind === "draft" && destination?.tiles.length && analyzeMeld(destination.tiles).valid) {
      setToast("These tiles don’t fit that meld · place them on empty felt");
      return;
    }
    const candidateBoard = resolution.groups;
    remember();
    setRack((items) => items.filter((entry) => !movingIdSet.has(entry.id)));
    setBoard(candidateBoard);
    setGroupPositions((current) => {
      const seeded = resolution.kind === "split" && current[groupId]
        ? { ...current, [splitId]: { x: current[groupId].x + 12, y: current[groupId].y } }
        : current;
      return positionTableGroups(candidateBoard, seeded);
    });
    setMoveCount((value) => value + movingTiles.length);
    setSelectedIds([]);
    if (sfxOn) playTilePlace();
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
    if (sfxOn) playTilePlace();
    if (haptics && "vibrate" in navigator) navigator.vibrate(14);
  };

  const rearrangeTableTiles = (
    tileIds: string[],
    fromGroupId: string,
    toGroupId: string,
    targetIndex?: number,
  ) => {
    if (turnState !== "you" || (fromGroupId === toGroupId && targetIndex === undefined)) return;
    if (!hasOpened && tileIds.some((id) => !returnableTileIds.has(id))) {
      setToast("Table rearrangement unlocks after your 30-point opening meld");
      return;
    }
    if (fromGroupId === toGroupId || tileIds.length > 1) {
      const movedBoard = moveBoardTiles(board, tileIds, fromGroupId, toGroupId, targetIndex);
      if (movedBoard === board) return;
      remember();
      const nextBoard = movedBoard.filter((group) => group.id === "new-meld" || group.tiles.length > 0);
      setBoard(nextBoard);
      setGroupPositions((current) => positionTableGroups(nextBoard, current));
      setMoveCount((value) => value + 1);
      return;
    }
    remember();
    const tileId = tileIds[0];
    const movingTile = board.find((group) => group.id === fromGroupId)?.tiles
      .find((entry) => entry.id === tileId);
    if (!movingTile) return;
    const removed = board.map((group) => group.id === fromGroupId
      ? { ...group, tiles: group.tiles.filter((entry) => entry.id !== tileId) }
      : group);
    const splitId = `split-${turnNumber}-${moveCount + 1}-${tileId}`;
    const resolution = resolveTileDrop(removed, toGroupId, [movingTile], targetIndex, splitId);
    const nextBoard = resolution.groups
      .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
    setBoard(nextBoard);
    setGroupPositions((current) => {
      const seeded = resolution.kind === "split" && current[toGroupId]
        ? { ...current, [splitId]: { x: current[toGroupId].x + 12, y: current[toGroupId].y } }
        : current;
      return positionTableGroups(nextBoard, seeded);
    });
    setMoveCount((value) => value + 1);
  };

  const moveTableTilesToNewGroup = (tileIds: string[], fromGroupId: string, position: TablePoint) => {
    if (turnState !== "you") return;
    if (!hasOpened && tileIds.some((id) => !returnableTileIds.has(id))) {
      setToast("Table rearrangement unlocks after your 30-point opening meld");
      return;
    }
    const source = board.find((group) => group.id === fromGroupId);
    const idSet = new Set(tileIds);
    const movingTiles = source?.tiles.filter((entry) => idSet.has(entry.id)) ?? [];
    if (!source || movingTiles.length === 0) return;
    remember();

    if (movingTiles.length === source.tiles.length) {
      setGroupPositions((current) => positionTableGroups(board, { ...current, [fromGroupId]: position }, fromGroupId));
      return;
    }

    const groupId = `split-${turnNumber}-${moveCount + 1}-${tileIds[0]}`;
    const nextBoard: BoardGroup[] = [
      ...board
        .filter((group) => group.id !== "new-meld")
        .map((group) => group.id === fromGroupId
          ? { ...group, tiles: group.tiles.filter((entry) => !idSet.has(entry.id)) }
          : group)
        .filter((group) => group.tiles.length > 0),
      { id: groupId, kind: "new", tiles: movingTiles },
      { id: "new-meld", kind: "new", tiles: [] },
    ];
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, { ...current, [groupId]: position }));
    setMoveCount((value) => value + 1);
  };

  const returnTilesToRack = (tileIds: string[], fromGroupId: string, insertIndex?: number) => {
    if (turnState !== "you") return;
    if (!tileIds.every((id) => returnableTileIds.has(id))) {
      setToast("Only tiles played from your rack this turn can come back");
      return;
    }
    const idSet = new Set(tileIds);
    const returningTiles = board
      .find((group) => group.id === fromGroupId)
      ?.tiles.filter((entry) => idSet.has(entry.id)) ?? [];
    if (returningTiles.length === 0) return;

    remember();
    const nextBoard = board
      .map((group) => group.id === fromGroupId
        ? { ...group, tiles: group.tiles.filter((entry) => !idSet.has(entry.id)) }
        : group)
      .filter((group) => group.id === "new-meld" || group.tiles.length > 0);
    setBoard(nextBoard);
    setGroupPositions((current) => positionTableGroups(nextBoard, current));
    setRack((items) => {
      // Never re-sort the rack: the player's arrangement is theirs. Returned
      // tiles land where they were dropped, or at the end.
      const next = [...items];
      const insertionIndex = insertIndex === undefined
        ? next.length
        : Math.max(0, Math.min(insertIndex, next.length));
      next.splice(insertionIndex, 0, ...returningTiles);
      return next;
    });
    setMoveCount((value) => Math.max(0, value - tileIds.length));
    setSelectedIds([]);
  };

  const getDropPosition = ({ active, activatorEvent, delta }: DragEndEvent): TablePoint => {
    const boardElement = document.querySelector<HTMLElement>(".board-world");
    const tileRect = active.rect.current.translated ?? active.rect.current.initial;
    if (!boardElement || !tileRect) return { x: 50, y: 50 };
    const start = pointerPosition(activatorEvent);
    const point = start ? { x: start.x + delta.x, y: start.y + delta.y }
      : { x: tileRect.left + tileRect.width / 2, y: tileRect.top + tileRect.height / 2 };
    return worldPoint(point, boardElement.getBoundingClientRect());
  };

  const handleDragOver = ({ over, active }: DragOverEvent) => {
    const overId = over ? String(over.id) : "";
    const onBoard = overId === "board-drop" || overId.startsWith("group:") || overId.startsWith("board-target:");
    const owner = overId.startsWith("group:") ? overId.slice(6)
      : board.find((group) => group.tiles.some((entry) => `board-target:${entry.id}` === overId))?.id ?? null;
    setHoverGroupId(owner);
    const targetTileId = onBoard
      ? over?.data.current?.tileId ?? board.find((group) => group.id === owner)?.tiles[0]?.id
      : active.id;
    const target = targetTileId
      ? document.querySelector<HTMLElement>(`[data-tile-id="${window.CSS.escape(String(targetTileId))}"] .tile`)
      : document.querySelector<HTMLElement>(".board-tile-measure");
    const rect = target?.getBoundingClientRect();
    if (rect) setOverlaySize({ width: rect.width, height: rect.height });
  };

  const handleDragCancel = () => {
    setActiveTile(null);
    setActiveTailIds([]);
    setHoverGroupId(null);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const rect = document.querySelector<HTMLElement>(`[data-tile-id="${window.CSS.escape(String(active.id))}"] .tile`)?.getBoundingClientRect();
    if (rect) setOverlaySize({ width: rect.width, height: rect.height });
    const dragged = active.data.current?.tile as Tile | undefined;
    setActiveTile(dragged ?? null);
    setActiveTailIds((active.data.current?.tailIds as string[] | undefined) ?? []);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTile(null);
    setActiveTailIds([]);
    setHoverGroupId(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const sourceType = active.data.current?.type as "rack-tile" | "board-tile" | undefined;
    const fromGroupId = active.data.current?.groupId as string | undefined;
    const draggedRackIds = sourceType === "rack-tile" && selectedIds.includes(activeId)
      ? selectedIds
      : [activeId];
    const draggedBoardIds = sourceType === "board-tile"
      ? ((active.data.current?.tailIds as string[] | undefined) ?? [activeId])
      : [];

    if (sourceType === "rack-tile" && (overId === "rack-drop" || rack.some((entry) => entry.id === overId))) {
      setRack((items) => moveRackSelection(items, draggedRackIds, overId === "rack-drop" ? undefined : overId));
      return;
    }
    if (turnState !== "you") return;

    if (sourceType === "board-tile" && fromGroupId && rack.some((entry) => entry.id === overId)) {
      returnTilesToRack(draggedBoardIds, fromGroupId, rack.findIndex((entry) => entry.id === overId));
      return;
    }

    if (overId === "rack-drop") {
      if (sourceType === "board-tile" && fromGroupId) returnTilesToRack(draggedBoardIds, fromGroupId);
      return;
    }

    if (overId.startsWith("board-target:")) {
      const targetTileId = overId.slice("board-target:".length);
      const targetGroup = board.find((group) => group.tiles.some((entry) => entry.id === targetTileId));
      const targetIndex = targetGroup?.tiles.findIndex((entry) => entry.id === targetTileId) ?? -1;
      if (!targetGroup || targetIndex < 0) return;
      if (sourceType === "board-tile" && fromGroupId) {
        rearrangeTableTiles(draggedBoardIds, fromGroupId, targetGroup.id, targetIndex);
      } else {
        placeTiles(draggedRackIds, targetGroup.id, targetIndex);
      }
      return;
    }

    if (overId.startsWith("group:")) {
      const targetGroupId = overId.slice(6);
      if (sourceType === "board-tile" && fromGroupId) rearrangeTableTiles(draggedBoardIds, fromGroupId, targetGroupId);
      else placeTiles(draggedRackIds, targetGroupId);
      return;
    }
    if (overId === "board-drop") {
      const position = getDropPosition(event);
      if (sourceType === "board-tile" && fromGroupId) moveTableTilesToNewGroup(draggedBoardIds, fromGroupId, position);
      else placeTilesAsNewGroup(draggedRackIds, position);
      return;
    }


  };

  const handleGroupTap = (groupId: string) => {
    if (selectedIds.length > 0) placeTiles(selectedIds, groupId);
  };

  const handleTableTap = (position: TablePoint) => {
    if (selectedIds.length > 0) placeTilesAsNewGroup(selectedIds, position);
  };

  const handleUndo = () => {
    if (turnState !== "you" || winner || activeTile) return;
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

  const handleTakeBack = () => {
    if (turnState !== "you" || winner || activeTile || history.length === 0) return;
    // Restore the entire draft: merely removing rack tiles could leave table
    // melds broken after the player has split or rearranged them.
    setBoard(cloneBoard(turnStart.board));
    setRack(withRackOrder(turnStart.rack, rack));
    setGroupPositions(clonePositions(turnStartPositions));
    setHistory([]);
    setMoveCount(0);
    setSelectedIds([]);
    setHoverGroupId(null);
    setToast("Turn taken back · your turn continues");
    if (sfxOn) playTilePlace();
    if (haptics && "vibrate" in navigator) navigator.vibrate(14);
  };

  const handleDraw = () => {
    if (turnState !== "you" || winner) return;
    const base = { ...cloneTurnSnapshot(turnStart), rack: withRackOrder(turnStart.rack, rack) };
    const nextTile = base.pool[0];
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
    setConsecutivePasses(0);
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
    setConsecutivePasses(0);
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
      pool.length === 0 ? handlePass() : handleDraw();
      return;
    }
    handleEndTurn();
  };

  const toggleViewMode = () => {
    const next = viewMode === "locked" ? "free" : "locked";
    localStorage.setItem("tessera.viewMode", next);
    setViewMode(next);
  };

  const resetGame = () => {
    const nextDeal = createDeal();
    setDeal(nextDeal);
    setRack(nextDeal.rack);
    setBoard(cloneBoard(initialBoard));
    setPool(nextDeal.pool);
    setOpponentRacks(cloneOpponentRacks(nextDeal.opponents));
    setOpponentOpened({ Maya: false, Leo: false });
    setHasOpened(false);
    setTurnStart({ rack: [...nextDeal.rack], board: cloneBoard(initialBoard), pool: [...nextDeal.pool], hasOpened: false });
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
    setConsecutivePasses(0);
    setEndedByStalemate(false);
    setSelectedIds([]);
    setSettingsOpen(false);
    setRackSpace({ portrait: 2, landscape: 1 });
    setToast(null);
  };

  return (
    <motion.main
      className="screen game-screen"
      style={{ "--rack-rows": visibleRackRows } as CSSProperties}
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
        <div className={`rail-player ${turnState === "you" ? "rail-player--active" : ""}`}><Avatar initials={localPlayerInitial} tone="olive" active={turnState === "you"} /><span><strong>{localPlayerName}</strong><em>{rack.length} tiles</em></span></div>
        <div className={`rail-player ${turnState === "opponent" && activeOpponent === "Leo" ? "rail-player--active" : ""}`}><Avatar initials="L" tone="blue" active={turnState === "opponent" && activeOpponent === "Leo"} /><span><strong>Leo</strong><em>{opponentRacks.Leo.length} tiles</em></span></div>
        <div className={`rail-player ${turnState === "opponent" && activeOpponent === "Maya" ? "rail-player--active" : ""}`}><Avatar initials="M" tone="terra" active={turnState === "opponent" && activeOpponent === "Maya"} /><span><strong>Maya</strong><em>{opponentRacks.Maya.length} tiles</em></span></div>
      </section>

      <DndContext sensors={sensors} collisionDetection={tabletopCollision} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <BoardDropZone
          empty={boardIsEmpty}
          onTableTap={handleTableTap}
          camera={boardCamera}
          audioControls={
            <>
              <AudioToggle kind="music" on={musicOn} onChange={onMusicChange} />
              <AudioToggle kind="sfx" on={sfxOn} onChange={onSfxChange} />
            </>
          }
          onCameraChange={setBoardCamera}
          viewMode={viewMode}
          onToggleViewMode={toggleViewMode}
          onMeasure={setStageSize}
          world={visibleBoard.map((group) => {
            const position = layoutPositions[group.id] ?? { x: 50, y: 50 };
            return (
              <motion.div
                className="meld-position"
                key={group.id}
                initial={false}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
              >
                <DroppableGroup
                  group={group}
                  activeTile={activeTile}
                  activeTailIds={activeTailIds}
                  hot={hoverGroupId === group.id}
                  selectedTiles={selectedTiles}
                  onTap={handleGroupTap}
                  returnableTileIds={turnState === "you" ? returnableTileIds : new Set<string>()}
                  onReturnTile={(tileId, groupId) => returnTilesToRack([tileId], groupId)}
                />
              </motion.div>
            );
          })}
        >
          <div className="table-brand" aria-hidden="true">
            <BrandMark />
            {boardIsEmpty && <span className="table-brand__hint">Tap or drag tiles onto the felt</span>}
          </div>
          <button
            className="board-takeback-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); handleTakeBack(); }}
            disabled={history.length === 0 || turnState !== "you" || !!winner || !!activeTile}
            aria-label="Take back all changes this turn"
            title="Return this turn’s tiles and restore the table. Your turn and timer continue."
          >
            <UndoIcon /><span>Take back</span>
          </button>
          <AnimatePresence>{celebrating && <ConfettiBurst />}</AnimatePresence>
        </BoardDropZone>

        <RackDropZone
          className="rack-section"
          label={`Your tile rack. ${rack.length} tiles. Tap to select; hold to select tiles to the right.`}
        >
          <div className="rack-tools">
            <span>{selectedTiles.length ? `${selectedTiles.length} selected` : "Tap or hold to select"}</span>
            <button type="button" className="rack-clear" disabled={!selectedTiles.length || !!activeTile} onClick={() => setSelectedIds([])}>Clear</button>
            <button type="button" disabled={!!activeTile} aria-label="Sort rack by runs of the same colour" title="Sort by colour, then number" onClick={() => { setRack(sortRackByRuns); setToast("Rack sorted by colour, then number"); }}><b>789</b><span>Runs</span></button>
            <button type="button" disabled={!!activeTile} aria-label="Sort rack by equal numbers" title="Sort by number" onClick={() => { setRack(sortRackByGroups); setToast("Rack sorted by number"); }}><b>777</b><span>Groups</span></button>
          </div>
          <div className="rack-shell">
            <div
              className="rack-grid"
              style={{ "--rack-columns": rackColumns, "--rack-total-rows": Math.max(rackRows, visibleRackRows) } as CSSProperties}
            >
              <div className="rack-shelves" aria-hidden="true">
                {Array.from({ length: Math.max(rackRows, visibleRackRows) }, (_, row) => <div className="rack-shelf" key={row} />)}
              </div>
              <SortableContext items={rack.map((entry) => entry.id)} strategy={rectSortingStrategy}>
                {rack.map((entry) => (
                  <SortableTile
                    key={entry.id}
                    tile={entry}
                    selected={selectedIds.includes(entry.id)}
                    lifted={!!activeTile && selectedIds.includes(activeTile.id) && selectedIds.includes(entry.id)}
                    onExtend={(count) => {
                      const start = rack.findIndex((tile) => tile.id === entry.id);
                      setSelectedIds((current) => [...new Set([...current, ...rack.slice(start, start + count).map((tile) => tile.id)])]);
                    }}
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

        <DragOverlay dropAnimation={null} modifiers={[centerDragOnPointer]}>
          {activeTile ? (
            <div className="drag-stack" style={{ width: overlaySize.width, height: overlaySize.height, "--drag-number-size": `${overlaySize.height * 0.46}px` } as CSSProperties}>
              <TileFace tile={activeTile} floating />
              {activeDragCount > 1 ? (
                <span aria-label={`${activeDragCount} tiles`}>
                  {activeDragCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <section className="game-actions">
        <motion.button className="action-button action-button--outline" type="button" onClick={handleUndo} disabled={history.length === 0 || turnState !== "you" || !!winner || !!activeTile} whileTap={{ scale: 0.96 }}>
          <UndoIcon /> <span>Undo</span>
        </motion.button>
        <motion.button
          className={`action-button action-button--solid turn-action ${moveCount > 0 && !turnValidation.legal ? "action-button--blocked" : ""}`}
          type="button"
          onClick={handleTurnAction}
          disabled={turnState !== "you"}
          whileTap={{ scale: 0.96 }}
          aria-label={moveCount === 0
            ? (pool.length === 0 ? "Pass — the pool is empty." : `Draw one tile and end turn. ${pool.length} tiles remain in the pool.`)
            : turnValidation.legal ? "End turn" : "Fix the table before ending the turn"}
        >
          <span className="turn-action__label">{moveCount === 0 && pool.length === 0 ? "Pass" : "End turn"}</span>
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
              <span className="result-sheet__eyebrow">{endedByStalemate ? "Pool empty · no moves left" : "Round complete"}</span>
              <h2>{winner === "You" ? (endedByStalemate ? "Narrow victory." : "Beautifully played.") : `${winner} takes the table.`}</h2>
              <p>{endedByStalemate
                ? "Nobody could move — lowest rack total wins."
                : winner === "You" ? "You cleared all of your tiles." : `${winner} cleared their rack first.`}</p>
              <div className="scoreboard" aria-label="Final scores">
                {finalScores.map((entry) => {
                  const tone = entry.player === "You" ? "olive" : entry.player === "Leo" ? "blue" : "terra";
                  const initials = entry.player === "You" ? localPlayerInitial : entry.player[0];
                  return (
                    <div className={`score-row ${entry.player === winner ? "score-row--winner" : ""}`} key={entry.player}>
                      <Avatar initials={initials} tone={tone} active={entry.player === winner} />
                      <span><strong>{entry.player === "You" ? localPlayerName : entry.player}</strong><em>{entry.tiles} tile{entry.tiles === 1 ? "" : "s"} left</em></span>
                      <b>{entry.score > 0 ? "+" : ""}{entry.score}</b>
                    </div>
                  );
                })}
              </div>
              <button className="result-button" type="button" onClick={resetGame}>Play again <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6" /></svg></span></button>
              <button className="result-home" type="button" onClick={onBack}>Back to home</button>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.button className="sheet-scrim" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.section
              className="settings-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.65 }}
              onDragEnd={(_, info) => {
                // Swipe or drag the sheet down to dismiss — the handle invites it.
                if (info.offset.y > 90 || info.velocity.y > 550) setSettingsOpen(false);
              }}
            >
              <div className="sheet-handle" />
              <div className="settings-sheet__heading"><BrandMark compact /><div><span>Table settings</span><strong>Keep the game feeling good.</strong></div></div>
              <SettingRow label="Background music" description="Tavern tunes for lobby and table" value={musicOn} onChange={onMusicChange} />
              <SettingRow label="Sound effects" description="Ceramic clicks and the turn clock" value={sfxOn} onChange={onSfxChange} />
              <SettingRow label="Haptic taps" description="A light pulse when a tile lands" value={haptics} onChange={onHapticsChange} />
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
  viewMode,
  onToggleViewMode,
  audioControls,
  onMeasure,
}: {
  children: React.ReactNode;
  world: React.ReactNode;
  empty?: boolean;
  onTableTap: (position: TablePoint) => void;
  camera: BoardCamera;
  onCameraChange: (camera: BoardCamera) => void;
  viewMode: "locked" | "free";
  onToggleViewMode: () => void;
  audioControls: React.ReactNode;
  onMeasure: (size: { width: number; height: number }) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: "board-drop", data: { type: "board" } });
  const stageRef = useRef<HTMLElement | null>(null);
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
    if (viewMode === "locked") {
      const controls = [
        animate(cameraX, camera.x, { type: "spring", stiffness: 170, damping: 26 }),
        animate(cameraY, camera.y, { type: "spring", stiffness: 170, damping: 26 }),
        animate(cameraZoom, camera.zoom, { type: "spring", stiffness: 170, damping: 26 }),
      ];
      return () => controls.forEach((control) => control.stop());
    }
    cameraX.set(camera.x);
    cameraY.set(camera.y);
    cameraZoom.set(camera.zoom);
  }, [camera, viewMode, cameraX, cameraY, cameraZoom]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const report = () => onMeasure({ width: element.clientWidth, height: element.clientHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (viewMode === "locked") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (pointersRef.current.size === 0 && target.closest(".meld-position, button")) return;
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
    if (viewMode === "locked") return;
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
    if (viewMode === "locked") return;
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
      ref={(node) => { setNodeRef(node); stageRef.current = node; }}
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
        if (target.closest(".meld-position, button")) return;
        const worldElement = event.currentTarget.querySelector<HTMLElement>(".board-world");
        const rect = worldElement?.getBoundingClientRect();
        if (!rect) return;
        onTableTap(worldPoint({ x: event.clientX, y: event.clientY }, rect));
      }}
    >
      <div className="board-audio">{audioControls}</div>
      {children}
      <motion.div
        className="board-world"
        style={{ x: cameraX, y: cameraY, scale: cameraZoom }}
      >
        <div className="tile board-tile-measure" aria-hidden="true" />
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
      <button
        className="board-lock-button"
        type="button"
        aria-label={viewMode === "locked" ? "Enable table panning and zooming" : "Lock the camera without rearranging tiles"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onToggleViewMode(); }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          {viewMode === "locked"
            ? <path d="M6 9V6a4 4 0 1 1 8 0v3M5 9h10v7H5z" />
            : <path d="M6 9V6a4 4 0 0 1 7.6-1.6M5 9h10v7H5z" />}
        </svg>
        <span>{viewMode === "locked" ? "Pan off" : "Pan on"}</span>
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
  const [fadeTarget, setFadeTarget] = useState<Screen | null>(null);
  const [entered, setEntered] = useState(false);
  const [musicOn, setMusicOn] = useState(() =>
    (localStorage.getItem("tessera.music") ?? localStorage.getItem("tessera.sound") ?? "on") !== "off");
  const [sfxOn, setSfxOn] = useState(() =>
    (localStorage.getItem("tessera.sfx") ?? localStorage.getItem("tessera.sound") ?? "on") !== "off");
  const [haptics, setHaptics] = useState(() => localStorage.getItem("tessera.haptics") !== "off");

  useEffect(() => {
    localStorage.setItem("tessera.music", musicOn ? "on" : "off");
    localStorage.setItem("tessera.sfx", sfxOn ? "on" : "off");
    localStorage.setItem("tessera.haptics", haptics ? "on" : "off");
  }, [musicOn, sfxOn, haptics]);

  // Fade-to-black screen change: music starts crossfading the moment the
  // player taps, the screens swap under full black, then the table fades in.
  const changeScreen = (next: Screen) => {
    if (next === screen || fadeTarget !== null) return;
    setMusic(next === "home" ? "lobby" : "table", musicOn);
    setFadeTarget(next);
  };

  // Background music follows the screen; the pointerdown re-kick satisfies
  // autoplay policies (the first attempt before any gesture is blocked).
  useEffect(() => {
    const track = screen === "home" ? "lobby" as const : "table" as const;
    setMusic(track, musicOn);
    // Browsers only unlock audio from a completed gesture (click/keydown on
    // iOS Safari especially — pointerdown does NOT count), so retry there.
    const kick = () => setMusic(track, musicOn);
    window.addEventListener("click", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("click", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [screen, musicOn]);

  return (
    <div className="app-stage app-stage--physical">
      <div className="sun-disc" aria-hidden="true" />
      <div className="plate-motif" aria-hidden="true"><span /></div>
      <div className="phone-shell">
        <AnimatePresence mode="wait" initial={false}>
          {screen === "home"
            ? <HomeScreen key="home" onPlay={() => changeScreen("game")} musicOn={musicOn} sfxOn={sfxOn} onMusicChange={setMusicOn} onSfxChange={setSfxOn} />
            : <GameScreen key="game" onBack={() => changeScreen("home")} musicOn={musicOn} sfxOn={sfxOn} haptics={haptics} onMusicChange={setMusicOn} onSfxChange={setSfxOn} onHapticsChange={setHaptics} />}
        </AnimatePresence>
        <AnimatePresence>
          {fadeTarget && (
            <motion.div
              className="screen-fade"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.5, delay: 0.55, ease: "easeInOut" } }}
              transition={{ duration: 0.38, ease: "easeInOut" }}
              onAnimationComplete={(definition) => {
                if ((definition as { opacity?: number }).opacity === 1) {
                  setScreen(fadeTarget);
                  setFadeTarget(null);
                }
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {!entered && (
            <motion.button
              className="enter-splash"
              type="button"
              aria-label="Enter Tessera"
              initial={false}
              exit={{ opacity: 0, transition: { duration: 0.6, ease: "easeOut" } }}
              onClick={() => setEntered(true)}
            >
              <BrandMark />
              <span className="enter-splash__hint">Tap to begin</span>
            </motion.button>
          )}
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
function SettingsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.2 13.4a7.4 7.4 0 0 0 0-2.8l2-1.6-1.9-3.3-2.4.9a7.4 7.4 0 0 0-2.4-1.4L14.1 2h-4.2l-.4 2.5a7.4 7.4 0 0 0-2.4 1.4l-2.4-.9L2.8 8.3l2 1.6a7.4 7.4 0 0 0 0 2.8l-2 1.6 1.9 3.3 2.4-.9a7.4 7.4 0 0 0 2.4 1.4l.4 2.5h4.2l.4-2.5a7.4 7.4 0 0 0 2.4-1.4l2.4.9 1.9-3.3z" /></svg>; }
function UndoIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7-5 5 5 5M5 12h8a6 6 0 1 1 0 12" /></svg>; }

export default App;
