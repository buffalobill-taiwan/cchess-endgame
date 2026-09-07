// ═══════════════════════════════════════════
// RULES ENGINE
// ═══════════════════════════════════════════

import { ROWS, COLS } from './constants.js';
import { state, opp, inPalace, onOwnSide } from './state.js';

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

export function isInCheck(b, color) {
  const kp = color === 'red' ? state.redKingPos : state.blackKingPos;
  if (!kp) return true;
  const o = opp(color);
  const okp = color === 'red' ? state.blackKingPos : state.redKingPos;

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

export function isCheckmate(b, color) {
  return isInCheck(b, color) && generateLegalMoves(b, color).length === 0;
}

export function isStalemate(b, color) {
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

export function generateLegalMoves(b, color) {
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
export function makeMove(b, move) {
  const captured = b[move.to.row][move.to.col];
  const moved = b[move.from.row][move.from.col];
  b[move.to.row][move.to.col] = moved;
  b[move.from.row][move.from.col] = null;

  if (moved.type === 'king') {
    if (moved.color === 'red') state.redKingPos = {row:move.to.row, col:move.to.col};
    else state.blackKingPos = {row:move.to.row, col:move.to.col};
  }
  if (captured && captured.type === 'king') {
    if (captured.color === 'red') state.redKingPos = null;
    else state.blackKingPos = null;
  }
  return { captured, moved, from:move.from, to:move.to };
}

export function unmakeMove(b, move, undo) {
  b[move.from.row][move.from.col] = undo.moved;
  b[move.to.row][move.to.col] = undo.captured;
  if (undo.moved.type === 'king') {
    if (undo.moved.color === 'red') state.redKingPos = {row:move.from.row, col:move.from.col};
    else state.blackKingPos = {row:move.from.row, col:move.from.col};
  }
  if (undo.captured && undo.captured.type === 'king') {
    if (undo.captured.color === 'red') state.redKingPos = {row:move.to.row, col:move.to.col};
    else state.blackKingPos = {row:move.to.row, col:move.to.col};
  }
}