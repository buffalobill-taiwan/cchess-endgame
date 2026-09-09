// ═══════════════════════════════════════════
// MOVE NOTATION (Chinese chess)
// ═══════════════════════════════════════════

import { ROWS, COLS, CHARS } from './constants.js';
import { state, initBoard } from './state.js';

const CN = '　一二三四五六七八九';
const AN = '　１２３４５６７８９';

const DISAMBIG = {
  2: ['前', '後'],
  3: ['前', '中', '後'],
  4: ['前', '二', '三', '四'],
  5: ['前', '二', '三', '四', '五'],
};

function colNum(col, color) {
  return color === 'red' ? 9 - col : col + 1;
}

function sameFilePieces(b, row, col, color, type) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    if (b[r][col] && b[r][col].color === color && b[r][col].type === type) {
      rows.push(r);
    }
  }
  // 前 = 靠近己方底線：紅方 row 小在前，黑方 row 大在前
  rows.sort((a, b) => color === 'red' ? a - b : b - a);
  const idx = rows.indexOf(row);
  return { idx, total: rows.length };
}

function rankLabel(b, row, col, color, type) {
  const { idx, total } = sameFilePieces(b, row, col, color, type);
  if (total < 2) return null;
  const labels = DISAMBIG[Math.min(total, 5)];
  return labels[Math.min(idx, labels.length - 1)];
}

function labelCount(b, color, type, label) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const q = b[r][c];
      if (!q || q.color !== color || q.type !== type) continue;
      if (rankLabel(b, r, c, color, type) === label) n++;
    }
  }
  return n;
}

export function moveToNotation(b, move, color) {
  const p = b[move.from.row][move.from.col];
  const ch = CHARS[color][p.type];
  const num = color === 'red' ? CN : AN;
  const { total } = sameFilePieces(b, move.from.row, move.from.col, color, p.type);

  let src;
  if (total >= 2) {
    const label = rankLabel(b, move.from.row, move.from.col, color, p.type);
    src = labelCount(b, color, p.type, label) > 1
      ? label + ch + num[colNum(move.from.col, color)]
      : label + ch;
  } else {
    src = ch + num[colNum(move.from.col, color)];
  }

  const dr = move.to.row - move.from.row;
  const adv = color === 'red' ? dr < 0 : dr > 0;
  const hor = dr === 0;

  if (hor) {
    const dst = num[colNum(move.to.col, color)];
    return src + '平' + dst;
  }

  if (['chariot','cannon','soldier','king'].includes(p.type)) {
    const steps = Math.abs(dr);
    return src + (adv ? '進' : '退') + num[steps];
  }

  const dst = num[colNum(move.to.col, color)];
  return src + (adv ? '進' : '退') + dst;
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

export function parseFen(fen) {
  if (!fen || !fen.trim()) throw new Error('空 FEN');
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== ROWS) throw new Error(`棋盤應為 ${ROWS} 行，實際 ${rows.length} 行`);
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let redKings = 0, blackKings = 0, redKing = null, blackKing = null;
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
          board[r][c] = { type, color: isRed ? 'red' : 'black' };
          if (type === 'king') {
            if (isRed) { redKings++; redKing = { row: r, col: c }; }
            else { blackKings++; blackKing = { row: r, col: c }; }
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
  return { board, redKing, blackKing };
}

export function fenToBoard(fen) {
  const { board } = parseFen(fen);
  initBoard();
  state.board = board;
  state.pieceCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) state.pieceCount++;
    }
  }
}