// ═══════════════════════════════════════════
// ZOBRIST HASHING UNIT TESTS
// ═══════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFen } from '../js/notation.js';
import { zobristFromBoard } from '../js/zobrist.js';
import { generateLegalMoves, makeMove, unmakeMove } from '../js/rules.js';
import { opp } from '../js/state.js';

test('zobristFromBoard is deterministic', () => {
  const fen = '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1';
  const { board } = parseFen(fen);
  const a = zobristFromBoard(board, 'red', false);
  const b = zobristFromBoard(board, 'red', false);
  assert.equal(a.lo, b.lo);
  assert.equal(a.hi, b.hi);
});

test('side to move and continuousCheck change the key', () => {
  const fen = '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1';
  const { board } = parseFen(fen);
  const red = zobristFromBoard(board, 'red', false);
  const black = zobristFromBoard(board, 'black', false);
  const cc = zobristFromBoard(board, 'red', true);
  assert.notEqual(red.lo, black.lo);
  assert.notEqual(red.hi, black.hi);
  assert.notEqual(red.lo, cc.lo);
  assert.notEqual(red.hi, cc.hi);
});

test('incremental hash over make/unmake matches zobristFromBoard', () => {
  const { board } = parseFen('1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1');
  const h = zobristFromBoard(board, 'red', false);
  const h0 = { lo: h.lo, hi: h.hi };

  let side = 'red';
  const moves = [];
  const seq = ['red', 'black', 'red'];
  for (const who of seq) {
    const list = generateLegalMoves(board, who);
    const m = list[0];
    moves.push({ m, undo: makeMove(board, m, h) });
    side = opp(side);
    const expect = zobristFromBoard(board, side, false);
    assert.equal(h.lo, expect.lo, `incremental lo diverged after ${who} move`);
    assert.equal(h.hi, expect.hi, `incremental hi diverged after ${who} move`);
  }

  for (let i = moves.length - 1; i >= 0; i--) {
    unmakeMove(board, moves[i].m, moves[i].undo, h);
  }
  assert.equal(h.lo, h0.lo, 'hash lo not restored after full unmake');
  assert.equal(h.hi, h0.hi, 'hash hi not restored after full unmake');
});

test('distinct preset positions produce distinct 64-bit keys', () => {
  const fens = [
    '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1',
    '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1',
    '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3 w - - 0 1',
    '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4 w - - 0 1',
  ];
  const keys = new Set();
  for (const fen of fens) {
    const { board } = parseFen(fen);
    const h = zobristFromBoard(board, 'red', false);
    const rk = ((BigInt(h.lo) & 0xFFFFFFFFn) << 32n) | (BigInt(h.hi) & 0xFFFFFFFFn);
    keys.add(rk.toString());
  }
  assert.equal(keys.size, fens.length, 'all preset positions must hash distinctly');
});