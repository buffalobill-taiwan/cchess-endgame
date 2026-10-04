import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSolver } from '../tools/game-solver.mjs';
import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';
import { MATE_VAL, INF } from '../js/constants.js';

const delayFen = '3Rk4/9/5P3/9/9/4P4/9/9/9/4K4';
const opposite = side => side === 'red' ? 'black' : 'red';

// Exhaustive reference: no alpha-beta, move ordering, TT or mate-score reuse.
function minimax(board, side, depth, ply = 0) {
  const kings = findKings(board);
  const moves = generateLegalMoves(board, side);
  const winner = !kings.red ? 'black' : !kings.black ? 'red' :
    moves.length === 0 ? opposite(side) : null;
  if (winner) return (winner === 'red' ? 1 : -1) * (MATE_VAL - ply);
  if (depth === 0) return 0;
  const values = moves.map(m => minimax(applyBoardCopy(board, m), opposite(side), depth - 1, ply + 1));
  return side === 'red' ? Math.max(...values) : Math.min(...values);
}

test('black delays forced defeat as long as possible, with exact mate distance', () => {
  const { board } = parseFen(delayFen);
  const original = structuredClone(board);
  const result = new GameSolver().solve(board, 'black', 6, Date.now() + 5000);
  assert.equal(result.resolved, true);
  assert.equal(result.interrupted, false);
  assert.equal(result.score, MATE_VAL - 6);
  assert.equal(result.score, minimax(board, 'black', 6));
  // Capturing the rook loses after six plies; moving down loses after two.
  assert.deepEqual(result.move.to, { row: 0, col: 3 });
  const choices = generateLegalMoves(board, 'black').map(m =>
    minimax(applyBoardCopy(board, m), 'red', 5, 1));
  assert.deepEqual(choices.sort((a, b) => a - b), [MATE_VAL - 6, MATE_VAL - 2]);
  assert.equal(result.pv.length, 6);
  assert.deepEqual(board, original);
});

test('black takes an immediate win instead of allowing further resistance', () => {
  const { board } = parseFen('1P1k2c2/4n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1');
  const result = new GameSolver().solve(board, 'black', 6, Date.now() + 5000);
  assert.equal(result.resolved, true);
  assert.equal(result.score, -MATE_VAL + 1);
  assert.equal(result.score, minimax(board, 'black', 1));
  assert.equal(generateLegalMoves(applyBoardCopy(board, result.move), 'red').length, 0);
});

test('depth exhaustion is unknown, while a completely searched cycle can prove a draw', () => {
  const { board } = parseFen('3k5/9/9/9/9/9/9/9/9/5K3');
  const solver = new GameSolver({ useGraph: false });
  const shallow = solver.solve(board, 'black', 1, Date.now() + 5000);
  assert.equal(shallow.score, 0);
  assert.equal(shallow.resolved, false);
  const complete = solver.solve(board, 'black', 64, Date.now() + 5000);
  assert.equal(complete.score, 0);
  assert.equal(complete.resolved, true);
  assert.equal(complete.interrupted, false);
});

test('cached mate distances are relative to the position and survive later root lookups', () => {
  const { board } = parseFen(delayFen);
  const solver = new GameSolver({ useGraph: false });
  const parent = solver.solve(board, 'black', 6, Date.now() + 5000);
  const cached = solver.solve(board, 'black', 6, Date.now() + 5000);
  assert.equal(cached.score, parent.score);
  assert.equal(cached.nodes, 0);
  const child = applyBoardCopy(board, parent.move);
  const reused = solver.solve(child, 'red', 5, Date.now() + 5000);
  assert.equal(reused.resolved, true);
  assert.equal(reused.score, MATE_VAL - 5);
  assert.equal(reused.score, minimax(child, 'red', 5));
  const shallow = solver.solve(child, 'red', 1, Date.now() + 5000);
  assert.equal(shallow.resolved, true);
  assert.equal(shallow.score, MATE_VAL - 5);
  assert.equal(shallow.nodes, 0);
});

test('interruption restores the board and cannot certify a partial search', t => {
  const { board } = parseFen(delayFen);
  const original = structuredClone(board);
  let ticks = 0;
  t.mock.method(Date, 'now', () => ticks++);
  const result = new GameSolver().solve(board, 'black', 6, 20);
  assert.equal(result.interrupted, true);
  assert.equal(result.resolved, false);
  assert.deepEqual(board, original);
});

test('recursive search consumes exact graph boundaries and adjusts mate distance', () => {
  const solver = new GameSolver();
  solver.graph.solve(parseFen('4k4/9/9/4P4/9/9/9/9/9/4K4').board, 'black', () => {});
  const parent = parseFen('4k4/9/9/9/4P4/9/9/9/9/4K4').board;
  const ctx = solver.context(Date.now() + 5000);
  const result = solver.search(parent, 'red', 7, 0, -INF, INF, ctx);
  assert.ok(solver.proofHits > 0);
  assert.equal(result.resolved, true);
  assert.equal(result.score, minimax(parent, 'red', 7));
});

test('transient eviction never removes exact proofs', () => {
  const solver = new GameSolver({ useGraph: false, ttLimit: 2 });
  const board = parseFen(delayFen).board;
  const first = solver.solve(board, 'black', 6, Date.now() + 5000);
  const proofCount = solver.proofs.size;
  for (let i = 0; i < 10; i++) solver.storeTransient(`temporary ${i}`, { score: 0 });
  assert.equal(solver.tt.size, 2);
  assert.equal(solver.proofs.size, proofCount);
  const cached = solver.solve(board, 'black', 1, Date.now() + 5000);
  assert.equal(cached.nodes, 0);
  assert.equal(cached.score, first.score);
});

test('dynamic graph probing handles a two-pawn position above the old placement bound', () => {
  const board = parseFen('3k5/7PP/9/9/9/9/9/9/9/5K3').board;
  const solver = new GameSolver();
  const result = solver.solve(board, 'red', 1, Date.now() + 5000);
  assert.equal(result.resolved, true);
  assert.equal(solver.method, 'graph');
  assert.equal(solver.graph.lastProbe.reason, 'complete');
});

test('an incomplete graph remains unknown when actual resource budgets are exhausted', () => {
  const board = parseFen('4k4/9/9/4P4/9/9/9/9/9/4K4').board;
  const solver = new GameSolver({ graphNodes: 2, graphEdges: 20 });
  const result = solver.solve(board, 'red', 1, Date.now() + 5000);
  assert.equal(result.resolved, false);
  assert.equal(result.score, 0);
  assert.equal(solver.graph.lastProbe.reason, 'nodes');
});

test('equal-distance defenses may reuse known positions, but shorter resistance may not', () => {
  const key = board => boardToFen(board).split(' ')[0];
  const board = parseFen('4k4/9/3R5/9/9/4P4/9/9/9/4K4').board;
  const solver = new GameSolver({ useGraph: false });
  const result = solver.solve(board, 'black', 4, Date.now() + 5000);
  const moves = generateLegalMoves(board, 'black');
  const alternative = moves.find(m => JSON.stringify(m.to) !== JSON.stringify(result.move.to));
  const selected = solver.preferKnown(board, moves, new Set([key(applyBoardCopy(board, alternative))]),
    result, Date.now() + 5000);
  assert.deepEqual(selected, alternative);
  assert.equal(solver.preferredKnown, 1);

  const losing = parseFen(delayFen).board;
  const best = solver.solve(losing, 'black', 6, Date.now() + 5000);
  const replies = generateLegalMoves(losing, 'black');
  const worse = replies.find(m => m.to.row === 1);
  assert.deepEqual(solver.preferKnown(losing, replies, new Set([key(applyBoardCopy(losing, worse))]),
    best, Date.now() + 5000), best.move);
});
