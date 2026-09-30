// ═══════════════════════════════════════════
// CONTINUOUS-CHECK GAME ANALYZER
// usage: node tools/game-analyze.mjs --name <name> --fen <fen> [--depth N] [--time-limit MS] [--pretty]
// ═══════════════════════════════════════════

import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';

const DEFAULT_DEPTH = 64;
const DEFAULT_TIME_LIMIT = 15000;

class AnalysisFailure extends Error {}

function parseArgs(argv) {
  const args = { depth: DEFAULT_DEPTH, timeLimit: DEFAULT_TIME_LIMIT, pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pretty') { args.pretty = true; continue; }
    if (arg === '--name' || arg === '--fen' || arg === '--depth' || arg === '--time-limit') {
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

function stateKey(board, side) {
  return `${side}:${boardKey(board)}`;
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

function terminalResult(board, sideToMove) {
  const { red, black } = findKings(board);
  if (!red) return { outcome: 'blackWin', plies: 0, redSteps: 0, qualified: false };
  if (!black) return { outcome: 'redWin', plies: 0, redSteps: 0, qualified: true };

  const moves = orderedMoves(board, sideToMove);
  if (moves.length === 0) {
    return sideToMove === 'red'
      ? { outcome: 'blackWin', plies: 0, redSteps: 0, qualified: false }
      : { outcome: 'redWin', plies: 0, redSteps: 0, qualified: true };
  }
  return null;
}

function compareMin(a, b, field) {
  return a[field] < b[field] ? a : b;
}

function compareMax(a, b, field) {
  return a[field] > b[field] ? a : b;
}

function compareChildMin(a, b, field) {
  return a.child[field] < b.child[field] ? a : b;
}

function compareChildMax(a, b, field) {
  return a.child[field] > b.child[field] ? a : b;
}

class Solver {
  constructor({ deadline, maxDepth }) {
    this.deadline = deadline;
    this.maxDepth = maxDepth;
    this.memo = new Map();
    this.policy = new Map();
    this.active = new Set();
    this.nodes = 0;
  }

  checkBudget(depth) {
    if (Date.now() >= this.deadline) {
      throw new AnalysisFailure(`分析逾時（nodes=${this.nodes}, memo=${this.memo.size}）`);
    }
    return depth < this.maxDepth;
  }

  solve(board, side, path, depth) {
    this.nodes++;
    const terminal = terminalResult(board, side);
    if (terminal) return { ...terminal, choice: null };

    const key = stateKey(board, side);
    // A repeated state is a graph edge, not an analysis error. Keep a
    // deterministic black response so the exported table can represent the
    // cycle without recursing forever.
    if (path.has(key)) {
      const moves = orderedMoves(board, side);
      return {
        outcome: 'cycle', plies: 0, redSteps: 0, qualified: false,
        choice: side === 'black' ? (this.policy.get(key) ?? moves[0] ?? null) : null,
      };
    }
    if (this.active.has(key)) {
      const moves = orderedMoves(board, side);
      return {
        outcome: 'cycle', plies: 0, redSteps: 0, qualified: false,
        choice: side === 'black' ? (this.policy.get(key) ?? moves[0] ?? null) : null,
      };
    }
    if (!this.checkBudget(depth)) {
      return { outcome: 'unknown', plies: 0, redSteps: 0, qualified: false, choice: null };
    }
    const cached = this.memo.get(key);
    if (cached) return cached;

    this.active.add(key);
    const nextPath = new Set(path);
    nextPath.add(key);
    const moves = orderedMoves(board, side);
    const children = [];
    for (const move of moves) {
      const nextBoard = applyBoardCopy(board, move);
      if (side === 'black') {
        const immediate = terminalResult(nextBoard, 'red');
        if (immediate?.outcome === 'blackWin') {
          const result = {
            outcome: 'blackWin', plies: 1, redSteps: 0,
            qualified: false, choice: move,
          };
          this.active.delete(key);
          this.memo.set(key, result);
          this.policy.set(key, move);
          return result;
        }
      }
      const child = this.solve(nextBoard, side === 'red' ? 'black' : 'red', nextPath, depth + 1);
      const item = { move, board: nextBoard, child, check: side === 'red' && moveGivesCheck(board, move) };
      children.push(item);

      // For a black node, any proven black win is sufficient to establish
      // the minimax result. Move ordering puts captures first; an immediate
      // mate is handled above, so this avoids expanding unrelated branches.
      if (side === 'black' && child.outcome === 'blackWin') {
        const result = {
          outcome: 'blackWin', plies: child.plies + 1,
          redSteps: child.redSteps, qualified: false, choice: move,
        };
        this.active.delete(key);
        this.memo.set(key, result);
        this.policy.set(key, move);
        return result;
      }

      // Red only needs one fully qualified checking win to establish the
      // puzzle's winning line. Other red moves are expanded later by the
      // table builder, where they are recorded as player alternatives.
      if (side === 'red' && item.check && child.outcome === 'redWin' && child.qualified) {
        const result = this.solveRed(children);
        this.active.delete(key);
        this.memo.set(key, result);
        return result;
      }
    }
    this.active.delete(key);

    const result = side === 'red'
      ? this.solveRed(children)
      : this.solveBlack(children);
    this.memo.set(key, result);
    if (side === 'black' && result.choice) this.policy.set(key, result.choice);
    return result;
  }

  solveRed(children) {
    const redWins = children.filter(item => item.child.outcome === 'redWin');
    const blackWins = children.filter(item => item.child.outcome === 'blackWin');
    const cycles = children.filter(item => item.child.outcome === 'cycle');
    const unknowns = children.filter(item => item.child.outcome === 'unknown');

    let outcome;
    let candidates;
    if (redWins.length > 0) {
      outcome = 'redWin';
      candidates = redWins;
    } else if (blackWins.length === children.length) {
      outcome = 'blackWin';
      candidates = blackWins;
    } else if (cycles.length > 0) {
      outcome = 'cycle';
      candidates = cycles;
    } else if (unknowns.length > 0) {
      outcome = 'unknown';
      candidates = unknowns;
    } else {
      outcome = 'draw';
      candidates = [];
    }

    if (outcome === 'redWin') {
      const qualifiedWins = redWins.filter(item => item.check && item.child.qualified);
      const qualified = qualifiedWins.length > 0;
      const chosen = qualifiedWins.length > 0
        ? qualifiedWins.reduce((best, item) => compareChildMin(best, item, 'redSteps'))
        : redWins.reduce((best, item) => compareChildMin(best, item, 'redSteps'));
      return {
        outcome, plies: chosen.child.plies + 1, redSteps: chosen.child.redSteps + 1,
        qualified, choice: null,
      };
    }
    if (outcome === 'blackWin') {
      const chosen = candidates.reduce((best, item) => compareChildMax(best, item, 'plies'));
      return {
        outcome, plies: chosen.child.plies + 1, redSteps: chosen.child.redSteps + 1,
        qualified: false, choice: null,
      };
    }
    if (outcome === 'cycle') {
      return {
        outcome, plies: 0, redSteps: 0, qualified: false, choice: null,
      };
    }
    if (outcome === 'unknown') {
      return { outcome, plies: 0, redSteps: 0, qualified: false, choice: null };
    }
    return { outcome, plies: 0, redSteps: 0, qualified: false, choice: null };
  }

  solveBlack(children) {
    const blackWins = children.filter(item => item.child.outcome === 'blackWin');
    const redWins = children.filter(item => item.child.outcome === 'redWin');
    const cycles = children.filter(item => item.child.outcome === 'cycle');
    const unknowns = children.filter(item => item.child.outcome === 'unknown');
    let chosen;
    let outcome;
    if (blackWins.length > 0) {
      outcome = 'blackWin';
      chosen = blackWins.reduce((best, item) => compareChildMin(best, item, 'plies'));
    } else if (cycles.length > 0) {
      outcome = 'cycle';
      chosen = cycles[0];
    } else if (redWins.length === children.length) {
      outcome = 'redWin';
      chosen = redWins.reduce((best, item) => compareChildMax(best, item, 'plies'));
    } else if (unknowns.length > 0) {
      outcome = 'unknown';
      chosen = unknowns[0];
    } else {
      outcome = 'draw';
      chosen = children.find(item => !['redWin', 'blackWin'].includes(item.child.outcome)) ?? children[0];
    }
    return {
      outcome,
      plies: chosen.child.plies + 1,
      redSteps: chosen.child.redSteps,
      qualified: outcome === 'redWin' && chosen.child.qualified,
      choice: chosen.move,
    };
  }
}

function buildTable(board, solver, deadline, maxDepth) {
  const table = {};
  const path = new Set([stateKey(board, 'red')]);
  const visited = new Set();

  function visit(redBoard, depth, currentPath) {
    if (Date.now() >= deadline) throw new AnalysisFailure('分析逾時');
    if (depth >= maxDepth) throw new AnalysisFailure(`超過最大搜尋深度 ${maxDepth}`);
    const visitKey = boardKey(redBoard);
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    for (const redMove of orderedMoves(redBoard, 'red')) {
      const afterRed = applyBoardCopy(redBoard, redMove);
      const redFen = boardKey(afterRed);
      const redTerminal = terminalResult(afterRed, 'black');
      if (redTerminal?.outcome === 'redWin') {
        table[redFen] = null;
        continue;
      }

      const childKey = stateKey(afterRed, 'black');
      const blackMoves = orderedMoves(afterRed, 'black');
      const immediateMove = blackMoves.find(move =>
        terminalResult(applyBoardCopy(afterRed, move), 'red')?.outcome === 'blackWin');
      const blackResult = immediateMove
        ? { outcome: 'blackWin', plies: 1, redSteps: 0, qualified: false, choice: immediateMove }
        : solver.solve(afterRed, 'black', currentPath, depth + 1);
      if (!['redWin', 'blackWin', 'cycle'].includes(blackResult.outcome) || !blackResult.choice) {
        throw new AnalysisFailure('存在無法證明勝負的分枝');
      }
      const afterBlack = applyBoardCopy(afterRed, blackResult.choice);
      const blackFen = boardKey(afterBlack);
      if (table[redFen] !== undefined && table[redFen] !== blackFen) {
        throw new AnalysisFailure('同一紅方局面出現不同黑方應手');
      }
      table[redFen] = blackFen;

      const afterBlackTerminal = terminalResult(afterBlack, 'red');
      if (afterBlackTerminal) continue;
      const nextKey = stateKey(afterBlack, 'red');
      if (currentPath.has(nextKey)) continue;
      const nextPath = new Set(currentPath);
      nextPath.add(nextKey);
      visit(afterBlack, depth + 2, nextPath);
    }
  }

  visit(board, 0, path);
  return table;
}

function analyze(args) {
  const parsed = parseFen(args.fen, { allowMissingKings: false });
  if (parsed.sideToMove !== 'w') throw new AnalysisFailure('初始 FEN 必須由紅方 w 行棋');
  const board = parsed.board;
  const deadline = Date.now() + args.timeLimit;
  const solver = new Solver({ deadline, maxDepth: args.depth });
  const root = solver.solve(board, 'red', new Set(), 0);
  if (root.outcome !== 'redWin' || !root.qualified) {
    throw new AnalysisFailure('初始局面不符合合格連將殺條件');
  }
  const table = buildTable(board, solver, deadline, args.depth);
  return {
    meta: { name: args.name, step: root.redSteps, init: boardKey(board) },
    table,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = analyze(args);
  console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`分析失敗：${message}`);
  process.exitCode = 1;
}
