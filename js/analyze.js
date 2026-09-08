// ═══════════════════════════════════════════
// POSITION ANALYSIS (engine only, no DOM)
// ═══════════════════════════════════════════

import { MATE_VAL, ROOT_TIME_LIMIT, MIN_REF_DEPTH } from './constants.js';
import { state, movesEqual } from './state.js';
import { isCheckmate, isStalemate, generateLegalMoves } from './rules.js';
import { moveToNotation } from './notation.js';
import { searchRootAsync } from './search.js';
import { deepCopyBoard, applyBoardCopy, withBoard, syncKingPos, generateForcedMoves, pvToTree, buildRefutationBranch } from './tree.js';

export async function analyzePosition(board, opts = {}) {
  const depth = opts.depth ?? 12;
  const timeLimit = opts.timeLimit ?? ROOT_TIME_LIMIT;
  const continuousCheck = opts.continuousCheck ?? false;

  syncKingPos(board);
  if (!state.redKingPos || !state.blackKingPos) {
    return { status: 'noKing', tree: null, score: 0, interrupted: false };
  }
  if (isCheckmate(board, 'red')) {
    return { status: 'redMated', tree: null, score: 0, interrupted: false };
  }
  if (isStalemate(board, 'red')) {
    return { status: 'redStalemated', tree: null, score: 0, interrupted: false };
  }

  state.continuousCheck = continuousCheck;
  const boardCopy = deepCopyBoard(board);
  const result = await searchRootAsync(boardCopy, depth, timeLimit);
  let tree = null;
  if (result && result.move) {
    const isMateScore = Math.abs(result.score) > MATE_VAL / 2;
    if (state.continuousCheck && !isMateScore) {
      tree = null;
    } else if (isMateScore && result.score < 0) {
      tree = { move: null, notation: '', color: 'red', isMate: false, isStalemate: false, children: [], board: null };
      const redMoves = generateForcedMoves(boardCopy, 'red');
      const cfg = {
        refDepth: Math.max(MIN_REF_DEPTH, depth - 2),
        refDepth2: Math.max(MIN_REF_DEPTH, depth - 4),
        pvStartDepth: 3, pvMaxDepth: depth, flatOnNonMate: false,
      };
      for (const rm of redMoves) {
        if (state.interruptRequested) break;
        const rmBoard = applyBoardCopy(boardCopy, rm);
        const rmState = withBoard(rmBoard, () => ({
          isMate: isCheckmate(rmBoard, 'black'),
          isStalemate: isStalemate(rmBoard, 'black'),
        }));
        if (rmState.isMate || rmState.isStalemate) {
          tree.children.push({
            move: rm, notation: moveToNotation(boardCopy, rm, 'red'),
            color: 'red', isMate: rmState.isMate, isStalemate: rmState.isStalemate,
            children: [], board: deepCopyBoard(rmBoard)
          });
        } else {
          const refChildren = await buildRefutationBranch(rmBoard, 'red', 'black', cfg);
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
      const nbState = withBoard(nb, () => ({
        isMate: isCheckmate(nb, 'black'),
        isStalemate: isStalemate(nb, 'black'),
      }));
      const restPV = result.pv.slice(1);
      tree = {
        move: result.move, notation: moveToNotation(boardCopy, result.move, 'red'),
        color: 'red', isMate: nbState.isMate, isStalemate: nbState.isStalemate, children: [],
        board: deepCopyBoard(nb)
      };

      syncKingPos(nb);
      const cfg = {
        refDepth: Math.max(MIN_REF_DEPTH, depth - 2),
        refDepth2: Math.max(MIN_REF_DEPTH, depth - 4),
        pvStartDepth: 3, pvMaxDepth: depth, flatOnNonMate: false,
      };
      for (const bm of generateLegalMoves(nb, 'black')) {
        if (state.interruptRequested) break;
        const bmBoard = applyBoardCopy(nb, bm);
        const isPV = restPV.length > 0 && movesEqual(bm, restPV[0]);
        const bmState = withBoard(bmBoard, () => ({
          isMate: isCheckmate(bmBoard, 'red'),
          isStalemate: isStalemate(bmBoard, 'red'),
        }));
        let childNode;

        if (isPV) {
          const sub = await pvToTree(bmBoard, restPV.slice(1), 'red', 1, depth, Date.now());
          childNode = {
            move: bm, notation: moveToNotation(nb, bm, 'black'),
            color: 'black',
            isMate: bmState.isMate, isStalemate: bmState.isStalemate,
            children: sub ? [sub] : [],
            board: deepCopyBoard(bmBoard)
          };
          if (!childNode.isMate && !childNode.isStalemate && childNode.children.length === 0) {
            const re = withBoard(bmBoard, () => ({
              isMate: isCheckmate(bmBoard, 'red'),
              isStalemate: isStalemate(bmBoard, 'red'),
            }));
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
          const refChildren = await buildRefutationBranch(bmBoard, 'black', 'red', cfg);
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
    tree,
    score: result ? result.score : 0,
    interrupted: state.interruptRequested,
  };
}