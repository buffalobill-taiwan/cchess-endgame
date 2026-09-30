import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const tool = new URL('../tools/game-analyze.mjs', import.meta.url);

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
  const { stdout } = await run(process.execPath, [
    tool.pathname, '--name', 'sample', '--fen', fen, '--depth', '64', '--time-limit', '5000',
  ]);
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
  const { stdout } = await run(process.execPath, [
    tool.pathname, '--name', 'simple', '--fen', fen, '--depth', '64', '--time-limit', '5000',
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.meta.step, 1);
  assert.equal(result.meta.init, fen.split(' ')[0]);
  assert.ok(Object.keys(result.table).length > 0);
});
