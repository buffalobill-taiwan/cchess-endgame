// ═══════════════════════════════════════════
// SEARCH BENCHMARK (headless)
// usage: node bench.mjs <fen> [depth] [timeLimitMs]
// ═══════════════════════════════════════════

import { parseFen, moveToNotation } from './js/notation.js';
import { deepCopyBoard, applyBoardCopy } from './js/board.js';
import { searchRootAsync } from './js/search.js';
import { state } from './js/state.js';

const fen = process.argv[2];
const depth = parseInt(process.argv[3] || '6', 10);
const timeLimit = parseInt(process.argv[4] || '15000', 10);

if (!fen) {
  console.error('usage: node bench.mjs <fen> [depth] [timeLimitMs]');
  process.exit(1);
}

const { board } = parseFen(fen);
state.continuousCheck = false;
state.interruptRequested = false;

const b = deepCopyBoard(board);
const t0 = process.hrtime.bigint();
const res = await searchRootAsync(b, depth, timeLimit);
const t1 = process.hrtime.bigint();
const ms = Number(t1 - t0) / 1e6;

const pvNot = [];
let cur = deepCopyBoard(board);
for (const m of (res.pv || [])) {
  const side = pvNot.length % 2 === 0 ? 'red' : 'black';
  pvNot.push(moveToNotation(cur, m, side));
  cur = applyBoardCopy(cur, m);
}

console.log(JSON.stringify({
  fen,
  depth,
  score: res.score,
  moves: (res.pv || []).length,
  pv: pvNot,
  nodes: res.nodes || 0,
  ms: Math.round(ms),
  nps: Math.round((res.nodes || 0) / (ms / 1000)),
}, null, 2));