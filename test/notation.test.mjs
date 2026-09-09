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

test('moveToNotation appends file number when 前/後 labels collide across files (red)', () => {
  // 六路 (col 3) and 四路 (col 5) each have two red soldiers
  const fen = 'k4P3/3P5/5P3/3P5/9/9/9/9/9/4K4';
  const { board } = parseFen(fen);
  const sixFront = { from: { row: 1, col: 3 }, to: { row: 1, col: 4 }, captured: null };
  const fourFront = { from: { row: 0, col: 5 }, to: { row: 0, col: 4 }, captured: null };
  assert.equal(moveToNotation(board, sixFront, 'red'), '前兵六平五');
  assert.equal(moveToNotation(board, fourFront, 'red'), '前兵四平五');
});

test('moveToNotation appends file number when 前/後 labels collide across files (black)', () => {
  // 2路 (col 1) and 4路 (col 3) each have two black soldiers; black 前 = larger row
  const fen = '4K4/9/9/9/9/1p7/3p5/1p7/3p5/4k4';
  const { board } = parseFen(fen);
  const atTwo = { from: { row: 7, col: 1 }, to: { row: 7, col: 2 }, captured: null };
  const atFour = { from: { row: 8, col: 3 }, to: { row: 8, col: 4 }, captured: null };
  assert.equal(moveToNotation(board, atTwo, 'black'), '前卒２平３');
  assert.equal(moveToNotation(board, atFour, 'black'), '前卒４平５');
});

test('moveToNotation keeps pure 前/後 when only one file is stacked', () => {
  // Only 六路 (col 3) has two soldiers; 二路 (col 7) has a single one
  const fen = '4k4/9/3P5/9/9/9/3P5/9/7P1/4K4';
  const { board } = parseFen(fen);
  const front = { from: { row: 2, col: 3 }, to: { row: 1, col: 3 }, captured: null };
  const rear = { from: { row: 6, col: 3 }, to: { row: 6, col: 4 }, captured: null };
  const single = { from: { row: 8, col: 7 }, to: { row: 7, col: 7 }, captured: null };
  assert.equal(moveToNotation(board, front, 'red'), '前兵進一');
  assert.equal(moveToNotation(board, rear, 'red'), '後兵平五');
  assert.equal(moveToNotation(board, single, 'red'), '兵二進一');
});

test('moveToNotation uses 前/中/後 and 前二三四五 for deeper stacks', () => {
  // 五路 (col 4): three soldiers at rows 1,3,5 + one at row 7 → 前/二/三/四
  const four = '4k4/4P4/9/4P4/9/4P4/9/4P4/9/4K4';
  const { board: b4 } = parseFen(four);
  const third = { from: { row: 5, col: 4 }, to: { row: 4, col: 4 }, captured: null };
  const last4 = { from: { row: 7, col: 4 }, to: { row: 6, col: 4 }, captured: null };
  assert.equal(moveToNotation(b4, third, 'red'), '三兵進一');
  assert.equal(moveToNotation(b4, last4, 'red'), '四兵進一');

  // 2路 (col 7): three soldiers at rows 2,4,6 → 前/中/後
  const three = '4k4/9/7P1/9/7P1/9/7P1/9/9/4K4';
  const { board: b3 } = parseFen(three);
  const middle = { from: { row: 4, col: 7 }, to: { row: 3, col: 7 }, captured: null };
  assert.equal(moveToNotation(b3, middle, 'red'), '中兵進一');

  // 五路 (col 4): five soldiers at rows 0..4 → 前/二/三/四/五
  const five = 'k3P4/4P4/4P4/4P4/4P4/9/9/9/9/4K4';
  const { board: b5 } = parseFen(five);
  const last5 = { from: { row: 4, col: 4 }, to: { row: 3, col: 4 }, captured: null };
  assert.equal(moveToNotation(b5, last5, 'red'), '五兵進一');
});