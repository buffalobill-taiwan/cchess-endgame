import { moveToNotation } from '../js/notation.js';
import { applyBoardCopy } from '../js/board.js';
import { MATE_VAL } from '../js/constants.js';

function pathTo(node) {
  const path = [];
  for (let n = node; n?.parent; n = n.parent) path.push(n.via);
  path.reverse();
  if (path.length > 16) path.splice(8, path.length - 16, '…');
  return path.join(' → ') || '初始局面';
}

export class AnalysisDiagnostics {
  constructor(start, timeLimit, init) {
    this.start = start;
    this.timeLimit = timeLimit;
    this.init = init;
    this.phase = '主搜尋';
    this.root = null;
    this.nodes = [];
    this.current = null;
    this.pending = 0;
    this.peakPending = 0;
    this.entries = 0;
    this.completed = 0;
    this.searches = 0;
    this.searchMs = 0;
    this.known = 0;
    this.fallback = 0;
    this.fallbackExamples = [];
    this.activeMove = null;
    this.afterRedFen = null;
  }

  recordRoot(board, result, elapsed) {
    const pv = [];
    let position = board;
    let color = 'red';
    for (const move of result.pv) {
      pv.push(moveToNotation(position, move, color));
      position = applyBoardCopy(position, move);
      color = color === 'red' ? 'black' : 'red';
    }
    this.root = { elapsed, score: result.score, interrupted: result.interrupted, pv,
      step: result.score > MATE_VAL / 2 && pv.length ? Math.ceil(pv.length / 2) : null };
  }

  discover(fen, parent = null, via = null) {
    const node = { fen, parent, via, started: false, legal: 0, checks: 0,
      added: 0, searchMs: 0, subtree: 0, subtreeMs: 0 };
    this.nodes.push(node);
    if (parent) parent.added++;
    return node;
  }

  updatePending(count) {
    this.pending = count;
    this.peakPending = Math.max(this.peakPending, count);
  }

  recordSearch(ms) {
    this.searches++;
    this.searchMs += ms;
    if (this.current) this.current.searchMs += ms;
  }

  recordFallback(chosen, suggested, score, interrupted) {
    this.fallback++;
    if (this.fallbackExamples.length < 5) this.fallbackExamples.push({
      node: this.current, red: this.activeMove, chosen, suggested, score, interrupted,
    });
  }

  format(now = Date.now()) {
    // Count started positions and search time along their first-discovery paths.
    // These are traversal statistics, not all possible transposition paths.
    for (const n of this.nodes) {
      n.subtree = n.started ? 1 : 0;
      n.subtreeMs = n.searchMs;
    }
    // Parents are discovered before children, so one reverse pass is enough.
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.parent) {
        n.parent.subtree += n.subtree;
        n.parent.subtreeMs += n.subtreeMs;
      }
    }
    const out = [
      '逾時分析（截至中斷時的統計；分支依首次發現路徑歸屬）',
      `耗時：${now - this.start}ms／上限 ${this.timeLimit}ms；中斷階段：${this.phase}`,
      `初始 FEN：${this.init} w - - 0 1`,
    ];
    if (this.root) {
      const r = this.root;
      out.push(`主搜尋：${r.elapsed}ms；分數 ${r.score}；${r.interrupted ? '已中斷' : '已完成'}；紅方殺步：${r.step ?? '未證明'}`);
      if (r.pv.length) out.push(`主搜尋 PV：${r.pv.join(' → ')}`);
    }
    out.push(
      `應手表：已開始 ${this.nodes.filter(n => n.started).length} 個紅方局面；完整展開 ${this.completed} 個；已發現 ${this.nodes.length} 個；待處理 ${this.pending} 個（峰值 ${this.peakPending}）；已記錄 ${this.entries} 個應手表項目`,
      `黑方搜尋：${this.searches} 次／${this.searchMs}ms；回到已知局面 ${this.known} 次；改用排序第一步 ${this.fallback} 次`,
    );
    if (this.current) {
      out.push(`當下路徑：${pathTo(this.current)}`,
        `當下紅方 FEN：${this.current.fen} w - - 0 1`,
        `當下合法走法 ${this.current.legal} 個，其中將軍 ${this.current.checks} 個`);
      if (this.activeMove) out.push(`正在處理紅方走法：${this.activeMove}`);
      if (this.afterRedFen) out.push(`紅方走後 FEN：${this.afterRedFen} b - - 0 1`);
    }
    const branches = this.nodes.filter(n => n.parent && !n.parent.parent)
      .sort((a, b) => b.subtreeMs - a.subtreeMs).slice(0, 5);
    if (branches.length) out.push('初始分支（依黑方搜尋耗時排序）：', ...branches.map(n =>
      `  ${n.via}：已開始 ${n.subtree} 個局面；黑方搜尋 ${n.subtreeMs}ms`));
    const hotspots = this.nodes.filter(n => n.started && n.added > 0)
      .sort((a, b) => b.added - a.added || b.subtreeMs - a.subtreeMs).slice(0, 5);
    if (hotspots.length) out.push('展開最多新局面的節點：', ...hotspots.flatMap(n => [
      `  ${pathTo(n)}`,
      `    合法 ${n.legal}／將軍 ${n.checks}；直接新增 ${n.added}；此分支已開始 ${n.subtree} 個局面；黑方搜尋 ${n.subtreeMs}ms`,
      `    FEN：${n.fen} w - - 0 1`,
    ]));
    if (this.fallbackExamples.length) out.push('改用排序第一步的例子（最多 5 筆）：',
      ...this.fallbackExamples.map(e => `  ${pathTo(e.node)} → ${e.red}／${e.chosen}；搜尋建議 ${e.suggested ?? '無'}，分數 ${e.score ?? '無'}，${e.interrupted ? '搜尋已中斷' : '未取得可採用的搜尋結果'}`));
    out.push('主搜尋結果不限制應手表展開；相同 FEN 才會去重。以上統計不代表完整遊戲樹。');
    return out.join('\n');
  }
}
