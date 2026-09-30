import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardToFen, parseFen } from '../js/notation.js';

test('FEN board round-trips and strict king validation is available', () => {
  const fen = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
  const { board } = parseFen(fen, { allowMissingKings: false });
  assert.equal(boardToFen(board).split(' ')[0], fen.split(' ')[0]);
  assert.throws(() => parseFen('9/9/9/9/9/9/9/9/9/9', { allowMissingKings: false }), /缺少/);
});

test('FEN rejects malformed rows and duplicate kings', () => {
  assert.throws(() => parseFen('9/9/9/9/9/9/9/9/9/9/9'), /10/);
  assert.throws(() => parseFen('4K4/4K4/9/9/9/9/9/9/9/4k4'), /超過一個帥/);
  assert.throws(() => parseFen('9/9/9/9/9/9/9/9/9/4X4'), /未知棋子/);
});
