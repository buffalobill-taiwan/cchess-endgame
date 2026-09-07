// ═══════════════════════════════════════════
// RESULT TREE
// ═══════════════════════════════════════════

import { ROWS, COLS, MATE_VAL } from './constants.js';
import { state, opp, movesEqual } from './state.js';
import { isInCheck, isCheckmate, isStalemate, generateLegalMoves } from './rules.js';
import { moveToNotation } from './notation.js';
import { findRefutation } from './search.js';

export function deepCopyBoard(src) {
  return src.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
}

export async function pvToTree(b, pv, color, depth, maxDepth, startTime) {
  if (state.interruptRequested || !pv || pv.length === 0 || depth > maxDepth) return null;

  syncKingPos(b);
  const m = pv[0];
  const rest = pv.slice(1);
  const nb = applyBoardCopy(b, m);
  const isMateEnd = isCheckmate(nb, opp(color));
  const isStalemateEnd = isStalemate(nb, opp(color));

  const node = {
    move: m, notation: moveToNotation(b, m, color),
    color: color, isMate: isMateEnd, isStalemate: isStalemateEnd, children: [],
    board: deepCopyBoard(nb)
  };

  const nextColor = opp(color);
  let responses = generateLegalMoves(nb, nextColor);
  if (state.continuousCheck && nextColor === 'red') {
    const savedRK = state.redKingPos, savedBK = state.blackKingPos;
    responses = responses.filter(m => {
      const nb2 = applyBoardCopy(nb, m);
      syncKingPos(nb2);
      const givesCheck = isInCheck(nb2, 'black');
      state.redKingPos = savedRK; state.blackKingPos = savedBK;
      return givesCheck;
    });
  }

  for (const resp of responses) {
    if (state.interruptRequested) break;
    const respBoard = applyBoardCopy(nb, resp);
    const savedRK = state.redKingPos;
    const savedBK = state.blackKingPos;
    const isPV = rest.length > 0 && movesEqual(resp, rest[0]);
    let childNode;

    if (isPV) {
      const sub = await pvToTree(respBoard, rest.slice(1), color, depth + 1, maxDepth, startTime);
      state.redKingPos = savedRK;
      state.blackKingPos = savedBK;
      syncKingPos(respBoard);
      childNode = {
        move: resp, notation: moveToNotation(nb, resp, nextColor),
        color: nextColor, isMate: isCheckmate(respBoard, color),
        isStalemate: isStalemate(respBoard, color),
        children: sub ? [sub] : [],
        board: deepCopyBoard(respBoard)
      };
    } else {
      state.redKingPos = savedRK;
      state.blackKingPos = savedBK;
      syncKingPos(respBoard);
      const respMate = isCheckmate(respBoard, color);
      const respStale = isStalemate(respBoard, color);
      if (respMate || respStale) {
        childNode = {
          move: resp, notation: moveToNotation(nb, resp, nextColor),
          color: nextColor, isMate: respMate, isStalemate: respStale,
          children: [], board: deepCopyBoard(respBoard)
        };
      } else {
        const ref = await findRefutation(respBoard, color, Math.max(4, maxDepth - depth - 1), Date.now(), 5000);
        state.redKingPos = savedRK;
        state.blackKingPos = savedBK;
        const refChildren = [];
        if (ref && ref.move) {
          const refBoard = applyBoardCopy(respBoard, ref.move);
          syncKingPos(refBoard);
          if (Math.abs(ref.score) > MATE_VAL / 2) {
            let losingMoves = generateLegalMoves(refBoard, nextColor);
            if (state.continuousCheck && nextColor === 'red') {
              const savedRK = state.redKingPos, savedBK = state.blackKingPos;
              losingMoves = losingMoves.filter(mm => {
                const nb2 = applyBoardCopy(refBoard, mm);
                syncKingPos(nb2);
                const givesCheck = isInCheck(nb2, 'black');
                state.redKingPos = savedRK; state.blackKingPos = savedBK;
                return givesCheck;
              });
            }
            const refFollowups = await Promise.all(losingMoves.map(async rr => {
              const rrBoard = applyBoardCopy(refBoard, rr);
              syncKingPos(rrBoard);
              const ref2 = await findRefutation(rrBoard, color, Math.max(4, maxDepth - depth - 2), Date.now(), 5000);
              syncKingPos(rrBoard);
              const children2 = [];
              if (ref2 && ref2.move && Math.abs(ref2.score) > MATE_VAL / 2) {
                const ref2Board = applyBoardCopy(rrBoard, ref2.move);
                syncKingPos(ref2Board);
                const ref2Children = [];
                if (ref2.pv && ref2.pv.length > 1) {
                  const oppMove = ref2.pv[1];
                  const oppBoard = applyBoardCopy(ref2Board, oppMove);
                  syncKingPos(oppBoard);
                  const ref2Sub = ref2.pv.length > 2
                    ? await pvToTree(oppBoard, ref2.pv.slice(2), color, depth + 3, maxDepth, Date.now())
                    : null;
                  ref2Children.push({
                    move: oppMove, notation: moveToNotation(ref2Board, oppMove, nextColor),
                    color: nextColor,
                    isMate: isCheckmate(oppBoard, color),
                    isStalemate: isStalemate(oppBoard, color),
                    children: ref2Sub ? [ref2Sub] : [],
                    board: deepCopyBoard(oppBoard)
                  });
                }
                children2.push({
                  move: ref2.move, notation: moveToNotation(rrBoard, ref2.move, color),
                  color: color,
                  isMate: isCheckmate(ref2Board, nextColor),
                  isStalemate: isStalemate(ref2Board, nextColor),
                  children: ref2Children,
                  board: deepCopyBoard(ref2Board)
                });
              }
              return {
                move: rr, notation: moveToNotation(refBoard, rr, nextColor),
                color: nextColor,
                isMate: isCheckmate(rrBoard, opp(nextColor)),
                isStalemate: isStalemate(rrBoard, opp(nextColor)),
                children: children2,
                board: deepCopyBoard(rrBoard)
              };
            }));
            refChildren.push({
              move: ref.move, notation: moveToNotation(respBoard, ref.move, color),
              color: color, isMate: isCheckmate(refBoard, nextColor),
              isStalemate: isStalemate(refBoard, nextColor),
              children: refFollowups,
              board: deepCopyBoard(refBoard)
            });
          } else {
            let flatMoves = generateLegalMoves(refBoard, nextColor);
            if (state.continuousCheck && nextColor === 'red') {
              const savedRK = state.redKingPos, savedBK = state.blackKingPos;
              flatMoves = flatMoves.filter(mm => {
                const nb2 = applyBoardCopy(refBoard, mm);
                syncKingPos(nb2);
                const givesCheck = isInCheck(nb2, 'black');
                state.redKingPos = savedRK; state.blackKingPos = savedBK;
                return givesCheck;
              });
            }
            const flatFollowup = flatMoves.slice(0, 1).map(rr => {
              const rrBoard = applyBoardCopy(refBoard, rr);
              return {
                move: rr, notation: moveToNotation(refBoard, rr, nextColor),
                color: nextColor,
                isMate: isCheckmate(rrBoard, opp(nextColor)),
                isStalemate: isStalemate(rrBoard, opp(nextColor)),
                children: [], board: deepCopyBoard(rrBoard)
              };
            });
            refChildren.push({
              move: ref.move, notation: moveToNotation(respBoard, ref.move, color),
              color: color, isMate: isCheckmate(refBoard, nextColor),
              isStalemate: isStalemate(refBoard, nextColor),
              children: flatFollowup,
              board: deepCopyBoard(refBoard)
            });
          }
        }
        state.redKingPos = savedRK;
        state.blackKingPos = savedBK;
        syncKingPos(respBoard);
        if (refChildren.length === 0) continue;
        childNode = {
          move: resp, notation: moveToNotation(nb, resp, nextColor),
          color: nextColor, isMate: isCheckmate(respBoard, color),
          isStalemate: isStalemate(respBoard, color),
          children: refChildren,
          board: deepCopyBoard(respBoard)
        };
      }
    }
    node.children.push(childNode);
  }
  return node;
}

export function applyBoardCopy(src, move) {
  const nb = src.map(row => row.map(cell => cell ? {...cell} : null));
  nb[move.to.row][move.to.col] = nb[move.from.row][move.from.col];
  nb[move.from.row][move.from.col] = null;
  const moved = src[move.from.row][move.from.col];
  if (moved && moved.type === 'king') {
    if (moved.color === 'red') state.redKingPos = {row: move.to.row, col: move.to.col};
    else state.blackKingPos = {row: move.to.row, col: move.to.col};
  }
  const captured = src[move.to.row][move.to.col];
  if (captured && captured.type === 'king') {
    if (captured.color === 'red') state.redKingPos = null;
    else state.blackKingPos = null;
  }
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