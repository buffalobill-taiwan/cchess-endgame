// Shared exact proofs, bounded transient search data, and budgeted graph probes.
import { MATE_VAL, INF } from '../js/constants.js';
import { boardToFen } from '../js/notation.js';
import { pieceInfo, applyBoardCopy } from '../js/board.js';
import { generateLegalMoves, isInCheck, makeMove, unmakeMove } from '../js/rules.js';
import { RetrogradeSolver, GRAPH_LIMIT, GRAPH_EDGE_LIMIT } from './game-retrograde.mjs';

const opposite = side => side === 'red' ? 'black' : 'red';
const sameMove = (a, b) => a && b && a.from.row === b.from.row &&
  a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
const relativeScore = (score, ply) => score > 0 ? score + ply : score < 0 ? score - ply : 0;
const absoluteScore = (score, ply) => score > 0 ? score - ply : score < 0 ? score + ply : 0;
const boardKey = board => boardToFen(board).split(' ')[0];
const positionKey = (board, side) => `${side}:${boardKey(board)}`;
const proofScore = p => p.winner === 'draw' ? 0 :
  (p.winner === 'red' ? 1 : -1) * (MATE_VAL - p.distance);

export class GameSolver {
  constructor({ useGraph = true, ttLimit = 100000, graphNodes = GRAPH_LIMIT,
    graphEdges = GRAPH_EDGE_LIMIT, isCancelled = () => false, onTick = () => {} } = {}) {
    this.proofs = new Map();
    this.tt = new Map();
    this.iterations = new Map();
    this.ttLimit = ttLimit;
    this.graph = useGraph ? new RetrogradeSolver(this.proofs, { maxNodes: graphNodes, maxEdges: graphEdges }) : null;
    this.isCancelled = isCancelled;
    this.onTick = onTick;
    this.method = 'search';
    this.proofHits = 0;
    this.preferredKnown = 0;
  }

  check(deadline) {
    if (this.isCancelled() || Date.now() >= deadline) throw TIMEOUT;
    this.onTick();
  }

  context(deadline, nodeLimit = Infinity) {
    return { deadline, nodes: 0, nodeLimit, repeats: 0, horizons: 0, path: new Set() };
  }

  storeTransient(key, record) {
    this.tt.delete(key);
    this.tt.set(key, record);
    while (this.tt.size > this.ttLimit) this.tt.delete(this.tt.keys().next().value);
  }

  rememberProof(board, side, result) {
    const proof = { winner: result.score === 0 ? 'draw' : result.score > 0 ? 'red' : 'black',
      distance: result.score === 0 ? null : MATE_VAL - Math.abs(result.score),
      move: result.move, next: result.move ? positionKey(applyBoardCopy(board, result.move), opposite(side)) : null,
      pv: result.pv };
    this.proofs.set(positionKey(board, side), proof);
    return proof;
  }

  proofPV(proof) {
    if (proof.pv) return proof.pv;
    const pv = [], seen = new Set();
    while (proof?.move && !seen.has(proof)) {
      seen.add(proof);
      pv.push(proof.move);
      proof = this.proofs.get(proof.next);
    }
    return pv;
  }

  result(proof, nodes = 0) {
    return { score: proofScore(proof), move: proof.move, pv: this.proofPV(proof),
      resolved: true, depth: proof.distance, nodes, interrupted: false };
  }

  solve(board, side, maxDepth, deadline) {
    const rootKey = positionKey(board, side);
    this.method = 'search';
    const saved = this.iterations.get(rootKey);
    let best = saved?.best ?? { score: 0, move: null, pv: [], resolved: false, depth: 0 };
    let ctx = this.context(deadline, 2000), nodes = 0;
    try {
      this.check(deadline);
      const proven = this.proofs.get(rootKey);
      if (proven) { this.proofHits++; this.method = 'proof'; return this.result(proven); }
      const deepen = depth => {
        const result = this.search(board, side, depth, 0, -INF, INF, ctx);
        best = { ...result, depth };
        if (result.resolved) {
          this.rememberProof(board, side, result);
          this.iterations.delete(rootKey);
        } else this.iterations.set(rootKey, { best });
        return result.resolved;
      };
      // Cheap forced replies often settle in one or two plies. Don't build an
      // entire graph to answer them. The probe budget is work-based, not timing.
      try {
        for (let d = best.depth + 1; d <= Math.min(2, maxDepth); d++) {
          if (deepen(d)) return { ...best, nodes: ctx.nodes, interrupted: false };
        }
      } catch (error) { if (error !== PROBE_LIMIT) throw error; }
      nodes += ctx.nodes;
      if (this.graph) {
        this.method = 'graph';
        const before = this.graph.expanded;
        let batch = 256;
        while (true) {
          const proof = this.graph.solve(board, side, () => this.check(deadline), batch);
          if (proof) return this.result(proof, nodes + this.graph.expanded - before);
          const probe = this.graph.lastProbe;
          // Continue a graph that is closing through transpositions. Rapidly
          // growing frontiers and actual resource limits fall back to search.
          if (probe.reason !== 'probe' || probe.states > Math.max(1, probe.processed) * 3) break;
          batch = Math.min(batch * 2, 4096);
        }
        nodes += this.graph.expanded - before;
      }
      this.method = 'search';
      ctx = this.context(deadline);
      for (let d = best.depth + 1; d <= maxDepth; d++) {
        if (deepen(d)) return { ...best, nodes: nodes + ctx.nodes, interrupted: false };
      }
      return { ...best, nodes: nodes + ctx.nodes, interrupted: false };
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      return { ...best, resolved: false, nodes: nodes + ctx.nodes, interrupted: true };
    }
  }

  // Only equal outcome AND equal distance may override a proven best reply.
  // Optional tie probes are bounded; unknown candidates never replace it.
  preferKnown(board, moves, known, result, deadline) {
    const root = this.proofs.get(positionKey(board, 'black'));
    if (!root || known.has(boardKey(applyBoardCopy(board, result.move)))) return result.move;
    for (const move of moves) {
      const childBoard = applyBoardCopy(board, move), fen = boardKey(childBoard);
      if (!known.has(fen)) continue;
      this.check(deadline);
      let child = this.proofs.get(`red:${fen}`);
      if (!child && root.winner !== 'draw') {
        const ctx = this.context(deadline, 2000);
        try {
          const reply = this.search(childBoard, 'red', root.distance - 1, 0, -INF, INF, ctx);
          if (reply.resolved) child = this.rememberProof(childBoard, 'red', reply);
        } catch (error) { if (error !== PROBE_LIMIT) throw error; }
      }
      if (child?.winner === root.winner &&
          (root.winner === 'draw' || child.distance + 1 === root.distance)) {
        this.preferredKnown++;
        return move;
      }
    }
    return result.move;
  }

  snapshot() {
    return { proofs: [...this.proofs], transient: [...this.tt], iterations: [...this.iterations],
      graph: this.graph?.snapshot() ?? null };
  }

  restore(data) {
    for (const [key, proof] of data.proofs) this.proofs.set(key, proof);
    for (const [key, entry] of data.transient) this.storeTransient(key, entry);
    this.iterations = new Map(data.iterations);
    if (this.graph && data.graph) this.graph.restore(data.graph);
  }

  search(board, side, remaining, ply, alpha, beta, ctx) {
    this.check(ctx.deadline);
    if (++ctx.nodes > ctx.nodeLimit) throw PROBE_LIMIT;
    const key = positionKey(board, side);
    if (ctx.path.has(key)) {
      ctx.repeats++;
      return { score: 0, move: null, pv: [], resolved: true };
    }
    const proof = this.proofs.get(key);
    // Don't let a long cached mate jump a finite horizon: other branches may
    // contain a shorter, still undiscovered mate. Root lookups have no horizon.
    if (proof && (proof.winner === 'draw' || proof.distance <= remaining)) {
      this.proofHits++;
      return { score: absoluteScore(proofScore(proof), ply), move: proof.move,
        pv: this.proofPV(proof), resolved: true };
    }
    const entry = this.tt.get(key);
    if (entry) { this.tt.delete(key); this.tt.set(key, entry); }
    if (entry && entry.depth === remaining) {
      const score = absoluteScore(entry.score, ply);
      if (entry.flag === 'exact' || entry.flag === 'lower' && score >= beta ||
          entry.flag === 'upper' && score <= alpha) {
        ctx.horizons++;
        return { score, move: entry.move, pv: entry.pv, resolved: false };
      }
    }

    const info = pieceInfo(board);
    let winner = !info.red ? 'black' : !info.black ? 'red' : null;
    const moves = winner ? [] : generateLegalMoves(board, side, info);
    if (!winner && moves.length === 0) winner = opposite(side);
    if (winner) {
      this.proofs.set(key, { winner, distance: 0, move: null, next: null });
      return { score: (winner === 'red' ? 1 : -1) * (MATE_VAL - ply),
        move: null, pv: [], resolved: true };
    }
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
      return { move, rank: (ply > 0 && sameMove(move, entry?.move) ? 4 : 0) +
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
    if (ctx.repeats === repeats) {
      const record = { score: relativeScore(score, ply), move: bestMove, pv, resolved };
      if (resolved) this.rememberProof(board, side, record);
      else this.storeTransient(key, { ...record, depth: remaining, flag });
    }
    return { score, move: bestMove, pv, resolved };
  }
}

const TIMEOUT = Symbol('game search timeout');
const PROBE_LIMIT = Symbol('search probe budget');
