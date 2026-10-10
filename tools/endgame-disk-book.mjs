import { registerFirst, firstExpanded, beginFirstPass, firstPassStep } from './endgame-incremental.mjs';
import { parseFen, moveToNotation } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { isInCheck } from '../js/rules.js';
import { boardKey, inspect, sameMove, opposite } from './endgame-graph.mjs';

const decode = value => value === null ? null : JSON.parse(value);
function node(db, id) { return db.get('SELECT * FROM nodes WHERE id=?', id); }
function discover(db, g, fen, side, parent = null, move = null, origin = null, originMove = null) {
  const existing = db.get('SELECT id FROM nodes WHERE g=? AND fen=? AND side=?', g, fen, side);
  if (existing) return existing.id;
  const state = db.data.state.graphs[g];
  if (state.nodes >= db.data.graphNodes) throw new Error('分析未完成：局面數達到 --graph-nodes 上限');
  const depth = parent === null ? 0 : (g === 1 ? db.get('SELECT depth FROM first_work WHERE node=?', parent).depth : node(db, parent).depth) + 1;
  const result = db.run('INSERT INTO nodes(g,fen,side,depth,parent,move,origin,origin_move) VALUES(?,?,?,?,?,?,?,?)',
    g, fen, side, depth, parent, move === null ? null : JSON.stringify(move), origin, originMove === null ? null : JSON.stringify(originMove));
  state.nodes++;
  const id = Number(result.lastInsertRowid);
  if (g === 1) registerFirst(db, id, fen, side, depth);
  return id;
}
function graphCounts(db, g) {
  const row = db.get("SELECT count(*) AS total,coalesce(sum(side='red'),0) AS red FROM nodes WHERE g=?", g);
  return { red: row.red, black: row.total - row.red, total: row.total };
}
function expand(db, g, depth = Infinity) {
  const work = db.data.state.graphs[g];
  const n = g === 1 ? db.get(`SELECT n.*,w.depth AS depth FROM first_work w JOIN nodes n ON n.id=w.node
    WHERE w.active=1 AND w.expanded=0 ORDER BY w.depth,w.node LIMIT 1`)
    : db.get('SELECT * FROM nodes WHERE g=? AND id>? ORDER BY id LIMIT 1', g, work.cursor);
  if (!n) return 'closed';
  if (n.depth > depth) return 'layer';
  const board = parseFen(n.fen).board, attacker = g === 1 ? 'red' : 'black';
  const { moves, winner } = inspect(board, n.side);
  const locked = n.side === 'black' ? decode(db.get('SELECT move FROM locked WHERE fen=?', n.fen)?.move ?? null) : null;
  let candidates = [];
  if (!winner) for (const move of moves) {
    const after = applyBoardCopy(board, move);
    if (n.side === attacker && !isInCheck(after, opposite(n.side))) continue;
    if (locked && !sameMove(move, locked)) continue;
    candidates.push({ move, fen: boardKey(after) });
    if (g === 3 && n.side === 'black' && inspect(after, 'red').winner === 'black') {
      candidates = [candidates.at(-1)]; break;
    }
  }
  const terminal = winner ?? (candidates.length ? null : opposite(attacker));
  db.run('UPDATE nodes SET terminal=? WHERE id=?', terminal, n.id);
  for (const [ord, candidate] of candidates.entries()) {
    if (work.edges >= db.data.graphEdges) throw new Error('分析未完成：邊數達到 --graph-edges 上限');
    const to = discover(db, g, candidate.fen, opposite(n.side), n.id, candidate.move);
    db.run('INSERT INTO edges(src,ord,dst,move) VALUES(?,?,?,?)', n.id, ord, to, JSON.stringify(candidate.move));
    work.edges++;
  }
  work.cursor = n.id;
  if (g === 1) firstExpanded(db, n.id);
  return 'progress';
}
function startSolve(db, g, frontier = null) {
  db.run('DELETE FROM proof_queue');
  db.data.state.solve = { g, frontier, phase: 'init', cursor: 0, child: null, parent: 0 };
}
// Small resumable transitions; the reverse-edge and distance indexes replace
// RAM adjacency lists and heaps. No phase loads an entire graph into JS.
function solveStep(db) {
  const work = db.data.state.solve;
  if (work.phase === 'init') {
    const batch = db.all(`SELECT n.id,n.terminal,w.expanded FROM nodes n LEFT JOIN first_work w ON w.node=n.id
      WHERE n.g=? AND n.id>? ORDER BY n.id LIMIT 256`, work.g, work.cursor);
    if (!batch.length) { work.phase = 'propagate'; return; }
    for (const n of batch) {
      const terminal = n.terminal ?? (work.frontier && n.expanded === 0 ? work.frontier : null);
      // Discovery already ruled out a real terminal at unknown frontiers.
      const distance = terminal ? (n.terminal ? 0 : 1) : null;
      db.run('UPDATE nodes SET winner=?,distance=?,best=NULL,remaining=(SELECT count(*) FROM edges WHERE src=?),longest=0 WHERE id=?',
        terminal, distance, n.id, n.id);
      if (terminal) db.run('INSERT INTO proof_queue VALUES(?,?)', n.id, distance);
      work.cursor = n.id;
    }
  } else if (work.phase === 'propagate') {
    if (work.child === null) {
      const next = db.get('SELECT node FROM proof_queue ORDER BY distance,node LIMIT 1');
      if (!next) { work.phase = 'draw'; work.cursor = 0; return; }
      work.child = next.node; work.parent = 0;
      db.run('DELETE FROM proof_queue WHERE node=?', next.node);
    }
    const child = node(db, work.child);
    const edge = db.get('SELECT id,src FROM edges WHERE dst=? AND id>? ORDER BY id LIMIT 1', child.id, work.parent);
    if (!edge) { work.child = null; return; }
    work.parent = edge.id;
    const parent = node(db, edge.src);
    if (parent.winner !== null) return;
    if (child.winner === parent.side) {
      db.run('UPDATE nodes SET winner=side,distance=? WHERE id=?', child.distance + 1, parent.id);
      db.run('INSERT INTO proof_queue VALUES(?,?)', parent.id, child.distance + 1);
    } else {
      const remaining = parent.remaining - 1, longest = Math.max(parent.longest, child.distance);
      db.run('UPDATE nodes SET remaining=?,longest=? WHERE id=?', remaining, longest, parent.id);
      if (!remaining) {
        db.run('UPDATE nodes SET winner=?,distance=? WHERE id=?', opposite(parent.side), longest + 1, parent.id);
        db.run('INSERT INTO proof_queue VALUES(?,?)', parent.id, longest + 1);
      }
    }
  } else if (work.phase === 'draw') {
    const batch = db.all('SELECT id FROM nodes WHERE g=? AND id>? ORDER BY id LIMIT 256', work.g, work.cursor);
    if (!batch.length) { work.phase = 'select'; work.cursor = 0; return; }
    const end = batch.at(-1).id;
    db.run("UPDATE nodes SET winner='draw' WHERE g=? AND id>? AND id<=? AND winner IS NULL", work.g, work.cursor, end);
    work.cursor = end;
  } else if (work.phase === 'select') {
    const n = db.get('SELECT id,side,winner FROM nodes WHERE g=? AND id>? ORDER BY id LIMIT 1', work.g, work.cursor);
    if (!n) { work.phase = 'done'; return; }
    const best = db.get(`SELECT e.id FROM edges e JOIN nodes c ON c.id=e.dst
      WHERE e.src=? AND c.winner=? ORDER BY CASE WHEN ? THEN c.distance ELSE -c.distance END,e.ord LIMIT 1`,
      n.id, n.winner, n.side === n.winner ? 1 : 0);
    db.run('UPDATE nodes SET best=? WHERE id=?', best?.id ?? null, n.id);
    work.cursor = n.id;
  }
}
function route(db, id, retained = false) {
  const path = [];
  let n = node(db, id);
  while (true) {
    const link = retained ? db.get('SELECT parent,move FROM retained WHERE node=?', n.id) : n;
    if (link.parent === null) break;
    const parent = node(db, link.parent);
    path.push({ fen: parent.fen, side: parent.side, move: decode(link.move) }); n = parent;
  }
  return { root: n, path: path.reverse() };
}
function fail(db, id, message) {
  const n = node(db, id), traced = route(db, id, n.g === 1);
  let path = traced.path;
  if (n.g === 3) {
    const origin = node(db, traced.root.origin);
    path = [...route(db, origin.id, true).path,
      { fen: origin.fen, side: 'red', move: decode(traced.root.origin_move) }, ...path];
  }
  const formatted = path.map((p, i) => `${i + 1}. ${p.side === 'red' ? '紅' : '黑'} ${moveToNotation(parseFen(p.fen).board, p.move, p.side)}`);
  const witness = [];
  let current = n;
  while (n.g === 3 && current.winner === 'red' && current.best !== null) {
    const edge = db.get('SELECT dst,move FROM edges WHERE id=?', current.best), next = node(db, edge.dst);
    if (!(next.distance < current.distance)) break;
    witness.push(`${current.side === 'red' ? '紅' : '黑'} ${moveToNotation(parseFen(current.fen).board, decode(edge.move), current.side)}`);
    current = next;
  }
  const error = new Error(`題目不合格：${message}\n問題 FEN：${n.fen} ${n.side === 'red' ? 'w' : 'b'} - - 0 1\n到達路線：\n${formatted.join('\n') || '（初始局面）'}${witness.length ? `\n反殺失敗見證（其中一條抵抗線）：${witness.join(' → ')}\n見證終點：${current.fen} ${current.side === 'red' ? 'w' : 'b'} - - 0 1` : ''}`);
  error.qualification = true;
  throw error;
}
function step(db) {
  const s = db.data.state;
  if (s.phase === 'expand1') {
    if (!s.root) { s.root = discover(db, 1, db.data.init, 'red'); return; }
    if (s.firstClosed) { s.stats.first = graphCounts(db, 1); startSolve(db, 1); s.phase = 'solve1'; return; }
    if (expand(db, 1, s.firstDepth - 1) !== 'progress') beginFirstPass(db);
  } else if (s.phase === 'firstLowerStart' || s.phase === 'firstUpperStart') {
    const lower = s.phase === 'firstLowerStart';
    startSolve(db, 1, lower ? 'red' : 'black');
    s.phase = lower ? 'firstLower' : 'firstUpper';
  } else if (s.phase === 'firstLower' || s.phase === 'firstUpper') {
    if (s.solve.phase !== 'done') { solveStep(db); return; }
    s.phase = s.phase === 'firstLower' ? 'firstLowerCopy' : 'firstUpperCopy'; s.firstCursor = 0;
  } else if (['firstProof', 'firstCut', 'firstReach', 'firstMark', 'firstLowerCopy', 'firstUpperCopy'].includes(s.phase)) {
    firstPassStep(db);
  } else if (s.phase === 'solve1') {
    if (s.solve.phase !== 'done') { solveStep(db); return; }
    if (node(db, s.root).winner !== 'red') {
      db.run('INSERT OR IGNORE INTO retained(node,parent,move) VALUES(?,NULL,NULL)', s.root);
      fail(db, s.root, '初始局面不能強制連將取勝');
    }
    db.run('INSERT INTO retained(node,parent,move) VALUES(?,NULL,NULL)', s.root); s.phase = 'prune';
  } else if (s.phase === 'prune') {
    const item = db.get('SELECT seq,node FROM retained WHERE seq>? ORDER BY seq LIMIT 1', s.retainCursor);
    if (!item) {
      const c = db.get("SELECT count(*) total,coalesce(sum(n.side='red'),0) red FROM retained r JOIN nodes n ON n.id=r.node");
      s.stats.second = { red: c.red, black: c.total - c.red, total: c.total, removed: s.stats.first.total - c.total };
      s.phase = 'seeds'; return;
    }
    const n = node(db, item.node);
    const edges = n.side === 'red' ? db.all('SELECT * FROM edges WHERE src=? ORDER BY ord', n.id)
      : n.best === null ? [] : [db.get('SELECT * FROM edges WHERE id=?', n.best)];
    if (n.side === 'black' && edges.length) db.run('INSERT INTO locked VALUES(?,?)', n.fen, edges[0].move);
    for (const e of edges) db.run('INSERT OR IGNORE INTO retained(node,parent,move) VALUES(?,?,?)', e.dst, n.id, e.move);
    s.retainCursor = item.seq;
  } else if (s.phase === 'seeds') {
    const item = db.get('SELECT seq,node FROM retained WHERE seq>? ORDER BY seq LIMIT 1', s.seedCursor);
    if (!item) { s.phase = 'expand3'; return; }
    const n = node(db, item.node);
    if (n.side === 'red') {
      const board = parseFen(n.fen).board;
      for (const move of inspect(board, 'red').moves) {
        const after = applyBoardCopy(board, move);
        if (isInCheck(after, 'black')) continue;
        const id = discover(db, 3, boardKey(after), 'black', null, null, n.id, move);
        db.run('INSERT OR IGNORE INTO seeds VALUES(?)', id);
      }
    }
    s.seedCursor = item.seq;
  } else if (s.phase === 'expand3') {
    const status = expand(db, 3, s.counterDepth);
    if (status !== 'progress') { s.counterClosed = status === 'closed'; startSolve(db, 3); s.phase = 'solve3'; }
  } else if (s.phase === 'solve3') {
    if (s.solve.phase !== 'done') { solveStep(db); return; }
    const failure = db.get("SELECT n.id FROM seeds s JOIN nodes n ON n.id=s.node WHERE n.winner='red' ORDER BY n.id LIMIT 1");
    const unknown = db.get("SELECT n.id FROM seeds s JOIN nodes n ON n.id=s.node WHERE n.winner!='black' OR n.distance>? LIMIT 1", s.counterDepth);
    if (s.counterClosed || failure || !unknown) {
      s.stats.thirdExplored = graphCounts(db, 3);
      if (failure) fail(db, failure.id, '紅方停止叫將後，黑方無法對所有抵抗強制連將反殺');
      const invalid = db.get("SELECT n.id FROM seeds s JOIN nodes n ON n.id=s.node WHERE n.winner!='black' ORDER BY n.id LIMIT 1");
      if (invalid) fail(db, invalid.id, '紅方停止叫將後，黑方無法對所有抵抗強制連將反殺');
      db.run("INSERT INTO final_nodes(fen,side) VALUES(?,'red')", db.data.init);
      s.phase = 'export';
    } else { s.counterDepth++; s.phase = 'expand3'; }
  } else if (s.phase === 'export') {
    const n = db.get('SELECT * FROM final_nodes WHERE seq>? ORDER BY seq LIMIT 1', s.finalCursor);
    if (!n) {
      const c = db.get("SELECT count(*) total,coalesce(sum(side='red'),0) red FROM final_nodes");
      const added = db.get(`SELECT count(*) total FROM final_nodes f WHERE NOT EXISTS
        (SELECT 1 FROM nodes n JOIN retained r ON r.node=n.id WHERE n.g=1 AND n.fen=f.fen AND n.side=f.side)`).total;
      s.stats.final = { red: c.red, black: c.total - c.red, total: c.total, added,
        entries: db.get('SELECT count(*) total FROM responses').total };
      db.run('INSERT INTO steps(fen,distance) VALUES(?,0)', db.data.init); s.phase = 'steps'; return;
    }
    const board = parseFen(n.fen).board, { moves, winner } = inspect(board, n.side);
    if (!winner && n.side === 'red') {
      for (const move of moves) db.run("INSERT OR IGNORE INTO final_nodes(fen,side) VALUES(?,'black')", boardKey(applyBoardCopy(board, move)));
    } else if (n.side === 'black') {
      let target = null;
      if (!winner) {
        let move = db.get('SELECT move FROM locked WHERE fen=?', n.fen)?.move;
        if (!move) move = db.get("SELECT e.move FROM nodes n JOIN edges e ON e.id=n.best WHERE n.g=3 AND n.fen=? AND n.side='black' AND n.winner='black'", n.fen)?.move;
        if (!move) throw new Error(`內部錯誤：缺少已證明應手 ${n.fen}`);
        target = boardKey(applyBoardCopy(board, decode(move)));
        db.run("INSERT OR IGNORE INTO final_nodes(fen,side) VALUES(?,'red')", target);
      } else if (winner !== 'red') throw new Error('內部錯誤：紅方行棋後紅方終局');
      db.run('INSERT INTO responses(fen,target) VALUES(?,?)', n.fen, target);
    }
    s.finalCursor = n.seq;
  } else if (s.phase === 'steps') {
    const n = db.get('SELECT * FROM steps WHERE seq>? ORDER BY seq LIMIT 1', s.stepCursor);
    if (!n) { s.step = null; s.phase = 'done'; return; }
    const board = parseFen(n.fen).board;
    for (const move of inspect(board, 'red').moves) {
      const fen = boardKey(applyBoardCopy(board, move));
      const response = db.get('SELECT target FROM responses WHERE fen=?', fen);
      if (!response) throw new Error(`內部錯誤：應手表缺少 ${fen}`);
      if (response.target === null) { s.step = n.distance + 1; s.phase = 'done'; return; }
      db.run('INSERT OR IGNORE INTO steps(fen,distance) VALUES(?,?)', response.target, n.distance + 1);
    }
    s.stepCursor = n.seq;
  } else throw new Error(`未知分析階段：${s.phase}`);
}
export function analyzeDisk(db, check = () => {}) {
  while (db.data.state.phase !== 'done') {
    check(); // Safe boundary: callers may save all completed transitions here.
    try { step(db); }
    catch (error) {
      if (error.qualification) db.checkpoint();
      else db.rollback();
      throw error;
    }
    db.tick();
  }
  db.checkpoint();
}
export function diskStatistics(db) {
  const s = db.data.state, format = c => `紅 ${c.red}／黑 ${c.black}／總計 ${c.total}`;
  const lines = [`階段：${s.phase}`, `第一階段${s.stats.first ? '' : '（未完成）'}：${format(s.stats.first ?? graphCounts(db, 1))}`];
  if (s.firstDepth) lines.push(`交錯展開：已完成深度 ${s.firstDepth - 2}，保留斷連將黑方局面 ${s.firstStops ?? 0}，已證明循環黑方局面 ${s.firstCycles ?? 0}，累計排除局面 ${s.firstRemoved ?? 0}`);
  if (s.stats.second) lines.push(`第二階段：${format(s.stats.second)}，刪除 ${s.stats.second.removed}`);
  if (s.graphs[3].nodes || s.stats.thirdExplored) lines.push(`第三階段探索${s.stats.thirdExplored ? '' : '（未完成）'}：${format(s.stats.thirdExplored ?? graphCounts(db, 3))}`);
  if (s.stats.final) lines.push(`第三階段完成：${format(s.stats.final)}，新增 ${s.stats.final.added}，表項 ${s.stats.final.entries}`);
  return lines.join('\n');
}
