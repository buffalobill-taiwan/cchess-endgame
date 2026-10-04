// Build a complete table of black responses for every reachable red position.
// usage: node tools/game-analyze.mjs --name <name> --fen <fen> [--depth N] [--time-limit MS] [--pretty]

import { parseFen, boardToFen, moveToNotation } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';
import { GameSolver } from './game-solver.mjs';
import { AnalysisDiagnostics } from './game-analyze-diagnostics.mjs';
import { countWinningSteps } from './game-steps.mjs';

const DEFAULT_DEPTH = 64;
const DEFAULT_TIME_LIMIT = 60000;

class AnalysisFailure extends Error {}
class AnalysisTimeout extends AnalysisFailure {}

function checkDeadline(deadline) {
  if (Date.now() >= deadline) throw new AnalysisTimeout('分析逾時');
}

function parseArgs(argv) {
  const args = { depth: DEFAULT_DEPTH, timeLimit: DEFAULT_TIME_LIMIT, pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pretty') { args.pretty = true; continue; }
    if (['--name', '--fen', '--depth', '--time-limit'].includes(arg)) {
      const value = argv[++i];
      if (!value) throw new AnalysisFailure(`${arg} 缺少參數`);
      if (arg === '--name') args.name = value;
      else if (arg === '--fen') args.fen = value;
      else if (arg === '--depth') args.depth = parsePositiveInt(value, '--depth');
      else args.timeLimit = parsePositiveInt(value, '--time-limit');
      continue;
    }
    if (!arg.startsWith('--') && !args.fen) { args.fen = arg; continue; }
    throw new AnalysisFailure(`未知參數：${arg}`);
  }
  if (!args.name) throw new AnalysisFailure('缺少 --name');
  if (!args.fen) throw new AnalysisFailure('缺少 --fen');
  return args;
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AnalysisFailure(`${label} 必須是正整數`);
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
  return orderedMoves(board, sideToMove).length === 0;
}

function chooseBlackMove(board, moves, solver, args, deadline, diagnostics) {
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
  if (result.resolved && result.move) return result.move;
  throw new AnalysisFailure(`黑方最優應手尚未證明（搜尋深度 ${args.depth} plies）：${boardKey(board)} b - - 0 1`);
}

async function buildTable(board, solver, args, deadline, diagnostics) {
  const table = Object.create(null);
  const pending = [{ board, node: diagnostics.discover(boardKey(board)) }];
  const visited = new Set();
  const knownRedPositions = new Set([boardKey(board)]);
  diagnostics.updatePending(pending.length);

  while (pending.length > 0) {
    checkDeadline(deadline);
    const { board: redBoard, node } = pending.pop();
    diagnostics.updatePending(pending.length);
    const redFen = boardKey(redBoard);
    if (visited.has(redFen)) continue;
    visited.add(redFen);
    node.started = true;
    diagnostics.current = node;
    diagnostics.activeMove = null;
    diagnostics.afterRedFen = null;
    const redMoves = orderedMoves(redBoard, 'red');
    node.legal = redMoves.length;
    node.checks = redMoves.filter(move => moveGivesCheck(redBoard, move)).length;

    for (const redMove of redMoves) {
      diagnostics.activeMove = moveToNotation(redBoard, redMove, 'red');
      diagnostics.afterRedFen = null;
      checkDeadline(deadline);
      const afterRed = applyBoardCopy(redBoard, redMove);
      const afterRedFen = boardKey(afterRed);
      diagnostics.afterRedFen = afterRedFen;
      // This black-to-move position already has a fixed response. Its target
      // was queued when the entry was first created, including cycle edges.
      if (afterRedFen in table) {
        diagnostics.reused++;
        continue;
      }
      if (isTerminal(afterRed, 'black')) {
        if (!(afterRedFen in table)) diagnostics.entries++;
        table[afterRedFen] = null;
        continue;
      }

      const blackMoves = orderedMoves(afterRed, 'black');
      const blackMove = chooseBlackMove(afterRed, blackMoves, solver, args, deadline, diagnostics);
      if (!blackMove) {
        if (!(afterRedFen in table)) diagnostics.entries++;
        table[afterRedFen] = null;
        continue;
      }
      const afterBlack = applyBoardCopy(afterRed, blackMove);
      if (!(afterRedFen in table)) diagnostics.entries++;
      table[afterRedFen] = boardKey(afterBlack);

      if (!isTerminal(afterBlack, 'red')) {
        const nextFen = boardKey(afterBlack);
        if (!knownRedPositions.has(nextFen)) {
          knownRedPositions.add(nextFen);
          const via = `${diagnostics.activeMove} / ${moveToNotation(afterRed, blackMove, 'black')}`;
          pending.push({ board: afterBlack, node: diagnostics.discover(nextFen, node, via) });
          diagnostics.updatePending(pending.length);
        }
      }
    }
    diagnostics.completed++;
    diagnostics.activeMove = null;
    diagnostics.afterRedFen = null;
  }
  checkDeadline(deadline);
  return table;
}

async function analyze(args) {
  const parsed = parseFen(args.fen, { allowMissingKings: false });
  if (parsed.sideToMove !== 'w') throw new AnalysisFailure('初始 FEN 必須由紅方 w 行棋');
  const start = Date.now();
  const deadline = start + args.timeLimit;
  const diagnostics = new AnalysisDiagnostics(start, args.timeLimit, boardKey(parsed.board));
  const solver = new GameSolver();
  try {
    const table = await buildTable(parsed.board, solver, args, deadline, diagnostics);
    diagnostics.phase = '步數推導';
    const step = countWinningSteps(boardKey(parsed.board), table, () => checkDeadline(deadline));
    checkDeadline(deadline);
    return { meta: { name: args.name, step, init: boardKey(parsed.board) }, table };
  } catch (error) {
    if (error instanceof AnalysisFailure) error.report = diagnostics.format(Date.now(), error instanceof AnalysisTimeout);
    throw error;
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await analyze(args);
  console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`分析失敗：${message}`);
  if (error.report) console.error(error.report);
  process.exitCode = 1;
}
