import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFen } from '../js/notation.js';
import { analyzePosition } from '../js/analyze.js';

test('analyzePosition is DOM-free and honors the shared deadline', async () => {
  const { board } = parseFen('3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1');
  const result = await analyzePosition(board, { depth: 2, timeLimit: 1000 });
  assert.equal(result.status, 'ok');
  assert.equal(typeof result.interrupted, 'boolean');
  assert.equal(result.score !== undefined, true);
});

test('analyzePosition reports cancellation without relying on UI state', async () => {
  const { board } = parseFen('3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1');
  const result = await analyzePosition(board, { depth: 12, timeLimit: 1000, isCancelled: () => true });
  assert.equal(result.interrupted, true);
});
