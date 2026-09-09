// ═══════════════════════════════════════════
// NOTATION / FEN UNIT TESTS
// ═══════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardToFen, parseFen, moveToNotation } from '../js/notation.js';

const PRESETS = [
  '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1',
  '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1',
  '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3 w - - 0 1',
  '4k2P1/5P3/c8/9/9/3c4R/4r3C/B3p4/4p4/3K5 w - - 0 1',
  '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2 w - - 0 1',
  '9/9/3a1k3/6P2/9/9/3r5/2n3r2/C8/4K1p2 w - - 0 1',
  '3rka1R1/4aR3/4b4/9/9/9/6r2/7C1/3p5/c1BA1K3 w - - 0 1',
  '9/4a4/3a1k3/2r3R2/1n5N1/c7C/1n5N1/2r3R2/3p1p3/4K4 w - - 0 1',
  '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4 w - - 0 1',
];

test('boardToFen → parseFen round trips every preset', () => {
  for (const fen of PRESETS) {
    const { board } = parseFen(fen);
    const out = boardToFen(board);
    const prefix = out.split(' ')[0];
    assert.equal(prefix, fen.split(' ')[0], `round trip changed the board for ${fen}`);
  }
});

test('parseFen enforces board shape and single kings', () => {
  assert.throws(() => parseFen('9/9/9/9/9/9/9/9/9/9/9 w - - 0 1'), /10/);
  assert.throws(() => parseFen('4K4/4K4/9/9/9/9/9/9/9/4k4 w - - 0 1'), /紅方超過一個帥/);
  assert.throws(() => parseFen('4k4/4k4/9/9/9/9/9/9/9/4K4 w - - 0 1'), /黑方超過一個將/);
  assert.throws(() => parseFen(''), /空 FEN/);
  assert.throws(() => parseFen('4K4/9/9/9/9/9/9/9/9/5X3 w - - 0 1'), /未知棋子「X」/);
});

test('moveToNotation for a known chariot advance', () => {
  // Red chariot at row 7 (row index), col 5 → advance up two to row 5 = 俥四進二
  const fen = '4k4/9/9/9/9/9/9/5R3/9/4K4';
  const { board } = parseFen(fen);
  const m = { from: { row: 7, col: 5 }, to: { row: 5, col: 5 }, captured: null };
  assert.equal(moveToNotation(board, m, 'red'), '俥四進二');
});

test('moveToNotation disambiguates same-file pieces (前/後)', () => {
  // Two red chariots on file 4 (col 3): upper row 6 is 前, lower row 8 is 後
  const fen = '4k4/9/9/9/9/9/3R5/9/3R5/4K4';
  const { board } = parseFen(fen);
  const upper = { from: { row: 6, col: 3 }, to: { row: 5, col: 3 }, captured: null };
  const lower = { from: { row: 8, col: 3 }, to: { row: 8, col: 4 }, captured: null };
  assert.equal(moveToNotation(board, upper, 'red'), '前俥進一');
  assert.equal(moveToNotation(board, lower, 'red'), '後俥平五');
});