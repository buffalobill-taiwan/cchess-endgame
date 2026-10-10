import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFen } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { isInCheck } from '../js/rules.js';
import { createAnalysis, analyzeBook } from '../tools/endgame-book.mjs';
import { boardKey, positionKey, inspect, solveGraph, sameMove } from '../tools/endgame-graph.mjs';
import { databasePath as checkpointPath, readMetadata as readCheckpoint } from '../tools/endgame-database.mjs';

const run = promisify(execFile);
const tool = new URL('../tools/endgame-analyze.mjs', import.meta.url).pathname;
const first = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1';
const second = '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2';
const adjusted = '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p2r/2rAK4';
const limits = { graphNodes: 50000, graphEdges: 400000 };
const json = object => JSON.parse(JSON.stringify(object));

// Independently traverse the fixed book and every possible player move.
function verifyBook(book) {
  const pending = [book.meta.init], seen = new Set(), keys = new Set();
  for (let i = 0; i < pending.length; i++) {
    const fen = pending[i];
    if (seen.has(fen)) continue;
    seen.add(fen);
    const board = parseFen(fen).board;
    const { moves, winner } = inspect(board, 'red');
    if (winner) continue;
    for (const move of moves) {
      const next = applyBoardCopy(board, move), key = boardKey(next);
      keys.add(key);
      assert.ok(Object.hasOwn(book.table, key));
      const black = inspect(next, 'black');
      if (black.winner) { assert.equal(book.table[key], null); continue; }
      const reply = black.moves.find(m => boardKey(applyBoardCopy(next, m)) === book.table[key]);
      assert.ok(reply, `illegal black reply at ${key}`);
      pending.push(book.table[key]);
    }
  }
  assert.deepEqual([...keys].sort(), Object.keys(book.table).sort());
}
// Check an entire strategy certificate, not just the printed witness line.
// For a red escape proof, ALL black checks must fail; for a black mate proof,
// ALL red replies must be covered. Strictly decreasing distances exclude loops.
function verifyCertificate(state, root, winner) {
  const graph = state.counter, seen = new Set(), pending = [root];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const n = graph.nodes[id], board = parseFen(n.fen).board;
    assert.equal(n.winner, winner);
    const actual = inspect(board, n.side);
    const legal = actual.moves.filter(move => (n.side !== 'black' || isInCheck(applyBoardCopy(board, move), 'red')) &&
      (n.side !== 'black' || !state.locked[n.fen] || sameMove(move, state.locked[n.fen])));
    if (actual.winner || !legal.length) {
      assert.equal(actual.winner ?? 'red', winner);
      assert.equal(n.distance, 0);
      continue;
    }
    const edges = n.side === winner ? [n.edges[n.best]] : n.edges;
    if (n.side !== winner) assert.equal(edges.length, legal.length);
    for (const edge of edges) {
      assert.ok(legal.some(move => sameMove(move, edge.move)));
      const child = graph.nodes[edge.to];
      assert.equal(child.fen, boardKey(applyBoardCopy(board, edge.move)));
      assert.ok(child.distance < n.distance);
      pending.push(edge.to);
    }
  }
}

test('first example produces a complete four-move book and verified counterattacks', () => {
  const state = createAnalysis(first), book = analyzeBook(state, limits);
  assert.equal(book.meta.step, 4);
  assert.deepEqual(state.stats.first, { red: 4, black: 5, total: 9 });
  assert.equal(state.stats.second.total, 9);
  assert.deepEqual(state.stats.final, { red: 102, black: 103, total: 205, entries: 103, added: 196 });
  verifyBook(book);
  for (const root of state.seeds) verifyCertificate(state, root, 'black');
});

for (const [label, fen, firstCount, secondCount, thirdCount, budget] of [
  ['second example', second, 6443, 591, 16355, limits],
  ['right-side black rook', adjusted, 3523, 519, 13118, limits],
  ['two bottom black rooks', second.replace('2rAK1p2', '1rrAK1p2'), 6443, 591, 225715,
    { graphNodes: 250000, graphEdges: 2000000 }],
]) test(`${label} has a four-move checking win but fails strict counterattack qualification`, () => {
  const state = createAnalysis(fen);
  let failure;
  try { analyzeBook(state, budget); } catch (error) { failure = error; }
  assert.match(failure.message, /題目不合格.*連將反殺/);
  assert.equal(state.first.nodes[0].distance, 7);
  assert.equal(state.stats.first.total, firstCount);
  assert.equal(state.stats.second.total, secondCount);
  assert.equal(state.stats.thirdExplored.total, thirdCount);
  let board = parseFen(fen).board;
  for (const [i, { fen: before, side, move }] of failure.path.entries()) {
    assert.equal(boardKey(board), before);
    assert.ok(inspect(board, side).moves.some(m => sameMove(m, move)));
    if (side === 'black' && state.locked[before]) assert.ok(sameMove(move, state.locked[before]));
    board = applyBoardCopy(board, move);
    if (side === 'red') assert.equal(isInCheck(board, 'black'), i !== failure.path.length - 1);
  }
  assert.equal(boardKey(board), failure.position);
  assert.match(failure.message, /反殺失敗見證/);
  verifyCertificate(state, failure.nodeId, 'red');
});

test('all graph and propagation phases resume from JSON snapshots in tiny slices', () => {
  let state = createAnalysis(first), result, rounds = 0;
  const phases = new Set();
  while (!result) {
    let checks = 0;
    try {
      result = analyzeBook(state, limits, () => {
        phases.add(state.phase);
        if (++checks > 17) throw new Error('slice');
      });
    } catch (error) {
      assert.equal(error.message, 'slice');
      state = json(state);
      assert.ok(++rounds < 2000);
    }
  }
  const fresh = createAnalysis(first);
  assert.deepEqual(result, analyzeBook(fresh, limits));
  assert.deepEqual(state.stats, fresh.stats);
  for (const phase of ['expand1', 'solve1', 'prune', 'seeds', 'expand3', 'solve3', 'export']) assert.ok(phases.has(phase));
});

test('retrograde prefers escape over cycles and longest resistance to unavoidable mate', () => {
  const n = (side, terminal = null) => ({ side, terminal, edges: [] });
  const nodes = [n('black'), n('red', 'black'), n('red'), n('black'),
    n('black'), n('red', 'red'), n('red'), n('black', 'red')];
  const link = (id, targets) => { nodes[id].edges = targets.map(to => ({ to, move: to })); };
  link(0, [2, 1]); link(2, [3]); link(3, [2]);
  link(4, [5, 6]); link(6, [7]);
  const graph = { nodes, solve: null };
  solveGraph(graph, () => {});
  assert.equal(nodes[0].edges[nodes[0].best].to, 1);
  assert.equal(nodes[2].winner, 'draw');
  assert.equal(nodes[4].edges[nodes[4].best].to, 6);
  assert.equal(nodes[4].distance, 2);
});

test('a cycle without a checking win is not a qualified puzzle', () => {
  assert.throws(() => analyzeBook(createAnalysis('3k5/9/9/9/9/9/9/9/9/5K3'), limits), /不能強制連將取勝/);
});

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'endgame-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
test('CLI preserves JSON format, automatic resume and reports stage counts on stderr', async t => {
  const dir = await workspace(t), options = { env: { ...process.env, TMPDIR: dir } };
  const args = [tool, '--name', 'first', '--fen', first, '--depth', '1'];
  const output = await run(process.execPath, args, options);
  const book = JSON.parse(output.stdout);
  assert.deepEqual(Object.keys(book).sort(), ['meta', 'table']);
  assert.deepEqual(book.meta, { name: 'first', step: 4, init: first });
  assert.match(output.stderr, /第一階段.*總計 9/);
  assert.match(output.stderr, /第三階段完成.*總計 205/);
  const file = checkpointPath(first, dir);
  assert.equal(readCheckpoint(file).state.phase, 'done');
  const resumed = await run(process.execPath, [tool, '--resume', file], options);
  assert.deepEqual(JSON.parse(resumed.stdout), book);
  const renamed = await run(process.execPath, [tool, '--name', 'renamed', '--fen', `${first} w - - 20 30`], options);
  assert.equal(JSON.parse(renamed.stdout).meta.name, 'renamed');
  await writeFile(file, 'corrupt database');
  await assert.rejects(run(process.execPath, [tool, '--resume', file]), e => e.stdout === '' && /database|資料庫/.test(e.stderr));
  const recovered = await run(process.execPath, args, options);
  assert.match(recovered.stderr, /忽略自動資料庫/);
});

test('CLI resource limits save resumable work without declaring the puzzle invalid', async t => {
  const dir = await workspace(t), file = join(dir, 'work.sqlite');
  await assert.rejects(run(process.execPath, [tool, '--name', 'limit', '--fen', first,
    '--graph-nodes', '2', '--checkpoint', file]), error => {
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /分析未完成.*graph-nodes/);
    assert.doesNotMatch(error.stderr, /題目不合格/);
    return true;
  });
  const resumed = await run(process.execPath, [tool, '--resume', file, '--graph-nodes', '50000']);
  assert.equal(JSON.parse(resumed.stdout).meta.step, 4);
  const original = await readFile(file, 'utf8');
  await assert.rejects(run(process.execPath, [tool, '--resume', file, '--name', 'wrong']), /不符/);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('CLI rejects invalid side, incompatible options and unqualified inputs without JSON', async () => {
  for (const args of [
    ['--name', 'bad', '--fen', `${first} b - - 0 1`],
    ['--name', 'bad', '--fen', first, '--fresh', '--no-checkpoint'],
    ['--name', 'bad', '--fen', '3k5/9/9/9/9/9/9/9/9/5K3', '--no-checkpoint'],
  ]) await assert.rejects(run(process.execPath, [tool, ...args]), e => e.code === 1 && e.stdout === '');
});

test('extra bottom cannon qualifies the branching example with every player move covered', () => {
  const fen = '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p2r/cr1AK4';
  const state = createAnalysis(fen), book = analyzeBook(state, limits);
  assert.equal(book.meta.step, 4);
  assert.equal(state.stats.first.total, 3523);
  assert.equal(state.stats.second.total, 519);
  assert.equal(state.stats.thirdExplored.total, 29952);
  assert.deepEqual(state.stats.final, { red: 3767, black: 3874, total: 7641, entries: 3874, added: 7122 });
  verifyBook(book);
  for (const root of state.seeds) verifyCertificate(state, root, 'black');
});
