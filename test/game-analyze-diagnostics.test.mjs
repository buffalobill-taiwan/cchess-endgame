import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisDiagnostics } from '../tools/game-analyze-diagnostics.mjs';

test('timeout diagnostics attribute search time and started positions to discovery branches', () => {
  const d = new AnalysisDiagnostics(100, 1000, 'initial');
  const root = d.discover('initial');
  root.started = true;
  root.legal = 30;
  root.checks = 3;
  const branch = d.discover('branch', root, '俥六進一 / 將５進１');
  branch.started = true;
  branch.legal = 13;
  branch.checks = 7;
  d.current = branch;
  d.recordSearch(200);
  const child = d.discover('child', branch, '傌八進六 / 將５進１');
  child.started = true;
  d.current = child;
  d.recordSearch(300);
  d.discover('pending', branch, '俥六退一 / 將５退１');
  d.activeMove = '俥六平四';
  d.afterRedFen = 'after-red';
  d.reused = 3;
  d.forced = 2;
  d.updatePending(4);
  d.updatePending(1);
  d.completed = 2;
  d.phase = '應手表展開';
  const report = d.format(1100);
  assert.match(report, /已開始 3 個紅方局面；完整展開 2 個；已發現 4 個；待處理 1 個（峰值 4）/);
  assert.match(report, /黑方搜尋：2 次／500ms/);
  assert.match(report, /俥六進一 \/ 將５進１：已開始 2 個局面；黑方搜尋 500ms/);
  assert.match(report, /合法 13／將軍 7；直接新增 2；此分支已開始 2 個局面；黑方搜尋 500ms/);
  assert.match(report, /當下路徑：俥六進一 \/ 將５進１ → 傌八進六 \/ 將５進１/);
  assert.match(report, /紅方走後 FEN：after-red b - - 0 1/);
  assert.match(report, /唯一合法應手 2 次；重用已固定應手 3 次/);
  assert.equal(d.format(1100), report);
});

test('diagnostics distinguish table expansion from post-build step counting', () => {
  const d = new AnalysisDiagnostics(0, 1000, 'initial');
  assert.match(d.format(1000), /中斷階段：應手表展開/);
  d.phase = '步數推導';
  assert.match(d.format(1000), /中斷階段：步數推導/);
  assert.doesNotMatch(d.format(1000), /主搜尋/);
});
