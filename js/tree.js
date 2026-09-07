// ═══════════════════════════════════════════
// RESULT TREE
// ═══════════════════════════════════════════

import { ROWS, COLS, MATE_VAL, REFUTATION_TIME_LIMIT, MIN_REF_DEPTH } from './constants.js';
import { state, opp, movesEqual } from './state.js';
import { isInCheck, isCheckmate, isStalemate, generateLegalMoves } from './rules.js';
import { moveToNotation } from './notation.js';
import { findRefutation } from './search.js';

export function deepCopyBoard(src) {
  return src.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
}

// Applies a move to a fresh copy. Pure: never touches global kingpos.
// Whenever a rules-engine function needs to inspect a board, use withBoard()
// so the global king-position invariant stays intact.
export function applyBoardCopy(src, move) {
  const nb = src.map(row => row.map(cell => cell ? { ...cell } : null));
  nb[move.to.row][move.to.col] = nb[move.from.row][move.from.col];
  nb[move.from.row][move.from.col] = null;
  return nb;
}

export function syncKingPos(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (b[r][c] && b[r][c].type === 'king') {
        if (b[r][c].color === 'red') state.redKingPos = { row: r, col: c };
        else state.blackKingPos = { row: r, col: c };
      }
    }
  }
}

// Temporarily make nb the globally-tracked board for the duration of fn(),
// then restore the previous king positions. fn receives nb.
export function withBoard(nb, fn) {
  const savedRK = state.redKingPos, savedBK = state.blackKingPos;
  syncKingPos(nb);
  try {
    return fn(nb);
  } finally {
    state.redKingPos = savedRK;
    state.blackKingPos = savedBK;
  }
}

// Legal moves for `side`, restricted to check-giving moves when the
// 連將殺 (continuous-check) mode is on and the side to move is red.
export function generateForcedMoves(b, side) {
  syncKingPos(b);
  const moves = generateLegalMoves(b, side);
  if (!state.continuousCheck || side !== 'red') return moves;
  return moves.filter(m => withBoard(applyBoardCopy(b, m), nb => isInCheck(nb, 'black')));
}

function evalOn(b, color) {
  return withBoard(b, () => ({
    isMate: isCheckmate(b, color),
    isStalemate: isStalemate(b, color),
  }));
}

// Refute `mover`'s continuations from position `pos` (turn = `mover`) by
// searching with `searchColor`. Returns the refutation children of the
// mover's node, or [] when no refutation was found. Kept in sync between
// app.js (main-line branch) and pvToTree (variant expansion).
export async function buildRefutationBranch(pos, mover, searchColor, cfg) {
  syncKingPos(pos);
  const ref = await findRefutation(pos, searchColor, cfg.refDepth, Date.now(), REFUTATION_TIME_LIMIT);
  if (!ref || !ref.move) return [];

  const refBoard = applyBoardCopy(pos, ref.move);
  const refNode = {
    move: ref.move, notation: moveToNotation(pos, ref.move, searchColor),
    color: searchColor,
    isMate: evalOn(refBoard, mover).isMate,
    isStalemate: evalOn(refBoard, mover).isStalemate,
    children: [], board: deepCopyBoard(refBoard),
  };

  if (Math.abs(ref.score) > MATE_VAL / 2) {
    const followMoves = generateForcedMoves(refBoard, mover);
    const followups = [];
    for (const rr of followMoves) {
      if (state.interruptRequested) break;
      const rrBoard = applyBoardCopy(refBoard, rr);
      const rrState = evalOn(rrBoard, searchColor);
      syncKingPos(rrBoard);
      const ref2 = await findRefutation(rrBoard, searchColor, cfg.refDepth2, Date.now(), REFUTATION_TIME_LIMIT);
      const children2 = [];
      if (ref2 && ref2.move && Math.abs(ref2.score) > MATE_VAL / 2) {
        const ref2Board = applyBoardCopy(rrBoard, ref2.move);
        const ref2State = evalOn(ref2Board, mover);
        const ref2Children = [];
        if (ref2.pv && ref2.pv.length > 1) {
          const oppMove = ref2.pv[1];
          const oppBoard = applyBoardCopy(ref2Board, oppMove);
          const oppState = evalOn(oppBoard, searchColor);
          const ref2Sub = ref2.pv.length > 2
            ? await pvToTree(oppBoard, ref2.pv.slice(2), searchColor, cfg.pvStartDepth, cfg.pvMaxDepth, Date.now())
            : null;
          ref2Children.push({
            move: oppMove, notation: moveToNotation(ref2Board, oppMove, mover),
            color: mover,
            isMate: oppState.isMate, isStalemate: oppState.isStalemate,
            children: ref2Sub ? [ref2Sub] : [],
            board: deepCopyBoard(oppBoard),
          });
        }
        children2.push({
          move: ref2.move, notation: moveToNotation(rrBoard, ref2.move, searchColor),
          color: searchColor,
          isMate: ref2State.isMate, isStalemate: ref2State.isStalemate,
          children: ref2Children,
          board: deepCopyBoard(ref2Board),
        });
      }
      followups.push({
        move: rr, notation: moveToNotation(refBoard, rr, mover),
        color: mover,
        isMate: rrState.isMate, isStalemate: rrState.isStalemate,
        children: children2,
        board: deepCopyBoard(rrBoard),
      });
    }
    refNode.children = followups;
  } else if (cfg.flatOnNonMate) {
    const flatMoves = generateForcedMoves(refBoard, mover);
    refNode.children = flatMoves.slice(0, 1).map(rr => {
      const nb = applyBoardCopy(refBoard, rr);
      const st = evalOn(nb, opp(mover));
      return {
        move: rr, notation: moveToNotation(refBoard, rr, mover),
        color: mover,
        isMate: st.isMate, isStalemate: st.isStalemate,
        children: [], board: deepCopyBoard(nb),
      };
    });
  }
  return [refNode];
}

export async function pvToTree(b, pv, color, depth, maxDepth, startTime) {
  if (state.interruptRequested || !pv || pv.length === 0 || depth > maxDepth) return null;

  const m = pv[0];
  const rest = pv.slice(1);
  const nb = applyBoardCopy(b, m);
  const end = evalOn(nb, opp(color));

  const node = {
    move: m, notation: moveToNotation(b, m, color),
    color: color, isMate: end.isMate, isStalemate: end.isStalemate, children: [],
    board: deepCopyBoard(nb)
  };

  const nextColor = opp(color);
  const responses = generateForcedMoves(nb, nextColor);

  for (const resp of responses) {
    if (state.interruptRequested) break;
    const respBoard = applyBoardCopy(nb, resp);
    const isPV = rest.length > 0 && movesEqual(resp, rest[0]);
    const respState = evalOn(respBoard, color);
    let childNode;

    if (isPV) {
      const sub = await pvToTree(respBoard, rest.slice(1), color, depth + 1, maxDepth, startTime);
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor,
        isMate: respState.isMate, isStalemate: respState.isStalemate,
        children: sub ? [sub] : [],
        board: deepCopyBoard(respBoard),
      };
    } else if (respState.isMate || respState.isStalemate) {
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor,
        isMate: respState.isMate, isStalemate: respState.isStalemate,
        children: [], board: deepCopyBoard(respBoard),
      };
    } else {
      const cfg = {
        refDepth: Math.max(MIN_REF_DEPTH, maxDepth - depth - 1),
        refDepth2: Math.max(MIN_REF_DEPTH, maxDepth - depth - 2),
        pvStartDepth: depth + 3, pvMaxDepth: maxDepth,
        flatOnNonMate: true,
      };
      const refChildren = await buildRefutationBranch(respBoard, nextColor, color, cfg);
      if (refChildren.length === 0) continue;
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor,
        isMate: respState.isMate, isStalemate: respState.isStalemate,
        children: refChildren,
        board: deepCopyBoard(respBoard),
      };
    }
    node.children.push(childNode);
  }
  return node;
}