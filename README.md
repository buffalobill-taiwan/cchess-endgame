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

### 殘局遊戲棋譜產生器

`tools/game-analyze.mjs` 為其他專案的殘局遊戲產生 JSON 應手表。程式直接展開局面，不預先分析紅方是否必勝；即使初始局面是黑方必勝，也照常產譜。紅方是玩家，每個可達局面的所有合法走法都會納入，包括失誤、非將軍走法，以及敗勢中的抵抗。黑方是電腦，每個局面固定一個最優回應：能強制取勝就選最快取勝的一步，必敗則選最長抵抗；能保和時不選必敗走法。同等結果的應手只保留一個。

產譜的 `tools/game-solver.mjs` 會自動選擇兩種嚴格求解方式，與網頁的局面估分搜尋分開：

- **小型殘局：完整局面圖與反向推導。** 依棋子可到位置、被吃掉的情況及行棋方估計狀態數；保守上限不超過 50,000 時，由 `tools/game-retrograde.mjs` 建立所有可達局面及雙方合法走法。相同「棋盤＋行棋方」只建一次。從缺將帥或無合法走法的終局向前驅傳遞結果：有一步能贏就取最短距離；全部走法都輸才判必敗，取最長距離；完整傳遞後剩下的局面為和棋。結果整批快取，之後可直接查詢，也能把已求解局面當成新圖的已知邊界。此模式沒有深度截斷。
- **較大殘局：終局搜尋。** 保守狀態上限超過 50,000 時，保留 iterative-deepening alpha-beta，避免先枚舉龐大的黑方非最佳分支。只有真正終局才給勝負分，深度邊界是「未解」，不能當成和棋。殺步分數包含距離，換位表共用結果。後續吃子或兵前進使局面縮小時，可以自動改用局面圖。

50,000 是演算法分流門檻，不是截斷棋譜或把未解局面判和的上限。圖建置與反向推導必須完整完成才提交結果。黑方只有一個合法走法時可直接採用，否則必須證明選擇的最優性；不會因逾時或搜尋中斷而改選任意走法。最終棋譜只保留每個黑方局面的一個最佳應手，再展開玩家的全部合法選擇。

搜尋中的循環按可持續重複的和棋路線處理，不套用長將／長捉判負；只有搜尋已排除未解邊界，才可證明和棋。輸出保留循環的局面連結，不會為了避免重複而強迫黑方換招，也不會為了回到已知局面而放棄更好的應手。相同黑方待走局面只選一次，之後共用既有表項；相同紅方待走局面只展開一次。因此有限張表可表示無限重複的對局。

若搜尋模式的黑方選擇到達深度上限仍未證明，或任一模式整體逾時，工具以錯誤結束，不輸出部分 JSON。stderr 會提供未解 FEN、中斷階段（應手表展開／步數推導）、已開始／完整展開／待處理的局面數、黑方求解耗時、局面圖查詢／展開／已求解快取數、唯一合法應手與重用應手次數、當下路徑及主要分支。分支統計依首次發現路徑歸屬，僅涵蓋截至中斷的資料。stdout 維持空白，退出碼為 1；可加上 `2> analysis.log` 保存報告。

```bash
node tools/game-analyze.mjs \
  --name "題目名" \
  --fen "<完整 FEN>" \
  --depth 64 \
  --time-limit 60000 \
  --pretty
```

輸出包含 `meta.name`、沿應手表從初始局面取勝的最少紅方步數 `meta.step`、初始棋盤欄位 `meta.init`，以及紅方走完後的棋盤欄位到黑方應手後棋盤欄位的 `table`。應手表完成後，才由 `tools/game-steps.mjs` 從初始局面以廣度優先搜尋尋找可達的 `null` 表項；每個紅方走法計一步，黑方沿表中固定應手前進，重複局面只走訪一次。若沒有可達的紅方勝局，`meta.step` 為 `null`，仍輸出完整棋譜。紅方走後已終局的表項為 `null`；黑方走後若終局，仍記錄該棋盤，消費端應檢查終局並停止遊戲。

`--depth` 預設 64，單位是半回合（plies），只限制較大殘局的黑方應手搜尋，不限制局面圖求解、應手表的對局長度或最後的步數推導。`--time-limit` 預設 60000ms，涵蓋局面圖／搜尋求解、整張表建置與完成後的步數推導，沒有預留的初始分析階段。短殺題也不保證表小：玩家可以不走殺著，或在敗勢中選擇其他抵抗；這些可達局面仍須完整列舉。

例如 `4k4/9/9/4P4/9/9/9/9/9/4K4 w - - 0 1` 的完整圖有 1,959 個含行棋方的狀態；目前選定的黑方策略產出 969 筆應手，`meta.step` 為 2，即使 `--depth 1` 也能完成。

瀏覽器手動驗收建議：

- 從調色盤拖曳棋子到合法與非法位置，確認合法位置提示與棋子數量。
- 拖曳棋盤上的棋子移動、拖出棋盤移除，確認 FEN 同步更新。
- 匯入 `w` FEN 與 `b` FEN，確認工具只接受紅方 `w` 分析。
- 分析中按「中斷」，確認不顯示未完成變著樹，且控制項恢復可用。
- 點擊結果樹節點與「原始局面」，確認棋盤可正確還原。
- 在「我的範例」新增、載入、刪除資料，並測試 localStorage 不可用時的錯誤提示。
