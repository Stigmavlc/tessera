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
- Larger virtual tabletop with one-finger/mouse-drag camera panning, pinch/wheel zoom, and Fit recovery
- Multi-select rack tiles and place or drag the batch as one move
- Split a table meld by dragging a tile onto empty felt, then recombine it by dropping onto another tile or meld
- Permissive table drafting while arranging, with strict legality enforced when the turn is committed
- Return any rack tile played this turn using its table remove control or by dragging it back
- Numeric draft ordering and tile-level drop targets for table repositioning
- Reorderable two-row rack that keeps every held tile visible without scrolling
- Fresh empty-board start with 14 tiles per player and 64 in the pool
- Strict run, group, joker, 30-point opening-meld, and table-conservation rules
- One consistently labelled End Turn action: draw one and pass when idle, or submit a legal play
- Undo, legal table rearrangement, and incomplete-draft recovery
- One-minute timer that auto-submits legal play, draws one when idle, or penalizes an illegal draft
- Legal local turns and separate 30-point openings for Leo and Maya
- Non-blocking opponent turns that leave the entire table visible
- One quiet inline game-status line instead of bottom-screen notification overlays
- High-contrast tile colours reinforced with distinct geometric markers
- Rack-empty victory, final scoring, and instant replay
- Sound/haptics settings sheet and table reset
- Responsive mobile layout with a framed desktop presentation and island-safe header spacing
- Reduced-motion support

## Verification

```bash
npm test
npm run build
```
