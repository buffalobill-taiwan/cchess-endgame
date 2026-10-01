// ═══════════════════════════════════════════
// POSITION ANALYSIS (engine only, no DOM)
// ═══════════════════════════════════════════

import { MATE_VAL, ROOT_TIME_LIMIT, MIN_REF_DEPTH } from './constants.js';
import { movesEqual } from './geometry.js';
import { isCheckmate, isStalemate, generateLegalMoves, terminalState } from './rules.js';
import { moveToNotation } from './notation.js';
import { searchRootAsync } from './search.js';
import { findKings, deepCopyBoard, applyBoardCopy } from './board.js';
import { generateForcedMoves, pvToTree, buildRefutationBranch } from './tree.js';

export async function analyzePosition(board, opts = {}) {
  const depth = opts.depth ?? 12;
  const timeLimit = opts.timeLimit ?? ROOT_TIME_LIMIT;
  const continuousCheck = opts.continuousCheck ?? false;
  const deadline = opts.deadline ?? (Date.now() + timeLimit);
  const isCancelled = opts.isCancelled ?? (() => false);
  const context = { deadline, isCancelled, continuousCheck };

  const { red, black } = findKings(board);
  if (!red || !black) {
    return { status: 'noKing', tree: null, score: 0, interrupted: false };
  }
  if (isCheckmate(board, 'red')) {
    return { status: 'redMated', tree: null, score: 0, interrupted: false };
  }
  if (isStalemate(board, 'red')) {
    return { status: 'redStalemated', tree: null, score: 0, interrupted: false };
  }

  const boardCopy = deepCopyBoard(board);
  const result = await searchRootAsync(boardCopy, depth, timeLimit, context);
  const interrupted = result?.interrupted || isCancelled() || Date.now() >= deadline;
  let tree = null;
  if (result && result.move) {
    const isMateScore = Math.abs(result.score) > MATE_VAL / 2;
    if (continuousCheck && !isMateScore) {
      tree = null;
    } else if (isMateScore && result.score < 0) {
      tree = { move: null, notation: '', color: 'red', isMate: false, isStalemate: false, children: [], board: null };
      const redMoves = generateForcedMoves(boardCopy, 'red', continuousCheck);
      const cfg = {
        refDepth: Math.max(MIN_REF_DEPTH, depth - 2),
        refDepth2: Math.max(MIN_REF_DEPTH, depth - 4),
        pvStartDepth: 3, pvMaxDepth: depth, flatOnNonMate: false,
      };
      for (const rm of redMoves) {
        if (isCancelled() || Date.now() >= deadline) break;
        const rmBoard = applyBoardCopy(boardCopy, rm);
        const rmState = terminalState(rmBoard, 'black');
        if (rmState.isMate || rmState.isStalemate) {
          tree.children.push({
            move: rm, notation: moveToNotation(boardCopy, rm, 'red'),
            color: 'red', isMate: rmState.isMate, isStalemate: rmState.isStalemate,
            children: [], board: deepCopyBoard(rmBoard)
          });
        } else {
          const refChildren = await buildRefutationBranch(rmBoard, 'red', 'black', { ...cfg, context });
          if (refChildren.length === 0) continue;
          tree.children.push({
            move: rm, notation: moveToNotation(boardCopy, rm, 'red'),
            color: 'red', isMate: rmState.isMate, isStalemate: rmState.isStalemate,
            children: refChildren, board: deepCopyBoard(rmBoard)
          });
        }
      }
    } else {
      const nb = applyBoardCopy(boardCopy, result.move);
      const nbState = terminalState(nb, 'black');
      const restPV = result.pv.slice(1);
      tree = {
        move: result.move, notation: moveToNotation(boardCopy, result.move, 'red'),
        color: 'red', isMate: nbState.isMate, isStalemate: nbState.isStalemate, children: [],
        board: deepCopyBoard(nb)
      };

      const cfg = {
        refDepth: Math.max(MIN_REF_DEPTH, depth - 2),
        refDepth2: Math.max(MIN_REF_DEPTH, depth - 4),
        pvStartDepth: 3, pvMaxDepth: depth, flatOnNonMate: false,
      };
      for (const bm of generateLegalMoves(nb, 'black')) {
        if (isCancelled() || Date.now() >= deadline) break;
        const bmBoard = applyBoardCopy(nb, bm);
        const isPV = restPV.length > 0 && movesEqual(bm, restPV[0]);
        const bmState = terminalState(bmBoard, 'red');
        let childNode;

        if (isPV) {
          const sub = await pvToTree(bmBoard, restPV.slice(1), 'red', 1, depth, context);
          childNode = {
            move: bm, notation: moveToNotation(nb, bm, 'black'),
            color: 'black',
            isMate: bmState.isMate, isStalemate: bmState.isStalemate,
            children: sub ? [sub] : [],
            board: deepCopyBoard(bmBoard)
          };
          if (!childNode.isMate && !childNode.isStalemate && childNode.children.length === 0) {
            const re = terminalState(bmBoard, 'red');
            if (re.isMate) childNode.isMate = true;
            else if (re.isStalemate) childNode.isStalemate = true;
            else childNode.interrupted = true;
          }
        } else if (bmState.isMate || bmState.isStalemate) {
          childNode = {
            move: bm, notation: moveToNotation(nb, bm, 'black'),
            color: 'black',
            isMate: bmState.isMate, isStalemate: bmState.isStalemate,
            children: [], board: deepCopyBoard(bmBoard)
          };
        } else {
          const refChildren = await buildRefutationBranch(bmBoard, 'black', 'red', { ...cfg, context });
          if (refChildren.length === 0) continue;
          childNode = {
            move: bm, notation: moveToNotation(nb, bm, 'black'),
            color: 'black',
            isMate: bmState.isMate, isStalemate: bmState.isStalemate,
            children: refChildren, board: deepCopyBoard(bmBoard)
          };
        }
        tree.children.push(childNode);
      }
    }
  }

  return {
    status: 'ok',
    tree: interrupted ? null : tree,
    score: result ? result.score : 0,
    interrupted,
  };
}
