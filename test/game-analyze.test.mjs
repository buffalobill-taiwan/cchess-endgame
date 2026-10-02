import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const tool = new URL('../tools/game-analyze.mjs', import.meta.url);
const branchingFen = '2b1k4/3R5/4N4/9/1N7/9/9/9/4pppr1/3K4c w - - 0 1';

test('game-analyze reports a root-search timeout on stderr without partial JSON', async () => {
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--name', 'timeout', '--fen', branchingFen, '--time-limit', '1']),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /逾時分析/);
      assert.match(error.stderr, /中斷階段：主搜尋/);
      assert.match(error.stderr, /主搜尋：\d+ms/);
      assert.match(error.stderr, /黑方搜尋：0 次/);
      return true;
    },
  );
});

test('game-analyze reports traversal paths and branching positions on table timeout', async () => {
  await assert.rejects(
    run(process.execPath, [tool.pathname, '--name', 'timeout', '--fen', branchingFen,
      '--depth', '1', '--time-limit', '500']),
    error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /中斷階段：應手表展開/);
      assert.match(error.stderr, /當下紅方 FEN：/);
      assert.match(error.stderr, /當下合法走法 \d+ 個，其中將軍 \d+ 個/);
      assert.match(error.stderr, /初始分支（依黑方搜尋耗時排序）/);
      assert.match(error.stderr, /展開最多新局面的節點/);
      assert.match(error.stderr, /直接新增 \d+/);
      assert.match(error.stderr, /改用排序第一步的例子/);
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
});

test('game-analyze reuses alpha-beta refutations on a simple mate puzzle', async () => {
  const fen = '4k4/9/9/6N2/9/4C4/9/4p4/3p1p3/4K4 w - - 0 1';
  const { stdout, stderr } = await run(process.execPath, [
    tool.pathname, '--name', 'simple', '--fen', fen, '--depth', '64', '--time-limit', '5000',
  ]);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.meta.step, 1);
  assert.equal(result.meta.init, fen.split(' ')[0]);
  assert.ok(Object.keys(result.table).length > 0);
});
