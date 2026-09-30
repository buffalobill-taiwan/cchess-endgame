// ═══════════════════════════════════════════
// EXAMPLE POSITION MODAL
// ═══════════════════════════════════════════

import { state } from './state.js';
import { parseFen } from './notation.js';
import { renderPieces, updateStatus } from './ui.js';
import { loadExamples, saveExamples } from './example-store.js';

function loadFenIntoState(fen) {
  const { board, sideToMove } = parseFen(fen);
  if (sideToMove !== 'w') throw new Error('本工具固定以紅方（w）作為分析方');
  state.board = board;
  state.pieceCount = board.flat().filter(Boolean).length;
}

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
      loadFenIntoState(fen);
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
    const items = loadExamples();
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
        const cur = loadExamples();
        cur.splice(i, 1);
        try {
          saveExamples(cur);
        } catch (e) {
          alert(e.message);
          return;
        }
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
      loadFenIntoState(f);
    } catch (e) {
      alert('FEN格式錯誤：' + e.message);
      return;
    }
    try {
      const cur = loadExamples();
      cur.push({ label: l, fen: f });
      saveExamples(cur);
    } catch (e) {
      alert(e.message);
      return;
    }
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



export function setupExamplesButton() {
  document.getElementById('btn-examples').addEventListener('click', showExamplesModal);
}
