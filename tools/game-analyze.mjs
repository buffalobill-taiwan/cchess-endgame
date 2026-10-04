// Build a complete table of black responses for every reachable red position.
// usage: node tools/game-analyze.mjs --name <name> --fen <fen> [--depth N] [--time-limit MS] [--pretty]

import { parseFen, boardToFen, moveToNotation } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';
import { GameSolver } from './game-solver.mjs';
import { AnalysisDiagnostics } from './game-analyze-diagnostics.mjs';
import { countWinningSteps } from './game-steps.mjs';
import { GRAPH_LIMIT, GRAPH_EDGE_LIMIT } from './game-retrograde.mjs';
import { automaticCheckpointPath, readCheckpoint, writeCheckpoint } from './game-checkpoint.mjs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const DEFAULT_DEPTH = 64;
const DEFAULT_TIME_LIMIT = 60000;

class AnalysisFailure extends Error {}
class AnalysisTimeout extends AnalysisFailure {}
let cancelled = () => false;

function checkDeadline(deadline) {
  if (cancelled()) throw new AnalysisFailure('分析已中斷');
  if (Date.now() >= deadline) throw new AnalysisTimeout('分析逾時');
}

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
      if (!value) throw new AnalysisFailure(`${arg} 缺少參數`);
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
    throw new AnalysisFailure(`未知參數：${arg}`);
  }
  if (!args.name && !args.resume) throw new AnalysisFailure('缺少 --name');
  if (!args.fen && !args.resume) throw new AnalysisFailure('缺少 --fen');
  if (args.noCheckpoint && (args.checkpoint || args.resume || args.fresh)) {
    throw new AnalysisFailure('--no-checkpoint 不可與 --checkpoint、--resume 或 --fresh 並用');
  }
  if (args.fresh && args.resume) throw new AnalysisFailure('--fresh 不可與 --resume 並用');
  return args;
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AnalysisFailure(`${label} 必須是正整數`);
  return n;
}

function boardKey(board) {
  return boardToFen(board, 'w').split(' ')[0];
}

function moveGivesCheck(board, move) {
  return isInCheck(applyBoardCopy(board, move), 'black');
}

function orderedMoves(board, side) {
  return generateLegalMoves(board, side).sort((a, b) => {
    const aIndex = a.from.row * 9 + a.from.col;
    const bIndex = b.from.row * 9 + b.from.col;
    const aTarget = a.to.row * 9 + a.to.col;
    const bTarget = b.to.row * 9 + b.to.col;
    const aCapture = a.captured ? 1 : 0;
    const bCapture = b.captured ? 1 : 0;
    if (side === 'red') {
      const aCheck = moveGivesCheck(board, a) ? 1 : 0;
      const bCheck = moveGivesCheck(board, b) ? 1 : 0;
      if (aCheck !== bCheck) return bCheck - aCheck;
    }
    if (side === 'black' && aCapture !== bCapture) return bCapture - aCapture;
    return (aIndex - bIndex) || (aTarget - bTarget);
  });
}

function isTerminal(board, sideToMove) {
  const { red, black } = findKings(board);
  if (!red || !black) return true;
  return generateLegalMoves(board, sideToMove).length === 0;
}

function chooseBlackMove(board, moves, solver, known, args, deadline, diagnostics) {
  if (moves.length === 0) return null;
  if (moves.length === 1) {
    diagnostics.forced++;
    return moves[0];
  }
  checkDeadline(deadline);
  let result;
  const start = Date.now();
  try {
    result = solver.solve(board, 'black', args.depth, deadline);
  } finally {
    diagnostics.recordSearch(Date.now() - start);
    if (solver.method === 'graph') diagnostics.graphQueries++;
    diagnostics.graphPositions = solver.graph?.positions.size ?? 0;
    diagnostics.graphExpanded = solver.graph?.expanded ?? 0;
  }
  checkDeadline(deadline);
  if (result.resolved && result.move) {
    let move;
    try { move = solver.preferKnown(board, moves, known, result, deadline); }
    catch (error) { checkDeadline(deadline); throw error; }
    checkDeadline(deadline);
    diagnostics.preferredKnown = solver.preferredKnown;
    return move;
  }
  throw new AnalysisFailure(`黑方最優應手尚未證明（搜尋深度 ${args.depth} plies）：${boardKey(board)} b - - 0 1`);
}

function buildTable(progress, solver, args, deadline, diagnostics, tick) {
  const { table, pending, discovered } = progress;
  const completed = new Set(progress.completed);
  const known = new Map();
  for (let id = 0; id < discovered.length; id++) {
    const item = discovered[id];
    const node = diagnostics.discover(item.fen, item.parent === null ? null : diagnostics.nodes[item.parent], item.via);
    node.id = id;
    node.started = completed.has(item.fen);
    known.set(item.fen, node);
  }
  diagnostics.entries = Object.keys(table).length;
  diagnostics.completed = completed.size;
  diagnostics.updatePending(pending.length);

  while (progress.current || pending.length) {
    checkDeadline(deadline);
    if (!progress.current) progress.current = { fen: pending.pop(), index: 0 };
    const current = progress.current;
    const node = known.get(current.fen);
    node.started = true;
    diagnostics.current = node;
    diagnostics.updatePending(pending.length);
    const redBoard = parseFen(current.fen).board;
    const redMoves = orderedMoves(redBoard, 'red');
    node.legal = redMoves.length;
    node.checks = redMoves.filter(move => moveGivesCheck(redBoard, move)).length;
    for (; current.index < redMoves.length; current.index++) {
      const redMove = redMoves[current.index];
      diagnostics.activeMove = moveToNotation(redBoard, redMove, 'red');
      diagnostics.afterRedFen = null;
      checkDeadline(deadline);
      tick();
      const afterRed = applyBoardCopy(redBoard, redMove);
      const afterRedFen = boardKey(afterRed);
      diagnostics.afterRedFen = afterRedFen;
      if (Object.hasOwn(table, afterRedFen)) { diagnostics.reused++; continue; }
      if (isTerminal(afterRed, 'black')) {
        table[afterRedFen] = null;
        diagnostics.entries++;
        continue;
      }
      const blackMoves = orderedMoves(afterRed, 'black');
      const blackMove = chooseBlackMove(afterRed, blackMoves, solver, known, args, deadline, diagnostics);
      const afterBlack = applyBoardCopy(afterRed, blackMove);
      const nextFen = boardKey(afterBlack);
      // Commit response and queue target together, without interruption points.
      table[afterRedFen] = nextFen;
      diagnostics.entries++;
      if (!isTerminal(afterBlack, 'red') && !known.has(nextFen)) {
        const via = `${diagnostics.activeMove} / ${moveToNotation(afterRed, blackMove, 'black')}`;
        const child = diagnostics.discover(nextFen, node, via);
        child.id = discovered.length;
        discovered.push({ fen: nextFen, parent: node.id, via });
        known.set(nextFen, child);
        pending.push(nextFen);
        diagnostics.updatePending(pending.length);
      }
    }
    progress.completed.push(current.fen);
    progress.current = null;
    diagnostics.completed++;
    diagnostics.activeMove = null;
    diagnostics.afterRedFen = null;
  }
  checkDeadline(deadline);
  return table;
}

function analyze(args) {
  let saved = args.resume ? readCheckpoint(args.resume) : null;
  if (saved) {
    if (args.name && args.name !== saved.name) throw new AnalysisFailure('續算的題目名稱與快照不符');
    args.name ??= saved.name;
    args.fen ??= `${saved.init} w - - 0 1`;
    args.checkpoint ??= args.resume;
    for (const [flag, field] of [['--depth', 'depth'], ['--graph-nodes', 'graphNodes'], ['--graph-edges', 'graphEdges']]) {
      if (!args.provided.includes(flag)) args[field] = saved[field];
      if (args[field] < saved[field]) throw new AnalysisFailure(`續算時 ${flag} 不可低於快照設定`);
    }
  }
  const parsed = parseFen(args.fen, { allowMissingKings: false });
  if (parsed.sideToMove !== 'w') throw new AnalysisFailure('初始 FEN 必須由紅方 w 行棋');
  const init = boardKey(parsed.board);
  if (saved && init !== saved.init) throw new AnalysisFailure('續算的初始 FEN 與快照不符');
  if (!args.checkpoint && !args.noCheckpoint) {
    args.checkpoint = automaticCheckpointPath(init);
    if (!args.fresh) {
      try {
        const candidate = readCheckpoint(args.checkpoint);
        const budgets = [['--depth', 'depth'], ['--graph-nodes', 'graphNodes'], ['--graph-edges', 'graphEdges']];
        // An explicitly reduced budget requests a fresh run. Otherwise retain
        // at least the current defaults, so rerunning can raise earlier limits.
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
  const start = Date.now(), deadline = start + args.timeLimit;
  const diagnostics = new AnalysisDiagnostics(start, args.timeLimit, init);
  const progress = saved?.progress ?? { table: Object.create(null), pending: [init], current: null,
    completed: [], discovered: [{ fen: init, parent: null, via: null }] };
  let lastSave = Date.now();
  const solver = new GameSolver({ graphNodes: args.graphNodes, graphEdges: args.graphEdges,
    isCancelled: cancelled, onTick: () => tick() });
  if (saved) solver.restore(saved.solver);
  function save() {
    if (!args.checkpoint) return;
    writeCheckpoint(args.checkpoint, { name: args.name, init, depth: args.depth,
      graphNodes: args.graphNodes, graphEdges: args.graphEdges, progress, solver: solver.snapshot() });
    lastSave = Date.now();
  }
  function tick() {
    if (args.checkpoint && Date.now() - lastSave >= 1000) save();
  }
  try {
    save();
    const table = buildTable(progress, solver, args, deadline, diagnostics, tick);
    diagnostics.phase = '步數推導';
    const step = countWinningSteps(init, table, () => { checkDeadline(deadline); tick(); });
    checkDeadline(deadline);
    save();
    return { meta: { name: args.name, step, init }, table };
  } catch (error) {
    if (!(error instanceof Error)) error = new AnalysisFailure(String(error));
    try { save(); }
    catch (saveError) { throw new AnalysisFailure(`${error.message ?? String(error)}；快照儲存失敗：${saveError.message}`); }
    if (error instanceof AnalysisFailure) error.report = diagnostics.format(Date.now(), error instanceof AnalysisTimeout);
    if (args.checkpoint) error.checkpoint = args.checkpoint;
    throw error;
  }
}

// A responsive main thread receives Ctrl-C even during synchronous search.
// The worker checks the shared flag and saves at a consistent interruption point.
if (isMainThread) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const buffer = new SharedArrayBuffer(4), flag = new Int32Array(buffer);
    const worker = new Worker(new URL(import.meta.url), { workerData: { args, buffer } });
    const interrupt = () => Atomics.store(flag, 0, 1);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    worker.on('message', message => {
      if (message.output !== undefined) process.stdout.write(message.output + '\n');
      else {
        console.error(`分析失敗：${message.error}`);
        if (message.report) console.error(message.report);
        if (message.checkpoint) console.error(`工作快照已儲存：${message.checkpoint}`);
        process.exitCode = 1;
      }
    });
    worker.on('error', error => { console.error(`分析失敗：${error.message}`); process.exitCode = 1; });
    worker.on('exit', code => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      if (code) process.exitCode = 1;
    });
  } catch (error) { console.error(`分析失敗：${error.message}`); process.exitCode = 1; }
} else {
  const flag = new Int32Array(workerData.buffer);
  cancelled = () => Atomics.load(flag, 0) !== 0;
  try {
    const result = analyze(workerData.args);
    parentPort.postMessage({ output: JSON.stringify(result, null, workerData.args.pretty ? 2 : 0) });
  } catch (error) {
    parentPort.postMessage({ error: error.message ?? String(error), report: error.report, checkpoint: error.checkpoint });
  }
}
