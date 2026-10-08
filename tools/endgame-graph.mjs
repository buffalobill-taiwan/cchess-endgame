// Finite alternating graph: the attacker must give check on every move.
import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';

export const opposite = side => side === 'red' ? 'black' : 'red';
export const boardKey = board => boardToFen(board).split(' ')[0];
export const positionKey = (fen, side) => `${side}:${fen}`;
export const moveOrder = (a, b) => a.from.row - b.from.row || a.from.col - b.from.col ||
  a.to.row - b.to.row || a.to.col - b.to.col;
export const sameMove = (a, b) => moveOrder(a, b) === 0;
export function inspect(board, side) {
  const kings = findKings(board);
  const moves = kings.red && kings.black ? generateLegalMoves(board, side).sort(moveOrder) : [];
  return { moves, winner: !kings.red ? 'black' : !kings.black ? 'red' :
    moves.length ? null : opposite(side) };
}
export function createGraph(attacker) {
  return { attacker, nodes: [], cursor: 0, edges: 0, solve: null };
}
export function indexGraph(graph) {
  return new Map(graph.nodes.map((n, id) => [positionKey(n.fen, n.side), id]));
}
export function discover(graph, index, fen, side, parent, move, limits, origin = null) {
  const key = positionKey(fen, side);
  if (index.has(key)) return index.get(key);
  if (graph.nodes.length >= limits.graphNodes) throw new Error('分析未完成：局面數達到 --graph-nodes 上限');
  const id = graph.nodes.length;
  graph.nodes.push({ fen, side, parent, move, origin, depth: parent === null ? 0 : graph.nodes[parent].depth + 1,
    edges: [], terminal: null });
  index.set(key, id);
  return id;
}
export function expandGraph(graph, index, limits, check, locked = {}, maxDepth = Infinity) {
  while (graph.cursor < graph.nodes.length) {
    check();
    const id = graph.cursor, node = graph.nodes[id];
    if (node.depth > maxDepth) return false;
    if (!node.candidates) {
      const board = parseFen(node.fen).board;
      const { moves, winner } = inspect(board, node.side);
      node.terminal = winner;
      node.candidates = [];
      if (!winner) {
        for (const move of moves) {
          const after = applyBoardCopy(board, move);
          if (node.side === graph.attacker && !isInCheck(after, opposite(node.side))) continue;
          if (node.side === 'black' && locked[node.fen] && !sameMove(move, locked[node.fen])) continue;
          node.candidates.push({ move, fen: boardKey(after) });
          // A checking mate in one is already a shortest possible proof.
          // Phase one still enumerates every red check; only counterattacks
          // may omit strictly inferior black alternatives.
          if (graph.attacker === 'black' && node.side === 'black' && inspect(after, 'red').winner === 'black') {
            node.candidates = [node.candidates.at(-1)];
            break;
          }
        }
        if (!node.candidates.length) node.terminal = opposite(graph.attacker);
      }
    }
    while (node.edges.length < node.candidates.length) {
      check();
      if (graph.edges >= limits.graphEdges) throw new Error('分析未完成：邊數達到 --graph-edges 上限');
      const candidate = node.candidates[node.edges.length];
      const to = discover(graph, index, candidate.fen, opposite(node.side), id, candidate.move, limits);
      node.edges.push({ to, move: candidate.move });
      graph.edges++;
    }
    delete node.candidates;
    graph.cursor++;
  }
  return true;
}

// A serializable minimum-distance queue. Equal distances use node IDs.
function push(queue, nodes, id) {
  const less = (a, b) => nodes[a].distance < nodes[b].distance ||
    nodes[a].distance === nodes[b].distance && a < b;
  let i = queue.length;
  queue.push(id);
  while (i) {
    const parent = (i - 1) >> 1;
    if (!less(id, queue[parent])) break;
    queue[i] = queue[parent]; i = parent;
  }
  queue[i] = id;
}
function pop(queue, nodes) {
  const first = queue[0], last = queue.pop();
  if (queue.length) {
    const less = (a, b) => nodes[a].distance < nodes[b].distance ||
      nodes[a].distance === nodes[b].distance && a < b;
    let i = 0;
    while (2 * i + 1 < queue.length) {
      let child = 2 * i + 1;
      if (child + 1 < queue.length && less(queue[child + 1], queue[child])) child++;
      if (!less(queue[child], last)) break;
      queue[i] = queue[child]; i = child;
    }
    queue[i] = last;
  }
  return first;
}

// Every transition is atomic relative to check(), including queue updates.
export function solveGraph(graph, check) {
  const nodes = graph.nodes;
  const work = graph.solve ??= { phase: 'init', cursor: 0, edge: 0, queue: [], child: null, parent: 0 };
  while (work.phase !== 'done') {
    check();
    if (work.phase === 'init') {
      if (work.cursor === nodes.length) { work.phase = 'parents'; work.cursor = 0; continue; }
      const id = work.cursor++, node = nodes[id];
      Object.assign(node, { winner: node.terminal, distance: node.terminal ? 0 : null,
        parents: [], remaining: node.edges.length, longest: 0, best: null });
      if (node.winner) push(work.queue, nodes, id);
    } else if (work.phase === 'parents') {
      if (work.cursor === nodes.length) { work.phase = 'propagate'; continue; }
      const node = nodes[work.cursor];
      if (work.edge === node.edges.length) { work.cursor++; work.edge = 0; continue; }
      nodes[node.edges[work.edge++].to].parents.push(work.cursor);
    } else if (work.phase === 'propagate') {
      if (work.child === null) {
        if (!work.queue.length) { work.phase = 'draw'; work.cursor = 0; continue; }
        work.child = pop(work.queue, nodes); work.parent = 0;
      }
      const child = nodes[work.child];
      if (work.parent === child.parents.length) { work.child = null; continue; }
      const id = child.parents[work.parent++], parent = nodes[id];
      if (parent.winner) continue;
      if (child.winner === parent.side) {
        parent.winner = parent.side; parent.distance = child.distance + 1;
        push(work.queue, nodes, id);
      } else {
        parent.remaining--; parent.longest = Math.max(parent.longest, child.distance);
        if (!parent.remaining) {
          parent.winner = opposite(parent.side); parent.distance = parent.longest + 1;
          push(work.queue, nodes, id);
        }
      }
    } else if (work.phase === 'draw') {
      if (work.cursor === nodes.length) { work.phase = 'select'; work.cursor = 0; continue; }
      const node = nodes[work.cursor++];
      if (!node.winner) node.winner = 'draw';
    } else {
      if (work.cursor === nodes.length) { work.phase = 'done'; continue; }
      const node = nodes[work.cursor++];
      for (const edge of node.edges) {
        const target = nodes[edge.to];
        if (target.winner !== node.winner) continue;
        const best = node.best === null ? null : nodes[node.edges[node.best].to];
        if (!best || (node.winner === node.side ? target.distance < best.distance : target.distance > best.distance)) {
          node.best = node.edges.indexOf(edge);
        }
      }
    }
  }
}
export function counts(nodes) {
  const red = nodes.filter(n => n.side === 'red').length;
  return { red, black: nodes.length - red, total: nodes.length };
}
