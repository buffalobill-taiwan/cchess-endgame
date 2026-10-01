import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as engine from '../js/engine.js';

test('engine dependency graph excludes browser state and browser adapters', async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    assert.doesNotMatch(url.pathname, /\/(?:state|ui|ui-constants|app|example-modal|example-store)\.js$/);
    const source = await readFile(url, 'utf8');
    assert.doesNotMatch(source, /\b(?:document|window|localStorage)\b/);
    for (const match of source.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
      await visit(new URL(match[1], url));
    }
  }
  await visit(new URL('../js/engine.js', import.meta.url));
});

test('public engine API analyzes an independent board without modifying it', async () => {
  const { board } = engine.parseFen('3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1');
  const snapshot = structuredClone(board);
  const result = await engine.analyzePosition(board, { depth: 2, timeLimit: 1000 });
  assert.equal(result.status, 'ok');
  assert.deepEqual(board, snapshot);
  assert.ok(engine.generateLegalMoves(board, 'red').length > 0);
});

test('position editor constraints are available without the UI', () => {
  assert.equal(engine.canPlaceAt(9, 4, 'king', 'red'), true);
  assert.equal(engine.canPlaceAt(0, 4, 'king', 'red'), false);
  assert.equal(engine.canPlaceAt(7, 4, 'elephant', 'red'), true);
  assert.equal(engine.canPlaceAt(7, 3, 'elephant', 'red'), false);
  assert.equal(engine.canPlaceAt(6, 2, 'soldier', 'red'), true);
  assert.equal(engine.canPlaceAt(6, 3, 'soldier', 'red'), false);
});
