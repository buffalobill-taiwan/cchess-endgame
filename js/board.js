// ═══════════════════════════════════════════
// PURE BOARD UTILITIES
// ═══════════════════════════════════════════

import { ROWS, COLS } from './constants.js';

export function deepCopyBoard(src) {
  return src.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
}

export function applyBoardCopy(src, move) {
  const nb = src.map(row => row.map(cell => cell ? { ...cell } : null));
  nb[move.to.row][move.to.col] = nb[move.from.row][move.from.col];
  nb[move.from.row][move.from.col] = null;
  return nb;
}

export function findKings(b) {
  let red = null, black = null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.type === 'king') {
        if (p.color === 'red') red = { row: r, col: c };
        else black = { row: r, col: c };
      }
    }
  }
  return { red, black };
}

// Per-node piece lists for fast move generation and check detection.
// Returns { red, black, redPieces, blackPieces } where `red`/`black` are the
// king entries (or null) and each list holds { row, col, type } entries.
// King entries are shared objects with their list entry, so relocating a king
// in the list also moves the position reference.
export function pieceInfo(b) {
  let red = null, black = null;
  const redPieces = [], blackPieces = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      const entry = { row: r, col: c, type: p.type };
      if (p.color === 'red') {
        if (p.type === 'king') red = entry;
        redPieces.push(entry);
      } else {
        if (p.type === 'king') black = entry;
        blackPieces.push(entry);
      }
    }
  }
  return { red, black, redPieces, blackPieces };
}