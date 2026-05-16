const ROWS = 10, COLS = 9, CELL = 54, PAD = 30;
const W = PAD * 2 + (COLS - 1) * CELL;
const H = PAD * 2 + (ROWS - 1) * CELL;

const CHARS = {
  red:   { king:'帥', advisor:'仕', elephant:'相', horse:'傌', chariot:'俥', cannon:'炮', soldier:'兵' },
  black: { king:'將', advisor:'士', elephant:'象', horse:'馬', chariot:'車', cannon:'砲', soldier:'卒' },
};

const PIECE_VALUES = { king:10000, chariot:900, cannon:450, horse:400, elephant:200, advisor:200, soldier:100 };
const MATE_VAL = 100000, INF = 999999;
const TYPES = ['chariot','horse','cannon','advisor','elephant','soldier','king'];

let board = [];
let redKingPos = null, blackKingPos = null;
let pieceCount = 0;
let isAnalyzing = false;
let interruptRequested = false;
let _dragDropProcessed = false;

function initBoard() {
  board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  redKingPos = null;
  blackKingPos = null;
  pieceCount = 0;
}
initBoard();

// ─── helpers ───
function opp(c) { return c === 'red' ? 'black' : 'red'; }
function movesEqual(a, b) { return a.from.row===b.from.row && a.from.col===b.from.col && a.to.row===b.to.row && a.to.col===b.to.col; }
function inPalace(row, col, color) {
  if (col < 3 || col > 5) return false;
  return color === 'red' ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
}
function onOwnSide(row, color) { return color === 'red' ? row >= 5 : row <= 4; }

// ─── SVG Board Lines ───
function drawBoardSVG() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const ln = (x1,y1,x2,y2) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1);
    l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke','#5c3a1e'); l.setAttribute('stroke-width','1');
    svg.appendChild(l);
  };

  for (let r = 0; r < ROWS; r++) ln(PAD, PAD+r*CELL, PAD+8*CELL, PAD+r*CELL);

  ln(PAD, PAD, PAD, PAD+9*CELL);
  ln(PAD+8*CELL, PAD, PAD+8*CELL, PAD+9*CELL);
  for (let c = 1; c <= 7; c++) {
    ln(PAD+c*CELL, PAD, PAD+c*CELL, PAD+4*CELL);
    ln(PAD+c*CELL, PAD+5*CELL, PAD+c*CELL, PAD+9*CELL);
  }

  ln(PAD+3*CELL, PAD, PAD+5*CELL, PAD+2*CELL);
  ln(PAD+5*CELL, PAD, PAD+3*CELL, PAD+2*CELL);
  ln(PAD+3*CELL, PAD+7*CELL, PAD+5*CELL, PAD+9*CELL);
  ln(PAD+5*CELL, PAD+7*CELL, PAD+3*CELL, PAD+9*CELL);

  const tx = (x,y,t) => {
    const te = document.createElementNS(ns,'text');
    te.setAttribute('x',x); te.setAttribute('y',y);
    te.setAttribute('fill','#5c3a1e'); te.setAttribute('font-size','18');
    te.setAttribute('font-family','serif'); te.setAttribute('text-anchor','middle');
    te.textContent = t;
    svg.appendChild(te);
  };
  tx(PAD+1.5*CELL, PAD+4.5*CELL+6, '楚河');
  tx(PAD+6.5*CELL, PAD+4.5*CELL+6, '漢界');
  return svg;
}

// ─── UI Render ───
function xpos(c) { return PAD + c * CELL; }
function ypos(r) { return PAD + r * CELL; }

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  boardEl.appendChild(drawBoardSVG());

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'intersection';
      el.dataset.row = r;
      el.dataset.col = c;
      el.style.left = xpos(c) + 'px';
      el.style.top = ypos(r) + 'px';
      boardEl.appendChild(el);
    }
  }

  const topLabel = '１２３４５６７８９';
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement('div');
    el.className = 'col-label';
    el.textContent = topLabel[c];
    el.style.left = xpos(c) + 'px';
    el.style.top = '8px';
    boardEl.appendChild(el);
  }

  const bottomLabel = '九八七六五四三二一';
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement('div');
    el.className = 'col-label';
    el.textContent = bottomLabel[c];
    el.style.left = xpos(c) + 'px';
    el.style.top = (ypos(9) + 8) + 'px';
    boardEl.appendChild(el);
  }

  renderPieces();
  setupDragDrop();
  updateStatus();
  updateFenInput();
}

function placePieceEl(row, col, piece) {
  const boardEl = document.getElementById('board');
  const el = document.createElement('div');
  el.className = `piece ${piece.color}`;
  el.dataset.type = piece.type;
  el.dataset.color = piece.color;
  el.dataset.row = row;
  el.dataset.col = col;
  el.textContent = CHARS[piece.color][piece.type];
  el.style.left = xpos(col) + 'px';
  el.style.top = ypos(row) + 'px';
  el.draggable = true;
  boardEl.appendChild(el);
  return el;
}

function renderPieces() {
  document.querySelectorAll('#board .piece').forEach(el => el.remove());
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) placePieceEl(r, c, board[r][c]);
    }
  }
}

function handlePaletteDrop(e) {
  e.preventDefault();
  _dragDropProcessed = true;
  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
  if (data.source === 'board') {
    removePiece(parseInt(data.fromRow), parseInt(data.fromCol));
    renderPieces();
    setupDragDrop();
    updateStatus();
  }
}

function canPlaceAt(row, col, type, color) {
  if (type === 'king') return inPalace(row, col, color);
  if (type === 'advisor') {
    const pos = color === 'red'
      ? [[7,3],[7,5],[8,4],[9,3],[9,5]]
      : [[0,3],[0,5],[1,4],[2,3],[2,5]];
    return pos.some(([r,c]) => r===row && c===col);
  }
  if (type === 'elephant') {
    const pos = color === 'red'
      ? [[5,2],[5,6],[7,0],[7,4],[7,8],[9,2],[9,6]]
      : [[0,2],[0,6],[2,0],[2,4],[2,8],[4,2],[4,6]];
    return pos.some(([r,c]) => r===row && c===col);
  }
  if (type === 'soldier') {
    if (color === 'red' && row >= 5) return (row===5||row===6) && col%2===0;
    if (color === 'black' && row <= 4) return (row===3||row===4) && col%2===0;
  }
  return true;
}

function placePiece(row, col, type, color) {
  if (!canPlaceAt(row, col, type, color)) return;
  if (board[row][col]) removePiece(row, col);
  board[row][col] = { type, color };
  pieceCount++;
  if (type === 'king') {
    if (color === 'red') redKingPos = { row, col };
    else blackKingPos = { row, col };
  }
  updateStatus();
}

function removePiece(row, col) {
  const p = board[row][col];
  if (!p) return;
  if (p.type === 'king') {
    if (p.color === 'red') redKingPos = null;
    else blackKingPos = null;
  }
  board[row][col] = null;
  pieceCount--;
  updateStatus();
}

function movePiece(fr, fc, tr, tc) {
  const p = board[fr][fc];
  if (!p) return;
  if (!canPlaceAt(tr, tc, p.type, p.color)) return;
  if (board[tr][tc]) removePiece(tr, tc);
  board[tr][tc] = p;
  board[fr][fc] = null;
  if (p.type === 'king') {
    if (p.color === 'red') redKingPos = { row: tr, col: tc };
    else blackKingPos = { row: tr, col: tc };
  }
  updateStatus();
}

function renderPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  for (const color of ['red','black']) {
    const sec = document.createElement('div');
    sec.className = 'palette-section';
    const h3 = document.createElement('h3');
    h3.className = color + '-text';
    h3.textContent = color === 'red' ? '紅方' : '黑方';
    sec.appendChild(h3);
    const pieces = document.createElement('div');
    pieces.className = 'palette-pieces';
    for (const type of TYPES) {
      const el = document.createElement('div');
      el.className = `piece-palette-item ${color}`;
      el.dataset.type = type;
      el.dataset.color = color;
      el.textContent = CHARS[color][type];
      el.draggable = true;
      pieces.appendChild(el);
    }
    sec.appendChild(pieces);
    pal.appendChild(sec);
  }
}

function updateStatus() {
  document.getElementById('status').textContent = `棋子：${pieceCount}`;
  document.getElementById('btn-analyze').disabled = pieceCount < 2 || isAnalyzing;
  updateFenInput();
}

function clearHighlights() {
  document.querySelectorAll('#board .intersection.highlight-valid').forEach(el => {
    el.classList.remove('highlight-valid');
  });
}

function highlightValidPositions(type, color) {
  clearHighlights();
  document.querySelectorAll('#board .intersection').forEach(el => {
    const row = parseInt(el.dataset.row);
    const col = parseInt(el.dataset.col);
    if (canPlaceAt(row, col, type, color)) {
      el.classList.add('highlight-valid');
    }
  });
}

function setupDragDrop() {
  document.querySelectorAll('#board .intersection').forEach(el => {
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', handleBoardDrop);
  });
  document.querySelectorAll('#board .piece').forEach(el => {
    el.addEventListener('dragstart', handlePieceDragStart);
    el.addEventListener('dragend', handlePieceDragEnd);
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', handleBoardDrop);
  });
  document.querySelectorAll('.piece-palette-item').forEach(el => {
    el.addEventListener('dragstart', handlePaletteDragStart);
    el.addEventListener('dragend', handlePaletteDragEnd);
  });
  document.getElementById('palette').addEventListener('dragover', e => e.preventDefault());
  document.getElementById('palette').addEventListener('drop', handlePaletteDrop);
}

function handlePaletteDragStart(e) {
  _dragDropProcessed = false;
  highlightValidPositions(this.dataset.type, this.dataset.color);
  e.dataTransfer.setData('text/plain', JSON.stringify({
    source: 'palette', type: this.dataset.type, color: this.dataset.color
  }));
  e.dataTransfer.effectAllowed = 'copy';
}

function handlePieceDragStart(e) {
  _dragDropProcessed = false;
  highlightValidPositions(this.dataset.type, this.dataset.color);
  e.dataTransfer.setData('text/plain', JSON.stringify({
    source: 'board', type: this.dataset.type, color: this.dataset.color,
    fromRow: parseInt(this.dataset.row), fromCol: parseInt(this.dataset.col)
  }));
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function handlePieceDragEnd(e) {
  this.classList.remove('dragging');
  clearHighlights();
  if (!_dragDropProcessed) {
    const fr = parseInt(this.dataset.row), fc = parseInt(this.dataset.col);
    removePiece(fr, fc);
    renderPieces();
    setupDragDrop();
    updateStatus();
  }
}

function handlePaletteDragEnd(e) {
  clearHighlights();
}

function handleBoardDrop(e) {
  e.preventDefault();
  _dragDropProcessed = true;
  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
  const row = parseInt(this.dataset.row);
  const col = parseInt(this.dataset.col);
  if (isNaN(row) || isNaN(col)) return;

  if (data.source === 'palette') {
    placePiece(row, col, data.type, data.color);
  } else if (data.source === 'board') {
    const fr = parseInt(data.fromRow), fc = parseInt(data.fromCol);
    if (fr === row && fc === col) return;
    movePiece(fr, fc, row, col);
  }
  renderPieces();
  setupDragDrop();
  updateStatus();
}

// ═══════════════════════════════════════════
// RULES ENGINE
// ═══════════════════════════════════════════

function isLineClear(board, fr, fc, tr, tc) {
  if (fr === tr) {
    const mc = Math.min(fc, tc), xc = Math.max(fc, tc);
    for (let c = mc + 1; c < xc; c++) if (board[fr][c]) return false;
    return true;
  }
  if (fc === tc) {
    const mr = Math.min(fr, tr), xr = Math.max(fr, tr);
    for (let r = mr + 1; r < xr; r++) if (board[r][fc]) return false;
    return true;
  }
  return false;
}

function countBetween(board, fr, fc, tr, tc) {
  let n = 0;
  if (fr === tr) {
    const mc = Math.min(fc, tc), xc = Math.max(fc, tc);
    for (let c = mc + 1; c < xc; c++) if (board[fr][c]) n++;
  } else {
    const mr = Math.min(fr, tr), xr = Math.max(fr, tr);
    for (let r = mr + 1; r < xr; r++) if (board[r][fc]) n++;
  }
  return n;
}

function canHorseReach(board, fr, fc, tr, tc) {
  const dr = tr - fr, dc = tc - fc, adr = Math.abs(dr), adc = Math.abs(dc);
  if (!((adr===2 && adc===1) || (adr===1 && adc===2))) return false;
  if (adr === 2) {
    if (board[fr + (dr>0?1:-1)][fc]) return false;
  } else {
    if (board[fr][fc + (dc>0?1:-1)]) return false;
  }
  return true;
}

function canPieceReach(board, fr, fc, target) {
  const p = board[fr][fc];
  if (!p) return false;
  const dr = target.row - fr, dc = target.col - fc;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  switch (p.type) {
    case 'king':
      return adr <= 1 && adc <= 1 && inPalace(target.row, target.col, p.color);
    case 'advisor':
      return adr === 1 && adc === 1 && inPalace(target.row, target.col, p.color);
    case 'elephant':
      if (adr !== 2 || adc !== 2) return false;
      if (!onOwnSide(target.row, p.color) || !onOwnSide(fr, p.color)) return false;
      if (board[fr + dr/2][fc + dc/2]) return false;
      return true;
    case 'horse':
      return canHorseReach(board, fr, fc, target.row, target.col);
    case 'chariot':
      return (adr === 0 || adc === 0) && isLineClear(board, fr, fc, target.row, target.col);
    case 'cannon':
      if (adr !== 0 && adc !== 0) return false;
      return countBetween(board, fr, fc, target.row, target.col) === 1;
    case 'soldier':
      if (adr + adc !== 1) return false;
      if (p.color === 'red') {
        if (dr > 0) return false;
        if (fr >= 5 && dc !== 0) return false;
      } else {
        if (dr < 0) return false;
        if (fr <= 4 && dc !== 0) return false;
      }
      return true;
  }
  return false;
}

function isInCheck(b, color) {
  const kp = color === 'red' ? redKingPos : blackKingPos;
  if (!kp) return true;
  const o = opp(color);
  const okp = color === 'red' ? blackKingPos : redKingPos;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (b[r][c] && b[r][c].color === o) {
        if (canPieceReach(b, r, c, {row:kp.row, col:kp.col})) return true;
      }
    }
  }

  if (okp && kp.col === okp.col) {
    let blocked = false;
    const mr = Math.min(kp.row, okp.row), xr = Math.max(kp.row, okp.row);
    for (let r = mr + 1; r < xr; r++) { if (b[r][kp.col]) { blocked = true; break; } }
    if (!blocked) return true;
  }
  return false;
}

function isCheckmate(b, color) {
  return isInCheck(b, color) && generateLegalMoves(b, color).length === 0;
}

function isStalemate(b, color) {
  return !isInCheck(b, color) && generateLegalMoves(b, color).length === 0;
}

// ─── Pseudo-legal move generators ───

function generatePseudoMoves(b, row, col) {
  const p = b[row][col];
  if (!p) return [];
  const moves = [];
  const own = p.color;
  const add = (tr, tc) => {
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return;
    const t = b[tr][tc];
    if (!t || t.color !== own) moves.push({ from:{row,col}, to:{row:tr, col:tc}, captured:t });
  };

  switch (p.type) {
    case 'king': {
      const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
      for (const [dr,dc] of dirs) {
        const nr=row+dr, nc=col+dc;
        if (inPalace(nr, nc, own)) add(nr,nc);
      }
      break;
    }
    case 'advisor': {
      const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      for (const [dr,dc] of dirs) {
        const nr=row+dr, nc=col+dc;
        if (inPalace(nr, nc, own)) add(nr,nc);
      }
      break;
    }
    case 'elephant': {
      const dirs = [[2,2],[2,-2],[-2,2],[-2,-2]];
      for (const [dr,dc] of dirs) {
        const nr=row+dr, nc=col+dc;
        if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
        if (!onOwnSide(nr, own)) continue;
        if (b[row+dr/2][col+dc/2]) continue;
        add(nr,nc);
      }
      break;
    }
    case 'horse': {
      const jumps = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
      for (const [dr,dc] of jumps) {
        const nr=row+dr, nc=col+dc;
        if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
        const legR = row + (Math.abs(dr)===2 ? (dr>0?1:-1) : 0);
        const legC = col + (Math.abs(dc)===2 ? (dc>0?1:-1) : 0);
        if (b[legR][legC]) continue;
        add(nr,nc);
      }
      break;
    }
    case 'chariot': {
      const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
      for (const [dr,dc] of dirs) {
        let nr=row+dr, nc=col+dc;
        while (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS) {
          const t = b[nr][nc];
          if (t) { if (t.color!==own) add(nr,nc); break; }
          add(nr,nc);
          nr+=dr; nc+=dc;
        }
      }
      break;
    }
    case 'cannon': {
      const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
      for (const [dr,dc] of dirs) {
        let nr=row+dr, nc=col+dc, screen=false;
        while (nr>=0&&nr<ROWS&&nc>=0&&nc<COLS) {
          const t = b[nr][nc];
          if (!screen) {
            if (t) screen = true;
            else add(nr,nc);
          } else {
            if (t) { if (t.color!==own) add(nr,nc); break; }
          }
          nr+=dr; nc+=dc;
        }
      }
      break;
    }
    case 'soldier': {
      const forward = own === 'red' ? -1 : 1;
      const crossed = own === 'red' ? row <= 4 : row >= 5;
      add(row+forward, col);
      if (crossed) { add(row, col-1); add(row, col+1); }
      break;
    }
  }
  return moves;
}

function generateLegalMoves(b, color) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (b[r][c] && b[r][c].color === color) {
        const pm = generatePseudoMoves(b, r, c);
        for (const m of pm) {
          const undo = makeMove(b, m);
          if (!isInCheck(b, color)) moves.push(m);
          unmakeMove(b, m, undo);
        }
      }
    }
  }
  return moves;
}

// ─── make/unmake (incremental) ───
function makeMove(b, move) {
  const captured = b[move.to.row][move.to.col];
  const moved = b[move.from.row][move.from.col];
  b[move.to.row][move.to.col] = moved;
  b[move.from.row][move.from.col] = null;

  if (moved.type === 'king') {
    if (moved.color === 'red') redKingPos = {row:move.to.row, col:move.to.col};
    else blackKingPos = {row:move.to.row, col:move.to.col};
  }
  if (captured && captured.type === 'king') {
    if (captured.color === 'red') redKingPos = null;
    else blackKingPos = null;
  }
  return { captured, moved, from:move.from, to:move.to };
}

function unmakeMove(b, move, undo) {
  b[move.from.row][move.from.col] = undo.moved;
  b[move.to.row][move.to.col] = undo.captured;
  if (undo.moved.type === 'king') {
    if (undo.moved.color === 'red') redKingPos = {row:move.from.row, col:move.from.col};
    else blackKingPos = {row:move.from.row, col:move.from.col};
  }
  if (undo.captured && undo.captured.type === 'king') {
    if (undo.captured.color === 'red') redKingPos = {row:move.to.row, col:move.to.col};
    else blackKingPos = {row:move.to.row, col:move.to.col};
  }
}

// ═══════════════════════════════════════════
// MOVE NOTATION (Chinese chess)
// ═══════════════════════════════════════════

const CN = '　一二三四五六七八九';
const AN = '　１２３４５６７８９';

function colNum(col, color) {
  return color === 'red' ? 9 - col : col + 1;
}

function moveToNotation(b, move, color) {
  const p = b[move.from.row][move.from.col];
  const ch = CHARS[color][p.type];
  const num = color === 'red' ? CN : AN;
  const src = num[colNum(move.from.col, color)];
  const dr = move.to.row - move.from.row;
  const adv = color === 'red' ? dr < 0 : dr > 0;
  const hor = dr === 0;

  if (hor) {
    const dst = num[colNum(move.to.col, color)];
    return ch + src + '平' + dst;
  }

  if (['chariot','cannon','soldier','king'].includes(p.type)) {
    const steps = Math.abs(dr);
    return ch + src + (adv ? '進' : '退') + num[steps];
  }

  const dst = num[colNum(move.to.col, color)];
  return ch + src + (adv ? '進' : '退') + dst;
}

// ═══════════════════════════════════════════
// FEN
// ═══════════════════════════════════════════

const PIECE_TO_FEN = {
  red:   { king:'K', advisor:'A', elephant:'B', horse:'N', chariot:'R', cannon:'C', soldier:'P' },
  black: { king:'k', advisor:'a', elephant:'b', horse:'n', chariot:'r', cannon:'c', soldier:'p' },
};

function boardToFen(b) {
  let rows = [];
  for (let r = 0; r < ROWS; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) { empty++; continue; }
      if (empty > 0) { row += empty; empty = 0; }
      row += PIECE_TO_FEN[p.color][p.type];
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

function fenToBoard(fen) {
  initBoard();
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  for (let r = 0; r < Math.min(rows.length, ROWS); r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') { c += parseInt(ch); continue; }
      if (c >= COLS) break;
      const isRed = ch === ch.toUpperCase();
      for (const [type, code] of Object.entries(PIECE_TO_FEN[isRed ? 'red' : 'black'])) {
        if (code === ch) {
          board[r][c] = { type, color: isRed ? 'red' : 'black' };
          pieceCount++;
          if (type === 'king') {
            if (isRed) redKingPos = { row: r, col: c };
            else blackKingPos = { row: r, col: c };
          }
          break;
        }
      }
      c++;
    }
  }
}

function updateFenInput() {
  const el = document.getElementById('fen-input');
  if (el) el.value = boardToFen(board);
}

// ═══════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════

function evaluate(b) {
  let sc = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      let v = PIECE_VALUES[p.type];
      if (p.type === 'soldier') {
        const crossed = (p.color==='red' && r>=5) || (p.color==='black' && r<=4);
        if (crossed) v += 100;
      }
      sc += (p.color === 'red' ? 1 : -1) * v;
    }
  }
  return sc;
}

function orderMoves(moves, b) {
  moves.sort((a, c) => {
    const ca = b[a.to.row][a.to.col], cb = b[c.to.row][c.to.col];
    return (cb ? PIECE_VALUES[cb.type] : 0) - (ca ? PIECE_VALUES[ca.type] : 0);
  });
}

function alphaBetaSync(b, color, depth, alpha, beta, startTime, timeLimit, maxDepth, checkExt) {
  if (interruptRequested) return { score: evaluate(b), move: null, pv: [] };
  if (Date.now() - startTime > timeLimit) return { score: evaluate(b), move: null, pv: [] };

  const inCheck = isInCheck(b, color);
  const actualMax = inCheck ? maxDepth + 1 : maxDepth;
  if (depth >= actualMax + checkExt) return { score: evaluate(b), move: null, pv: [] };

  const moves = generateLegalMoves(b, color);
  if (moves.length === 0) {
    if (inCheck) {
      const s = (color === 'red' ? -1 : 1) * (MATE_VAL - depth);
      return { score: s, move: null, pv: [] };
    }
    const s = (color === 'red' ? -1 : 1) * (MATE_VAL - depth);
    return { score: s, move: null, pv: [] };
  }

  orderMoves(moves, b);

  let bestMove = null, bestPV = [];
  let bestScore = color === 'red' ? -INF : INF;

  for (const m of moves) {
    if (interruptRequested) break;
    const undo = makeMove(b, m);
    const givesCheck = isInCheck(b, opp(color));
    const nextExt = givesCheck && checkExt < 3 ? checkExt + 1 : checkExt;
    const r = alphaBetaSync(b, opp(color), depth + 1, alpha, beta, startTime, timeLimit, maxDepth, nextExt);
    unmakeMove(b, m, undo);

    if (color === 'red') {
      if (r.score > bestScore) { bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv]; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (r.score < bestScore) { bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv]; }
      beta = Math.min(beta, bestScore);
    }
    if (alpha >= beta) break;
  }
  return { score: bestScore, move: bestMove, pv: bestPV };
}

async function alphaBeta(b, color, depth, alpha, beta, startTime, timeLimit, maxDepth, yieldState, checkExt) {
  if (interruptRequested) return { score: evaluate(b), move: null, pv: [] };
  if (Date.now() - startTime > timeLimit) return { score: evaluate(b), move: null, pv: [] };

  const inCheck = isInCheck(b, color);
  const actualMax = inCheck ? maxDepth + 1 : maxDepth;
  if (depth >= actualMax + checkExt) return { score: evaluate(b), move: null, pv: [] };

  const moves = generateLegalMoves(b, color);
  if (moves.length === 0) {
    if (inCheck) {
      const s = (color === 'red' ? -1 : 1) * (MATE_VAL - depth);
      return { score: s, move: null, pv: [] };
    }
    const s = (color === 'red' ? -1 : 1) * (MATE_VAL - depth);
    return { score: s, move: null, pv: [] };
  }

  orderMoves(moves, b);

  let bestMove = null, bestPV = [];
  let bestScore = color === 'red' ? -INF : INF;

  for (const m of moves) {
    if (interruptRequested) break;

    if (Date.now() - yieldState.lastYield > 30) {
      await new Promise(r => setTimeout(r, 0));
      yieldState.lastYield = Date.now();
      if (interruptRequested) break;
      if (Date.now() - startTime > timeLimit) break;
    }

    const undo = makeMove(b, m);
    const givesCheck = isInCheck(b, opp(color));
    const nextExt = givesCheck && checkExt < 3 ? checkExt + 1 : checkExt;
    const r = await alphaBeta(b, opp(color), depth + 1, alpha, beta, startTime, timeLimit, maxDepth, yieldState, nextExt);
    unmakeMove(b, m, undo);

    if (color === 'red') {
      if (r.score > bestScore) { bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv]; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (r.score < bestScore) { bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv]; }
      beta = Math.min(beta, bestScore);
    }
    if (alpha >= beta) break;
  }
  return { score: bestScore, move: bestMove, pv: bestPV };
}

async function searchRootAsync(b, maxDepth, timeLimit) {
  const startTime = Date.now();
  let best = { score: 0, move: null, pv: [] };

  for (let d = 1; d <= maxDepth; d++) {
    if (interruptRequested) break;
    const yieldState = { lastYield: Date.now() };
    const r = await alphaBeta(b, 'red', 0, -INF, INF, startTime, timeLimit, d, yieldState, 0);
    if (Date.now() - startTime >= timeLimit) break;
    best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) break;
  }
  return best;
}

function findRefutation(b, color, maxDepth, startTime, timeLimit) {
  let best = { score: 0, move: null, pv: [] };
  for (let d = 2; d <= maxDepth; d += 2) {
    if (Date.now() - startTime > timeLimit) break;
    const r = alphaBetaSync(b, color, 0, -INF, INF, startTime, timeLimit, d, 0);
    if (r.move) best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) break;
  }
  return best;
}

// ═══════════════════════════════════════════
// RESULT TREE
// ═══════════════════════════════════════════

function deepCopyBoard(src) {
  return src.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
}

function restoreBoard(snapshot) {
  board = snapshot.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
  redKingPos = null;
  blackKingPos = null;
  pieceCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) {
        pieceCount++;
        if (board[r][c].type === 'king') {
          if (board[r][c].color === 'red') redKingPos = { row: r, col: c };
          else blackKingPos = { row: r, col: c };
        }
      }
    }
  }
  renderPieces();
  setupDragDrop();
  updateStatus();
}

function pvToTree(b, pv, color, depth, maxDepth, startTime) {
  if (!pv || pv.length === 0 || depth > maxDepth) return null;

  syncKingPos(b);
  const m = pv[0];
  const rest = pv.slice(1);
  const nb = applyBoardCopy(b, m);
  const isMateEnd = isCheckmate(nb, opp(color));
  const isStalemateEnd = isStalemate(nb, opp(color));

  const node = {
    move: m, notation: moveToNotation(b, m, color),
    color: color, isMate: isMateEnd, isStalemate: isStalemateEnd, children: [],
    board: deepCopyBoard(nb)
  };

  const nextColor = opp(color);
  const responses = generateLegalMoves(nb, nextColor);

  for (const resp of responses) {
    const respBoard = applyBoardCopy(nb, resp);
    const savedRK = redKingPos;
    const savedBK = blackKingPos;
    const isPV = rest.length > 0 && movesEqual(resp, rest[0]);
    let childNode;

    if (isPV) {
      const sub = pvToTree(respBoard, rest.slice(1), color, depth + 1, maxDepth, startTime);
      redKingPos = savedRK;
      blackKingPos = savedBK;
      syncKingPos(respBoard);
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor, isMate: isCheckmate(respBoard, color),
        isStalemate: isStalemate(respBoard, color),
        children: sub ? [sub] : [],
        board: deepCopyBoard(respBoard)
      };
    } else if (color === 'red') {
      redKingPos = savedRK;
      blackKingPos = savedBK;
      const ref = findRefutation(respBoard, color, Math.max(2, maxDepth - depth - 1), Date.now(), 5000);
      redKingPos = savedRK;
      blackKingPos = savedBK;
      const refChildren = [];
      if (ref && ref.move) {
        const refBoard = applyBoardCopy(respBoard, ref.move);
        let refSub = null;
        if (ref.pv && ref.pv.length > 1) {
          refSub = pvToTree(refBoard, ref.pv.slice(1), nextColor, depth + 2, maxDepth, Date.now());
        }
        const refFollowups = refSub
          ? [refSub]
          : generateLegalMoves(refBoard, nextColor).slice(0, 1).map(rr => {
              const rrBoard = applyBoardCopy(refBoard, rr);
              return {
                move: rr, notation: moveToNotation(refBoard, rr, nextColor),
                color: nextColor,
                isMate: isCheckmate(rrBoard, opp(nextColor)),
                isStalemate: isStalemate(rrBoard, opp(nextColor)),
                children: [], board: deepCopyBoard(rrBoard)
              };
            });
        refChildren.push({
          move: ref.move, notation: moveToNotation(respBoard, ref.move, color),
          color: color, isMate: isCheckmate(refBoard, nextColor),
          isStalemate: isStalemate(refBoard, nextColor),
          children: refFollowups,
          board: deepCopyBoard(refBoard)
        });
      }
      redKingPos = savedRK;
      blackKingPos = savedBK;
      syncKingPos(respBoard);
      if (refChildren.length === 0) continue;
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor, isMate: isCheckmate(respBoard, color),
        isStalemate: isStalemate(respBoard, color),
        children: refChildren,
        board: deepCopyBoard(respBoard)
      };
    }
    node.children.push(childNode);
  }
  return node;
}

function applyBoardCopy(src, move) {
  const nb = src.map(row => row.map(cell => cell ? {...cell} : null));
  nb[move.to.row][move.to.col] = nb[move.from.row][move.from.col];
  nb[move.from.row][move.from.col] = null;
  const moved = src[move.from.row][move.from.col];
  if (moved && moved.type === 'king') {
    if (moved.color === 'red') redKingPos = {row: move.to.row, col: move.to.col};
    else blackKingPos = {row: move.to.row, col: move.to.col};
  }
  const captured = src[move.to.row][move.to.col];
  if (captured && captured.type === 'king') {
    if (captured.color === 'red') redKingPos = null;
    else blackKingPos = null;
  }
  return nb;
}

function syncKingPos(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (b[r][c] && b[r][c].type === 'king') {
        if (b[r][c].color === 'red') redKingPos = { row: r, col: c };
        else blackKingPos = { row: r, col: c };
      }
    }
  }
}

// ═══════════════════════════════════════════
// RESULT DISPLAY
// ═══════════════════════════════════════════

function renderTree(node, moveNum, parentEl) {
  if (!node) return;
  const li = document.createElement('li');
  if (node.interrupted) {
    li.textContent = `  (分析中斷)`;
    li.className = 'interrupted';
    parentEl.appendChild(li);
    return;
  }
  li.className = node.color === 'red' ? 'red-move' : '';
  if (node.isMate) li.classList.add(node.color === 'red' ? 'mate' : 'mate-loss');
  if (node.isStalemate) li.classList.add(node.color === 'red' ? 'mate' : 'mate-loss');
  li.style.cursor = 'pointer';

  const prefix = node.color === 'red' ? `${moveNum}.` : `${moveNum}. ...`;
  const suffix = node.isMate ? '  死棋' : node.isStalemate ? ' 困斃' : '';
  li.textContent = `${prefix} ${node.notation}${suffix}`;
  li.addEventListener('click', () => {
    if (node.board) restoreBoard(node.board);
  });
  parentEl.appendChild(li);

  if (node.children.length > 0) {
    const ul = document.createElement('ul');
    const nextNum = node.color === 'red' ? moveNum : moveNum + 1;
    for (const child of node.children) renderTree(child, nextNum, ul);
    parentEl.appendChild(ul);
  }
}

function showResult(pvTree, score) {
  const rc = document.getElementById('result-content');
  rc.innerHTML = '';

  if (!pvTree) {
    rc.innerHTML = '<p>分析中斷或無可用著法</p>';
    return;
  }

  if (Math.abs(score) < MATE_VAL / 2) {
    const verdict = score > 0 ? `紅方優勢 (${score})` : score < 0 ? `黑方優勢 (${Math.abs(score)})` : '均勢';
    rc.innerHTML = `<p>未找到必勝著法。${verdict}</p>`;
  }

  const h = document.createElement('h2');
  h.textContent = Math.abs(score) > MATE_VAL / 2
    ? (score > 0 ? '紅方必勝' : '黑方必勝')
    : '最佳著法';
  rc.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'tree';
  renderTree(pvTree, 1, ul);
  rc.appendChild(ul);
}

// ═══════════════════════════════════════════
// MAIN ANALYZE
// ═══════════════════════════════════════════

function analyze() {
  if (isAnalyzing) return;
  if (!redKingPos || !blackKingPos) {
    document.getElementById('result-content').innerHTML = '<p>請先擺放紅黑將帥</p>';
    return;
  }
  if (isCheckmate(board, 'red')) {
    document.getElementById('result-content').innerHTML = '<p>紅方死棋，黑方勝</p>';
    return;
  }
  if (isStalemate(board, 'red')) {
    document.getElementById('result-content').innerHTML = '<p>紅方困斃，黑方勝</p>';
    return;
  }

  isAnalyzing = true;
  interruptRequested = false;
  updateStatus();
  const btn = document.getElementById('btn-analyze');
  btn.textContent = '分析中...';
  document.getElementById('btn-interrupt').style.display = '';
  document.getElementById('result-content').innerHTML = '<p>分析中，請稍候...</p>';

  const boardCopy = deepCopyBoard(board);
  const depth = parseInt(document.getElementById('depth-slider').value);
  (async () => {
    try {
      const result = await searchRootAsync(boardCopy, depth, 15000);
      let tree = null;
      if (result && result.move) {
        const nb = applyBoardCopy(boardCopy, result.move);
        syncKingPos(nb);
        const isMateEnd = isCheckmate(nb, 'black');
        const isStalemateEnd = isStalemate(nb, 'black');
        const restPV = result.pv.slice(1);
        tree = {
          move: result.move, notation: moveToNotation(boardCopy, result.move, 'red'),
          color: 'red', isMate: isMateEnd, isStalemate: isStalemateEnd, children: [],
          board: deepCopyBoard(nb)
        };

        const blackMoves = generateLegalMoves(nb, 'black');
        for (const bm of blackMoves) {
          const bmBoard = applyBoardCopy(nb, bm);
          const savedRK = redKingPos;
          const savedBK = blackKingPos;
          const isPV = restPV.length > 0 && movesEqual(bm, restPV[0]);

          let childNode;
          if (isPV) {
            const sub = pvToTree(bmBoard, restPV.slice(1), 'red', 1, 12, Date.now());
            redKingPos = savedRK;
            blackKingPos = savedBK;
            syncKingPos(bmBoard);
            childNode = {
              move: bm, notation: moveToNotation(nb, bm, 'black'),
              color: 'black', isMate: isCheckmate(bmBoard, 'red'),
              isStalemate: isStalemate(bmBoard, 'red'),
              children: sub ? [sub] : [],
              board: deepCopyBoard(bmBoard)
            };
            if (!childNode.isMate && !childNode.isStalemate && childNode.children.length === 0) {
              syncKingPos(bmBoard);
              const mate = isCheckmate(bmBoard, 'red');
              const stale = isStalemate(bmBoard, 'red');
              if (mate) childNode.isMate = true;
              else if (stale) childNode.isStalemate = true;
              else childNode.interrupted = true;
            }
          } else {
            redKingPos = savedRK;
            blackKingPos = savedBK;
            const ref = findRefutation(bmBoard, 'red', 10, Date.now(), 5000);
            const refChildren = [];
            if (ref && ref.move) {
              const refBoard = applyBoardCopy(bmBoard, ref.move);
              let refSub = null;
              if (ref.pv && ref.pv.length > 1) {
                refSub = pvToTree(refBoard, ref.pv.slice(1), 'black', 2, 12, Date.now());
              }
              const refFollowups = refSub
                ? [refSub]
                : generateLegalMoves(refBoard, 'black').slice(0, 1).map(bm2 => {
                    const bm2Board = applyBoardCopy(refBoard, bm2);
                    return {
                      move: bm2, notation: moveToNotation(refBoard, bm2, 'black'),
                      color: 'black',
                      isMate: isCheckmate(bm2Board, 'red'),
                      isStalemate: isStalemate(bm2Board, 'red'),
                      children: [], board: deepCopyBoard(bm2Board)
                    };
                  });
              refChildren.push({
                move: ref.move, notation: moveToNotation(bmBoard, ref.move, 'red'),
                color: 'red', isMate: isCheckmate(refBoard, 'black'),
                isStalemate: isStalemate(refBoard, 'black'),
                children: refFollowups,
                board: deepCopyBoard(refBoard)
              });
            }
            redKingPos = savedRK;
            blackKingPos = savedBK;
            syncKingPos(bmBoard);
            if (refChildren.length === 0) continue;
            childNode = {
              move: bm, notation: moveToNotation(nb, bm, 'black'),
              color: 'black', isMate: isCheckmate(bmBoard, 'red'),
              isStalemate: isStalemate(bmBoard, 'red'),
              children: refChildren,
              board: deepCopyBoard(bmBoard)
            };
          }
          tree.children.push(childNode);
        }
      }
      showResult(tree, result ? result.score : 0);
    } catch (e) {
      document.getElementById('result-content').innerHTML = `<p>分析錯誤：${e.message}</p>`;
    } finally {
      isAnalyzing = false;
      interruptRequested = false;
      btn.textContent = '分析';
      document.getElementById('btn-interrupt').style.display = 'none';
      updateStatus();
    }
  })();
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderBoard();
  renderPalette();
  setupDragDrop();
  updateStatus();

  document.getElementById('btn-analyze').addEventListener('click', analyze);
  document.getElementById('btn-interrupt').addEventListener('click', () => {
    interruptRequested = true;
  });
  document.getElementById('depth-slider').addEventListener('input', function() {
    document.getElementById('depth-value').textContent = this.value;
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (isAnalyzing) return;
    initBoard();
    renderPieces();
    setupDragDrop();
    updateStatus();
    document.getElementById('result-content').innerHTML = '';
  });

  document.getElementById('btn-import-fen').addEventListener('click', () => {
    const fen = prompt('請輸入FEN編碼：');
    if (!fen) return;
    try {
      fenToBoard(fen);
      renderPieces();
      setupDragDrop();
      updateStatus();
      document.getElementById('result-content').innerHTML = '';
    } catch (e) {
      alert('FEN格式錯誤：' + e.message);
    }
  });

  document.getElementById('fen-input').addEventListener('click', function() {
    this.select();
  });
});
