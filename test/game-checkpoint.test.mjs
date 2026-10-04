import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { automaticCheckpointPath, readCheckpoint } from '../tools/game-checkpoint.mjs';

const run = promisify(execFile);
const tool = new URL('../tools/game-analyze.mjs', import.meta.url).pathname;
const sample = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cchess-checkpoint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'work.json');
}

test('depth-limited work resumes to the same complete book as an uninterrupted run', async t => {
  const file = await workspace(t);
  const fen = '3k5/4P4/9/9/9/9/9/9/9/4K4 w - - 0 1';
  await assert.rejects(run(process.execPath, [tool, '--name', 'resume', '--fen', fen,
    '--depth', '1', '--graph-nodes', '2', '--graph-edges', '20', '--checkpoint', file]), error => {
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /尚未證明/);
    assert.match(error.stderr, /工作快照已儲存/);
    return true;
  });
  const partial = readCheckpoint(file);
  assert.ok(partial.progress.current);
  assert.ok(Object.keys(partial.progress.table).length > 0);
  const resumed = await run(process.execPath, [tool, '--resume', file, '--depth', '64',
    '--graph-nodes', '50000', '--graph-edges', '400000', '--time-limit', '5000']);
  const fresh = await run(process.execPath, [tool, '--no-checkpoint', '--name', 'resume', '--fen', fen,
    '--time-limit', '5000']);
  assert.equal(resumed.stderr, '');
  assert.deepEqual(JSON.parse(resumed.stdout), JSON.parse(fresh.stdout));
  const complete = readCheckpoint(file);
  assert.equal(complete.progress.current, null);
  assert.equal(complete.progress.pending.length, 0);
  const again = await run(process.execPath, [tool, '--resume', file]);
  assert.deepEqual(JSON.parse(again.stdout), JSON.parse(fresh.stdout));
});

test('time-limited work saves an independently resumable snapshot without JSON stdout', async t => {
  const file = await workspace(t);
  await assert.rejects(run(process.execPath, [tool, '--name', 'timeout', '--fen', sample,
    '--time-limit', '1', '--checkpoint', file]), error => {
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /逾時/);
    return true;
  });
  const resumed = await run(process.execPath, [tool, '--resume', file, '--time-limit', '5000']);
  assert.equal(JSON.parse(resumed.stdout).meta.step, 4);
});

test('resume rejects changed inputs, incompatible versions and corrupted snapshots', async t => {
  const file = await workspace(t);
  await run(process.execPath, [tool, '--name', 'validation', '--fen', sample, '--checkpoint', file]);
  const original = await readFile(file, 'utf8');
  for (const args of [
    ['--name', 'different'],
    ['--fen', '4k4/9/9/4P4/9/9/9/9/9/4K4 w - - 0 1'],
    ['--depth', '1'],
  ]) {
    await assert.rejects(run(process.execPath, [tool, '--resume', file, ...args]),
      error => error.stdout === '' && /不符|不可低於/.test(error.stderr));
    assert.equal(await readFile(file, 'utf8'), original);
  }
  for (const mutate of [
    d => { d.version = 999; },
    d => { d.engine = 'old engine'; },
    d => { d.data.name = 'tampered'; },
  ]) {
    const data = JSON.parse(original);
    mutate(data);
    await writeFile(file, JSON.stringify(data));
    await assert.rejects(run(process.execPath, [tool, '--resume', file]),
      error => error.stdout === '' && /快照.*不相容|校驗失敗/.test(error.stderr));
  }
});

test('Ctrl-C interrupts synchronous search and saves consistent work', async t => {
  const file = await workspace(t);
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const child = spawn(process.execPath, [tool, '--name', 'interrupt', '--fen', fen, '--checkpoint', file]);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not stop')), 8000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
  for (let i = 0; i < 200; i++) {
    try { await access(file); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(child.kill('SIGINT'), true);
  assert.equal(await closed, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /分析已中斷/);
  assert.match(stderr, /工作快照已儲存/);
  const saved = readCheckpoint(file);
  assert.equal(saved.name, 'interrupt');
  assert.ok(saved.progress.current);
});

test('default checkpoint resumes by normalized position, independently of title and counters', async t => {
  const directory = dirname(await workspace(t));
  const options = { env: { ...process.env, TMPDIR: directory } };
  const fen = '3k5/4P4/9/9/9/9/9/9/9/4K4 w - - 0 1';
  const file = automaticCheckpointPath(fen.split(' ')[0], directory);
  assert.match(file, /checkpoint-[a-f0-9]{64}\.json$/);
  await assert.rejects(run(process.execPath, [tool, '--name', 'first', '--fen', fen,
    '--depth', '1', '--graph-nodes', '2', '--graph-edges', '20'], options), error => {
    assert.equal(error.stdout, '');
    assert.ok(error.stderr.includes(file));
    return /尚未證明/.test(error.stderr);
  });
  assert.ok(readCheckpoint(file).progress.current);
  const resumed = await run(process.execPath, [tool, '--name', 'second', '--fen',
    fen.replace('0 1', '10 20'), '--time-limit', '5000'], options);
  const fresh = await run(process.execPath, [tool, '--no-checkpoint', '--name', 'second',
    '--fen', fen, '--time-limit', '5000'], options);
  assert.deepEqual(JSON.parse(resumed.stdout), JSON.parse(fresh.stdout));
  const complete = readCheckpoint(file);
  assert.equal(complete.name, 'second');
  assert.equal(complete.progress.current, null);
  const repeated = await run(process.execPath, [tool, '--name', 'third', '--fen', fen], options);
  assert.equal(JSON.parse(repeated.stdout).meta.name, 'third');
  assert.deepEqual(readCheckpoint(file).solver, complete.solver);
  assert.notEqual(file, automaticCheckpointPath(sample.split(' ')[0], directory));
  // A smaller explicitly requested budget must not reuse a completed book.
  await assert.rejects(run(process.execPath, [tool, '--name', 'smaller', '--fen', fen, '--depth', '1',
    '--graph-nodes', '2', '--graph-edges', '20'], options), error =>
    error.stdout === '' && /尚未證明/.test(error.stderr));
});

test('automatic snapshots recover from corruption; fresh and opt-out control reuse', async t => {
  const directory = dirname(await workspace(t));
  const options = { env: { ...process.env, TMPDIR: directory } };
  const file = automaticCheckpointPath(sample.split(' ')[0], directory);
  const args = [tool, '--name', 'auto', '--fen', sample, '--time-limit', '5000'];
  await run(process.execPath, [...args, '--no-checkpoint'], options);
  await assert.rejects(access(file), { code: 'ENOENT' });
  for (const contents of ['broken JSON', JSON.stringify({ version: 999 })]) {
    await writeFile(file, contents);
    const recovered = await run(process.execPath, args, options);
    assert.equal(JSON.parse(recovered.stdout).meta.step, 4);
    assert.match(recovered.stderr, /忽略自動快照/);
    assert.equal(readCheckpoint(file).progress.pending.length, 0);
  }
  await writeFile(file, 'broken JSON');
  const fresh = await run(process.execPath, [...args, '--fresh'], options);
  assert.equal(fresh.stderr, '');
  assert.equal(readCheckpoint(file).progress.pending.length, 0);
  const original = await readFile(file, 'utf8');
  await run(process.execPath, [...args, '--no-checkpoint'], options);
  assert.equal(await readFile(file, 'utf8'), original);

});
