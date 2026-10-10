import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EndgameDatabase, bookChunks, readMetadata, databasePath, GRAPH_LIMIT, GRAPH_EDGE_LIMIT,
  assertDatabaseIdle } from '../tools/endgame-database.mjs';
import { analyzeDisk } from '../tools/endgame-disk-book.mjs';
import { createAnalysis, analyzeBook } from '../tools/endgame-book.mjs';
const run = promisify(execFile);
const tool = new URL('../tools/endgame-analyze.mjs', import.meta.url).pathname;
const simple = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1';
const branching = '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p2r/cr1AK4';
const config = init => ({ name: 'sqlite', init, depth: 64, graphNodes: GRAPH_LIMIT, graphEdges: GRAPH_EDGE_LIMIT });
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'endgame-sql-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
for (const fen of [simple, branching]) test(`disk graph and streamed book match the reference: ${fen}`, async t => {
  const path = join(await workspace(t), 'work.sqlite');
  const memory = createAnalysis(fen), reference = analyzeBook(memory, config(fen));
  const db = new EndgameDatabase(path, config(fen));
  try {
    let earlyNodes, earlyEdges;
    analyzeDisk(db, () => {
      if (db.data.state.phase === 'solve1' && !earlyNodes) {
        earlyNodes = db.all('SELECT n.fen,n.side FROM first_work w JOIN nodes n ON n.id=w.node WHERE w.active=1')
          .map(n => `${n.side}:${n.fen}`).sort();
        earlyEdges = db.all(`SELECT n.fen,n.side,e.move,c.fen target,c.side target_side FROM first_work w
          JOIN nodes n ON n.id=w.node JOIN edges e ON e.src=n.id JOIN nodes c ON c.id=e.dst WHERE w.active=1`)
          .map(e => JSON.stringify([e.side,e.fen,JSON.parse(e.move).from,JSON.parse(e.move).to,e.target_side,e.target])).sort();
      }
    });
    assert.deepEqual(earlyNodes, memory.retained.map(id => {
      const n = memory.first.nodes[id]; return `${n.side}:${n.fen}`;
    }).sort(), 'incremental pruning must already match old stage two before the final solve');
    const referenceEdges = memory.retained.flatMap(id => {
      const n = memory.first.nodes[id];
      return (n.side === 'red' ? n.edges : n.best === null ? [] : [n.edges[n.best]])
        .map(e => { const c = memory.first.nodes[e.to]; return JSON.stringify([n.side,n.fen,e.move.from,e.move.to,c.side,c.fen]); });
    }).sort();
    assert.deepEqual(earlyEdges, referenceEdges);
    assert.deepEqual(db.data.state.stats.final, memory.stats.final);
    assert.deepEqual(db.data.state.stats.thirdExplored, memory.stats.thirdExplored);
    assert.equal(db.data.state.stats.second.total, memory.stats.second.total);
    assert.ok(db.data.state.stats.first.total <= memory.stats.first.total);
    assert.ok(db.get('SELECT count(*) n FROM nodes WHERE g=1').n <= memory.first.nodes.length);
    assert.equal(db.get('SELECT count(*) n FROM nodes WHERE g=3').n, memory.counter.nodes.length);
    assert.equal(db.get('SELECT count(*) n FROM responses').n, Object.keys(reference.table).length);
    assert.ok(db.get("SELECT length(value) n FROM metadata WHERE key='analysis'").n < 10000,
      'metadata must not embed growing collections');
  } finally { db.close(); }
  for (const pretty of [false, true]) {
    const chunks = [...bookChunks(path, pretty)];
    assert.ok(chunks.every(chunk => chunk.length < 70000));
    const result = JSON.parse(chunks.join(''));
    assert.deepEqual(result, { meta: { name: 'sqlite', ...reference.meta }, table: reference.table });
  }
  assert.equal((await readFile(path)).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.equal(readMetadata(path).graphNodes, 16777216);
  assert.equal(readMetadata(path).graphEdges, 134217728);
});

test('every disk phase resumes after closing and reopening the database', async t => {
  const path = join(await workspace(t), 'work.sqlite');
  const phases = new Set();
  let finished = false, rounds = 0;
  while (!finished) {
    const db = new EndgameDatabase(path, config(simple));
    let ticks = 0;
    try {
      analyzeDisk(db, () => {
        phases.add(db.data.state.phase);
        if (db.data.state.solve) phases.add(`solve:${db.data.state.solve.phase}`);
        if (++ticks > 31) throw new Error('slice');
      });
      finished = true;
    } catch (error) { assert.equal(error.message, 'slice'); }
    finally { db.close(); }
    assert.ok(++rounds < 1000);
  }
  const expected = analyzeBook(createAnalysis(simple), config(simple));
  assert.deepEqual(JSON.parse([...bookChunks(path)].join('')).table, expected.table);
  for (const phase of ['expand1', 'prune', 'seeds', 'expand3', 'solve:propagate', 'solve:select', 'export', 'steps']) {
    assert.ok(phases.has(phase), phase);
  }
});

test('ownership prevents concurrent writers and is released on close', async t => {
  const path = join(await workspace(t), 'work.sqlite');
  const first = new EndgameDatabase(path, config(simple));
  try {
    assert.throws(() => assertDatabaseIdle(path), /使用/);
    assert.throws(() => new EndgameDatabase(path, config(simple), { fresh: true }), /locked|使用/);
    assert.equal(first.data.state.phase, 'expand1');
  } finally { first.close(); }
  assertDatabaseIdle(path);
  const next = new EndgameDatabase(path, config(simple));
  next.close();
});

test('SQLite snapshots can resume into a new independent database', async t => {
  const dir = await workspace(t), source = join(dir, 'source.sqlite'), target = join(dir, 'nested', 'copy.sqlite');
  await run(process.execPath, [tool, '--name', 'copy', '--fen', simple, '--checkpoint', source]);
  const original = await readFile(source);
  const output = await run(process.execPath, [tool, '--resume', source, '--checkpoint', target]);
  assert.equal(JSON.parse(output.stdout).meta.step, 4);
  assert.equal(readMetadata(target).state.phase, 'done');
  assert.deepEqual(await readFile(source), original);
});

for (const signal of ['SIGINT', 'SIGKILL']) test(`${signal} preserves committed SQLite work and permits resume`, async t => {
  const dir = await workspace(t), path = join(dir, 'work.sqlite');
  const child = spawn(process.execPath, [tool, '--name', 'interrupted', '--fen', branching, '--checkpoint', path]);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let ready = false;
  for (let i = 0; i < 1000; i++) {
    try {
      const meta = readMetadata(path);
      if (meta.state.graphs[1].nodes > 0 && meta.state.phase !== 'done') { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(ready, 'wait for a committed in-progress batch');
  child.kill(signal);
  const ended = await closed;
  assert.equal(stdout, '');
  if (signal === 'SIGINT') {
    assert.equal(ended.code, 1);
    assert.match(stderr, /分析已中斷/);
  } else assert.equal(ended.signal, 'SIGKILL');
  const partial = readMetadata(path);
  assert.notEqual(partial.state.phase, 'done');
  const output = await run(process.execPath, [tool, '--resume', path, '--time-limit', '60000']);
  assert.equal(JSON.parse(output.stdout).meta.step, 4);
  assert.equal(readMetadata(path).state.stats.final.total, 7641);
});

test('no-checkpoint uses disposable disk storage and fresh resets persistent work', async t => {
  const dir = await workspace(t), env = { ...process.env, TMPDIR: dir };
  const path = databasePath(simple, dir);
  await run(process.execPath, [tool, '--name', 'fresh', '--fen', simple], { env });
  const original = await readFile(path);
  await run(process.execPath, [tool, '--name', 'fresh', '--fen', simple, '--no-checkpoint'], { env });
  assert.deepEqual(await readFile(path), original);
  await assert.rejects(run(process.execPath, [tool, '--name', 'fresh', '--fen', simple,
    '--fresh', '--graph-nodes', '2'], { env }), e => e.stdout === '' && /分析未完成/.test(e.stderr));
  assert.notEqual(readMetadata(path).state.phase, 'done');
});


test('two-ply incremental batches reproduce boss pruning and survive every phase boundary', async t => {
  const init = '2ca1k3/4a1N2/9/9/9/9/9/5CN2/2npAp3/2p1K1p2';
  const path = join(await workspace(t), 'boss.sqlite');
  let done = false, rounds = 0;
  const phases = new Set();
  while (!done) {
    const db = new EndgameDatabase(path, config(init));
    let ticks = 0;
    try {
      analyzeDisk(db, () => {
        phases.add(db.data.state.phase);
        if (db.data.state.phase === 'expand1' && db.data.state.firstDepth === 8) { done = true; throw Error('slice'); }
        if (++ticks > 47) throw Error('slice');
      });
    } catch (e) { assert.equal(e.message, 'slice'); }
    finally { db.close(); }
    assert.ok(++rounds < 1000);
  }
  const db = new EndgameDatabase(path, config(init));
  try {
    assert.deepEqual(db.all('SELECT depth,before,after,stops,cut_edges FROM first_batches ORDER BY depth').map(x => ({ ...x })), [
      { depth: 2, before: 6, after: 6, stops: 0, cut_edges: 0 },
      { depth: 4, before: 50, after: 46, stops: 5, cut_edges: 5 },
      { depth: 6, before: 166, after: 161, stops: 10, cut_edges: 7 },
    ]);
    assert.equal(db.get('SELECT count(*) n FROM first_work WHERE active=1').n, 161);
    for (const phase of ['firstProof', 'firstCut', 'firstReach', 'firstMark', 'firstLower', 'firstUpper', 'firstLowerCopy', 'firstUpperCopy']) assert.ok(phases.has(phase));
  } finally { db.close(); }
});

test('partial bounds keep unknown red alternatives and prove a closed cycle', async t => {
  const { beginFirstPass } = await import('../tools/endgame-incremental.mjs');
  const db = new EndgameDatabase(join(await workspace(t), 'partial.sqlite'), config(simple));
  try {
    // Root -> black -> red AND node. One check reaches a proven stop;
    // the other reaches an unexplored black node. A separate cycle has no exit.
    for (const [id, side, depth, expanded, stop] of [
      [1, 'red', 0, 1, null], [2, 'black', 1, 1, null], [3, 'red', 2, 1, null],
      [4, 'black', 3, 1, 0], [5, 'black', 3, 0, null],
      [6, 'black', 1, 1, null], [7, 'red', 2, 1, null],
    ]) {
      db.run('INSERT INTO nodes(id,g,fen,side,depth,terminal) VALUES(?,1,?,?,?,?)', id, `fixture-${id}`, side, depth, stop === 0 ? 'black' : null);
      db.run('INSERT INTO first_work(node,depth,active,expanded,stop) VALUES(?,?,1,?,?)', id, depth, expanded, stop);
    }
    for (const [src, ord, dst] of [[1,0,2],[1,1,6],[2,0,3],[3,0,4],[3,1,5],[6,0,7],[7,0,6]]) {
      db.run("INSERT INTO edges(src,ord,dst,move) VALUES(?,?,?,'{}')", src, ord, dst);
    }
    db.run('INSERT INTO stop_queue VALUES(4,0)');
    Object.assign(db.data.state, { root: 1, firstDepth: 2 });
    db.data.state.graphs[1] = { nodes: 7, edges: 7, cursor: 0 };
    beginFirstPass(db);
    assert.throws(() => analyzeDisk(db, () => { if (db.data.state.phase === 'expand1') throw Error('batch done'); }), /batch done/);
    assert.equal(db.get('SELECT count(*) n FROM edges').n, 7);
    assert.equal(db.get('SELECT possibilities FROM first_work WHERE node=3').possibilities, 7);
    assert.equal(db.get('SELECT possibilities FROM first_work WHERE node=6').possibilities, 2);
    assert.equal(db.get('SELECT count(*) n FROM first_work WHERE stop IS NOT NULL').n, 1);
    assert.equal(db.get('SELECT count(*) n FROM first_work WHERE active=1').n, 7);
  } finally { db.close(); }
});

async function partialGame(t, positions, links) {
  const { beginFirstPass } = await import('../tools/endgame-incremental.mjs');
  const db = new EndgameDatabase(join(await workspace(t), 'bounds.sqlite'), config(simple));
  for (const [id, side, terminal = null, expanded = 1] of positions) {
    db.run('INSERT INTO nodes(id,g,fen,side,depth,terminal) VALUES(?,1,?,?,0,?)', id, `abstract-${id}`, side, terminal);
    db.run('INSERT INTO first_work(node,depth,active,expanded,stop) VALUES(?,0,1,?,?)', id, expanded, terminal === 'black' ? 0 : null);
    if (terminal === 'black') db.run('INSERT INTO stop_queue VALUES(?,0)', id);
  }
  const ord = new Map();
  for (const [src, dst] of links) {
    const index = ord.get(src) ?? 0; ord.set(src, index + 1);
    db.run("INSERT INTO edges(src,ord,dst,move) VALUES(?,?,?,'{}')", src, index, dst);
  }
  Object.assign(db.data.state, { root: 1, firstDepth: 0 });
  db.data.state.graphs[1] = { nodes: positions.length, edges: links.length, cursor: 0 };
  beginFirstPass(db);
  try {
    assert.throws(() => analyzeDisk(db, () => { if (db.data.state.phase === 'expand1') throw Error('batch done'); }), /batch done/);
    return db;
  } catch (e) { db.close(); throw e; }
}

test('proven cycle removes a losing reply but preserves an unknown possible stop', async t => {
  const db = await partialGame(t, [[1,'black'],[2,'red'],[3,'red','red'],[4,'red',null,0]],
    [[1,2],[1,3],[1,4],[2,1]]);
  try {
    assert.deepEqual(db.all('SELECT dst FROM edges WHERE src=1 ORDER BY ord').map(e => e.dst), [2,4]);
    assert.equal(db.get('SELECT possibilities FROM first_work WHERE node=1').possibilities, 6);
    assert.equal(db.get('SELECT fixed FROM first_work WHERE node=1').fixed, 0);
    assert.equal(db.get('SELECT active FROM first_work WHERE node=3').active, 0);
  } finally { db.close(); }
});

test('a repeated position with a red winning exit is not a safe cycle', async t => {
  const db = await partialGame(t, [[1,'black'],[2,'red'],[3,'black','red']], [[1,2],[2,1],[2,3]]);
  try {
    const n = db.get('SELECT possibilities,lower_distance,upper_distance FROM first_work WHERE node=1');
    assert.equal(n.possibilities, 1);
    assert.equal(n.lower_distance, 2);
    assert.equal(n.upper_distance, 2);
  } finally { db.close(); }
});

test('a proven stop beats a cycle and forced losses prefer the longest survival', async t => {
  const stop = await partialGame(t, [[1,'black'],[2,'red'],[3,'red','black']], [[1,2],[1,3],[2,1]]);
  try { assert.deepEqual(stop.all('SELECT dst FROM edges WHERE src=1').map(e => e.dst), [3]); }
  finally { stop.close(); }
  const loss = await partialGame(t, [[1,'black'],[2,'red','red'],[3,'red'],[4,'black'],[5,'red','red']],
    [[1,2],[1,3],[3,4],[4,5]]);
  try {
    assert.deepEqual(loss.all('SELECT dst FROM edges WHERE src=1').map(e => e.dst), [3]);
    assert.equal(loss.get('SELECT lower_distance FROM first_work WHERE node=1').lower_distance, 3);
  } finally { loss.close(); }
});
