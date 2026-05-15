# 中國象棋殘局求解器

純前端中國象棋（象棋）殘局求解器，使用 alpha-beta 剪枝搜尋引擎尋找必勝著法。

## 功能

- 🏁 拖曳擺放棋子（從調色盤拖到棋盤，或棋盤上拖曳調整位置，拖出棋盤外移除）
- 🔍 點擊「分析」自動搜尋紅方必勝著法
- 🌲 展開變著樹顯示所有分支
- 📋 FEN 編碼匯入匯出
- ⚙️ 可調整搜尋深度（1–20 層），分析中可中斷
- 📱 純前端，無需後端伺服器

## 使用方式

直接用瀏覽器開啟 `index.html`，或存取 GitHub Pages：

**https://buffalobill-taiwan.github.io/cchess-endgame/**

## 技術架構

- 純 HTML/CSS/JavaScript，無框架、無建置工具
- 棋盤使用 SVG 繪製
- 完整的象棋規則引擎（所有七種棋子、王見王、困斃）
- Iterative-deepening alpha-beta 搜尋（可調深度，15 秒時間限制）
- Incremental make/unmake moves（全域棋盤狀態，無拷貝）
