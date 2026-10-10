# 工具使用說明

本文件說明兩個產生殘局應手表的命令列工具。兩者都從紅方行棋的 FEN 建立 JSON 棋譜，格式為 `{ meta: { name, step, init }, table }`；`meta.step` 是沿輸出應手表取勝所需的最少紅方步數，若沒有可達的紅方勝局則為 `null`。

## `tools/game-analyze.mjs`

這是一般殘局產譜工具。它會展開紅方可走的局面，為每個紅方走後的局面選出黑方應手。紅方走後已終局的局面以 `null` 表示；黑方走後的局面以棋盤欄位作為應手表的值。工具可以輸出 `meta.step: null` 的完整棋譜，消費端仍可使用應手表進行遊戲。

```bash
node tools/game-analyze.mjs \
  --name "題目名" \
  --fen "<完整 FEN>" \
  --depth 64 \
  --time-limit 60000 \
  > game.json
```

參數：

- `--name <名稱>`、`--fen <FEN>`：題目名稱與紅方行棋的初始局面。
- `--depth <plies>`：搜尋深度，預設 64 半回合。已完成證明、局面圖求解與步數推導不受此深度限制。
- `--time-limit <毫秒>`：本次執行的時間預算，預設 60,000 毫秒。續算時會重新取得完整預算。
- `--graph-nodes <數量>`、`--graph-edges <數量>`：局面圖節點與邊上限，預設分別為 50,000 與 400,000。
- `--pretty`：縮排 JSON。
- `--fresh`：忽略既有自動快照，重新計算。
- `--no-checkpoint`：不讀取或保存快照。
- `--checkpoint <路徑>`：從頭計算並保存至指定快照。
- `--resume <路徑>`：讀取指定快照續算，預設寫回同一路徑。

### 自動保存與續算

預設快照存於系統暫存目錄，通常是 `/tmp/checkpoint-{hash}.json`；hash 由標準化棋盤 FEN 與紅方行棋方計算。重跑相同局面的原指令即可自動續算。`TMPDIR` 可改變暫存目錄。

指定快照的例子：

```bash
node tools/game-analyze.mjs \
  --name "題目名" --fen "<完整 FEN>" \
  --checkpoint work.json --time-limit 60000 > game.json

node tools/game-analyze.mjs \
  --resume work.json --time-limit 120000 > game.json
```

續算會沿用快照中的題目與搜尋設定；可提高深度、圖節點數及邊數，不能降低。遇到時間、搜尋深度或圖上限仍未證明的分支時，工具會以錯誤結束並在 stderr 報告未解局面，不會把未完成結果寫成棋譜。stdout 僅在完整棋譜完成後輸出 JSON，建議像範例一樣重導向至檔案。

## `tools/endgame-analyze.mjs`

這是連將殺專用產譜工具，輸入和輸出格式與 `game-analyze.mjs` 相同。它依序建立紅方連續叫將局面圖、固定黑方最佳應手，再檢查紅方偏離叫將後黑方能否強制連將反殺。黑方策略會優先止住紅方連將；不能止將時再避開紅方可利用的循環；若仍必敗則選擇延長敗局的路線。

```bash
node tools/endgame-analyze.mjs \
  --name "連將殺" \
  --fen "3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1" \
  --time-limit 60000 \
  > game.json
```

第一階段只展開紅方叫將走法，黑方回應先全部納入，再以可證明的結果界限刪除不可能成為黑方最佳策略的分支。第二階段保留所有紅方叫將選擇並固定黑方策略。第三階段補入紅方不叫將的走法，要求黑方能對紅方所有抵抗強制連將取勝；黑方每步都必須將軍，循環不算取勝。若題目不符合連將殺條件，工具會報告問題局面 FEN、到達路線及可用的抵抗見證，不輸出部分棋譜。

參數：

- `--name <名稱>`、`--fen <FEN>`：新分析的題目名稱與初始局面。
- `--time-limit <毫秒>`：單次執行時間，預設 60,000 毫秒。
- `--graph-nodes <數量>`、`--graph-edges <數量>`：每張工作圖的上限，預設分別為 16,777,216 個局面與 134,217,728 條邊。
- `--depth <數字>`：為相容而保留，不限制此工具的完整圖展開。
- `--pretty`：縮排 JSON。
- `--checkpoint <路徑>`：從頭分析並將 SQLite 工作資料庫存至指定位置。
- `--resume <路徑>`：從指定 SQLite 工作資料庫續算。可提高上限；若搭配另一個 `--checkpoint` 路徑，目的檔必須不存在，工具會建立副本。
- `--fresh`：清除資料庫內的進度後重新分析。
- `--no-checkpoint`：改用臨時 SQLite 工作資料庫，結束後刪除。

預設會依局面 hash 在系統暫存目錄自動保存 SQLite 工作資料庫，通常是 `/tmp/checkpoint-endgame-{hash}.sqlite`；重跑相同 FEN 即可續算。SQLite 需要 Node.js 22.13 或更新版本。資料庫使用期間不要刪除旁邊的 `-wal`、`-shm` 檔案，也不要讓兩個產譜程序同時使用同一資料庫。

每張工作圖最多允許 16,777,216 個局面是可設定的上限，不代表每題都能在上限內完成；磁碟空間、I/O 與執行時間也會影響可處理規模。若超過時間或節點／邊上限，工具會回報「分析未完成」並保留 checkpoint，之後可提高預算續算。`--depth` 不會縮小局面圖。

## 輸出與錯誤處理

兩個工具都把機器可讀的棋譜寫到 stdout，分析進度及失敗診斷寫到 stderr。可分別導向棋譜與日誌：

```bash
node tools/endgame-analyze.mjs --name "連將殺" --fen "<完整 FEN>" \
  > game.json 2> analysis.log
```

只有完整棋譜會寫入 stdout。分析逾時、資源上限或未解分支不會產生部分 JSON；保留 checkpoint 後可續算。要執行專案測試，使用 `node --test`。
