// ═══════════════════════════════════════════
// 連將殺 FEN 查表產生器
// usage: node tools/analyze.mjs <fen> [--depth N] [--time-limit MS] [--full-tree] [-o file]
// ═══════════════════════════════════════════

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { MATE_VAL } from '../js/constants.js';
import { state, movesEqual } from '../js/state.js';
import { deepCopyBoard, applyBoardCopy, findKings } from '../js/board.js';
import { parseFen, boardToFen, moveToNotation } from '../js/notation.js';
import { isCheckmate, isStalemate, generateLegalMoves } from '../js/rules.js';
import { searchRootAsync } from '../js/search.js';

export function parseArgs(argv) {
  const opts = { depth: 24, timeLimit: 15000, continuousCheck: true, output: null, fen: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') opts.depth = parseInt(argv[++i], 10);
    else if (a === '--time-limit') opts.timeLimit = parseInt(argv[++i], 10);
    else if (a === '--full-tree') opts.continuousCheck = false;
    else if (a === '-o') opts.output = argv[++i];
    else rest.push(a);
  }
  opts.fen = rest[0];
  return opts;
}

function serializeMove(m) {
  return {
    from: [m.from.row, m.from.col],
    to: [m.to.row, m.to.col],
    captured: m.captured || null,
  };
}

// 查表 key：僅取盤面部分，截掉後綴（w - - 0 1）。map 全域皆為黑方輪走的盤面，
// 是否合法（side）不影響，因為決定黑方回應的只有盤面本身。
function posKey(b) {
  return boardToFen(b).split(' ')[0];
}

function findMateInOne(B) {
  for (const m of generateLegalMoves(B, 'black')) {
    const nb = applyBoardCopy(B, m);
    if (isCheckmate(nb, 'red') || isStalemate(nb, 'red')) return m;
  }
  return null;
}

// 驗證條件 1、2 並建立 { 黑方輪到盤面FEN: 黑方回應 } 查表。
// 黑方回應為該盤面的純函數：紅必勝線上取最長防守，誤走盤面取一步絕殺。
export async function analyzeFen(fen, opts = {}) {
  const depth = opts.depth ?? 24;
  const timeLimit = opts.timeLimit ?? 15000;
  const continuousCheck = opts.continuousCheck ?? true;

  let root;
  try {
    root = parseFen(fen).board;
  } catch (e) {
    return { valid: false, error: `FEN 解析失敗：${e.message}` };
  }
  const kings = findKings(root);
  if (!kings.red || !kings.black) {
    return { valid: false, error: '初始局面缺少紅帥或黑將' };
  }

  state.continuousCheck = continuousCheck;
  state.interruptRequested = false;

  // ─── Phase 1：條件 1（紅必勝）。窮盡決策樹：查過 verified 將殺且
  //     PV 長度 ≤ 該搜尋深度，保證整條 PV 的 minimax 皆 exact
  //     （黑方回應 = 路徑最長的那條必敗線）。
  let res = null;
  for (let md = 2; md <= depth; md += 2) {
    const r = await searchRootAsync(deepCopyBoard(root), md, timeLimit);
    if (state.interruptRequested) break;
    if (Math.abs(r.score) > MATE_VAL / 2 && r.pv && r.pv.length > 0 && r.pv.length <= md) {
      res = r;
      break;
    }
  }
  if (!res) {
    return {
      valid: false,
      error: `條件1不成立：深度 ${depth} 內未能確認紅方必勝（紅方正確走時黑方必然被將死、黑方取最長防守）`,
    };
  }

  // ─── Phase 2：沿 PV 逐節點驗證條件 2（誤走即被一步絕殺）並建立 map ───
  const map = new Map();
  const pv = res.pv;
  let R = deepCopyBoard(root);
  let i = 0;
  let altMates = 0;

  while (i < pv.length) {
    const correctMove = pv[i];
    let terminal = false;

    for (const rm of generateLegalMoves(R, 'red')) {
      const B = applyBoardCopy(R, rm);
      const key = posKey(B);

      if (movesEqual(rm, correctMove)) {
        const bMated = isCheckmate(B, 'black') || isStalemate(B, 'black');
        if (bMated) {
          if (i !== pv.length - 1) {
            return { valid: false, error: '內部不一致：正確走法提前將死黑方' };
          }
          if (!map.has(key)) map.set(key, null);
          terminal = true;
          break;
        }
        if (i + 1 >= pv.length) {
          return { valid: false, error: '內部不一致：PV 在黑方未死時結束' };
        }
        const reply = pv[i + 1];
        if (!map.has(key)) {
          map.set(key, {
            move: serializeMove(reply),
            notation: moveToNotation(B, reply, 'black'),
            fen: boardToFen(applyBoardCopy(B, reply), 'w'),
          });
        }
      } else {
        const bMated = isCheckmate(B, 'black') || isStalemate(B, 'black');
        if (bMated) {
          // 此非主線紅走法亦能立即得勝：黑方無步可走 → 終結，不視為錯誤。
          if (!map.has(key)) map.set(key, null);
          altMates++;
          continue;
        }
        const kill = findMateInOne(B);
        if (!kill) {
          return {
            valid: false,
            error: `條件2不成立：紅方走 ${moveToNotation(R, rm, 'red')} 之後黑方無法一步絕殺`,
          };
        }
        if (!map.has(key)) {
          map.set(key, {
            move: serializeMove(kill),
            notation: moveToNotation(B, kill, 'black'),
            fen: boardToFen(applyBoardCopy(B, kill), 'w'),
          });
        }
      }
    }

    if (terminal) break;
    if (i + 1 >= pv.length) {
      return { valid: false, error: '內部不一致：PV 未將死黑方即結束' };
    }
    R = applyBoardCopy(R, correctMove);
    R = applyBoardCopy(R, pv[i + 1]);
    i += 2;
  }

  return { valid: true, map: Object.fromEntries(map), altMates };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.fen) {
    console.error('usage: node tools/analyze.mjs <fen> [--depth N] [--time-limit MS] [--full-tree] [-o file]');
    process.exit(2);
  }

  const t0 = process.hrtime.bigint();
  const res = await analyzeFen(opts.fen, opts);
  const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

  if (!res.valid) {
    console.error(`[analyze] ${res.error} (${ms}ms)`);
    process.stdout.write(JSON.stringify({ error: res.error }) + '\n');
    process.exit(1);
  }

  const keys = Object.keys(res.map).length;
  if (res.altMates > 0) {
    console.error(`[analyze] 注意：${res.altMates} 個非主線走法亦能立即得勝（多解，不影響查表）`);
  }
  const json = JSON.stringify(res.map);
  if (opts.output) {
    await writeFile(opts.output, json + '\n', 'utf8');
    console.error(`[analyze] OK：${keys} keys 寫入 ${opts.output} (${ms}ms)`);
  } else {
    process.stdout.write(json + '\n');
    console.error(`[analyze] OK：${keys} keys (${ms}ms)`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) void main();