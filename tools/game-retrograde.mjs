import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';

const opposite = side => side === 'red' ? 'black' : 'red';
const boardKey = board => boardToFen(board).split(' ')[0];
export const GRAPH_LIMIT = 50000;

export const GRAPH_EDGE_LIMIT = 400000;

// Increasing distance is essential: the first winning child gives the fastest
// win, while a loss is settled only after ALL children prove opponent wins.
class DistanceQueue {
  items = [];
  push(node) {
    const a = this.items;
    let i = a.length;
    a.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].distance <= node.distance) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = node;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1].distance < a[child].distance) child++;
        if (a[child].distance >= last.distance) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

// Nodes contain side, edges [{to, move}], and an optional known winner/distance
// (terminal or previously solved boundary). Everything else starts unknown.
export function resolveGraph(nodes, check = () => {}) {
  const queue = new DistanceQueue();
  for (const node of nodes) {
    check();
    node.parents = [];
    node.remaining = node.edges.length;
    node.longest = 0;
    if (node.winner && node.winner !== 'draw') queue.push(node);
  }
  for (const node of nodes) {
    check();
    for (const edge of node.edges) edge.to.parents.push(node);
  }
  while (queue.items.length) {
    check();
    const child = queue.pop();
    for (const parent of child.parents) {
      if (parent.winner) continue;
      if (child.winner === parent.side) {
        parent.winner = parent.side;
        parent.distance = child.distance + 1;
        queue.push(parent);
      } else {
        parent.remaining--;
        parent.longest = Math.max(parent.longest, child.distance);
        if (parent.remaining === 0) {
          parent.winner = opposite(parent.side);
          parent.distance = parent.longest + 1;
          queue.push(parent);
        }
      }
    }
  }
  // Only a COMPLETE graph permits this conclusion. Draw boundaries and cycles
  // prevent a loss from propagating and need no special history restrictions.
  for (const node of nodes) {
    check();
    if (!node.winner) { node.winner = 'draw'; node.distance = null; }
  }
  for (const node of nodes) {
    check();
    let best = null;
    for (const edge of node.edges) {
      if (edge.to.winner !== node.winner) continue;
      if (!best || (node.winner === node.side
        ? edge.to.distance < best.to.distance : edge.to.distance > best.to.distance)) best = edge;
    }
    if (best) { node.move = best.move; node.next = best.to.key; }
  }
}

export class RetrogradeSolver {
  constructor(positions = new Map(), { maxNodes = GRAPH_LIMIT, maxEdges = GRAPH_EDGE_LIMIT } = {}) {
    this.positions = positions;
    this.maxNodes = maxNodes;
    this.maxEdges = maxEdges;
    this.frontier = new Map();
    this.frontierEdges = 0;
    this.expanded = 0;
    this.lastProbe = null;
  }

  remember(key, record) {
    this.frontier.set(key, record);
    this.frontierEdges += record.edges.length;
    while (this.frontier.size > this.maxNodes || this.frontierEdges > this.maxEdges) {
      const oldest = this.frontier.keys().next().value;
      this.frontierEdges -= this.frontier.get(oldest).edges.length;
      this.frontier.delete(oldest);
    }
  }

  solve(board, side, check, expansionBudget = Infinity) {
    const rootFen = boardKey(board), rootKey = `${side}:${rootFen}`;
    check();
    if (this.positions.has(rootKey)) return this.positions.get(rootKey);
    const graph = new Map(), pending = [];
    let edges = 0, processed = 0, expanded = 0;
    const stop = reason => {
      this.lastProbe = { reason, states: graph.size, processed, expanded, edges };
      return null;
    };
    const discover = (fen, turn) => {
      const key = `${turn}:${fen}`;
      if (graph.has(key)) return graph.get(key);
      if (graph.size >= this.maxNodes) throw NODE_LIMIT;
      const cached = this.positions.get(key);
      const node = { key, fen, side: turn, edges: [], ...cached };
      graph.set(key, node);
      if (!cached) pending.push(node);
      return node;
    };
    try {
      const root = discover(rootFen, side);
      for (let i = 0; i < pending.length; i++) {
        check();
        const node = pending[i];
        let record = this.frontier.get(node.key);
        if (!record) {
          if (expanded >= expansionBudget) return stop('probe');
          const current = parseFen(node.fen).board;
          const kings = findKings(current);
          let winner = !kings.red ? 'black' : !kings.black ? 'red' : null;
          const moves = winner ? [] : generateLegalMoves(current, node.side);
          if (!winner && !moves.length) winner = opposite(node.side);
          record = { winner, edges: [] };
          for (const move of moves) {
            check();
            record.edges.push({ move, fen: boardKey(applyBoardCopy(current, move)) });
          }
          // A frontier record is committed only after all its legal moves are
          // generated. It is reusable work, not a proof of the position's value.
          this.remember(node.key, record);
          this.expanded++;
          expanded++;
        }
        processed++;
        if (record.winner) { node.winner = record.winner; node.distance = 0; continue; }
        for (const edge of record.edges) {
          check();
          if (++edges > this.maxEdges) return stop('edges');
          node.edges.push({ move: edge.move, to: discover(edge.fen, opposite(node.side)) });
        }
      }
      resolveGraph([...graph.values()], check);
      // Only a complete graph is eligible for draw classification and proofs.
      check();
      for (const node of graph.values()) {
        this.positions.set(node.key, { winner: node.winner, distance: node.distance,
          move: node.move ?? null, next: node.next ?? null });
      }
      this.lastProbe = { reason: 'complete', states: graph.size, processed, expanded, edges };
      return this.positions.get(root.key);
    } catch (error) {
      if (error === NODE_LIMIT) return stop('nodes');
      throw error;
    }
  }

  snapshot() {
    return { expanded: this.expanded, frontier: [...this.frontier] };
  }

  restore(data) {
    this.expanded = data.expanded;
    for (const [key, record] of data.frontier) this.remember(key, record);
  }
}

const NODE_LIMIT = Symbol('graph node budget');
