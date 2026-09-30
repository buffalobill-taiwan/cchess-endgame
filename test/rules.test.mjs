import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFen } from '../js/notation.js';
import { pieceInfo } from '../js/board.js';
import { generateLegalMoves, generateCaptureMoves, isInCheck, makeMove, unmakeMove } from '../js/rules.js';
import { zobristFromBoard } from '../js/zobrist.js';

const key = m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`;

test('piece-list and full-scan move generation agree', () => {
  const { board } = parseFen('3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1');
  for (const color of ['red', 'black']) {
    const info = pieceInfo(board);
    assert.deepEqual(
      generateLegalMoves(board, color, info).map(key).sort(),
      generateLegalMoves(board, color).map(key).sort(),
    );
  }
});

test('capture generation is the capture subset of legal moves', () => {
  const { board } = parseFen('4k4/9/9/9/9/9/9/4R4/9/4K4');
  const legal = generateLegalMoves(board, 'red').filter(m => m.captured).map(key).sort();
  assert.deepEqual(generateCaptureMoves(board, 'red').map(key).sort(), legal);
});

test('make/unmake restores board and incremental hash', () => {
  const { board } = parseFen('3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1');
  const original = JSON.stringify(board);
  const hash = zobristFromBoard(board, 'red', false);
  const move = generateLegalMoves(board, 'red')[0];
  const undo = makeMove(board, move, hash);
  const expected = zobristFromBoard(board, 'black', false);
  assert.deepEqual(hash, expected);
  unmakeMove(board, move, undo, hash);
  assert.equal(JSON.stringify(board), original);
  assert.deepEqual(hash, zobristFromBoard(board, 'red', false));
});

test('flying general is detected', () => {
  const { board } = parseFen('4k4/9/9/9/9/9/9/9/9/4K4');
  assert.equal(isInCheck(board, 'red'), true);
  board[5][4] = { type: 'soldier', color: 'red' };
  assert.equal(isInCheck(board, 'red'), false);
});
