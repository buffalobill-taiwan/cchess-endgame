import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';

const opposite = side => side === 'red' ? 'black' : 'red';
const boardKey = board => boardToFen(board).split(' ')[0];
export const GRAPH_LIMIT = 50000;

// Conservative placement bound, including captures and both sides to move.
// This decides which algorithm to use; it never truncates a proof.
export function fitsGraph(board) {
  let bound = 2;
  for (let row = 0; row < board.length; row++) {
    for (const piece of board[row]) {
      if (!piece) continue;
      const places = piece.type === 'king' ? 11 : piece.type === 'advisor' ? 7 :
        piece.type === 'elephant' ? 17 : piece.type === 'soldier'
          ? (piece.color === 'red' ? row + 1 : 10 - row) * 9 + 1 : 91;
      bound *= places;
      if (bound > GRAPH_LIMIT) return false;
    }
  }
  return true;
}

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
  positions = new Map();
  expanded = 0;

  solve(board, side, check) {
    const rootFen = boardKey(board), rootKey = `${side}:${rootFen}`;
    check();
    if (this.positions.has(rootKey)) return this.positions.get(rootKey);
    const graph = new Map(), pending = [];
    const discover = (fen, turn) => {
      const key = `${turn}:${fen}`;
      if (graph.has(key)) return graph.get(key);
      const cached = this.positions.get(key);
      const node = { key, fen, side: turn, edges: [], ...cached };
      graph.set(key, node);
      if (!cached) pending.push(node);
      return node;
    };
    const root = discover(rootFen, side);
    for (let i = 0; i < pending.length; i++) {
      check();
      const node = pending[i];
      const current = parseFen(node.fen).board;
      const kings = findKings(current);
      node.winner = !kings.red ? 'black' : !kings.black ? 'red' : null;
      const moves = node.winner ? [] : generateLegalMoves(current, node.side);
      if (!node.winner && !moves.length) node.winner = opposite(node.side);
      this.expanded++;
      if (node.winner) { node.distance = 0; continue; }
      for (const move of moves) {
        check();
        const fen = boardKey(applyBoardCopy(current, move));
        node.edges.push({ move, to: discover(fen, opposite(node.side)) });
      }
    }
    resolveGraph([...graph.values()], check);
    // Commit atomically: interrupted expansion/propagation proves nothing.
    check();
    for (const node of graph.values()) {
      this.positions.set(node.key, { winner: node.winner, distance: node.distance,
        move: node.move ?? null, next: node.next ?? null });
    }
    return this.positions.get(root.key);
  }
}
