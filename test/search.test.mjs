// ═══════════════════════════════════════════
// SEARCH ENGINE INTEGRATION TESTS
// ═══════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFen } from '../js/notation.js';
import { applyBoardCopy, deepCopyBoard } from '../js/board.js';
import { searchRootAsync, findRefutation } from '../js/search.js';
import { isCheckmate, generateLegalMoves, isInCheck } from '../js/rules.js';
import { state, opp } from '../js/state.js';
import { MATE_VAL } from '../js/constants.js';

const PRESETS = [
  '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1',
  '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4',
  '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3',
  '4k2P1/5P3/c8/9/9/3c4R/4r3C/B3p4/4p4/3K5',
  '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2',
  '9/9/3a1k3/6P2/9/9/3r5/2n3r2/C8/4K1p2',
  '3rka1R1/4aR3/4b4/9/9/9/6r2/7C1/3p5/c1BA1K3',
  '9/4a4/3a1k3/2r3R2/1n5N1/c7C/1n5N1/2r3R2/3p1p3/4K4',
  '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4',
];

const DEPTH = 5;
const TIME_LIMIT = 15000;

function resetEngine() {
  state.interruptRequested = false;
  state.continuousCheck = false;
}

test('search on presets returns structurally valid results at depth 5', async () => {
  resetEngine();
  for (const fen of PRESETS) {
    const { board } = parseFen(fen + ' w - - 0 1');
    const b = deepCopyBoard(board);
    const res = await searchRootAsync(b, DEPTH, TIME_LIMIT);
    assert.ok(res.nodes > 0, `nodes must be > 0 @ ${fen.slice(0, 20)}`);
    assert.ok(res.nodes !== undefined, 'nodes must be reported');

    const side = 'red';
    const legal = generateLegalMoves(b, side).map(m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`);
    if (Math.abs(res.score) > MATE_VAL / 2) {
      assert.ok(res.pv.length > 0, `mate needs a PV @ ${fen.slice(0, 20)}`);
      assert.equal(legal.includes(`${res.pv[0].from.row},${res.pv[0].from.col}>${res.pv[0].to.row},${res.pv[0].to.col}`), true, `best move must be legal @ ${fen.slice(0, 20)}`);
      const loser = res.score > 0 ? 'black' : 'red';
      const finalBoard = replayPV(board, res.pv);
      assert.equal(isCheckmate(finalBoard, loser), true, `PV must end in checkmate (winner ${opp(loser)}) @ ${fen.slice(0, 20)}`);
    } else {
      if (res.move) {
        assert.equal(legal.includes(`${res.move.from.row},${res.move.from.col}>${res.move.to.row},${res.move.to.col}`), true, `best move must be legal @ ${fen.slice(0, 20)}`);
      }
    }
  }
});

test('nodes reported grow with iteration depth (no early mate)', async () => {
  resetEngine();
  // Puzzle 9 (霹靂眼) is not a red mate at depth 3–4 (measured), so the
  // cumulative node count must strictly increase with depth.
  const fen = '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4 w - - 0 1';
  const { board } = parseFen(fen);
  const b = deepCopyBoard(board);
  const r3 = await searchRootAsync(b, 3, 20000);
  const b2 = deepCopyBoard(board);
  const r4 = await searchRootAsync(b2, 4, 20000);
  assert.equal(Math.abs(r3.score) > MATE_VAL / 2, false, 'depth 3 must not mate this preset');
  assert.ok(r4.nodes > r3.nodes, `nodes should grow with depth (${r3.nodes} -> ${r4.nodes})`);
});

test('continuousCheck mode: every red move in the PV gives check', async () => {
  state.continuousCheck = true;
  state.interruptRequested = false;
  const fen = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
  const { board } = parseFen(fen);
  const res = await searchRootAsync(deepCopyBoard(board), 5, 15000);
  state.continuousCheck = false;
  assert.ok(res.pv.length > 0, 'expected a PV in continuous-check mode');
  let cur = deepCopyBoard(board);
  let side = 'red';
  for (let i = 0; i < res.pv.length; i++) {
    const m = res.pv[i];
    cur = applyBoardCopy(cur, m);
    if (side === 'red') {
      assert.equal(isInCheck(cur, 'black'), true, `red move #${i + 1} must give check in continuous-check mode`);
    }
    side = opp(side);
  }
});

test('findRefutation returns a legal move or empty score', async () => {
  resetEngine();
  const fen = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';
  const { board } = parseFen(fen);
  const ref = await findRefutation(deepCopyBoard(board), 'red', 4, Date.now(), 5000);
  assert.ok(ref.nodes !== undefined);
  if (ref.move) {
    const legal = generateLegalMoves(board, 'red').map(m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`);
    assert.ok(legal.includes(`${ref.move.from.row},${ref.move.from.col}>${ref.move.to.row},${ref.move.to.col}`), 'refutation move must be legal');
  }
});

function replayPV(board, pv) {
  let cur = deepCopyBoard(board);
  let side = 'red';
  const legalSet = s => new Set(generateLegalMoves(cur, s).map(m => `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`));
  for (const m of pv) {
    assert.ok(legalSet(side).has(`${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`), `PV move must be legal for ${side}`);
    cur = applyBoardCopy(cur, m);
    side = opp(side);
  }
  return cur;
}