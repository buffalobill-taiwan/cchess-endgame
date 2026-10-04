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
    this.phase = '應手表展開';
    this.nodes = [];
    this.current = null;
    this.pending = 0;
    this.peakPending = 0;
    this.entries = 0;
    this.completed = 0;
    this.searches = 0;
    this.searchMs = 0;
    this.reused = 0;
    this.forced = 0;
    this.graphQueries = 0;
    this.graphPositions = 0;
    this.graphExpanded = 0;
    this.preferredKnown = 0;
    this.activeMove = null;
    this.afterRedFen = null;
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

  format(now = Date.now(), timedOut = true) {
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
      `${timedOut ? '逾時' : '未解局面'}分析（截至中斷時的統計；分支依首次發現路徑歸屬）`,
      `耗時：${now - this.start}ms／上限 ${this.timeLimit}ms；中斷階段：${this.phase}`,
      `初始 FEN：${this.init} w - - 0 1`,
    ];
    out.push(
      `應手表：已開始 ${this.nodes.filter(n => n.started).length} 個紅方局面；完整展開 ${this.completed} 個；已發現 ${this.nodes.length} 個；待處理 ${this.pending} 個（峰值 ${this.peakPending}）；已記錄 ${this.entries} 個應手表項目`,
      `黑方搜尋：${this.searches} 次／${this.searchMs}ms；唯一合法應手 ${this.forced} 次；重用已固定應手 ${this.reused} 次`,
      `局面圖：查詢 ${this.graphQueries} 次；已展開 ${this.graphExpanded} 個局面；共用已證明快取 ${this.graphPositions} 個局面（含行棋方）`,
      `同等最佳應手中優先重用局面 ${this.preferredKnown} 次`,
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
    out.push('紅方所有合法走法都會展開，相同 FEN 才會去重；完成應手表後才推導步數。以上統計不代表完整遊戲樹。');
    return out.join('\n');
  }
}
