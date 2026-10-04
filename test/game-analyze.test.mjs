import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';
import { countWinningSteps } from '../tools/game-steps.mjs';

const run = promisify(execFile);
const tool = new URL('../tools/game-analyze.mjs', import.meta.url);
const branchingFen = '2b1k4/3R5/4N4/9/1N7/9/9/9/4pppr1/3K4c w - - 0 1';

test('game-analyze starts with table expansion and reports timeout without partial JSON', async () => {
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--name', 'timeout', '--fen', branchingFen, '--time-limit', '1']),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /逾時分析/);
      assert.match(error.stderr, /中斷階段：應手表展開/);
      assert.doesNotMatch(error.stderr, /主搜尋/);
      return true;
    },
  );
});

test('game-analyze fails on an unproved defense instead of exporting an arbitrary move', async () => {
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--name', 'timeout', '--fen', branchingFen,
      '--depth', '1', '--time-limit', '5000']),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /中斷階段：應手表展開/);
      assert.match(error.stderr, /當下紅方 FEN：/);
      assert.match(error.stderr, /當下合法走法 \d+ 個，其中將軍 \d+ 個/);
      assert.match(error.stderr, /初始分支（依黑方搜尋耗時排序）/);
      assert.match(error.stderr, /展開最多新局面的節點/);
      assert.match(error.stderr, /直接新增 \d+/);
      assert.match(error.stderr, /黑方最優應手尚未證明（搜尋深度 1 plies）/);
      assert.match(error.stderr, /未解局面分析/);
      assert.doesNotMatch(error.stderr, /改用排序第一步/);
      return true;
    },
  );
});

test('game-analyze rejects missing metadata and invalid positions without JSON stdout', async () => {
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--fen', '4k4/9/9/9/9/9/9/9/9/4K4']),
    error => error.code === 1 && error.stdout === '' && /缺少 --name/.test(error.stderr),
  );
});

test('game-analyze rejects a non-red initial side', async () => {
  const fen = '4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1';
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--name', 'test', '--fen', fen]),
    error => error.code === 1 && error.stdout === '' && /必須由紅方/.test(error.stderr),
  );
});

test('game-analyze builds the bundled continuous-check position', async () => {
  const fen = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'sample', '--fen', fen, '--depth', '64', '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.deepEqual(result.meta, {
    name: 'sample',
    step: 4,
    init: fen.split(' ')[0],
  });
  assert.ok(Object.keys(result.table).length > 0);
  verifyCoverage(result);
});

test('game-analyze proves defenses on a simple mate puzzle', async () => {
  const fen = '4k4/9/9/6N2/9/4C4/9/4p4/3p1p3/4K4 w - - 0 1';
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'simple', '--fen', fen, '--depth', '64', '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.meta.step, 1);
  assert.equal(result.meta.init, fen.split(' ')[0]);
  assert.ok(Object.keys(result.table).length > 0);
  verifyCoverage(result);
});

// Independently walk the exported policy, including every legal player move.
// This checks closure, terminal encoding, legal black replies and orphan entries.
function verifyCoverage({ meta, table }) {
  const key = b => boardToFen(b).split(' ')[0];
  const terminal = (b, side) => {
    const kings = findKings(b);
    return !kings.red || !kings.black || generateLegalMoves(b, side).length === 0;
  };
  const visited = new Set(), entries = new Set(), active = new Set();
  let cycles = 0;
  function visit(fen) {
    if (active.has(fen)) { cycles++; return; }
    if (visited.has(fen)) return;
    visited.add(fen);
    const { board } = parseFen(fen);
    if (terminal(board, 'red')) return;
    active.add(fen);
    for (const red of generateLegalMoves(board, 'red')) {
      const afterRed = applyBoardCopy(board, red), redKey = key(afterRed);
      assert.ok(Object.hasOwn(table, redKey), `missing player move: ${redKey}`);
      entries.add(redKey);
      if (terminal(afterRed, 'black')) {
        assert.equal(table[redKey], null);
        continue;
      }
      const blackBoards = generateLegalMoves(afterRed, 'black').map(m => applyBoardCopy(afterRed, m));
      const chosen = blackBoards.find(b => key(b) === table[redKey]);
      assert.ok(chosen, `illegal black reply: ${redKey}`);
      if (!terminal(chosen, 'red')) visit(table[redKey]);
    }
    active.delete(fen);
  }
  visit(meta.init);
  assert.deepEqual([...entries].sort(), Object.keys(table).sort());
  return { cycles, positions: visited.size };
}

test('game-analyze exports a closed cyclic policy without rejecting repetition', async () => {
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'cycle', '--fen', '3k5/9/9/9/9/9/9/9/9/5K3 w - - 0 1',
    '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.meta.step, null);
  const coverage = verifyCoverage(result);
  assert.ok(coverage.cycles > 0);
  assert.ok(coverage.positions > 1);
  // A null elsewhere in the table is not evidence that the initial position
  // can win. Traverse the cyclic component and ignore the unreachable ending.
  result.table['4k4/9/9/9/9/9/9/9/4R4/4K4'] = null;
  assert.equal(countWinningSteps(result.meta.init, result.table), null);
});

test('game-analyze exports every player move even when black always wins', async () => {
  const fen = '4k4/9/9/9/9/9/4p4/9/9/4K4 w - - 0 1';
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'black wins', '--fen', fen, '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.deepEqual(result.meta, { name: 'black wins', step: null, init: fen.split(' ')[0] });
  assert.ok(Object.keys(result.table).length > 0);
  assert.ok(Object.values(result.table).every(response => response !== null));
  verifyCoverage(result);
});

test('single red pawn exports a complete cyclic book without a search-depth horizon', async () => {
  const fen = '4k4/9/9/4P4/9/9/9/9/9/4K4 w - - 0 1';
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'single pawn', '--fen', fen,
    '--depth', '1', '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.meta.step, 2);
  assert.ok(Object.keys(result.table).length > 100);
  assert.ok(Object.keys(result.table).length <= 36 * 9 * 9 + 9 * 9);
  assert.ok(verifyCoverage(result).cycles > 0);
});
