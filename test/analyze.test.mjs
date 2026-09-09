// ═══════════════════════════════════════════
// 連將殺 ANALYZE 工具測試
// ═══════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardToFen, parseFen, moveToNotation } from '../js/notation.js';
import { deepCopyBoard, applyBoardCopy } from '../js/board.js';
import { isCheckmate, isStalemate } from '../js/rules.js';
import { analyzeFen } from '../tools/analyze.mjs';

const EXAMPLE = '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1';

function postKey(fen) {
  return fen.trim().split(/\s+/)[0];
}

function assertMapConsistent(map) {
  for (const [keyFen, val] of Object.entries(map)) {
    assert.equal(keyFen.split(' ').length, 1,
      `key 應只取盤面部分（無後綴）：${keyFen}`);
    assert.equal(keyFen.split('/').length, 10, `key 盤面應為 10 行：${keyFen}`);
    if (val === null) {
      const { board } = parseFen(keyFen + ' w - - 0 1');
      assert.ok(isCheckmate(board, 'black') || isStalemate(board, 'black'),
        `null key 應為黑方將死/困斃：${keyFen}`);
      continue;
    }
    assert.equal(typeof val.notation, 'string');
    assert.equal(typeof val.fen, 'string');
    assert.equal(val.fen.split(' ')[1], 'w', `val.fen 應為紅方輪走：${keyFen}`);
    assert.equal(val.move.from.length, 2);
    assert.equal(val.move.to.length, 2);
    const { board } = parseFen(keyFen + ' w - - 0 1');
    const m = {
      from: { row: val.move.from[0], col: val.move.from[1] },
      to: { row: val.move.to[0], col: val.move.to[1] },
      captured: null,
    };
    assert.equal(boardToFen(applyBoardCopy(board, m), 'w'), val.fen,
      `val.fen 應等於黑方走這步後的盤面：${keyFen}`);
    assert.equal(val.notation, moveToNotation(board, m, 'black'));
  }
}

test('boardToFen 支援 sideToMove 參數', () => {
  const { board } = parseFen(EXAMPLE);
  const key = boardToFen(board, 'b');
  assert.equal(key.split(' ')[1], 'b');
  assert.equal(parseFen(key).board.length, 10);
  assert.equal(boardToFen(board, 'w').split(' ')[1], 'w');
  assert.equal(boardToFen(board), boardToFen(board, 'w'));
});

test('範例 FEN 應通過兩條件並產生查表', async () => {
  const res = await analyzeFen(EXAMPLE, { depth: 20, timeLimit: 10000 });
  assert.equal(res.valid, true, res.error);
  assert.ok(Object.keys(res.map).length > 0);
  const nulls = Object.values(res.map).filter(v => v === null).length;
  assert.ok(nulls >= 2, `應含主線終結與另解終結，實際 ${nulls}`);
  assertMapConsistent(res.map);
});

test('輸入 FEN 的後綴不影響分析（不參考 side/步數欄）', async () => {
  const a = await analyzeFen(EXAMPLE, { depth: 20, timeLimit: 10000 });
  const b = await analyzeFen(EXAMPLE.replace(' w - - 0 1', ' b 40 1 99'), { depth: 20, timeLimit: 10000 });
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
  assert.deepEqual(a.map, b.map);
});

test('缺少將帥應判定無效', async () => {
  const res = await analyzeFen('4K4/9/9/9/9/9/9/9/9/9 w - - 0 1', { depth: 4, timeLimit: 1000 });
  assert.equal(res.valid, false);
  assert.match(res.error, /缺少紅帥或黑將/);
});

test('壞 FEN 應解析失敗', async () => {
  const res = await analyzeFen('not-a-fen', { depth: 4, timeLimit: 1000 });
  assert.equal(res.valid, false);
  assert.match(res.error, /FEN 解析失敗/);
});

test('條件1不成立的局面應判定無效（紅方無必勝）', async () => {
  const res = await analyzeFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', { depth: 4, timeLimit: 2000 });
  assert.equal(res.valid, false);
  assert.match(res.error, /條件1不成立/);
});

test('紅方走俥二平六後的盤面應能查表命中', async () => {
  const res = await analyzeFen(EXAMPLE, { depth: 20, timeLimit: 10000 });
  assert.equal(res.valid, true, res.error);
  const afterChariot = '3k2c2/1P2n1N2/4bP3/9/9/9/r2R5/3p5/4p4/3K3C1 w - - 0 1';
  assert.ok(postKey(afterChariot) in res.map, '俥二平六後的黑方輪走盤面應為 key');
  assert.equal(res.map[postKey(afterChariot)].notation, '車１平４');
});

test('deepCopyBoard 不與搜尋共用物件（回歸防護）', async () => {
  const { board } = parseFen(EXAMPLE);
  const c1 = deepCopyBoard(board);
  const before = boardToFen(board);
  await analyzeFen(EXAMPLE, { depth: 20, timeLimit: 10000 });
  assert.equal(boardToFen(board), before);
  assert.equal(boardToFen(c1), before);
});