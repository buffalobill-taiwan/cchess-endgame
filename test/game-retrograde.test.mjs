import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGraph, RetrogradeSolver } from '../tools/game-retrograde.mjs';
import { GameSolver } from '../tools/game-solver.mjs';
import { parseFen } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';

const pawnFen = '4k4/9/9/4P4/9/9/9/9/9/4K4';
const node = (key, side, winner = null, distance = 0) => ({ key, side, winner, distance, edges: [] });
const link = (from, ...targets) => { from.edges = targets.map(to => ({ to, move: to.key })); };

test('retrograde uses shortest winning distance and longest losing distance, including cached boundaries', () => {
  const win = node('win', 'black'), lose = node('lose', 'black');
  const fastWin = node('fastWin', 'red', 'black', 2);
  const slowWin = node('slowWin', 'red', 'black', 8);
  const fastLoss = node('fastLoss', 'red', 'red', 1);
  const slowLoss = node('slowLoss', 'red', 'red', 5);
  link(win, slowWin, fastWin);
  link(lose, fastLoss, slowLoss);
  resolveGraph([win, lose, slowWin, fastWin, fastLoss, slowLoss]);
  assert.deepEqual([win.winner, win.distance, win.move], ['black', 3, 'fastWin']);
  assert.deepEqual([lose.winner, lose.distance, lose.move], ['red', 6, 'slowLoss']);
});

test('cycles with a forced winning exit are solved, while avoidable losses remain draws', () => {
  const black = node('black', 'black'), red = node('red', 'red');
  const won = node('won', 'red', 'black');
  link(black, red, won);
  link(red, black);
  const drawBlack = node('drawBlack', 'black'), drawRed = node('drawRed', 'red');
  const lost = node('lost', 'red', 'red');
  link(drawBlack, lost, drawRed);
  link(drawRed, drawBlack);
  resolveGraph([black, red, won, drawBlack, drawRed, lost]);
  assert.deepEqual([black.winner, black.distance, black.move], ['black', 1, 'won']);
  assert.deepEqual([red.winner, red.distance], ['black', 2]);
  assert.equal(drawBlack.winner, 'draw');
  assert.equal(drawRed.winner, 'draw');
  assert.equal(drawBlack.move, 'drawRed');
});

test('single-pawn graph is solved once and reused for subsequent positions', () => {
  const { board } = parseFen(pawnFen);
  const original = structuredClone(board);
  const solver = new GameSolver();
  const result = solver.solve(board, 'red', 1, Date.now() + 5000);
  assert.equal(solver.method, 'graph');
  assert.equal(result.resolved, true);
  assert.equal(result.depth, 3);
  assert.equal(solver.graph.expanded, solver.graph.positions.size);
  assert.ok(solver.graph.expanded <= 2 * (36 * 9 * 9 + 9 * 9));
  const expanded = solver.graph.expanded;
  for (const move of generateLegalMoves(board, 'red')) {
    const next = solver.solve(applyBoardCopy(board, move), 'black', 1, Date.now() + 5000);
    assert.equal(next.resolved, true);
    assert.equal(next.nodes, 0);
  }
  assert.equal(solver.graph.expanded, expanded);
  assert.deepEqual(board, original);
});

test('expanding into previously solved boundaries agrees with a fresh full graph', () => {
  const reused = new RetrogradeSolver(), fresh = new RetrogradeSolver();
  reused.solve(parseFen(pawnFen).board, 'red', () => {});
  const expanded = reused.expanded;
  const board = parseFen('4k4/9/9/9/4P4/9/9/9/9/4K4').board;
  const a = reused.solve(board, 'red', () => {});
  const b = fresh.solve(board, 'red', () => {});
  assert.deepEqual([a.winner, a.distance], [b.winner, b.distance]);
  assert.ok(reused.expanded - expanded < fresh.expanded);
  for (const [key, value] of fresh.positions) {
    const cached = reused.positions.get(key);
    assert.deepEqual([cached.winner, cached.distance], [value.winner, value.distance], key);
  }
});

test('interrupted graph construction commits no partial results', () => {
  const graph = new RetrogradeSolver();
  const board = parseFen(pawnFen).board, original = structuredClone(board);
  let calls = 0;
  assert.throws(() => graph.solve(board, 'red', () => {
    if (++calls === 100) throw new Error('stop');
  }), /stop/);
  assert.equal(graph.positions.size, 0);
  assert.deepEqual(board, original);
});

test('partial graph work survives serialization and resumes without re-expansion', () => {
  const graph = new RetrogradeSolver();
  const board = parseFen(pawnFen).board;
  assert.equal(graph.solve(board, 'red', () => {}, 5), null);
  assert.equal(graph.positions.size, 0);
  assert.equal(graph.frontier.size, 5);
  const resumed = new RetrogradeSolver();
  resumed.restore(JSON.parse(JSON.stringify(graph.snapshot())));
  const result = resumed.solve(board, 'red', () => {});
  assert.equal(result.winner, 'red');
  assert.equal(result.distance, 3);
  assert.equal(resumed.expanded, resumed.positions.size);
});
