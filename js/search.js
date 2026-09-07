// ═══════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════

import { ROWS, COLS, PIECE_VALUES, MATE_VAL, INF } from './constants.js';
import { state, opp, movesEqual } from './state.js';
import { isInCheck, generateLegalMoves, makeMove, unmakeMove } from './rules.js';
import { PIECE_TO_FEN } from './notation.js';

// ─── Static evaluation (material + small positional terms) ───

const SOLD_CROSS = 100;
const SOLDIER_ADV = 12;

const HORSE_PSQT = [
  [-6,-4,-1, 0, 0, 0,-1,-4,-6],
  [-4,-1, 2, 3, 3, 3, 2,-1,-4],
  [-1, 2, 5, 6, 6, 6, 5, 2,-1],
  [ 0, 3, 6, 8, 9, 8, 6, 3, 0],
  [ 1, 4, 7,10,10,10, 7, 4, 1],
  [ 1, 4, 7,10,10,10, 7, 4, 1],
  [ 0, 3, 6, 8, 9, 8, 6, 3, 0],
  [-1, 2, 5, 6, 6, 6, 5, 2,-1],
  [-4,-1, 2, 3, 3, 3, 2,-1,-4],
  [-6,-4,-1, 0, 0, 0,-1,-4,-6],
];

const CANNON_PSQT = [
  [ 0, 0, 1, 2, 2, 2, 1, 0, 0],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [-1, 0, 3, 5, 5, 5, 3, 0,-1],
  [-2, 0, 4, 6, 7, 6, 4, 0,-2],
  [-2, 0, 4, 7, 8, 7, 4, 0,-2],
  [-2, 0, 4, 7, 8, 7, 4, 0,-2],
  [-2, 0, 4, 6, 7, 6, 4, 0,-2],
  [-1, 0, 3, 5, 5, 5, 3, 0,-1],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [ 0, 0, 1, 2, 2, 2, 1, 0, 0],
];

const CHARIOT_PSQT = [
  [ 0, 0, 1, 2, 2, 2, 1, 0, 0],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [ 0, 1, 2, 4, 4, 4, 2, 1, 0],
  [ 0, 1, 2, 4, 4, 4, 2, 1, 0],
  [ 0, 1, 2, 4, 4, 4, 2, 1, 0],
  [ 0, 1, 2, 4, 4, 4, 2, 1, 0],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [ 0, 1, 2, 3, 3, 3, 2, 1, 0],
  [ 0, 0, 1, 2, 2, 2, 1, 0, 0],
];

function evaluate(b) {
  let sc = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      const red = p.color === 'red';
      const idx = red ? r : ROWS - 1 - r;
      let v = PIECE_VALUES[p.type];
      switch (p.type) {
        case 'horse': v += HORSE_PSQT[idx][c]; break;
        case 'cannon': v += CANNON_PSQT[idx][c]; break;
        case 'chariot': v += CHARIOT_PSQT[idx][c]; break;
        case 'soldier': {
          const crossed = red ? r <= 4 : r >= 5;
          if (crossed) v += SOLD_CROSS + SOLDIER_ADV * (red ? 4 - r : r - 5);
          break;
        }
      }
      sc += (red ? 1 : -1) * v;
    }
  }
  return sc;
}

// ─── Move ordering: TT move → captures (MVV-LVA) → killer moves ───

function setKiller(killers, ply, m) {
  if (!killers[ply]) killers[ply] = [];
  const k = killers[ply];
  if (k[0] && movesEqual(k[0], m)) return;
  k[1] = k[0];
  k[0] = m;
}

function moveScore(b, m, ttMove, killers, ply) {
  let s = 0;
  if (ttMove && movesEqual(m, ttMove)) s += 1000000;
  const victim = b[m.to.row][m.to.col];
  if (victim) s += PIECE_VALUES[victim.type] * 16 - PIECE_VALUES[b[m.from.row][m.from.col].type];
  const k = killers[ply];
  if (k) {
    if (k[0] && movesEqual(m, k[0])) s += 10000;
    else if (k[1] && movesEqual(m, k[1])) s += 9000;
  }
  return s;
}

function orderMoves(moves, b, ttMove, killers, ply) {
  const scored = moves.map(m => ({ m, s: moveScore(b, m, ttMove, killers, ply) }));
  scored.sort((a, c) => c.s - a.s);
  for (let i = 0; i < moves.length; i++) moves[i] = scored[i].m;
}

// ─── Board key + transposition table ───

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

const TT_FLAG = { UPPER: -1, EXACT: 0, LOWER: 1 };

function ttKey(b, color) {
  return boardKey(b, color) + (state.continuousCheck ? 'c' : 'n');
}

// ─── Quiescence search (captures + check evasions at the horizon) ───

function generateCaptureMoves(b, color) {
  return generateLegalMoves(b, color).filter(m => b[m.to.row][m.to.col]);
}

function quiesce(b, color, alpha, beta, ctx, ply) {
  if (state.interruptRequested) return evaluate(b);
  if (Date.now() - ctx.startTime > ctx.timeLimit) return evaluate(b);
  if (ply > 64) return evaluate(b);

  const inCheck = isInCheck(b, color);
  const standPat = evaluate(b);

  if (inCheck) {
    let moves = generateLegalMoves(b, color);
    if (moves.length === 0) {
      return (color === 'red' ? -1 : 1) * (MATE_VAL - ctx.maxDepth - ply);
    }
    orderMoves(moves, b, null, ctx.killers, ply);
    let bestScore = color === 'red' ? -INF : INF;
    for (const m of moves) {
      if (state.interruptRequested) break;
      const undo = makeMove(b, m);
      const s = quiesce(b, opp(color), alpha, beta, ctx, ply + 1);
      unmakeMove(b, m, undo);
      if (color === 'red') {
        bestScore = Math.max(bestScore, s);
        alpha = Math.max(alpha, bestScore);
      } else {
        bestScore = Math.min(bestScore, s);
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
    }
    return bestScore;
  }

  if (color === 'red') {
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) return standPat;
    if (standPat < beta) beta = standPat;
  }

  const caps = generateCaptureMoves(b, color);
  orderMoves(caps, b, null, [], 0);
  for (const m of caps) {
    if (state.interruptRequested) break;
    const undo = makeMove(b, m);
    const s = quiesce(b, opp(color), alpha, beta, ctx, ply + 1);
    unmakeMove(b, m, undo);
    if (color === 'red') {
      if (s > alpha) {
        alpha = s;
        if (alpha >= beta) break;
      }
    } else {
      if (s < beta) {
        beta = s;
        if (alpha >= beta) break;
      }
    }
  }
  return color === 'red' ? alpha : beta;
}

// ─── Alpha-beta with TT, check extensions, repetition detection ───

async function alphaBeta(b, color, depth, alpha, beta, ctx, checkExt) {
  if (state.interruptRequested) return { score: evaluate(b), move: null, pv: [] };
  if (Date.now() - ctx.startTime > ctx.timeLimit) return { score: evaluate(b), move: null, pv: [] };

  const key = ttKey(b, color);
  if (ctx.repSet.has(key)) return { score: 0, move: null, pv: [] };
  ctx.repSet.add(key);

  try {
    const inCheck = isInCheck(b, color);
    const actualMax = inCheck ? ctx.maxDepth + 1 : ctx.maxDepth;
    const remDepth = actualMax + checkExt - depth;
    if (remDepth <= 0) {
      return { score: quiesce(b, color, alpha, beta, ctx, 0), move: null, pv: [] };
    }

    const ttEntry = ctx.tt.get(key);
    if (ttEntry && ttEntry.depth >= remDepth) {
      if (ttEntry.flag === TT_FLAG.EXACT) return { score: ttEntry.score, move: ttEntry.move, pv: [] };
      if (ttEntry.flag === TT_FLAG.LOWER && ttEntry.score >= beta) return { score: ttEntry.score, move: ttEntry.move, pv: [] };
      if (ttEntry.flag === TT_FLAG.UPPER && ttEntry.score <= alpha) return { score: ttEntry.score, move: ttEntry.move, pv: [] };
    }
    const ttMove = ttEntry ? ttEntry.move : null;

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
      const s = (color === 'red' ? -1 : 1) * (MATE_VAL - depth);
      ctx.tt.set(key, { depth: remDepth, score: s, flag: TT_FLAG.EXACT, move: null });
      return { score: s, move: null, pv: [] };
    }

    orderMoves(moves, b, ttMove, ctx.killers, depth);

    let bestMove = null, bestPV = [];
    let bestScore = color === 'red' ? -INF : INF;
    const alpha0 = alpha, beta0 = beta;

    for (const m of moves) {
      if (state.interruptRequested) break;

      if (Date.now() - ctx.yieldState.lastYield > 30) {
        await new Promise(r => setTimeout(r, 0));
        ctx.yieldState.lastYield = Date.now();
        if (state.interruptRequested) break;
        if (Date.now() - ctx.startTime > ctx.timeLimit) break;
      }

      const undo = makeMove(b, m);
      const givesCheck = isInCheck(b, opp(color));
      const nextExt = givesCheck && checkExt < 3 ? checkExt + 1 : checkExt;
      const r = await alphaBeta(b, opp(color), depth + 1, alpha, beta, ctx, nextExt);
      unmakeMove(b, m, undo);

      if (color === 'red') {
        if (r.score > bestScore) {
          bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv];
          if (!b[m.to.row][m.to.col] && bestScore >= beta) setKiller(ctx.killers, depth, m);
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (r.score < bestScore) {
          bestScore = r.score; bestMove = m; bestPV = [m, ...r.pv];
          if (!b[m.to.row][m.to.col] && bestScore <= alpha) setKiller(ctx.killers, depth, m);
        }
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
    }

    let flag;
    if (bestScore <= alpha0) flag = TT_FLAG.UPPER;
    else if (bestScore >= beta0) flag = TT_FLAG.LOWER;
    else flag = TT_FLAG.EXACT;
    if (ctx.tt.size > 262144) ctx.tt.clear();
    ctx.tt.set(key, { depth: remDepth, score: bestScore, flag, move: bestMove });

    return { score: bestScore, move: bestMove, pv: bestPV };
  } finally {
    ctx.repSet.delete(key);
  }
}

// ─── Root entry points ───

function cloneBoard(b) {
  return b.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

// A mate score can be reported at the quiescence horizon, cutting the PV before
// the final mating position. Replay the PV and carry each side's best reply
// forward one ply at a time until the mate is actually reached (or a cap).
async function extendMatePV(board, pv, startTime, timeLimit) {
  const b = cloneBoard(board);
  let color = 'red';
  for (const m of pv) {
    makeMove(b, m);
    color = opp(color);
  }
  const extended = pv.slice();
  for (let i = 0; i < 40; i++) {
    if (Date.now() - startTime > timeLimit) break;
    if (generateLegalMoves(b, color).length === 0) break;
    const ctx = {
      startTime, timeLimit, maxDepth: 4,
      repSet: new Set(), tt: new Map(), killers: [],
      yieldState: { lastYield: Date.now() },
    };
    const r = await alphaBeta(b, color, 0, -INF, INF, ctx, 0);
    if (!r.move) break;
    extended.push(r.move);
    makeMove(b, r.move);
    color = opp(color);
  }
  return extended;
}

export async function searchRootAsync(b, maxDepth, timeLimit) {
  const startTime = Date.now();
  let best = { score: 0, move: null, pv: [] };
  const tt = new Map();
  const killers = [];
  for (let d = 1; d <= maxDepth; d++) {
    if (state.interruptRequested) break;
    const ctx = {
      startTime, timeLimit, maxDepth: d,
      repSet: new Set(), tt, killers,
      yieldState: { lastYield: Date.now() },
    };
    const r = await alphaBeta(b, 'red', 0, -INF, INF, ctx, 0);
    if (Date.now() - startTime >= timeLimit) break;
    best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) {
      best.pv = await extendMatePV(b, r.pv, startTime, timeLimit);
      break;
    }
  }
  return best;
}

export async function findRefutation(b, color, maxDepth, startTime, timeLimit) {
  let best = { score: 0, move: null, pv: [] };
  const tt = new Map();
  const killers = [];
  for (let d = 2; d <= maxDepth; d += 2) {
    if (state.interruptRequested || Date.now() - startTime > timeLimit) break;
    const ctx = {
      startTime, timeLimit, maxDepth: d,
      repSet: new Set(), tt, killers,
      yieldState: { lastYield: Date.now() },
    };
    const r = await alphaBeta(b, color, 0, -INF, INF, ctx, 0);
    if (r.move) best = r;
    if (Math.abs(r.score) > MATE_VAL / 2) {
      if (!best.move) best = r;
      break;
    }
  }
  return best;
}