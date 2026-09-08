// ═══════════════════════════════════════════
// MAIN ANALYZE + INIT
// ═══════════════════════════════════════════

import { MAX_DEPTH, DEFAULT_DEPTH } from './constants.js';
import { state, initBoard } from './state.js';
import { fenToBoard } from './notation.js';
import { deepCopyBoard } from './board.js';
import { analyzePosition } from './analyze.js';
import { renderBoard, renderPalette, setupDragDrop, updateStatus, renderPieces, showResult } from './ui.js';

const LOCKABLE_IDS = ['btn-import-fen', 'btn-examples'];
function lockControls(lock) {
  for (const id of LOCKABLE_IDS) document.getElementById(id).disabled = lock;
  document.getElementById('depth-slider').disabled = lock;
}

function analyze() {
  if (state.isAnalyzing) return;
  state.continuousCheck = document.getElementById('chk-continuous-check').checked;
  document.getElementById('chk-continuous-check').disabled = true;
  document.querySelector('.chk-row').classList.add('disabled');

  state.isAnalyzing = true;
  state.interruptRequested = false;
  lockControls(true);
  updateStatus();
  const btn = document.getElementById('btn-analyze');
  btn.textContent = '中斷';
  btn.classList.add('interrupting');
  document.getElementById('result-content').innerHTML = '<p>分析中，請稍候...</p>';

  const initialBoard = deepCopyBoard(state.board);
  const slider = Math.min(12, Math.max(1, parseInt(document.getElementById('depth-slider').value) || DEFAULT_DEPTH));
  const depth = Math.min(MAX_DEPTH, slider * 2);
  (async () => {
    try {
      const res = await analyzePosition(initialBoard, { depth, continuousCheck: state.continuousCheck });
      const msg = {
        noKing: '請先擺放紅黑將帥',
        redMated: '紅方死棋，黑方勝',
        redStalemated: '紅方困斃，黑方勝',
      }[res.status];
      if (msg) { document.getElementById('result-content').innerHTML = `<p>${msg}</p>`; return; }
      showResult(res.tree, res.interrupted ? 0 : res.score, res.interrupted, initialBoard);
    } catch (e) {
      document.getElementById('result-content').innerHTML = `<p>分析錯誤：${e.message}</p>`;
    } finally {
      state.isAnalyzing = false;
      state.interruptRequested = false;
      document.getElementById('chk-continuous-check').disabled = false;
      document.querySelector('.chk-row').classList.remove('disabled');
      lockControls(false);
      btn.textContent = '分析';
      btn.classList.remove('interrupting');
      updateStatus();
    }
  })();
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderBoard();
  renderPalette();
  setupDragDrop();
  updateStatus();

  document.getElementById('btn-analyze').addEventListener('click', () => {
    if (state.isAnalyzing) {
      state.interruptRequested = true;
      return;
    }
    analyze();
  });
  document.getElementById('depth-slider').addEventListener('input', function() {
    document.getElementById('depth-value').textContent = this.value;
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (state.isAnalyzing) return;
    initBoard();
    renderPieces();
    updateStatus();
    document.getElementById('result-content').innerHTML = '';
  });

  document.getElementById('btn-import-fen').addEventListener('click', () => {
    if (state.isAnalyzing) return;
    const fen = document.getElementById('fen-input').value.trim();
    if (!fen) {
      alert('請先在上方欄位輸入或貼上 FEN 編碼');
      return;
    }
    try {
      fenToBoard(fen);
      renderPieces();
      updateStatus();
      document.getElementById('result-content').innerHTML = '';
    } catch (e) {
      alert('FEN格式錯誤：' + e.message);
    }
  });

  document.getElementById('fen-input').addEventListener('click', function() {
    this.select();
  });

  const DEFAULT_EXAMPLES = [
    { label: '馬炮兵圍城', fen: '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1' },
    { label: '雙炮馬連環', fen: '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1' },
    { label: '雙俥夾車攻', fen: '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3 w - - 0 1' },
    { label: '俥炮兵破關', fen: '4k2P1/5P3/c8/9/9/3c4R/4r3C/B3p4/4p4/3K5 w - - 0 1' },
    { label: '鐵桶炮馬局', fen: '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2 w - - 0 1' },
    { label: '兵逼將死', fen: '9/9/3a1k3/6P2/9/9/3r5/2n3r2/C8/4K1p2 w - - 0 1' },
    { label: '雙俥炮夾擊', fen: '3rka1R1/4aR3/4b4/9/9/9/6r2/7C1/3p5/c1BA1K3 w - - 0 1' },
    { label: '菱形殺陣', fen: '9/4a4/3a1k3/2r3R2/1n5N1/c7C/1n5N1/2r3R2/3p1p3/4K4 w - - 0 1' },
    { label: '霹靂眼', fen: '3aR4/3ca4/b3k4/5P3/C1b2R3/9/4P3r/3AB4/3p1pr2/2N1K4 w - - 0 1' },
  ];

  const MY_EXAMPLES_KEY = 'myExamples';

  function loadMyExamples() {
    const raw = localStorage.getItem(MY_EXAMPLES_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  function saveMyExamples(arr) {
    localStorage.setItem(MY_EXAMPLES_KEY, JSON.stringify(arr));
  }

  function showExamplesModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'modal';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => overlay.remove());

    const title = document.createElement('h2');
    title.textContent = '範例局面';

    function loadExample(fen) {
      if (state.isAnalyzing) return;
      try {
        fenToBoard(fen);
        renderPieces();
        updateStatus();
        document.getElementById('result-content').innerHTML = '';
        overlay.remove();
      } catch (e) {
        alert('FEN格式錯誤：' + e.message);
      }
    }

    const tabs = document.createElement('div');
    tabs.className = 'modal-tabs';

    const tabSystem = document.createElement('button');
    tabSystem.className = 'modal-tab active';
    tabSystem.textContent = '系統精選';

    const tabMine = document.createElement('button');
    tabMine.className = 'modal-tab';
    tabMine.textContent = '我的範例';

    const list = document.createElement('div');
    list.className = 'example-list';

    function renderSystemList() {
      list.innerHTML = '';
      for (const item of DEFAULT_EXAMPLES) {
        const row = document.createElement('div');
        row.className = 'example-item';

        const label = document.createElement('span');
        label.className = 'example-label';
        label.textContent = item.label;

        const fen = document.createElement('span');
        fen.className = 'example-fen';
        fen.textContent = item.fen;

        const loadBtn = document.createElement('button');
        loadBtn.className = 'example-load';
        loadBtn.textContent = '載入';
        loadBtn.addEventListener('click', () => loadExample(item.fen));

        row.appendChild(label);
        row.appendChild(fen);
        row.appendChild(loadBtn);
        list.appendChild(row);
      }
    }

    function renderMyList() {
      list.innerHTML = '';
      const items = loadMyExamples();
      for (let i = 0; i < items.length; i++) {
        const row = document.createElement('div');
        row.className = 'example-item';

        const label = document.createElement('span');
        label.className = 'example-label';
        label.textContent = items[i].label;

        const fen = document.createElement('span');
        fen.className = 'example-fen';
        fen.textContent = items[i].fen;

        const loadBtn = document.createElement('button');
        loadBtn.className = 'example-load';
        loadBtn.textContent = '載入';
        loadBtn.addEventListener('click', () => loadExample(items[i].fen));

        const delBtn = document.createElement('button');
        delBtn.className = 'example-del';
        delBtn.textContent = '刪除';
        delBtn.addEventListener('click', () => {
          if (state.isAnalyzing) return;
          const cur = loadMyExamples();
          cur.splice(i, 1);
          saveMyExamples(cur);
          renderMyList();
        });

        row.appendChild(label);
        row.appendChild(fen);
        row.appendChild(loadBtn);
        row.appendChild(delBtn);
        list.appendChild(row);
      }

      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'example-tip';
        empty.textContent = '尚無自訂範例，請於下方新增。';
        list.appendChild(empty);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'example-footer';
    footer.textContent = '系統精選為內建範例，隨版本更新，不可刪除。';

    const addRow = document.createElement('div');
    addRow.className = 'example-add';
    addRow.style.display = 'none';

    const labelInput = document.createElement('input');
    labelInput.className = 'example-add-name';
    labelInput.placeholder = '名稱';
    const fenInput = document.createElement('input');
    fenInput.placeholder = 'FEN 編碼';
    fenInput.style.flex = '3';

    const addBtn = document.createElement('button');
    addBtn.className = 'example-add-btn';
    addBtn.textContent = '新增';
    addBtn.addEventListener('click', () => {
      if (state.isAnalyzing) return;
      const l = labelInput.value.trim();
      const f = fenInput.value.trim();
      if (!l || !f) { alert('請輸入名稱與 FEN'); return; }
      try {
        fenToBoard(f);
      } catch (e) {
        alert('FEN格式錯誤：' + e.message);
        return;
      }
      const cur = loadMyExamples();
      cur.push({ label: l, fen: f });
      saveMyExamples(cur);
      labelInput.value = '';
      fenInput.value = '';
      renderMyList();
    });

    addRow.appendChild(labelInput);
    addRow.appendChild(fenInput);
    addRow.appendChild(addBtn);

    function setSystemTab() {
      tabSystem.classList.add('active');
      tabMine.classList.remove('active');
      renderSystemList();
      footer.style.display = '';
      addRow.style.display = 'none';
    }
    function setMyTab() {
      tabMine.classList.add('active');
      tabSystem.classList.remove('active');
      renderMyList();
      footer.style.display = 'none';
      addRow.style.display = '';
    }

    tabSystem.addEventListener('click', setSystemTab);
    tabMine.addEventListener('click', setMyTab);

    tabs.appendChild(tabSystem);
    tabs.appendChild(tabMine);

    setSystemTab();

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(tabs);
    modal.appendChild(list);
    modal.appendChild(footer);
    modal.appendChild(addRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  document.getElementById('btn-examples').addEventListener('click', showExamplesModal);
});