# AGENTS.md

- Pure frontend HTML/CSS/JS project — no build tools, no package manager, no framework (no package.json, no bundler)
- Purpose: Chinese chess (象棋) endgame puzzle solver
- Project files: `index.html`, `style.css`, `script.js` (no build tools, no package.json, no bundler)
- `script.js` contains all logic: board rendering, drag-and-drop, Chinese chess rules engine, minimax/alpha-beta search, result tree display
- Search: iterative-deepening alpha-beta with check extensions; depth 12, 15s time limit at root, reduced depth for refutation branches
- Board uses incremental make/unmake (no board cloning during search) — global `redKingPos`/`blackKingPos` are updated via make/unmake
- Placement validation (`canPlaceAt`): king/advisor restricted to palace, elephant to 7 fixed positions on own side, soldier (pre-river) to row 5/6 (red) or 3/4 (black) on cols 0/2/4/6/8
- To verify: open `index.html` in a browser (no server needed)
- No lint/format/test commands exist yet
