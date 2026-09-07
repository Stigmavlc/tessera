# Tile interaction regression checks

Run `npm test` and `npm run build` first. Start the local preview with `npm run dev`.

## Touch and mouse

- Tap tiles quickly: each tap toggles its selection once. Clear removes the selection.
- Hold a rack tile still: after 300 ms it selects, then selection extends right every 180 ms. Release without dragging: selection remains. Moving more than 4 px starts dragging and stops extending the selection.
- Hold until three tiles are selected, then drag without lifting your finger. All three should move together. Cancel, release outside the table/rack, or switch away from the browser: selection must stop growing.
- Drop a trio onto empty felt below an existing trio. It stays separate at the pointer position. Dropping outside the table must not target the closest group.
- With blue 5–8 on the table and blue 4 selected, the left insertion preview appears. Drag within 30–40 px of the other end: it still joins at the legal end. Select blue 9 and tap the right preview: it appends. Check both mouse and touch, batch extensions, jokers, zoom, and keyboard activation. Before opening, previews must only appear on your own opening drafts.
- The drag preview shrinks over the board, stays centred under the pointer, and matches regular or compressed target tiles.
- Drop an incompatible rack tile directly onto a complete meld: the rack and meld remain unchanged. Place it on empty felt to start a separate draft. Valid extensions and duplicate-run splits still work.
- Move board tiles onto empty felt, deliberately extend other melds, return this turn’s tiles, and Undo. End Turn still enforces opening points, legal melds, and table conservation.
- Use Take back after playing several tiles and splitting an existing table group. All groups and positions must return to the turn’s starting state, with this turn’s rack tiles returned. The current rack sorting stays; no tile is drawn and the clock continues. Selection and Undo history clear. Take back is disabled before any table changes and during opponents’ turns.
- After taking back, start another draft or End Turn to draw exactly one tile. Check that the embossed logo does not intercept taps or drops and that there are no white dots or corner guides.

## Turn and opponent feedback

- Your turn has a blue banner beside the rack and a matching header; both timers agree. Opponent turns use a quieter band naming the active player and current action.
- Opponents visibly pick up and drag one face-down tile at a time from their seat to the actual board destination; rack counts decrease as tiles land. During pickup and travel, neither the floating tile nor its blank destination may render a number or colour marker. The face appears only after landing. New additions remain highlighted through your next turn. Draws show only the tile back.
- Sort repeatedly during opponents: their sequence must not restart. Your full minute starts only after Maya’s last placement and summary settle.
- With reduced motion enabled, preserve staged placement and highlights without flying tiles.
- Reset the table or leave the game during a placement/draw: pending animation waits must cancel, with no delayed mutation of the new game.

## Rack arrangement

- `789` sorts by colour then number; `777` sorts by number then colour. Both keep duplicate tiles and put jokers last.
- Sort and manually drag single tiles or selected batches during an opponent’s turn. Opponents continue normally; board placement still waits for your turn.
- Sort, then draw or let an idle turn expire. The existing rack order stays, with the drawn tile appended.
- With 24 tiles, use three readable portrait rows. Playing tiles must not shrink the rack area and move the board beneath the drop. Unusually large hands can scroll inside the rack.

## Viewports and keyboard

- Check 390×844 and 375×667 portrait, then rotate to 844×390 and 667×375 landscape. Keep the table, rack tools, players and turn actions visible. Recheck on a real phone with browser bars and safe-area insets.
- Toggle Pan on/off: group positions stay unchanged. Pan, pinch, and Fit continue to work. Buttons must not pan the table or place a selection accidentally.
- Tab to a rack tile, press Space to pick it up, use arrows to move, then Space to drop or Escape to cancel. Check visible keyboard focus on sorting and camera controls.

## Verified in the 2026-09-07 session

- The local interaction follow-up passed 64 automated tests and the production build. The blue-4 reproduction, explicit right insertion, separate group below, incremental AI placement, persistent highlights, sorting during animations, and timer handoff passed in browser automation.
- Reduced-motion sequencing, face-down drawing, reset during an opponent animation, and emulated-touch approach drops also passed. The pickup/drag follow-up additionally checked actual on-screen travel, absence of numbered faces throughout flight, reveal on landing, and reset during a drag.
- The earlier published rack release passed 57 automated tests and the production build.
- Browser automation used a deterministic 24-tile deal and actual emulated touch events for hold-and-drag, precise placement, preview sizing, and off-table cancellation.
- Sorting and manual reordering worked during opponents without delaying AI. Keyboard adjacent-slot reorder, Escape, touch cancellation, and preserving order after drawing also passed.
- Take back restored both empty and occupied starting tables, repaired rearrangements, preserved held-tile sorting and the timer, drew no tiles, and cleared selection/history.
- Portrait, landscape, and desktop layouts were checked. Physical-device feel, browser bars, and safe-area behaviour remain manual checks.
- After deployment of `1a2f812`, the original live Mara link was browser-checked for the default terracotta finish, two shelf rows, 14 starting tiles, and the personalised name.

## Appearance and release checks

- Open the ordinary URL without `tiles=realistic`: realistic ivory tiles, terracotta row ledges, and the embossed table mark must be present by default. The old preview query parameter is no longer necessary.
- Check selected-tile highlights, pip visibility above each ledge, large-rack scrolling, and drag/drop over the non-interactive shelves.
- After pushing an app update, verify that the Pages workflow succeeded for the exact pushed commit, then open the original personalised link in a fresh browser. An already-open game may need refreshing.

Local `.playwright-mcp/` scripts/screenshots are ignored diagnostic artifacts; the scenarios in this document are the durable checklist.
