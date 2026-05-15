# AGENTS.md

- Pure frontend HTML/CSS/JS — no build tools, package manager, or framework
- Chinese chess (象棋) endgame puzzle solver; engine only analyzes for RED (red is always the searching side)
- All logic in `script.js`: SVG board rendering, drag-and-drop, rules engine, alpha-beta search, result tree
- Open `index.html` in a browser to test; also at https://buffalobill-taiwan.github.io/cchess-endgame/
- Search: iterative-deepening alpha-beta with check extensions; depth 12 (configurable 1–20), 15s root time limit, reduced depth for refutation branches
- Global `redKingPos`/`blackKingPos` updated via make/unmake (no board cloning during search)
- FEN import/export via the text input field (click field to select, "匯入" button to import)
- Placement (`canPlaceAt`): king/advisor→palace, elephant→7 fixed own-side positions, soldier (pre-river)→row 5/6 (red) or 3/4 (black), col 0/2/4/6/8
- Click a result tree node to restore board to that position; drag a piece off the board (to palette area) to remove it
- No lint/format/test commands exist
