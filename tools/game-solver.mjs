// Small endgames share a complete retrograde graph. Larger games use terminal-
// only minimax: horizon positions are unknown, never a material evaluation.
// Both methods prove mate distance and allow cycles with draw value.
import { MATE_VAL, INF } from '../js/constants.js';
import { boardToFen } from '../js/notation.js';
import { pieceInfo } from '../js/board.js';
import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../js/rules.js';
import { RetrogradeSolver, fitsGraph } from './game-retrograde.mjs';

const opposite = side => side === 'red' ? 'black' : 'red';
const sameMove = (a, b) => a && b && a.from.row === b.from.row &&
  a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
const relativeScore = (score, ply) => score > 0 ? score + ply : score < 0 ? score - ply : 0;
const absoluteScore = (score, ply) => score > 0 ? score - ply : score < 0 ? score + ply : 0;
const positionKey = (board, side) => `${side}:${boardToFen(board).split(' ')[0]}`;

export class GameSolver {
  constructor({ useGraph = true } = {}) {
    this.tt = new Map();
    this.graph = useGraph ? new RetrogradeSolver() : null;
    this.method = 'search';
  }

  solve(board, side, maxDepth, deadline) {
    this.method = 'search';
    if (this.graph && fitsGraph(board)) {
      this.method = 'graph';
      const before = this.graph.expanded;
      const check = () => { if (Date.now() >= deadline) throw TIMEOUT; };
      try {
        const result = this.graph.solve(board, side, check);
        const pv = [], seen = new Set();
        let position = result;
        while (position.move && !seen.has(position)) {
          check();
          seen.add(position);
          pv.push(position.move);
          position = this.graph.positions.get(position.next);
        }
        return { score: result.winner === 'draw' ? 0 :
          (result.winner === 'red' ? 1 : -1) * (MATE_VAL - result.distance),
          move: result.move, pv, resolved: true, depth: result.distance,
          nodes: this.graph.expanded - before, interrupted: false };
      } catch (error) {
        if (error !== TIMEOUT) throw error;
        return { score: 0, move: null, pv: [], resolved: false, depth: 0,
          nodes: this.graph.expanded - before, interrupted: true };
      }
    }
    const rootKey = positionKey(board, side);
    const proven = this.tt.get(rootKey);
    const distance = proven?.score ? MATE_VAL - Math.abs(proven.score) : 0;
    if (proven?.resolved && distance <= maxDepth && Date.now() < deadline) {
      return { score: proven.score, move: proven.move, pv: proven.pv,
        resolved: true, depth: distance, nodes: 0, interrupted: false };
    }
    const ctx = { deadline, nodes: 0, repeats: 0, horizons: 0, path: new Set() };
    let best = { score: 0, move: null, pv: [], resolved: false, depth: 0 };
    for (let depth = 1; depth <= maxDepth; depth++) {
      try {
        const result = this.search(board, side, depth, 0, -INF, INF, ctx);
        best = { ...result, depth };
        if (result.resolved) {
          // A root proof starts with an empty history, so it is safe to share
          // even when other explored branches contained cycles.
          this.tt.set(rootKey, { ...result, depth, flag: 'exact' });
          break;
        }
      } catch (error) {
        if (error !== TIMEOUT) throw error;
        return { ...best, nodes: ctx.nodes, interrupted: true };
      }
    }
    return { ...best, nodes: ctx.nodes, interrupted: false };
  }

  search(board, side, remaining, ply, alpha, beta, ctx) {
    if (Date.now() >= ctx.deadline) throw TIMEOUT;
    ctx.nodes++;
    const key = positionKey(board, side);
    if (ctx.path.has(key)) {
      ctx.repeats++;
      return { score: 0, move: null, pv: [], resolved: true };
    }
    const entry = this.tt.get(key);
    if (entry && (entry.depth === remaining ||
        entry.resolved && (entry.score === 0 || MATE_VAL - Math.abs(entry.score) <= remaining))) {
      const score = absoluteScore(entry.score, ply);
      if (entry.flag === 'exact' || entry.flag === 'lower' && score >= beta ||
          entry.flag === 'upper' && score <= alpha) {
        if (!entry.resolved) ctx.horizons++;
        return { score, move: entry.move, pv: entry.pv, resolved: entry.resolved };
      }
    }

    const info = pieceInfo(board);
    let winner = !info.red ? 'black' : !info.black ? 'red' : null;
    const moves = winner ? [] : generateLegalMoves(board, side, info);
    if (!winner && moves.length === 0) winner = opposite(side);
    if (winner) return {
      score: (winner === 'red' ? 1 : -1) * (MATE_VAL - ply),
      move: null, pv: [], resolved: true,
    };
    if (remaining === 0) {
      ctx.horizons++;
      return { score: 0, move: null, pv: [], resolved: false };
    }

    // Checks and captures first for either side; coordinates break ties. This
    // ordering affects speed only, not which outcomes are considered.
    const ordered = moves.map(move => {
      const undo = makeMove(board, move);
      let check;
      try { check = isInCheck(board, opposite(side)); }
      finally { unmakeMove(board, move, undo); }
      return { move, rank: (sameMove(move, entry?.move) ? 4 : 0) +
        (check ? 2 : 0) + (move.captured ? 1 : 0) };
    }).sort((a, b) => b.rank - a.rank ||
      a.move.from.row - b.move.from.row || a.move.from.col - b.move.from.col ||
      a.move.to.row - b.move.to.row || a.move.to.col - b.move.to.col);

    const alpha0 = alpha, beta0 = beta;
    const repeats = ctx.repeats, horizons = ctx.horizons;
    let score = side === 'red' ? -INF : INF;
    let bestMove = null, pv = [];
    ctx.path.add(key);
    try {
      for (const { move } of ordered) {
        const undo = makeMove(board, move);
        let child;
        try {
          child = this.search(board, opposite(side), remaining - 1, ply + 1, alpha, beta, ctx);
        } finally { unmakeMove(board, move, undo); }
        if (side === 'red' ? child.score > score : child.score < score) {
          score = child.score;
          bestMove = move;
          pv = [move, ...child.pv];
        }
        if (side === 'red') alpha = Math.max(alpha, score);
        else beta = Math.min(beta, score);
        if (alpha >= beta) break;
      }
    } finally { ctx.path.delete(key); }

    const flag = score <= alpha0 ? 'upper' : score >= beta0 ? 'lower' : 'exact';
    const resolved = flag === 'exact' && (score !== 0 || ctx.horizons === horizons);
    // Repetition depends on the current path: don't cache it as a fact about
    // the board. Mate scores in the TT are distances relative to this node.
    if (ctx.repeats === repeats && (!entry?.resolved || resolved)) {
      if (this.tt.size >= 100000) this.tt.clear();
      this.tt.set(key, { depth: remaining, score: relativeScore(score, ply),
        flag, move: bestMove, pv, resolved });
    }
    return { score, move: bestMove, pv, resolved };
  }
}

const TIMEOUT = Symbol('game search timeout');
