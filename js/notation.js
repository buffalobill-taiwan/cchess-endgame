// ═══════════════════════════════════════════
// MOVE NOTATION (Chinese chess)
// ═══════════════════════════════════════════

import { ROWS, COLS, CHARS } from './constants.js';
import { state, initBoard } from './state.js';

const CN = '　一二三四五六七八九';
const AN = '　１２３４５６７８９';

function colNum(col, color) {
  return color === 'red' ? 9 - col : col + 1;
}

export function moveToNotation(b, move, color) {
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

export const PIECE_TO_FEN = {
  red:   { king:'K', advisor:'A', elephant:'B', horse:'N', chariot:'R', cannon:'C', soldier:'P' },
  black: { king:'k', advisor:'a', elephant:'b', horse:'n', chariot:'r', cannon:'c', soldier:'p' },
};

export function boardToFen(b) {
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

export function fenToBoard(fen) {
  initBoard();
  if (!fen || !fen.trim()) throw new Error('空 FEN');
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== ROWS) throw new Error(`棋盤應為 ${ROWS} 行，實際 ${rows.length} 行`);
  let redKings = 0, blackKings = 0;
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') { c += parseInt(ch, 10); continue; }
      if (c >= COLS) throw new Error(`第 ${r + 1} 行超過 ${COLS} 路`);
      const isRed = ch === ch.toUpperCase();
      const side = PIECE_TO_FEN[isRed ? 'red' : 'black'];
      let placed = false;
      for (const [type, code] of Object.entries(side)) {
        if (code === ch) {
          state.board[r][c] = { type, color: isRed ? 'red' : 'black' };
          state.pieceCount++;
          if (type === 'king') {
            if (isRed) { redKings++; state.redKingPos = { row: r, col: c }; }
            else { blackKings++; state.blackKingPos = { row: r, col: c }; }
          }
          placed = true;
          break;
        }
      }
      if (!placed) throw new Error(`未知棋子「${ch}」`);
      c++;
    }
    if (c !== COLS) throw new Error(`第 ${r + 1} 行不是 ${COLS} 路（實際 ${c}）`);
  }
  if (redKings > 1) throw new Error('紅方超過一個帥');
  if (blackKings > 1) throw new Error('黑方超過一個將');
}

export function updateFenInput() {
  const el = document.getElementById('fen-input');
  if (el) el.value = boardToFen(state.board);
}