# Tile interaction regression checks

Run `npm test` and `npm run build` first. Start the local preview with `npm run dev`.

## Touch and mouse

- Tap tiles quickly: each tap toggles its selection once. Clear removes the selection.
- Hold a rack tile still: after 300 ms it selects, then selection extends right every 180 ms. Release without dragging: selection remains. Moving more than 4 px starts dragging and stops extending the selection.
- Hold until three tiles are selected, then drag without lifting your finger. All three should move together. Cancel, release outside the table/rack, or switch away from the browser: selection must stop growing.
- Drop a trio onto empty felt below an existing trio. It stays separate at the pointer position. Dropping outside the table must not target the closest group.
- The drag preview shrinks over the board, stays centred under the pointer, and matches regular or compressed target tiles.
- Drop an incompatible rack tile directly onto a complete meld: the rack and meld remain unchanged. Place it on empty felt to start a separate draft. Valid extensions and duplicate-run splits still work.
- Move board tiles onto empty felt, deliberately extend other melds, return this turn’s tiles, and Undo. End Turn still enforces opening points, legal melds, and table conservation.

## Rack arrangement

- `789` sorts by colour then number; `777` sorts by number then colour. Both keep duplicate tiles and put jokers last.
- Sort and manually drag single tiles or selected batches during an opponent’s turn. Opponents continue normally; board placement still waits for your turn.
- Sort, then draw or let an idle turn expire. The existing rack order stays, with the drawn tile appended.
- With 24 tiles, use three readable portrait rows. Playing tiles must not shrink the rack area and move the board beneath the drop. Unusually large hands can scroll inside the rack.

## Viewports and keyboard

- Check 390×844 and 375×667 portrait, then rotate to 844×390 and 667×375 landscape. Keep the table, rack tools, players and turn actions visible. Recheck on a real phone with browser bars and safe-area insets.
- Toggle Pan on/off: group positions stay unchanged. Pan, pinch, and Fit continue to work. Buttons must not pan the table or place a selection accidentally.
- Tab to a rack tile, press Space to pick it up, use arrows to move, then Space to drop or Escape to cancel. Check visible keyboard focus on sorting and camera controls.

Browser automation during this change exercised a deterministic 24-tile deal, actual emulated touch events for the hold-and-drag gesture, pointer placement and preview geometry, sorting during opponents, and both landscape sizes. Physical-device feel remains a manual check.
