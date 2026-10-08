// Continuous-check-specific book generator; stdout is exclusively game JSON.
import { parseFen } from '../js/notation.js';
import { boardKey } from './endgame-graph.mjs';
import { createAnalysis, analyzeBook, statistics } from './endgame-book.mjs';
import { checkpointPath, readCheckpoint, writeCheckpoint } from './endgame-checkpoint.mjs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const DEFAULT_DEPTH = 64, DEFAULT_TIME_LIMIT = 60000;
const GRAPH_LIMIT = 50000, GRAPH_EDGE_LIMIT = 400000;

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
  let saved = args.resume ? readCheckpoint(args.resume) : null;
  const budgets = [['--depth', 'depth'], ['--graph-nodes', 'graphNodes'], ['--graph-edges', 'graphEdges']];
  if (saved) {
    if (args.name && args.name !== saved.name) throw new Error('續算的題目名稱與快照不符');
    args.name ??= saved.name;
    args.fen ??= `${saved.init} w - - 0 1`;
    args.checkpoint ??= args.resume;
    for (const [flag, field] of budgets) {
      if (!args.provided.includes(flag)) args[field] = saved[field];
      if (args[field] < saved[field]) throw new Error(`續算時 ${flag} 不可低於快照設定`);
    }
  }
  const parsed = parseFen(args.fen, { allowMissingKings: false });
  if (parsed.sideToMove !== 'w') throw new Error('初始 FEN 必須由紅方 w 行棋');
  const init = boardKey(parsed.board);
  if (saved && init !== saved.init) throw new Error('續算的初始 FEN 與快照不符');
  if (!args.checkpoint && !args.noCheckpoint) {
    args.checkpoint = checkpointPath(init);
    if (!args.fresh) {
      try {
        const candidate = readCheckpoint(args.checkpoint);
        if (candidate.init === init && budgets.every(([flag, field]) =>
          !args.provided.includes(flag) || args[field] >= candidate[field])) {
          saved = candidate;
          for (const [, field] of budgets) args[field] = Math.max(args[field], saved[field]);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(`忽略自動快照，重新分析：${error.message}`);
      }
    }
  }
  const state = saved?.state ?? createAnalysis(init);
  const deadline = Date.now() + args.timeLimit;
  let lastSave = Date.now();
  function save() {
    if (args.checkpoint) writeCheckpoint(args.checkpoint, { name: args.name, init,
      depth: args.depth, graphNodes: args.graphNodes, graphEdges: args.graphEdges, state });
    lastSave = Date.now();
  }
  function check() {
    if (Atomics.load(flag, 0)) throw new Error('分析已中斷');
    if (Date.now() >= deadline) throw new Error('分析未完成：分析逾時');
    if (args.checkpoint && Date.now() - lastSave >= 1000) save();
  }
  try {
    save();
    const result = analyzeBook(state, args, check);
    check(); save();
    return { book: { meta: { name: args.name, step: result.meta.step, init }, table: result.table },
      report: statistics(state) };
  } catch (error) {
    try { save(); error.checkpoint = args.checkpoint; }
    catch (saveError) { error.message += `；快照儲存失敗：${saveError.message}`; }
    error.report = statistics(state);
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
    worker.on('message', message => {
      if (message.output !== undefined) {
        console.error(message.report);
        process.stdout.write(message.output + '\n');
      } else {
        console.error(`分析失敗：${message.error}`);
        if (message.report) console.error(message.report);
        if (message.checkpoint) console.error(`工作快照已儲存：${message.checkpoint}`);
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
    parentPort.postMessage({ output: JSON.stringify(result.book, null, workerData.args.pretty ? 2 : 0), report: result.report });
  } catch (error) {
    parentPort.postMessage({ error: error.message, report: error.report, checkpoint: error.checkpoint });
  }
}
