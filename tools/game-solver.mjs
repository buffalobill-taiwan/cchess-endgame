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
    this.activeSearch = null;
    this.ttLimit = ttLimit;
    this.graph = useGraph ? new RetrogradeSolver(this.proofs, { maxNodes: graphNodes, maxEdges: graphEdges }) : null;
    this.isCancelled = isCancelled;
    this.onTick = onTick;
    this.method = 'search';
    this.proofHits = 0;
    this.preferredKnown = 0;
    // Proven non-losing policies may contain cycles; they do not claim an
    // exact outcome or mate distance and must stay separate from proofs.
    this.defenses = new Map();
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

  defend(board, maxDepth, deadline) {
    const rootKey = positionKey(board, 'black');
    if (this.defenses.has(rootKey)) return this.defenses.get(rootKey);
    let nodes = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const path = new Set(), safe = new Map(), journal = [];
      const rollback = start => {
        while (journal.length > start) safe.delete(journal.pop());
      };
      const visit = (board, side, remaining) => {
        this.check(deadline);
        if (++nodes > 20000) throw PROBE_LIMIT;
        const key = positionKey(board, side);
        if (path.has(key) || safe.has(key)) return true;
        if (this.defenses.has(key)) return true;
        const proof = this.proofs.get(key);
        if (proof) {
          if (proof.winner === 'red') return false;
          safe.set(key, proof.move); journal.push(key);
          return true;
        }
        const info = pieceInfo(board);
        const moves = !info.red || !info.black ? [] : generateLegalMoves(board, side, info);
        if (!info.black) return false;
        if (!info.red || !moves.length) return !info.red || side === 'red';
        if (!remaining) return false;
        const start = journal.length;
        path.add(key);
        // Check/capture ordering finds immediate punishments of red mistakes
        // before exploring quiet play. Existing policy links close cycles first.
        const ordered = moves.map(move => {
          const child = applyBoardCopy(board, move);
          const childKey = positionKey(child, opposite(side));
          return { move, child, rank: (path.has(childKey) || safe.has(childKey) ? 4 : 0) +
            (isInCheck(child, opposite(side)) ? 2 : 0) + (move.captured ? 1 : 0) };
        }).sort((a, b) => b.rank - a.rank);
        let accepted = side === 'red', chosen = null;
        for (const { move, child } of ordered) {
          const ok = visit(child, opposite(side), remaining - 1);
          if (side === 'black' && ok) { accepted = true; chosen = move; break; }
          if (side === 'red' && !ok) { accepted = false; break; }
        }
        path.delete(key);
        if (!accepted) {
          // Descendants may have assumed this ancestor was safe. Discard them
          // together when the ancestor fails, including their chosen replies.
          rollback(start);
          return false;
        }
        safe.set(key, chosen); journal.push(key);
        return true;
      };
      try {
        if (visit(board, 'black', depth)) {
          for (const [key, move] of safe) this.defenses.set(key, move);
          return this.defenses.get(rootKey);
        }
      } catch (error) {
        if (error === PROBE_LIMIT || error === TIMEOUT) return null;
        throw error;
      }
    }
    return null;
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
      if (proven) {
        this.activeSearch = null;
        this.proofHits++; this.method = 'proof'; return this.result(proven);
      }
      const deepen = depth => {
        const result = this.search(board, side, depth, 0, -INF, INF, ctx, true);
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
      if (this.graph && !(this.activeSearch?.rootKey === rootKey && this.activeSearch.depth > 2)) {
        this.method = 'graph';
        const before = this.graph.expanded;
        let batch = 256;
        while (true) {
          const proof = this.graph.solve(board, side, () => this.check(deadline), batch);
          if (proof) {
            this.activeSearch = null;
            return this.result(proof, nodes + this.graph.expanded - before);
          }
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
      defenses: [...this.defenses],
      activeSearch: this.activeSearch, graph: this.graph?.snapshot() ?? null };
  }

  restore(data) {
    this.defenses = new Map(data.defenses ?? []);
    for (const [key, proof] of data.proofs) this.proofs.set(key, proof);
    for (const [key, entry] of data.transient) this.storeTransient(key, entry);
    this.iterations = new Map(data.iterations);
    this.activeSearch = data.activeSearch ?? null;
    if (this.graph && data.graph) this.graph.restore(data.graph);
  }

  // Explicit frames are JSON-safe continuations. Checkpoints are taken only
  // between complete frame transitions; no caller board is ever left mutated.
  search(board, side, remaining, ply, alpha, beta, ctx, resumable = false) {
    const rootKey = positionKey(board, side);
    const frame = (board, side, remaining, ply, alpha, beta) => ({
      board, side, remaining, ply, alpha, beta, key: positionKey(board, side), stage: 'enter',
    });
    let task = resumable ? this.activeSearch : null;
    if (!task || task.rootKey !== rootKey || task.depth !== remaining) {
      task = { rootKey, depth: remaining, repeats: 0, horizons: 0,
        stack: [frame(board, side, remaining, ply, alpha, beta)] };
    }
    if (resumable) this.activeSearch = task;
    const path = new Set(task.stack.filter(f => f.stage === 'children').map(f => f.key));
    let result;
    const finish = value => {
      const finished = task.stack.pop();
      if (finished.stage === 'children') path.delete(finished.key);
      if (!task.stack.length) { result = value; return; }
      const parent = task.stack.at(-1), move = parent.ordered[parent.index++];
      if (parent.side === 'red' ? value.score > parent.score : value.score < parent.score) {
        parent.score = value.score;
        parent.bestMove = move;
        parent.pv = [move, ...value.pv];
      }
      if (parent.side === 'red') parent.alpha = Math.max(parent.alpha, parent.score);
      else parent.beta = Math.min(parent.beta, parent.score);
    };
    while (task.stack.length) {
      this.check(ctx.deadline);
      const f = task.stack.at(-1);
      if (f.stage === 'enter') {
        if (ctx.nodes >= ctx.nodeLimit) throw PROBE_LIMIT;
        ctx.nodes++;
        if (path.has(f.key)) {
          task.repeats++;
          finish({ score: 0, move: null, pv: [], resolved: true });
          continue;
        }
        const proof = this.proofs.get(f.key);
        if (proof && (proof.winner === 'draw' || proof.distance <= f.remaining)) {
          this.proofHits++;
          finish({ score: absoluteScore(proofScore(proof), f.ply), move: proof.move,
            pv: this.proofPV(proof), resolved: true });
          continue;
        }
        const entry = this.tt.get(f.key);
        if (entry) { this.tt.delete(f.key); this.tt.set(f.key, entry); }
        if (entry && entry.depth === f.remaining) {
          const score = absoluteScore(entry.score, f.ply);
          if (entry.flag === 'exact' || entry.flag === 'lower' && score >= f.beta ||
              entry.flag === 'upper' && score <= f.alpha) {
            task.horizons++;
            finish({ score, move: entry.move, pv: entry.pv, resolved: false });
            continue;
          }
        }
        const info = pieceInfo(f.board);
        let winner = !info.red ? 'black' : !info.black ? 'red' : null;
        const moves = winner ? [] : generateLegalMoves(f.board, f.side, info);
        if (!winner && !moves.length) winner = opposite(f.side);
        if (winner) {
          this.proofs.set(f.key, { winner, distance: 0, move: null, next: null });
          finish({ score: (winner === 'red' ? 1 : -1) * (MATE_VAL - f.ply),
            move: null, pv: [], resolved: true });
          continue;
        }
        if (f.remaining === 0) {
          task.horizons++;
          finish({ score: 0, move: null, pv: [], resolved: false });
          continue;
        }
        f.ordered = moves.map(move => {
          const undo = makeMove(f.board, move);
          let check;
          try { check = isInCheck(f.board, opposite(f.side)); }
          finally { unmakeMove(f.board, move, undo); }
          return { move, rank: (f.ply > 0 && sameMove(move, entry?.move) ? 4 : 0) +
            (check ? 2 : 0) + (move.captured ? 1 : 0) };
        }).sort((a, b) => b.rank - a.rank ||
          a.move.from.row - b.move.from.row || a.move.from.col - b.move.from.col ||
          a.move.to.row - b.move.to.row || a.move.to.col - b.move.to.col).map(x => x.move);
        Object.assign(f, { stage: 'children', index: 0, alpha0: f.alpha, beta0: f.beta,
          repeats: task.repeats, horizons: task.horizons,
          score: f.side === 'red' ? -INF : INF, bestMove: null, pv: [] });
        path.add(f.key);
      } else if (f.index < f.ordered.length && f.alpha < f.beta) {
        task.stack.push(frame(applyBoardCopy(f.board, f.ordered[f.index]), opposite(f.side),
          f.remaining - 1, f.ply + 1, f.alpha, f.beta));
      } else {
        const flag = f.score <= f.alpha0 ? 'upper' : f.score >= f.beta0 ? 'lower' : 'exact';
        const resolved = flag === 'exact' && (f.score !== 0 || task.horizons === f.horizons);
        if (task.repeats === f.repeats) {
          const record = { score: relativeScore(f.score, f.ply), move: f.bestMove, pv: f.pv, resolved };
          if (resolved) this.rememberProof(f.board, f.side, record);
          else this.storeTransient(f.key, { ...record, depth: f.remaining, flag });
        }
        finish({ score: f.score, move: f.bestMove, pv: f.pv, resolved });
      }
    }
    ctx.repeats += task.repeats;
    ctx.horizons += task.horizons;
    if (resumable) this.activeSearch = null;
    return result;
  }
}

const TIMEOUT = Symbol('game search timeout');
const PROBE_LIMIT = Symbol('search probe budget');
