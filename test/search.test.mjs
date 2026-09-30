import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFen } from '../js/notation.js';
import { deepCopyBoard, applyBoardCopy } from '../js/board.js';
import { searchRootAsync } from '../js/search.js';
import { generateLegalMoves, isInCheck } from '../js/rules.js';

const fen = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
const moveKey = m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`;

test('search returns a legal completed result without global engine state', async () => {
  const { board } = parseFen(fen);
  const result = await searchRootAsync(deepCopyBoard(board), 2, 2000);
  assert.ok(result.nodes > 0);
  assert.equal(result.interrupted, false);
  if (result.move) assert.ok(generateLegalMoves(board, 'red').map(moveKey).includes(moveKey(result.move)));
});

test('continuous-check option constrains red PV moves', async () => {
  const { board } = parseFen(fen);
  const result = await searchRootAsync(deepCopyBoard(board), 2, 2000, { continuousCheck: true });
  let current = deepCopyBoard(board);
  let side = 'red';
  for (const move of result.pv) {
    current = applyBoardCopy(current, move);
    if (side === 'red') assert.equal(isInCheck(current, 'black'), true);
    side = side === 'red' ? 'black' : 'red';
  }
});

test('deadline prevents an incomplete deepening iteration from being returned', async () => {
  const { board } = parseFen(fen);
  const result = await searchRootAsync(deepCopyBoard(board), 20, 1);
  assert.equal(result.interrupted, true);
  assert.ok(result.nodes >= 0);
});
