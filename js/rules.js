// ═══════════════════════════════════════════
// RULES ENGINE
// ═══════════════════════════════════════════

import { ROWS, COLS } from './constants.js';
import { opp, inPalace, onOwnSide } from './state.js';
import { findKings } from './board.js';
import { PIECE_INDEX, ZOBRIST_PIECE_LO, ZOBRIST_PIECE_HI, ZOBRIST_SIDE_LO, ZOBRIST_SIDE_HI } from './zobrist.js';

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

// Detect check on `color`'s king. Optional fast-path arguments avoid the
// full-board scans the caller already did:
//   kp        — color's king cell (falls back to findKings when null/missing)
//   okp       — opponent king cell (null when opponent king is absent, e.g. captured)
//   enemyList — opponent's piece entries (from pieceInfo); when provided, only
//               these ≤16 pieces are scanned for attackers (skipSq skips the
//               one just captured at m.to)
export function isInCheck(b, color, kp, okp, enemyList, skipSq) {
  if (!kp || !okp) {
    const { red, black } = findKings(b);
    if (!kp) kp = color === 'red' ? red : black;
    if (!okp) okp = color === 'red' ? black : red;
  }
  if (!kp) return true;
  const o = opp(color);

  if (enemyList) {
    for (let i = 0; i < enemyList.length; i++) {
      const e = enemyList[i];
      if (skipSq && e.row === skipSq.row && e.col === skipSq.col) continue;
      if (canPieceReach(b, e.row, e.col, kp)) return true;
    }
  } else {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (b[r][c] && b[r][c].color === o) {
          if (canPieceReach(b, r, c, kp)) return true;
        }
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

// Legality test for a pseudo-legal move `m` (already applied via makeMove;
// `undo` is its undo record). With `info` (the caller's pieceInfo for the
// pre-move board) the single-scan check path is used: the moved king's cell is
// passed explicitly, a captured opponent king nulls okp, and the captured pawn
// cell is skipped in the attacker scan.
function ownMoveLegal(b, m, undo, info, color) {
  if (!info) return !isInCheck(b, color);
  let tkp = info[color];
  if (undo.moved.type === 'king') tkp = { row: m.to.row, col: m.to.col };
  const okp = (undo.captured && undo.captured.type === 'king') ? null : info[opp(color)];
  const skipSq = undo.captured ? m.to : null;
  return !isInCheck(b, color, tkp, okp, info[opp(color) + 'Pieces'], skipSq);
}

function generateMovesInternal(b, color, info, onlyCaptures) {
  const moves = [];
  const list = info ? info[color + 'Pieces'] : null;
  const collect = (r, c) => {
    const pm = generatePseudoMoves(b, r, c);
    for (const m of pm) {
      if (onlyCaptures && !m.captured) continue;
      const undo = makeMove(b, m);
      if (ownMoveLegal(b, m, undo, info, color)) moves.push(m);
      unmakeMove(b, m, undo);
    }
  };
  if (list) {
    for (const src of list) collect(src.row, src.col);
  } else {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (b[r][c] && b[r][c].color === color) collect(r, c);
      }
    }
  }
  return moves;
}

export function generateLegalMoves(b, color, info) {
  return generateMovesInternal(b, color, info, false);
}

// Captures only — the quiescence search generator. Same legality filtering as
// generateLegalMoves but skips quiet moves up front.
export function generateCaptureMoves(b, color, info) {
  return generateMovesInternal(b, color, info, true);
}

// ─── make/unmake (incremental, pure board mutation) ───
// An optional `hash` object ({lo, hi}) is XOR-updated in place when provided.

export function makeMove(b, move, hash) {
  const captured = b[move.to.row][move.to.col];
  const moved = b[move.from.row][move.from.col];
  b[move.to.row][move.to.col] = moved;
  b[move.from.row][move.from.col] = null;
  if (hash && moved) {
    const movedIdx = PIECE_INDEX[moved.color][moved.type];
    const fromSq = move.from.row * COLS + move.from.col;
    const toSq = move.to.row * COLS + move.to.col;
    hash.lo ^= ZOBRIST_PIECE_LO[movedIdx][fromSq];
    hash.hi ^= ZOBRIST_PIECE_HI[movedIdx][fromSq];
    if (captured) {
      const capIdx = PIECE_INDEX[captured.color][captured.type];
      hash.lo ^= ZOBRIST_PIECE_LO[capIdx][toSq];
      hash.hi ^= ZOBRIST_PIECE_HI[capIdx][toSq];
    }
    hash.lo ^= ZOBRIST_PIECE_LO[movedIdx][toSq];
    hash.hi ^= ZOBRIST_PIECE_HI[movedIdx][toSq];
    hash.lo ^= ZOBRIST_SIDE_LO;
    hash.hi ^= ZOBRIST_SIDE_HI;
  }
  return { captured, moved, from: move.from, to: move.to };
}

export function unmakeMove(b, move, undo, hash) {
  if (hash && undo.moved) {
    const movedIdx = PIECE_INDEX[undo.moved.color][undo.moved.type];
    const fromSq = move.from.row * COLS + move.from.col;
    const toSq = move.to.row * COLS + move.to.col;
    hash.lo ^= ZOBRIST_PIECE_LO[movedIdx][toSq];
    hash.hi ^= ZOBRIST_PIECE_HI[movedIdx][toSq];
    hash.lo ^= ZOBRIST_PIECE_LO[movedIdx][fromSq];
    hash.hi ^= ZOBRIST_PIECE_HI[movedIdx][fromSq];
    if (undo.captured) {
      const capIdx = PIECE_INDEX[undo.captured.color][undo.captured.type];
      hash.lo ^= ZOBRIST_PIECE_LO[capIdx][toSq];
      hash.hi ^= ZOBRIST_PIECE_HI[capIdx][toSq];
    }
    hash.lo ^= ZOBRIST_SIDE_LO;
    hash.hi ^= ZOBRIST_SIDE_HI;
  }
  b[move.from.row][move.from.col] = undo.moved;
  b[move.to.row][move.to.col] = undo.captured;
}