# Tessera

A mobile-first, frontend-only tile-rummy prototype focused on visual direction, touch play, and motion. No database or network layer is included yet.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Included interactions

- Animated lobby with one primary Play now action and an always-visible bottom navigation
- Free-positioned felt canvas: tap or drop selected tiles anywhere to create a meld
- Collision-aware meld placement that keeps player and AI groups from visually overlapping
- Larger virtual tabletop; switch to the free camera for one-finger/mouse-drag panning, pinch/wheel zoom, and Fit recovery
- Multi-select rack tiles and place or drag the batch as one move
- Drop a duplicate tile mid-run to split it into two melds, exactly like the boxed rules
- Drag a run's tail (a tile plus everything right of it) as one stack; sets and invalid drafts still drag one tile at a time
- Split a table meld by dragging a tile onto empty felt, then recombine it by dropping onto another tile or meld
- Permissive table drafting while arranging, with strict legality enforced when the turn is committed
- Return any rack tile played this turn using its table remove control or by dragging it back
- Numeric draft ordering and tile-level drop targets for table repositioning
- Reorderable two-row rack that keeps every held tile visible without scrolling, with one-tap 777 / 789 sorting
- Fresh random deal every game — 14 tiles per player, 64 in the pool
- Strict run, group, joker, 30-point opening-meld, and table-conservation rules
- One consistently labelled End Turn action: draw one and pass when idle, or submit a legal play
- Undo, legal table rearrangement, and incomplete-draft recovery
- One-minute timer that auto-submits legal play, restores the table and draws one on an unfinished draft, or draws one when idle
- Pool-empty endgame: End Turn becomes Pass, three consecutive passes end the round by stalemate, and the lowest rack total wins on differential scoring
- Legal local turns and separate 30-point openings for Leo and Maya
- Non-blocking opponent turns that leave the entire table visible
- One quiet inline game-status line instead of bottom-screen notification overlays
- High-contrast tile colours reinforced with distinct geometric markers
- Rack-empty victory, final scoring, and instant replay
- Locked auto-arranging table view by default, with a free pan/pinch/zoom camera one tap away and the choice remembered between visits
- Sound/haptics settings sheet and table reset
- Responsive mobile layout with a framed desktop presentation and island-safe header spacing
- Reduced-motion support

## Verification

```bash
npm test
npm run build
```
