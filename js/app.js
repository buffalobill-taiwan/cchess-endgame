// ═══════════════════════════════════════════
// MAIN ANALYZE + INIT
// ═══════════════════════════════════════════

import { MAX_DEPTH, DEFAULT_DEPTH } from './constants.js';
import { state, initBoard } from './state.js';
import { parseFen, deepCopyBoard, analyzePosition } from './engine.js';
import { renderBoard, renderPalette, setupDragDrop, updateStatus, renderPieces, showResult } from './ui.js';
import { setupExamplesButton } from './example-modal.js';

const LOCKABLE_IDS = ['btn-import-fen', 'btn-examples'];
function lockControls(lock) {
  for (const id of LOCKABLE_IDS) document.getElementById(id).disabled = lock;
  document.getElementById('depth-slider').disabled = lock;
}

function loadFenIntoState(fen) {
  const { board, sideToMove } = parseFen(fen);
  if (sideToMove !== 'w') throw new Error('本工具固定以紅方（w）作為分析方');
  state.board = board;
  state.pieceCount = board.flat().filter(Boolean).length;
}

function setResultMessage(message) {
  const content = document.getElementById('result-content');
  const p = document.createElement('p');
  p.textContent = message;
  content.replaceChildren(p);
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
      const res = await analyzePosition(initialBoard, {
        depth,
        continuousCheck: state.continuousCheck,
        isCancelled: () => state.interruptRequested,
      });
      const msg = {
        noKing: '請先擺放紅黑將帥',
        redMated: '紅方死棋，黑方勝',
        redStalemated: '紅方困斃，黑方勝',
      }[res.status];
      if (msg) { setResultMessage(msg); return; }
      showResult(res.tree, res.interrupted ? 0 : res.score, res.interrupted, initialBoard);
    } catch (e) {
      setResultMessage(`分析錯誤：${e.message}`);
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
      loadFenIntoState(fen);
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

  setupExamplesButton();
});
