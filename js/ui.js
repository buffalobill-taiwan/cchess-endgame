// ═══════════════════════════════════════════
// SVG BOARD + UI (rendering, palette, drag-and-drop)
// ═══════════════════════════════════════════

import { W, H, PAD, CELL, ROWS, COLS, CHARS, TYPES, MATE_VAL } from './constants.js';
import { state, opp, inPalace } from './state.js';
import { isInCheck } from './rules.js';
import { updateFenInput } from './notation.js';
import { syncKingPos } from './tree.js';

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

export function renderBoard() {
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

export function renderPieces() {
  document.querySelectorAll('#board .piece').forEach(el => el.remove());
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.board[r][c]) placePieceEl(r, c, state.board[r][c]);
    }
  }
}

function handlePaletteDrop(e) {
  e.preventDefault();
  if (state.isAnalyzing) return;
  clearHighlights();
  state._dragDropProcessed = true;
  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
  if (data.source === 'board') {
    removePiece(parseInt(data.fromRow), parseInt(data.fromCol));
    renderPieces();
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
  if (state.board[row][col]) removePiece(row, col);
  state.board[row][col] = { type, color };
  state.pieceCount++;
  if (type === 'king') {
    if (color === 'red') state.redKingPos = { row, col };
    else state.blackKingPos = { row, col };
  }
  updateStatus();
}

function removePiece(row, col) {
  const p = state.board[row][col];
  if (!p) return;
  if (p.type === 'king') {
    if (p.color === 'red') state.redKingPos = null;
    else state.blackKingPos = null;
  }
  state.board[row][col] = null;
  state.pieceCount--;
  updateStatus();
}

function movePiece(fr, fc, tr, tc) {
  const p = state.board[fr][fc];
  if (!p) return;
  if (!canPlaceAt(tr, tc, p.type, p.color)) return;
  if (state.board[tr][tc]) removePiece(tr, tc);
  state.board[tr][tc] = p;
  state.board[fr][fc] = null;
  if (p.type === 'king') {
    if (p.color === 'red') state.redKingPos = { row: tr, col: tc };
    else state.blackKingPos = { row: tr, col: tc };
  }
  updateStatus();
}

export function renderPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  for (const color of ['black', 'red']) {
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

export function updateStatus() {
  document.getElementById('status').textContent = `棋子：${state.pieceCount}`;
  document.getElementById('btn-analyze').disabled = !state.redKingPos || !state.blackKingPos || state.isAnalyzing;
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

let dragBound = false;

export function setupDragDrop() {
  if (dragBound) return;
  dragBound = true;

  const boardEl = document.getElementById('board');
  const pal = document.getElementById('palette');

  boardEl.addEventListener('dragstart', e => {
    const pieceEl = e.target.closest('.piece');
    if (pieceEl) handlePieceDragStart.call(pieceEl, e);
    else if (e.target.closest('.intersection')) e.preventDefault();
  });
  boardEl.addEventListener('dragend', e => {
    const pieceEl = e.target.closest('.piece');
    if (pieceEl) handlePieceDragEnd.call(pieceEl, e);
  });
  boardEl.addEventListener('dragover', e => e.preventDefault());
  boardEl.addEventListener('drop', handleBoardDrop);

  pal.addEventListener('dragstart', e => {
    const item = e.target.closest('.piece-palette-item');
    if (item) handlePaletteDragStart.call(item, e);
  });
  pal.addEventListener('dragend', e => {
    const item = e.target.closest('.piece-palette-item');
    if (item) handlePaletteDragEnd.call(item, e);
  });
  pal.addEventListener('dragover', e => e.preventDefault());
  pal.addEventListener('drop', handlePaletteDrop);
}

function handlePaletteDragStart(e) {
  if (state.isAnalyzing) { e.preventDefault(); return; }
  state._dragDropProcessed = false;
  highlightValidPositions(this.dataset.type, this.dataset.color);
  e.dataTransfer.setData('text/plain', JSON.stringify({
    source: 'palette', type: this.dataset.type, color: this.dataset.color
  }));
  e.dataTransfer.effectAllowed = 'copy';
}

function handlePieceDragStart(e) {
  if (state.isAnalyzing) { e.preventDefault(); return; }
  state._dragDropProcessed = false;
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
  if (state.isAnalyzing) return;
  if (!state._dragDropProcessed) {
    const fr = parseInt(this.dataset.row), fc = parseInt(this.dataset.col);
    removePiece(fr, fc);
    renderPieces();
    updateStatus();
  }
}

function handlePaletteDragEnd(e) {
  clearHighlights();
}

function boardCellFromEvent(e) {
  const rect = document.getElementById('board').getBoundingClientRect();
  const col = Math.round((e.clientX - rect.left - PAD) / CELL);
  const row = Math.round((e.clientY - rect.top - PAD) / CELL);
  if (col < 0 || col > COLS - 1 || row < 0 || row > ROWS - 1) return null;
  return { row, col };
}

function handleBoardDrop(e) {
  e.preventDefault();
  if (state.isAnalyzing) return;
  clearHighlights();
  state._dragDropProcessed = true;
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  const cell = boardCellFromEvent(e);
  if (!cell) return;
  const { row, col } = cell;

  if (data.source === 'palette') {
    placePiece(row, col, data.type, data.color);
  } else if (data.source === 'board') {
    const fr = parseInt(data.fromRow), fc = parseInt(data.fromCol);
    if (fr === row && fc === col) return;
    movePiece(fr, fc, row, col);
  }
  renderPieces();
  updateStatus();
}

function restoreBoard(snapshot) {
  state.board = snapshot.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
  state.redKingPos = null;
  state.blackKingPos = null;
  state.pieceCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.board[r][c]) {
        state.pieceCount++;
        if (state.board[r][c].type === 'king') {
          if (state.board[r][c].color === 'red') state.redKingPos = { row: r, col: c };
          else state.blackKingPos = { row: r, col: c };
        }
      }
    }
  }
  renderPieces();
  updateStatus();
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
  let suffix = node.isMate ? ' 將死' : node.isStalemate ? ' 困斃' : '';
  if (!node.isMate && !node.isStalemate && node.board) {
    const savedRK = state.redKingPos, savedBK = state.blackKingPos;
    syncKingPos(node.board);
    if (isInCheck(node.board, opp(node.color))) suffix = ' 將軍';
    state.redKingPos = savedRK; state.blackKingPos = savedBK;
  }
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

export function showResult(pvTree, score, interrupted, initialBoard) {
  const rc = document.getElementById('result-content');
  rc.innerHTML = '';

  if (!pvTree) {
    rc.innerHTML = interrupted ? '<p>分析中斷</p>' : state.continuousCheck ? '<p>未找到連將殺必勝著法</p>' : '<p>無可用著法</p>';
    return;
  }

  if (!interrupted) {
    if (Math.abs(score) < MATE_VAL / 2) {
      const verdict = score > 0 ? `紅方優勢 (${score})` : score < 0 ? `黑方優勢 (${Math.abs(score)})` : '均勢';
      rc.innerHTML = `<p>未找到必勝著法。${verdict}</p>`;
    }
  }

  const h = document.createElement('h2');
  if (interrupted) {
    h.textContent = '分析中斷';
  } else {
    h.textContent = Math.abs(score) > MATE_VAL / 2
      ? (score > 0 ? '紅方必勝' : '黑方必勝')
      : '最佳著法';
  }
  rc.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'tree';

  if (initialBoard) {
    const liInit = document.createElement('li');
    liInit.className = 'original-position';
    liInit.style.cursor = 'pointer';
    liInit.style.fontWeight = 'bold';
    liInit.style.color = '#e8d5b0';
    liInit.style.marginBottom = '4px';
    liInit.textContent = '🏠 原始局面';
    liInit.addEventListener('click', () => {
      restoreBoard(initialBoard);
    });
    ul.appendChild(liInit);
  }

  if (pvTree.move === null) {
    for (const child of pvTree.children) renderTree(child, 1, ul);
  } else {
    renderTree(pvTree, 1, ul);
  }
  rc.appendChild(ul);
}