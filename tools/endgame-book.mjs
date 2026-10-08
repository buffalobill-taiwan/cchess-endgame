import { parseFen, moveToNotation } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { isInCheck } from '../js/rules.js';
import { boardKey, positionKey, inspect, createGraph, indexGraph, discover,
  expandGraph, solveGraph, counts } from './endgame-graph.mjs';

export function createAnalysis(init) {
  return { init, phase: 'expand1', first: createGraph('red'), counter: createGraph('black'),
    retained: [], retainedPaths: { 0: { parent: null, move: null } }, retainQueue: [0], retainCursor: 0, locked: {}, seedCursor: 0,
    counterDepth: 0, counterClosed: false, seeds: [], validateCursor: 0, table: {}, finalNodes: [], finalCursor: 0, stats: {} };
}
function graphPath(graph, id, paths = null) {
  const path = [];
  while ((paths?.[id] ?? graph.nodes[id]).parent !== null) {
    const link = paths?.[id] ?? graph.nodes[id], parent = graph.nodes[link.parent];
    path.push({ fen: parent.fen, side: parent.side, move: link.move });
    id = link.parent;
  }
  return { root: graph.nodes[id], path: path.reverse() };
}
function failure(state, message, graph, id) {
  const traced = graphPath(graph, id);
  let path = traced.path;
  if (graph === state.counter) {
    const origin = traced.root.origin;
    const first = graphPath(state.first, origin.id, state.retainedPaths);
    path = [...first.path, { fen: state.first.nodes[origin.id].fen, side: 'red', move: origin.move }, ...path];
  }
  const node = graph.nodes[id];
  const route = path.map((p, i) => `${i + 1}. ${p.side === 'red' ? '紅' : '黑'} ${moveToNotation(parseFen(p.fen).board, p.move, p.side)}`);
  const witness = [];
  let current = node;
  while (graph === state.counter && current.winner === 'red' && current.best !== null) {
    const edge = current.edges[current.best], next = graph.nodes[edge.to];
    if (!(next.distance < current.distance)) break;
    witness.push(`${current.side === 'red' ? '紅' : '黑'} ${moveToNotation(parseFen(current.fen).board, edge.move, current.side)}`);
    current = next;
  }
  const error = new Error(`題目不合格：${message}\n問題 FEN：${node.fen} ${node.side === 'red' ? 'w' : 'b'} - - 0 1\n到達路線：\n${route.join('\n') || '（初始局面）'}${witness.length ? `\n反殺失敗見證（其中一條抵抗線）：${witness.join(' → ')}\n見證終點：${current.fen} ${current.side === 'red' ? 'w' : 'b'} - - 0 1` : ''}`);
  error.position = node.fen;
  error.path = path;
  error.nodeId = id;
  throw error;
}

export function analyzeBook(state, limits, check = () => {}) {
  const firstIndex = indexGraph(state.first), counterIndex = indexGraph(state.counter);
  const queued = new Set(state.retainQueue);
  const finalIndex = new Set(state.finalNodes.map(n => positionKey(n.fen, n.side)));
  const addFinal = (fen, side) => {
    const key = positionKey(fen, side);
    if (!finalIndex.has(key)) { finalIndex.add(key); state.finalNodes.push({ fen, side }); }
  };
  while (state.phase !== 'done') {
    check();
    if (state.phase === 'expand1') {
      discover(state.first, firstIndex, state.init, 'red', null, null, limits);
      expandGraph(state.first, firstIndex, limits, check);
      state.stats.first = counts(state.first.nodes);
      state.phase = 'solve1';
    } else if (state.phase === 'solve1') {
      solveGraph(state.first, check);
      if (state.first.nodes[0].winner !== 'red') failure(state,
        '初始局面不能強制連將取勝', state.first, 0);
      state.phase = 'prune';
    } else if (state.phase === 'prune') {
      while (state.retainCursor < state.retainQueue.length) {
        check();
        const id = state.retainQueue[state.retainCursor++], node = state.first.nodes[id];
        state.retained.push(id);
        const edges = node.side === 'red' ? node.edges : node.best === null ? [] : [node.edges[node.best]];
        if (node.side === 'black' && edges.length) state.locked[node.fen] = edges[0].move;
        for (const edge of edges) if (!queued.has(edge.to)) {
          queued.add(edge.to); state.retainQueue.push(edge.to);
          state.retainedPaths[edge.to] = { parent: id, move: edge.move };
        }
      }
      state.stats.second = { ...counts(state.retained.map(id => state.first.nodes[id])),
        removed: state.first.nodes.length - state.retained.length };
      state.phase = 'seeds';
    } else if (state.phase === 'seeds') {
      while (state.seedCursor < state.retained.length) {
        check();
        const id = state.retained[state.seedCursor], node = state.first.nodes[id];
        if (node.side === 'red') {
          const board = parseFen(node.fen).board;
          const { moves } = inspect(board, 'red');
          // Persist the move cursor, so a limit in the middle of a position is resumable.
          for (; (state.seedMove ?? 0) < moves.length; state.seedMove++) {
            state.seedMove ??= 0;
            check();
            const move = moves[state.seedMove], after = applyBoardCopy(board, move);
            if (isInCheck(after, 'black')) continue;
            const seed = discover(state.counter, counterIndex, boardKey(after), 'black', null, null, limits, { id, move });
            if (!state.seeds.includes(seed)) state.seeds.push(seed);
          }
        }
        state.seedCursor++; state.seedMove = 0;
      }
      state.phase = 'expand3';
    } else if (state.phase === 'expand3') {
      state.counterClosed = expandGraph(state.counter, counterIndex, limits, check, state.locked, state.counterDepth);
      state.phase = 'solve3';
    } else if (state.phase === 'solve3') {
      solveGraph(state.counter, check);
      // On an open graph only forced wins/losses are proofs. Unexpanded
      // leaves and provisional draws remain unknown. A complete BFS prefix
      // through D plies rules out every undiscovered shorter mate than D.
      const provenFailure = state.seeds.find(id => state.counter.nodes[id].winner === 'red');
      const provenWin = state.seeds.every(id => state.counter.nodes[id].winner === 'black' &&
        state.counter.nodes[id].distance <= state.counterDepth);
      if (state.counterClosed || provenFailure !== undefined || provenWin) {
        state.stats.thirdExplored = counts(state.counter.nodes);
        if (provenFailure !== undefined) failure(state,
          '紅方停止叫將後，黑方無法對所有抵抗強制連將反殺', state.counter, provenFailure);
        state.phase = 'validate';
      } else {
        state.counterDepth++;
        state.counter.solve = null;
        state.phase = 'expand3';
      }
    } else if (state.phase === 'validate') {
      while (state.validateCursor < state.seeds.length) {
        check();
        const id = state.seeds[state.validateCursor];
        if (state.counter.nodes[id].winner !== 'black') failure(state,
          '紅方停止叫將後，黑方無法對所有抵抗強制連將反殺', state.counter, id);
        state.validateCursor++;
      }
      addFinal(state.init, 'red'); state.phase = 'export';
    } else if (state.phase === 'export') {
      while (state.finalCursor < state.finalNodes.length) {
        check();
        const node = state.finalNodes[state.finalCursor];
        const board = parseFen(node.fen).board;
        const { moves, winner } = inspect(board, node.side);
        if (!winner && node.side === 'red') {
          for (const move of moves) addFinal(boardKey(applyBoardCopy(board, move)), 'black');
        } else if (node.side === 'black') {
          if (winner) {
            if (winner !== 'red') throw new Error('內部錯誤：紅方行棋後紅方終局');
            state.table[node.fen] = null;
          } else {
            const counterId = counterIndex.get(positionKey(node.fen, 'black'));
            const counter = counterId === undefined ? null : state.counter.nodes[counterId];
            const move = state.locked[node.fen] ?? (counter?.winner === 'black' && counter.best !== null
              ? counter.edges[counter.best].move : null);
            if (!move) throw new Error(`內部錯誤：缺少已證明應手 ${node.fen}`);
            const next = boardKey(applyBoardCopy(board, move));
            state.table[node.fen] = next;
            addFinal(next, 'red');
          }
        }
        state.finalCursor++;
      }
      const secondKeys = new Set(state.retained.map(id => {
        const n = state.first.nodes[id]; return positionKey(n.fen, n.side);
      }));
      state.stats.final = { ...counts(state.finalNodes), entries: Object.keys(state.table).length,
        added: state.finalNodes.filter(n => !secondKeys.has(positionKey(n.fen, n.side))).length };
      state.phase = 'steps';
    } else if (state.phase === 'steps') {
      const work = state.steps ??= { queue: [{ fen: state.init, distance: 0 }], cursor: 0, move: 0,
        seen: { [state.init]: true } };
      while (work.cursor < work.queue.length && state.phase === 'steps') {
        check();
        const { fen, distance } = work.queue[work.cursor], board = parseFen(fen).board;
        const { moves } = inspect(board, 'red');
        while (work.move < moves.length) {
          check();
          const afterRed = boardKey(applyBoardCopy(board, moves[work.move]));
          if (!Object.hasOwn(state.table, afterRed)) throw new Error(`內部錯誤：應手表缺少 ${afterRed}`);
          const next = state.table[afterRed];
          if (next === null) { state.step = distance + 1; state.phase = 'done'; break; }
          if (!work.seen[next]) {
            work.seen[next] = true;
            work.queue.push({ fen: next, distance: distance + 1 });
          }
          work.move++;
        }
        work.cursor++; work.move = 0;
      }
      if (state.phase !== 'done') { state.step = null; state.phase = 'done'; }
    }
  }
  return { meta: { init: state.init, step: state.step }, table: state.table };
}
export function statistics(state) {
  const format = c => `紅 ${c.red}／黑 ${c.black}／總計 ${c.total}`;
  const lines = [`階段：${state.phase}`];
  lines.push(`第一階段${state.stats.first ? '' : '（未完成）'}：${format(state.stats.first ?? counts(state.first.nodes))}`);
  if (state.stats.second) lines.push(`第二階段：${format(state.stats.second)}，刪除 ${state.stats.second.removed}`);
  if (state.counter.nodes.length || state.stats.thirdExplored) lines.push(
    `第三階段探索${state.stats.thirdExplored ? '' : '（未完成）'}：${format(state.stats.thirdExplored ?? counts(state.counter.nodes))}`);
  if (state.stats.final) lines.push(`第三階段完成：${format(state.stats.final)}，新增 ${state.stats.final.added}，表項 ${state.stats.final.entries}`);
  return lines.join('\n');
}
