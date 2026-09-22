# Tile interaction regression checks

Run `npm test` and `npm run build` first. Start the local preview with `npm run dev`.

## Touch and mouse

- Also check black 7–8–9: removing 7 must leave an editable 8–9 draft. Join the extracted sevens, then add black 10 to repair the pair before committing.
- Drag the first 7 from a black 7–8–9–10 run onto empty felt: only 7 moves. Repeat with a yellow 7 and join with a blue rack 7. The remaining 8–9–10 runs stay intact. Undo and Take back restore all tiles and positions.
- Hold a board tile for 850 ms, then drag: only that tile moves. Repeat with immediate dragging and keyboard pickup. No group-selection badge should appear. Rack hold-to-select still works.
- Place tens separately; drag one near another to build a pair, then select the third and tap nearby. The pair remains an illegal draft; the trio is legal for a 30-point opening. A distinct group below stays separate.

- Tap tiles quickly: each tap toggles its selection once. Clear removes the selection.
- Hold a rack tile still: after 300 ms it selects, then selection extends right every 180 ms. Release without dragging: selection remains. Moving more than 4 px starts dragging and stops extending the selection.
- Hold until three tiles are selected, then drag without lifting your finger. All three should move together. Cancel, release outside the table/rack, or switch away from the browser: selection must stop growing.
- Drop a trio onto empty felt below an existing trio. It stays separate at the pointer position. Dropping outside the table must not target the closest group.
- With blue 5–8 on the table and blue 4 selected, the left insertion preview appears. Drag within 30–40 px of the other end: it still joins at the legal end. Select blue 9 and tap the right preview: it appends. Check both mouse and touch, batch extensions, jokers, zoom, and keyboard activation. Before opening, previews must only appear on your own opening drafts.
- The drag preview shrinks over the board, stays centred under the pointer, and matches regular or compressed target tiles.
- Drop an incompatible rack or board tile onto a complete or incomplete meld: both source and destination remain unchanged. In particular reject two black 4s, blue 1+3, and 1+2+4. Reject incompatible rack batches on empty felt too. Adjacent pairs and 1+2+3 still work. Place it on empty felt to start a separate draft. Valid extensions and duplicate-run splits still work.
- Move board tiles onto empty felt, deliberately extend other melds, return this turn’s tiles, and Undo. End Turn still enforces opening points, legal melds, and table conservation.
- Use Take back after playing several tiles and splitting an existing table group. All groups and positions must return to the turn’s starting state, with this turn’s rack tiles returned. The current rack sorting stays; no tile is drawn and the clock continues. Selection and Undo history clear. Take back is disabled before any table changes and during opponents’ turns.
- After taking back, start another draft or End Turn to draw exactly one tile. Check that the embossed logo does not intercept taps or drops and that there are no white dots or corner guides.

## Turn and opponent feedback

- Your turn has a dark navy banner and header, uppercase YOUR TURN with a gold marker, and an outlined rack; both timers agree. Opponent turns use a quieter band naming the active player and current action.
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
- Toggle Auto fit / Free pan: group positions stay unchanged. Free pan permits manual exploration; returning to Auto fit brings all tiles back into view. Buttons must not pan the table or place a selection accidentally.
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

Latest pro-feedback follow-up: 67 tests and production build passed. Deterministic touch browser checks reproduced individual-tile extraction, two-stage pair/trio building by drag and tap, valid remaining runs, deliberate hold-to-carry, and Take back. Brighter yellow/red/blue and black were visually inspected.

## 2026-09-09 follow-up

- With 52 tiles in play, Fit must show every tile inside the playable surface, with groups kept separate even on short screens. Camera, sound and Take back controls must remain in their own strip outside the clipped table, without overlapping each other at 390×844, 320×568, 844×390 and 667×375.
- Drop a rack tile onto the control strip: it must stay in the rack. Fit and Pan still work, and Take back must restore the board after rearrangements.
- 71 unit tests and production build passed. Browser checks covered delayed single pickup, duplicate and gap rejection from rack/board, incompatible rack batches, valid incremental runs, Take back, and the crowded-table strip.

## 2026-09-22 tester follow-up

- Do not press Fit: all 52 tiles must stay within the felt at 390×844, 320×568, 844×390 and 667×375. Place another run near an edge and check all 55 tiles remain visible. Buttons stay outside the felt and do not overlap.
- New unpositioned groups use the screen’s width. The virtual world follows the stage’s aspect ratio, so short screens do not force a tall column of groups. Explicit placements still stay near the requested point.
- Remove blue 4 from 1–7: get separate 1–3 and 5–7 runs, whether the 4 goes onto empty felt, onto a set of fours, or onto its end target. Check conservation, Undo and Take back. Return this turn’s blue 6 from 4–8 to the rack: get separate 4–5 and 7–8 drafts that cannot be committed yet.
- Automatic framing waits until a player’s drag finishes. Opponent pickups remain face-down and land at the current target; resetting during flight cancels the sequence.
- Verified: 82 unit tests and production build; touch extraction, rack return, explicit end joins, recovery, automatic framing after additions and resizing, Free pan recovery, opponent flight and reset. The compact portrait layout adds 57px of felt without shrinking rack rows.
