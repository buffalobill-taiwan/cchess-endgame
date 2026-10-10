// Partial games bound each unknown frontier twice: instant red win (lower
// black utility), instant stop (upper). Retrograde draws in these CLOSED games
// certify safety, never assume an unexplored frontier is a real draw.
// Outcome ranks for black: red win=1, draw=2, stop=3. Distances refine that order.
import { parseFen } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { isInCheck } from '../js/rules.js';
import { inspect } from './endgame-graph.mjs';

export function registerFirst(db, id, fen, side, depth) {
  const board = parseFen(fen).board, { moves, winner } = inspect(board, side);
  const terminal = winner ?? (side === 'red' && !moves.some(m => isInCheck(applyBoardCopy(board, m), 'black')) ? 'black' : null);
  db.run('UPDATE nodes SET terminal=? WHERE id=?', terminal, id);
  db.run('INSERT INTO first_work(node,depth,active,expanded,stop) VALUES(?,?,1,?,?)', id, depth, terminal ? 1 : 0, terminal === 'black' ? 0 : null);
  if (terminal === 'black') db.run('INSERT OR IGNORE INTO stop_queue VALUES(?,0)', id);
}
export function firstExpanded(db, id) {
  db.run('UPDATE first_work SET expanded=1 WHERE node=?', id);
  reconsider(db, id);
}
function reconsider(db, id) {
  const p = db.get('SELECT n.side,w.* FROM first_work w JOIN nodes n ON n.id=w.node WHERE w.node=?', id);
  if (!p.expanded || p.stop === 0) return;
  let distance;
  if (p.side === 'black') {
    const best = db.get('SELECT min(w.stop) d FROM edges e JOIN first_work w ON w.node=e.dst WHERE e.src=?', id);
    if (best.d === null) return;
    distance = best.d + 1;
  } else {
    const children = db.get('SELECT count(*) total,count(w.stop) proved,max(w.stop) d FROM edges e JOIN first_work w ON w.node=e.dst WHERE e.src=?', id);
    if (!children.total || children.total !== children.proved) return;
    distance = children.d + 1;
  }
  if (p.stop !== null && p.stop <= distance) return;
  db.run('UPDATE first_work SET stop=? WHERE node=?', distance, id);
  db.run('INSERT INTO stop_queue VALUES(?,?) ON CONFLICT(node) DO UPDATE SET distance=excluded.distance', id, distance);
}
export function beginFirstPass(db) {
  const s = db.data.state;
  s.firstReachMode = 'before';
  startReach(db);
}
function startReach(db) {
  db.run('DELETE FROM first_reach');
  db.run('INSERT INTO first_reach(node,depth) VALUES(?,0)', db.data.state.root);
  db.data.state.firstCursor = 0; db.data.state.phase = 'firstReach';
}
export function firstPassStep(db) {
  const s = db.data.state;
  if (s.phase === 'firstProof') {
    if (s.firstChild === null) {
      const q = db.get('SELECT node FROM stop_queue ORDER BY distance,node LIMIT 1');
      if (!q) { s.phase = 'firstLowerStart'; return; }
      s.firstChild = q.node; s.firstParent = 0;
      db.run('DELETE FROM stop_queue WHERE node=?', q.node);
    }
    const e = db.get('SELECT id,src FROM edges WHERE dst=? AND id>? ORDER BY id LIMIT 1', s.firstChild, s.firstParent);
    if (!e) { s.firstChild = null; return; }
    s.firstParent = e.id; reconsider(db, e.src);
  } else if (s.phase === 'firstLowerCopy' || s.phase === 'firstUpperCopy') {
    const lower = s.phase === 'firstLowerCopy';
    const batch = db.all('SELECT id,winner,distance FROM nodes WHERE g=1 AND id>? ORDER BY id LIMIT 256', s.firstCursor);
    if (!batch.length) {
      if (lower) { s.phase = 'firstUpperStart'; return; }
      s.phase = 'firstCut'; s.firstCursor = 0;
      s.firstBefore = db.get('SELECT count(*) n FROM first_work WHERE active=1').n; s.firstCutEdges = 0; return;
    }
    for (const n of batch) {
      const kind = n.winner === 'black' ? 3 : n.winner === 'draw' ? 2 : 1;
      if (lower) db.run('UPDATE first_work SET lower_kind=?,lower_distance=? WHERE node=?', kind, n.distance, n.id);
      else db.run(`UPDATE first_work SET upper_kind=?,upper_distance=?,
        possibilities=((1 << (? - lower_kind + 1))-1) << (lower_kind-1) WHERE node=?`, kind, n.distance, kind, n.id);
    }
    s.firstCursor = batch.at(-1).id;
  } else if (s.phase === 'firstCut') {
    const n = db.get(`SELECT w.* FROM first_work w JOIN nodes n ON n.id=w.node
      WHERE w.active=1 AND w.expanded=1 AND w.node>? AND n.side='black' AND w.fixed=0 ORDER BY w.node LIMIT 1`, s.firstCursor);
    if (!n) { s.firstReachMode = 'after'; startReach(db); return; }
    s.firstCursor = n.node;
    const edges = db.all(`SELECT e.id,e.ord,w.lower_kind,w.lower_distance,w.upper_kind,w.upper_distance
      FROM edges e JOIN first_work w ON w.node=e.dst WHERE e.src=? ORDER BY e.ord`, n.node);
    if (!edges.length) return;
    let best = edges[0];
    for (const e of edges) if (compareValue(e.lower_kind, e.lower_distance, best.lower_kind, best.lower_distance) > 0) best = e;
    let removed = 0;
    for (const e of edges) {
      if (e.id === best.id) continue;
      const comparison = compareValue(best.lower_kind, best.lower_distance, e.upper_kind, e.upper_distance);
      // Even the worst value of best beats the most optimistic value of e.
      // Equality permits deletion only when the stable coordinate tie favors best.
      if (comparison > 0 || comparison === 0 && best.ord < e.ord) {
        db.run('DELETE FROM edges WHERE id=?', e.id); removed++;
      }
    }
    s.graphs[1].edges -= removed; s.firstCutEdges += removed;
    if (edges.length - removed === 1) db.run('UPDATE first_work SET fixed=1 WHERE node=?', n.node);
  } else if (s.phase === 'firstReach') {
    const n = db.get('SELECT * FROM first_reach WHERE seq>? ORDER BY seq LIMIT 1', s.firstCursor);
    if (!n) { s.phase = 'firstMark'; s.firstCursor = 0; return; }
    for (const e of db.all('SELECT dst FROM edges WHERE src=? ORDER BY ord', n.node)) {
      db.run('INSERT OR IGNORE INTO first_reach(node,depth) VALUES(?,?)', e.dst, n.depth + 1);
    }
    s.firstCursor = n.seq;
  } else if (s.phase === 'firstMark') {
    const batch = db.all(`SELECT w.node,w.active,w.depth,r.depth AS reachable_depth
      FROM first_work w LEFT JOIN first_reach r ON r.node=w.node
      WHERE w.node>? ORDER BY w.node LIMIT 256`, s.firstCursor);
    if (batch.length) {
      for (const n of batch) {
        const active = n.reachable_depth === null ? 0 : 1, depth = n.reachable_depth ?? n.depth;
        if (active !== n.active || depth !== n.depth) {
          db.run('UPDATE first_work SET active=?,depth=? WHERE node=?', active, depth, n.node);
        }
      }
      s.firstCursor = batch.at(-1).node; return;
    }
    if (s.firstReachMode === 'before') {
      if (db.get('SELECT 1 FROM first_work WHERE active=1 AND expanded=0 AND depth<? LIMIT 1', s.firstDepth)) { s.phase = 'expand1'; return; }
      s.phase = 'firstProof'; s.firstChild = null; s.firstParent = 0; return;
    }
    const after = db.get('SELECT count(*) n FROM first_reach').n;
    const proved = db.get(`SELECT coalesce(sum(w.stop>0),0) stops,coalesce(sum(w.possibilities=2),0) cycles
      FROM first_work w JOIN nodes n ON n.id=w.node WHERE w.active=1 AND n.side='black'`);
    const stops = proved.stops;
    db.run('INSERT INTO first_batches(depth,before,after,stops,cut_edges,cycles) VALUES(?,?,?,?,?,?)',
      s.firstDepth, s.firstBefore, after, stops, s.firstCutEdges, proved.cycles);
    s.firstCycles = proved.cycles;
    s.firstRemoved = (s.firstRemoved ?? 0) + s.firstBefore - after;
    s.firstStops = stops;
    s.firstClosed = !db.get('SELECT 1 FROM first_work WHERE active=1 AND expanded=0 LIMIT 1');
    s.firstDepth += 2; s.phase = 'expand1';
  }
}

// Positive means a is better for black. Null distances only accompany draws.
export function compareValue(aKind, aDistance, bKind, bDistance) {
  if (aKind !== bKind) return aKind - bKind;
  if (aKind === 3) return bDistance - aDistance;
  if (aKind === 1) return aDistance - bDistance;
  return 0;
}
