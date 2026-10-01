# 中國象棋殘局求解器

純前端中國象棋（象棋）殘局求解器，使用 alpha-beta 剪枝搜尋引擎尋找紅方必勝著法。

![範例截圖](example.png)

## 功能

- 🏁 拖曳擺放棋子（從調色盤拖到棋盤，或棋盤上拖曳調整位置，拖出棋盤外移除）
- 🔍 點擊「分析」自動搜尋紅方必勝著法
- 🌲 展開變著樹，每個黑方應著只顯示唯一紅方必勝路徑
- 📋 FEN 編碼匯入匯出，內建「系統精選」範例局面，並可於「我的範例」自訂儲存（localStorage）
- ⚙️ 可調整搜尋深度（1–12 步，紅方步數；×2 為搜尋半回合數），分析中可中斷
- 📱 純前端，無需後端伺服器

## 使用方式

直接用瀏覽器開啟 `index.html`，或存取 GitHub Pages：

**https://buffalobill-taiwan.github.io/cchess-endgame/**

## 技術架構

- 純 HTML/CSS/JavaScript，無框架、無建置工具
- UI 入口、分析控制、範例 modal、範例儲存分層，核心分析維持 DOM-free
- 棋盤使用 SVG 繪製
- 完整的象棋規則引擎（所有七種棋子、王見王、困斃）
- Iterative-deepening alpha-beta 搜尋（可調深度，15 秒時間限制）
- Incremental make/unmake moves（由搜尋 context 管理的可回復棋盤，不依賴全域引擎棋盤）
- 搜尋與變著樹共用同一個總 deadline；中斷或逾時只提交完整的 iterative-deepening 深度
- 逾時的 refutation 不會被加入結果樹；分析中斷時不顯示部分變著樹
- 疊代加深 refutation 搜尋：從 depth 2 開始逐步加深，找到殺棋即停
- 變著樹利用 refutation PV 建構深層子樹，非必勝分枝自動跳過

## 終端機／其他前端引用

共用入口為 `js/engine.js`（ES module；Node 22+），不會載入 DOM、localStorage 或網頁的全域 `state`。可直接引用本專案路徑，無需建置或安裝套件：

```js
import { parseFen, analyzePosition, generateLegalMoves, applyBoardCopy,
  boardToFen } from './cchess-endgame/js/engine.js';

const { board, sideToMove } = parseFen(fen);
if (sideToMove !== 'w') throw new Error('分析固定由紅方開始');
const result = await analyzePosition(board, {
  depth: 12, // 半回合（plies），相當於網頁滑桿 6 步
  timeLimit: 15000, // 毫秒，包含搜尋與變著樹建構
  continuousCheck: false,
  isCancelled: () => false, // 終端機可接自己的取消旗標
});
console.log(result);

const moves = generateLegalMoves(board, 'red');
if (moves.length) console.log(boardToFen(applyBoardCopy(board, moves[0]), 'b'));
```

棋盤是 10 × 9 的陣列，`board[row][col]` 為 `null` 或 `{ type, color }`；row 0 是黑方底線，row 9 是紅方底線。`color` 為 `red`／`black`，棋種為 `king`、`advisor`、`elephant`、`horse`、`chariot`、`cannon`、`soldier`。走法為 `{ from: { row, col }, to: { row, col } }`。

`parseFen` 回傳 `{ board, sideToMove }`，sideToMove 為 `w`／`b`；規則與走法生成支援雙方，但 `analyzePosition` 與 `searchRootAsync` 固定搜尋紅方。FEN 解析預設允許缺將帥，可用 `{ allowMissingKings: false }` 嚴格檢查。

`analyzePosition` 不修改輸入棋盤，回傳 `{ status, tree, score, interrupted }`。status 為 `ok`、`noKing`、`redMated` 或 `redStalemated`；中斷／逾時時 tree 為 null。樹節點提供 move、notation、color、isMate、isStalemate、children 與 board，顯示方式由呼叫端決定。`applyBoardCopy` 回傳新棋盤；低階 `makeMove`／`unmakeMove` 會原地修改棋盤，呼叫端需自行配對還原。

分層邊界：

- 核心：`engine.js`、`constants.js`、`geometry.js`、`board.js`、`rules.js`、`notation.js`、`zobrist.js`、`search.js`、`tree.js`、`analyze.js`。`canPlaceAt` 是共用擺棋限制，實際對弈請使用 `generateLegalMoves`。
- 瀏覽器介面：`app.js`、`ui.js`、`ui-constants.js`、`state.js`、`example-modal.js`、`example-store.js`。管理畫面、拖曳、網頁工作階段與範例儲存；核心不引用這些模組。

每個呼叫端自行持有棋盤與取消旗標，不需初始化網頁狀態。測試會遞迴檢查核心依賴，防止重新引入瀏覽器模組。

## 測試

使用 `node --test` 執行 `test/` 下的規則、FEN、hash 與搜尋測試；使用 `node bench.mjs <fen> [depth] [timeLimitMs]` 進行 headless benchmark。

### 連將殺題目產生器

`tools/game-analyze.mjs` 會把完整 FEN 分析成可供其他專案使用的連將殺題目表。紅方所有合法走法都會納入，黑方則只保留最佳應手；若無法證明所有分枝最後為紅勝或黑勝，工具會以錯誤結束而不輸出部分 JSON。

```bash
node tools/game-analyze.mjs \
  --name "題目名" \
  --fen "<完整 FEN>" \
  --depth 64 \
  --time-limit 15000 \
  --pretty
```

輸出包含 `meta.name`、最短紅勝步數 `meta.step`、初始棋盤欄位 `meta.init`，以及紅方棋盤欄位到黑方最佳回應棋盤欄位的 `table`。

瀏覽器手動驗收建議：

- 從調色盤拖曳棋子到合法與非法位置，確認合法位置提示與棋子數量。
- 拖曳棋盤上的棋子移動、拖出棋盤移除，確認 FEN 同步更新。
- 匯入 `w` FEN 與 `b` FEN，確認工具只接受紅方 `w` 分析。
- 分析中按「中斷」，確認不顯示未完成變著樹，且控制項恢復可用。
- 點擊結果樹節點與「原始局面」，確認棋盤可正確還原。
- 在「我的範例」新增、載入、刪除資料，並測試 localStorage 不可用時的錯誤提示。
