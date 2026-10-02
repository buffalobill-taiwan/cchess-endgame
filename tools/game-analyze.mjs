// Build a complete table of black responses for every reachable red position.
// usage: node tools/game-analyze.mjs --name <name> --fen <fen> [--depth N] [--time-limit MS] [--pretty]

import { parseFen, boardToFen, moveToNotation } from '../js/notation.js';
import { MATE_VAL } from '../js/constants.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';
import { findRefutation, searchRootAsync } from '../js/search.js';
import { AnalysisDiagnostics } from './game-analyze-diagnostics.mjs';

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

async function chooseBlackMove(board, moves, knownRedPositions, args, deadline, diagnostics) {
  if (moves.length === 0) return null;
  const moveToKnownPosition = moves.find(move =>
    knownRedPositions.has(boardKey(applyBoardCopy(board, move))));
  if (moveToKnownPosition) {
    diagnostics.known++;
    return moveToKnownPosition;
  }

  const remaining = deadline - Date.now();
  checkDeadline(deadline);
  const depth = Math.min(12, args.depth);
  let result;
  if (depth >= 2) {
    const start = Date.now();
    try {
      result = await findRefutation(board, 'black', depth, start, Math.min(500, remaining), { deadline });
    } finally {
      diagnostics.recordSearch(Date.now() - start);
    }
    if (result.move) {
      // A proven mate is the preferred defense. Otherwise use the engine's
      // best available move at its completed search depth.
      if (result.score < -MATE_VAL / 2 || !result.interrupted) return result.move;
    }
  }
  checkDeadline(deadline);
  diagnostics.recordFallback(moveToNotation(board, moves[0], 'black'),
    result?.move ? moveToNotation(board, result.move, 'black') : null,
    result?.score, result?.interrupted ?? false);
  return moves[0];
}

async function buildTable(board, args, deadline, diagnostics) {
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
      if (isTerminal(afterRed, 'black')) {
        if (!(afterRedFen in table)) diagnostics.entries++;
        table[afterRedFen] = null;
        continue;
      }

      const blackMoves = orderedMoves(afterRed, 'black');
      const blackMove = await chooseBlackMove(afterRed, blackMoves, knownRedPositions, args, deadline, diagnostics);
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
  try {
    // Keep the browser engine's red-to-move minimax result for metadata. This
    // search does not limit table generation: every red move is still added.
    const stepBudget = Math.min(15000, args.timeLimit);
    const stepResult = await searchRootAsync(parsed.board, args.depth, stepBudget, {
      deadline: Math.min(deadline, Date.now() + stepBudget),
    });
    diagnostics.recordRoot(parsed.board, stepResult, Date.now() - start);
    checkDeadline(deadline);
    const step = stepResult.score > MATE_VAL / 2 && stepResult.pv.length > 0
      ? Math.ceil(stepResult.pv.length / 2)
      : null;
    diagnostics.phase = '應手表展開';
    const table = await buildTable(parsed.board, args, deadline, diagnostics);
    return { meta: { name: args.name, step, init: boardKey(parsed.board) }, table };
  } catch (error) {
    if (error instanceof AnalysisTimeout) error.report = diagnostics.format();
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
  if (error instanceof AnalysisTimeout) console.error(error.report);
  process.exitCode = 1;
}
