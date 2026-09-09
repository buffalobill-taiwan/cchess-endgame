// ═══════════════════════════════════════════
// RULES ENGINE UNIT TESTS
// ═══════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFen } from '../js/notation.js';
import { pieceInfo } from '../js/board.js';
import { isInCheck, generateLegalMoves, generateCaptureMoves, makeMove, unmakeMove } from '../js/rules.js';
import { opp } from '../js/state.js';
import { zobristFromBoard } from '../js/zobrist.js';

export const PRESETS = [
  { label: '馬炮兵圍城', fen: '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1' },
  { label: '雙炮馬連環', fen: '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1' },
  { label: '雙俥夾車攻', fen: '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3 w - - 0 1' },
  { label: '俥炮兵破關', fen: '4k2P1/5P3/c8/9/9/3c4R/4r3C/B3p4/4p4/3K5 w - - 0 1' },
  { label: '鐵桶炮馬局', fen: '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2 w - - 0 1' },
  { label: '兵逼將死', fen: '9/9/3a1k3/6P2/9/9/3r5/2n3r2/C8/4K1p2 w - - 0 1' },
  { label: '雙俥炮夾擊', fen: '3rka1R1/4aR3/4b4/9/9/9/6r2/7C1/3p5/c1BA1K3 w - - 0 1' },
  { label: '菱形殺陣', fen: '9/4a4/3a1k3/2r3R2/1n5N1/c7C/1n5N1/2r3R2/3p1p3/4K4 w - - 0 1' },
  { label: '霹靂眼', fen: '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4 w - - 0 1' },
];

const moveKey = m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`;

test('pieceInfo mirrors the board', () => {
  for (const { fen } of PRESETS) {
    const { board } = parseFen(fen);
    const info = pieceInfo(board);
    const byKey = new Map();
    for (const entry of [...info.redPieces, ...info.blackPieces]) byKey.set(`${entry.row},${entry.col}`, entry);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) { assert.equal(byKey.has(`${r},${c}`), false, `empty cell ${r},${c}`); continue; }
        const e = byKey.get(`${r},${c}`);
        assert.ok(e, `pieceInfo misses ${p.color} ${p.type} at ${r},${c}`);
        assert.equal(e.type, p.type);
        const king = info[p.color];
        if (p.type === 'king') assert.equal(e, king, 'king entry must be shared object');
      }
    }
  }
});

test('isInCheck fast path (piece lists) agrees with full scan', () => {
  for (const { fen } of PRESETS) {
    const { board } = parseFen(fen);
    for (const color of ['red', 'black']) {
      const info = pieceInfo(board);
      const fast = isInCheck(board, color, info[color], info[opp(color)], info[opp(color) + 'Pieces'], null);
      const slow = isInCheck(board, color);
      assert.equal(fast, slow, `isInCheck mismatch for ${color} @ ${fen.slice(0, 20)}`);
    }
  }
});

test('generateLegalMoves with pieceInfo equals the full-scan version', () => {
  for (const { fen } of PRESETS) {
    const { board } = parseFen(fen);
    for (const color of ['red', 'black']) {
      const info = pieceInfo(board);
      const list = generateLegalMoves(board, color, info).map(moveKey).sort();
      const scan = generateLegalMoves(board, color).map(moveKey).sort();
      assert.equal(list.length, scan.length, `legal move count mismatch @ ${fen.slice(0, 20)}`);
      assert.deepEqual(list, scan, `legal moves differ @ ${fen.slice(0, 20)}`);
    }
  }
});

test('generateCaptureMoves equals legal moves ∩ captures', () => {
  for (const { fen } of PRESETS) {
    const { board } = parseFen(fen);
    for (const color of ['red', 'black']) {
      const info = pieceInfo(board);
      const caps = generateCaptureMoves(board, color, info).map(moveKey).sort();
      const filtered = generateLegalMoves(board, color, info).filter(m => m.captured).map(moveKey).sort();
      assert.deepEqual(caps, filtered, `capture generator mismatch @ ${fen.slice(0, 20)}`);
      for (const m of generateCaptureMoves(board, color, info)) assert.ok(board[m.to.row][m.to.col], 'capture move must target a piece');
    }
  }
});

test('makeMove/unmakeMove restore the board and the Zobrist hash', () => {
  for (const { fen } of PRESETS) {
    const { board } = parseFen(fen);
    const h = zobristFromBoard(board, 'red', false);
    const h0 = { lo: h.lo, hi: h.hi };
    const snapshot = JSON.stringify(board);

    let side = 'red';
    const played = [];
    for (let i = 0; i < 3; i++) {
      const list = generateLegalMoves(board, side);
      if (list.length === 0) break;
      const m = list[0];
      const undo = makeMove(board, m, h);
      played.push({ m, undo });
      side = opp(side);
      const expect = zobristFromBoard(board, side, false);
      assert.equal(h.lo, expect.lo, `incremental hash lo mismatch after make @ ${fen.slice(0, 20)}`);
      assert.equal(h.hi, expect.hi, `incremental hash hi mismatch after make @ ${fen.slice(0, 20)}`);
    }
    for (let i = played.length - 1; i >= 0; i--) {
      const { m, undo } = played[i];
      unmakeMove(board, m, undo, h);
      side = opp(side);
      if (i === 0) {
        assert.equal(h.lo, h0.lo, 'hash not restored after unmake');
        assert.equal(h.hi, h0.hi, 'hash not restored after unmake');
      }
    }
    assert.equal(JSON.stringify(board), snapshot, 'board not restored after unmake loop');
  }
});

test('flying-general check detected by both paths', () => {
  // red king e0, black king e9, nothing between; red to move is in check.
  const fen = '4k4/9/9/9/9/9/9/9/9/4K4';
  const { board } = parseFen(fen);
  assert.equal(isInCheck(board, 'red'), true, 'full-scan flying general must be check on red');
  assert.equal(isInCheck(board, 'black'), true, 'full-scan flying general must be check on black');
  const info = pieceInfo(board);
  assert.equal(isInCheck(board, 'red', info.red, info.black, info.blackPieces, null), true);
  // interpose a soldier on the file → not check
  board[5][4] = { type: 'soldier', color: 'red' };
  const info2 = pieceInfo(board);
  assert.equal(isInCheck(board, 'red', info2.red, info2.black, info2.blackPieces, null), false);
  assert.equal(isInCheck(board, 'red'), false);
});