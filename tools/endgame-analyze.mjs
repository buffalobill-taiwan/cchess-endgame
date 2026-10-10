// Continuous-check-specific book generator; stdout is exclusively game JSON.
import { parseFen } from '../js/notation.js';
import { boardKey } from './endgame-graph.mjs';
import { analyzeDisk, diskStatistics } from './endgame-disk-book.mjs';
import { databasePath, readMetadata, assertDatabaseIdle, EndgameDatabase, bookChunks, GRAPH_LIMIT, GRAPH_EDGE_LIMIT } from './endgame-database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const DEFAULT_DEPTH = 64, DEFAULT_TIME_LIMIT = 60000;

function parseArgs(argv) {
  const args = { depth: DEFAULT_DEPTH, timeLimit: DEFAULT_TIME_LIMIT, pretty: false,
    graphNodes: GRAPH_LIMIT, graphEdges: GRAPH_EDGE_LIMIT, provided: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pretty') { args.pretty = true; continue; }
    if (arg === '--no-checkpoint') { args.noCheckpoint = true; continue; }
    if (arg === '--fresh') { args.fresh = true; continue; }
    if (['--name', '--fen', '--depth', '--time-limit', '--checkpoint', '--resume', '--graph-nodes', '--graph-edges'].includes(arg)) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} 缺少參數`);
      args.provided.push(arg);
      if (arg === '--name') args.name = value;
      else if (arg === '--fen') args.fen = value;
      else if (arg === '--depth') args.depth = parsePositiveInt(value, '--depth');
      else if (arg === '--time-limit') args.timeLimit = parsePositiveInt(value, arg);
      else if (arg === '--graph-nodes') args.graphNodes = parsePositiveInt(value, arg);
      else if (arg === '--graph-edges') args.graphEdges = parsePositiveInt(value, arg);
      else if (arg === '--checkpoint') args.checkpoint = value;
      else args.resume = value;
      continue;
    }
    if (!arg.startsWith('--') && !args.fen) { args.fen = arg; continue; }
    throw new Error(`未知參數：${arg}`);
  }
  if (!args.name && !args.resume) throw new Error('缺少 --name');
  if (!args.fen && !args.resume) throw new Error('缺少 --fen');
  if (args.noCheckpoint && (args.checkpoint || args.resume || args.fresh)) {
    throw new Error('--no-checkpoint 不可與 --checkpoint、--resume 或 --fresh 並用');
  }
  if (args.fresh && args.resume) throw new Error('--fresh 不可與 --resume 並用');
  return args;
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} 必須是正整數`);
  return n;
}


function analyze(args, flag) {
  let saved = args.resume ? readMetadata(args.resume) : null;
  let fresh = Boolean(args.fresh || args.checkpoint && !args.resume);
  const budgets = [['--depth', 'depth'], ['--graph-nodes', 'graphNodes'], ['--graph-edges', 'graphEdges']];
  if (saved) {
    if (args.name && args.name !== saved.name) throw new Error('續算的題目名稱與資料庫不符');
    args.name ??= saved.name;
    args.fen ??= `${saved.init} w - - 0 1`;
    args.checkpoint ??= args.resume;
    for (const [flag, field] of budgets) {
      if (!args.provided.includes(flag)) args[field] = saved[field];
      if (args[field] < saved[field]) throw new Error(`續算時 ${flag} 不可低於資料庫設定`);
    }
  }
  const parsed = parseFen(args.fen, { allowMissingKings: false });
  if (parsed.sideToMove !== 'w') throw new Error('初始 FEN 必須由紅方 w 行棋');
  const init = boardKey(parsed.board);
  if (saved && init !== saved.init) throw new Error('續算的初始 FEN 與資料庫不符');
  if (!args.checkpoint && !args.noCheckpoint) {
    args.checkpoint = databasePath(init);
    if (!fresh) {
      try {
        const candidate = readMetadata(args.checkpoint);
        if (candidate.init === init && budgets.every(([flag, field]) =>
          !args.provided.includes(flag) || args[field] >= candidate[field])) {
          saved = candidate;
          for (const [, field] of budgets) args[field] = Math.max(args[field], saved[field]);
        } else fresh = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          assertDatabaseIdle(args.checkpoint);
          console.error(`忽略自動資料庫，保留舊檔並重新分析：${error.message}`);
          const suffix = `.incompatible-${Date.now()}-${process.pid}`;
          for (const tail of ['', '-wal', '-shm']) if (existsSync(args.checkpoint + tail)) {
            renameSync(args.checkpoint + tail, args.checkpoint + suffix + tail);
          }
        }
      }
    }
  }
  if (args.resume && resolve(args.resume) !== resolve(args.checkpoint)) {
    if (existsSync(args.checkpoint)) throw new Error('新的續算資料庫路徑已存在，請指定尚未存在的檔案');
    assertDatabaseIdle(args.resume);
    mkdirSync(dirname(args.checkpoint), { recursive: true });
    const source = new DatabaseSync(args.resume, { readOnly: true });
    try { source.prepare('VACUUM INTO ?').run(args.checkpoint); }
    finally { source.close(); }
  }
  const temporary = args.noCheckpoint ? mkdtempSync(join(tmpdir(), 'endgame-work-')) : null;
  const path = args.checkpoint ?? join(temporary, 'work.sqlite');
  let db;
  try {
    db = new EndgameDatabase(path, { name: args.name, init, depth: args.depth,
      graphNodes: args.graphNodes, graphEdges: args.graphEdges }, { fresh });
    const deadline = Date.now() + args.timeLimit;
    const check = () => {
      if (Atomics.load(flag, 0)) throw new Error('分析已中斷');
      if (Date.now() >= deadline) throw new Error('分析未完成：分析逾時');
    };
    analyzeDisk(db, check);
    return { db, temporary, path, report: diskStatistics(db) };
  } catch (error) {
    if (db) {
      error.report = diskStatistics(db);
      db.close();
      if (!temporary) error.checkpoint = path;
    }
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (isMainThread) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const buffer = new SharedArrayBuffer(4), flag = new Int32Array(buffer);
    const worker = new Worker(new URL(import.meta.url), { workerData: { args, buffer } });
    const interrupt = () => Atomics.store(flag, 0, 1);
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    worker.on('message', async message => {
      if (message.path) {
        console.error(message.report);
        if (!args.noCheckpoint) console.error(`SQLite：${message.path}`);
        try { await pipeline(Readable.from(bookChunks(message.path, args.pretty)), process.stdout); }
        catch (error) { console.error(`輸出失敗：${error.message}`); process.exitCode = 1; }
        finally { worker.postMessage('output-done'); }
      } else {
        console.error(`分析失敗：${message.error}`);
        if (message.report) console.error(message.report);
        if (message.checkpoint) console.error(`工作資料庫已儲存：${message.checkpoint}`);
        process.exitCode = 1;
      }
    });
    worker.on('error', error => { console.error(`分析失敗：${error.message}`); process.exitCode = 1; });
    worker.on('exit', code => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      if (code) process.exitCode = 1;
    });
  } catch (error) { console.error(`分析失敗：${error.message}`); process.exitCode = 1; }
} else {
  try {
    const result = analyze(workerData.args, new Int32Array(workerData.buffer));
    // Keep ownership until the parent finishes streaming the committed book.
    parentPort.once('message', () => {
      result.db.close();
      if (result.temporary) rmSync(result.temporary, { recursive: true, force: true });
    });
    parentPort.postMessage({ path: result.path, report: result.report });
  } catch (error) {
    parentPort.postMessage({ error: error.message, report: error.report, checkpoint: error.checkpoint });
  }
}
