// ═══════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════

import { ROWS, COLS, PIECE_VALUES, MATE_VAL, INF } from './constants.js';
import { state, opp } from './state.js';
import { isInCheck, generateLegalMoves, makeMove, unmakeMove } from './rules.js';
import { PIECE_TO_FEN } from './notation.js';

function evaluate(b) {
  let sc = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      let v = PIECE_VALUES[p.type];
      if (p.type === 'soldier') {
        const crossed = (p.color==='red' && r<=4) || (p.color==='black' && r>=5);
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

function boardKey(b, color) {
  let k = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      k += p ? PIECE_TO_FEN[p.color][p.type] : '.';
    }
  }
  return k + (color === 'red' ? 'w' : 'b');
}

function alphaBetaSync(b, color, depth, alpha, beta, startTime, timeLimit, maxDepth, checkExt, repSet) {
  if (state.interruptRequested) return { score: evaluate(b), move: null, pv: [] };
  if (Date.now() - startTime > timeLimit) return { score: evaluate(b), move: null, pv: [] };

  const key = boardKey(b, color);
  if (repSet.has(key)) return { score: 0, move: null, pv: [] };
  repSet.add(key);

  try {
    const inCheck = isInCheck(b, color);
    const actualMax = inCheck ? maxDepth + 1 : maxDepth;
    if (depth >= actualMax + checkExt) return { score: evaluate(b), move: null, pv: [] };

    let moves = generateLegalMoves(b, color);
    if (state.continuousCheck && color === 'red') {
      moves = moves.filter(m => {
        const undo = makeMove(b, m);
        const givesCheck = isInCheck(b, opp(color));
        unmakeMove(b, m, undo);
        return givesCheck;
      });
    }
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
      if (state.interruptRequested) break;
      const undo = makeMove(b, m);
      const givesCheck = isInCheck(b, opp(color));
      const nextExt = givesCheck && checkExt < 3 ? checkExt + 1 : checkExt;
      const r = alphaBetaSync(b, opp(color), depth + 1, alpha, beta, startTime, timeLimit, maxDepth, nextExt, repSet);
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
  } finally {
    repSet.delete(key);
  }
}

async function alphaBeta(b, color, depth, alpha, beta, startTime, timeLimit, maxDepth, yieldState, checkExt, repSet) {
  if (state.interruptRequested) return { score: evaluate(b), move: null, pv: [] };
  if (Date.now() - startTime > timeLimit) return { score: evaluate(b), move: null, pv: [] };

  const key = boardKey(b, color);
  if (repSet.has(key)) return { score: 0, move: null, pv: [] };
  repSet.add(key);

  try {
    const inCheck = isInCheck(b, color);
    const actualMax = inCheck ? maxDepth + 1 : maxDepth;
    if (depth >= actualMax + checkExt) return { score: evaluate(b), move: null, pv: [] };

    let moves = generateLegalMoves(b, color);
    if (state.continuousCheck && color === 'red') {
      moves = moves.filter(m => {
        const undo = makeMove(b, m);
        const givesCheck = isInCheck(b, opp(color));
        unmakeMove(b, m, undo);
        return givesCheck;
      });
    }
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
      if (state.interruptRequested) break;

      if (Date.now() - yieldState.lastYield > 30) {
        await new Promise(r => setTimeout(r, 0));
        yieldState.lastYield = Date.now();
        if (state.interruptRequested) break;
        if (Date.now() - startTime > timeLimit) break;
      }

      const undo = makeMove(b, m);
      const givesCheck = isInCheck(b, opp(color));
      const nextExt = givesCheck && checkExt < 3 ? checkExt + 1 : checkExt;
      const r = await alphaBeta(b, opp(color), depth + 1, alpha, beta, startTime, timeLimit, maxDepth, yieldState, nextExt, repSet);
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
  } finally {
    repSet.delete(key);
  }
}

export async function searchRootAsync(b, maxDepth, timeLimit) {
  const startTime = Date.now();
  let best = { score: 0, move: null, pv: [] };

  for (let d = 1; d <= maxDepth; d++) {
    if (state.interruptRequested) break;
    const yieldState = { lastYield: Date.now() };
    const r = await alphaBeta(b, 'red', 0, -INF, INF, startTime, timeLimit, d, yieldState, 0, new Set());
    if (Date.now() - startTime >= timeLimit) break;
    best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) break;
  }
  return best;
}

export async function findRefutation(b, color, maxDepth, startTime, timeLimit) {
  let best = { score: 0, move: null, pv: [] };
  for (let d = 2; d <= maxDepth; d += 2) {
    if (state.interruptRequested || Date.now() - startTime > timeLimit) break;
    const yieldState = { lastYield: Date.now() };
    const r = await alphaBeta(b, color, 0, -INF, INF, startTime, timeLimit, d, yieldState, 0, new Set());
    if (r.move) best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) {
      if (!best.move) best = r;
      break;
    }
  }
  return best;
}