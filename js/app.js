// ═══════════════════════════════════════════
// MAIN ANALYZE + INIT
// ═══════════════════════════════════════════

import { MATE_VAL } from './constants.js';
import { state, initBoard, movesEqual } from './state.js';
import { isInCheck, isCheckmate, isStalemate, generateLegalMoves } from './rules.js';
import { moveToNotation, fenToBoard } from './notation.js';
import { searchRootAsync, findRefutation } from './search.js';
import { deepCopyBoard, applyBoardCopy, syncKingPos, pvToTree } from './tree.js';
import { renderBoard, renderPalette, setupDragDrop, updateStatus, renderPieces, showResult } from './ui.js';

function analyze() {
  if (state.isAnalyzing) return;
  if (!state.redKingPos || !state.blackKingPos) {
    document.getElementById('result-content').innerHTML = '<p>請先擺放紅黑將帥</p>';
    return;
  }
  if (isCheckmate(state.board, 'red')) {
    document.getElementById('result-content').innerHTML = '<p>紅方死棋，黑方勝</p>';
    return;
  }
  if (isStalemate(state.board, 'red')) {
    document.getElementById('result-content').innerHTML = '<p>紅方困斃，黑方勝</p>';
    return;
  }

  state.continuousCheck = document.getElementById('chk-continuous-check').checked;
  document.getElementById('chk-continuous-check').disabled = true;
  document.querySelector('.chk-row').classList.add('disabled');

  state.isAnalyzing = true;
  state.interruptRequested = false;
  updateStatus();
  const btn = document.getElementById('btn-analyze');
  btn.textContent = '分析中...';
  document.getElementById('btn-interrupt').style.display = '';
  document.getElementById('result-content').innerHTML = '<p>分析中，請稍候...</p>';

  const initialBoard = deepCopyBoard(state.board);
  const boardCopy = deepCopyBoard(state.board);
  const depth = parseInt(document.getElementById('depth-slider').value);
  (async () => {
    try {
      const result = await searchRootAsync(boardCopy, depth, 15000);
      let tree = null;
      if (result && result.move) {
        const isMateScore = Math.abs(result.score) > MATE_VAL / 2;
        if (state.continuousCheck && !isMateScore) {
          tree = null;
        } else if (isMateScore && result.score < 0) {
          tree = { move: null, notation: '', color: 'red', isMate: false, isStalemate: false, children: [], board: null };
          let redMoves = generateLegalMoves(boardCopy, 'red');
          if (state.continuousCheck) {
            redMoves = redMoves.filter(m => {
              const nb = applyBoardCopy(boardCopy, m);
              const savedRK = state.redKingPos, savedBK = state.blackKingPos;
              syncKingPos(nb);
              const givesCheck = isInCheck(nb, 'black');
              state.redKingPos = savedRK; state.blackKingPos = savedBK;
              return givesCheck;
            });
          }
          for (const rm of redMoves) {
            if (state.interruptRequested) break;
            const rmBoard = applyBoardCopy(boardCopy, rm);
            const savedRK = state.redKingPos;
            const savedBK = state.blackKingPos;
            state.redKingPos = savedRK;
            state.blackKingPos = savedBK;
            syncKingPos(rmBoard);
            const rmMate = isCheckmate(rmBoard, 'black');
            const rmStale = isStalemate(rmBoard, 'black');
            if (rmMate || rmStale) {
              tree.children.push({
                move: rm, notation: moveToNotation(boardCopy, rm, 'red'),
                color: 'red', isMate: rmMate, isStalemate: rmStale,
                children: [], board: deepCopyBoard(rmBoard)
              });
            } else {
              const ref = await findRefutation(rmBoard, 'black', Math.max(4, depth - 2), Date.now(), 5000);
              const refChildren = [];
              if (ref && ref.move) {
                const refBoard = applyBoardCopy(rmBoard, ref.move);
                syncKingPos(refBoard);
                let losingMoves = generateLegalMoves(refBoard, 'red');
                if (state.continuousCheck) {
                  losingMoves = losingMoves.filter(mm => {
                    const nnb = applyBoardCopy(refBoard, mm);
                    const savedRK = state.redKingPos, savedBK = state.blackKingPos;
                    syncKingPos(nnb);
                    const givesCheck = isInCheck(nnb, 'black');
                    state.redKingPos = savedRK; state.blackKingPos = savedBK;
                    return givesCheck;
                  });
                }
                const refFollowups = await Promise.all(losingMoves.map(async rr => {
                  const rrBoard = applyBoardCopy(refBoard, rr);
                  syncKingPos(rrBoard);
                  const ref2 = await findRefutation(rrBoard, 'black', Math.max(4, depth - 4), Date.now(), 5000);
                  const children2 = [];
                  if (ref2 && ref2.move && Math.abs(ref2.score) > MATE_VAL / 2) {
                    const ref2Board = applyBoardCopy(rrBoard, ref2.move);
                    syncKingPos(ref2Board);
                    const ref2Children = [];
                    if (ref2.pv && ref2.pv.length > 1) {
                      const oppMove = ref2.pv[1];
                      const oppBoard = applyBoardCopy(ref2Board, oppMove);
                      syncKingPos(oppBoard);
                      const ref2Sub = ref2.pv.length > 2
                        ? await pvToTree(oppBoard, ref2.pv.slice(2), 'black', 3, depth, Date.now())
                        : null;
                      ref2Children.push({
                        move: oppMove, notation: moveToNotation(ref2Board, oppMove, 'red'),
                        color: 'red',
                        isMate: isCheckmate(oppBoard, 'black'),
                        isStalemate: isStalemate(oppBoard, 'black'),
                        children: ref2Sub ? [ref2Sub] : [],
                        board: deepCopyBoard(oppBoard)
                      });
                    }
                    children2.push({
                      move: ref2.move, notation: moveToNotation(rrBoard, ref2.move, 'black'),
                      color: 'black',
                      isMate: isCheckmate(ref2Board, 'red'),
                      isStalemate: isStalemate(ref2Board, 'red'),
                      children: ref2Children,
                      board: deepCopyBoard(ref2Board)
                    });
                  }
                  return {
                    move: rr, notation: moveToNotation(refBoard, rr, 'red'),
                    color: 'red',
                    isMate: isCheckmate(rrBoard, 'black'),
                    isStalemate: isStalemate(rrBoard, 'black'),
                    children: children2,
                    board: deepCopyBoard(rrBoard)
                  };
                }));
                refChildren.push({
                  move: ref.move, notation: moveToNotation(rmBoard, ref.move, 'black'),
                  color: 'black', isMate: isCheckmate(refBoard, 'red'),
                  isStalemate: isStalemate(refBoard, 'red'),
                  children: refFollowups,
                  board: deepCopyBoard(refBoard)
                });
              }
              state.redKingPos = savedRK;
              state.blackKingPos = savedBK;
              syncKingPos(rmBoard);
              if (refChildren.length === 0) continue;
              tree.children.push({
                move: rm, notation: moveToNotation(boardCopy, rm, 'red'),
                color: 'red', isMate: isCheckmate(rmBoard, 'black'),
                isStalemate: isStalemate(rmBoard, 'black'),
                children: refChildren,
                board: deepCopyBoard(rmBoard)
              });
            }
          }
        } else {
          const nb = applyBoardCopy(boardCopy, result.move);
          syncKingPos(nb);
          const isMateEnd = isCheckmate(nb, 'black');
          const isStalemateEnd = isStalemate(nb, 'black');
          const restPV = result.pv.slice(1);
          tree = {
            move: result.move, notation: moveToNotation(boardCopy, result.move, 'red'),
            color: 'red', isMate: isMateEnd, isStalemate: isStalemateEnd, children: [],
            board: deepCopyBoard(nb)
          };

          const blackMoves = generateLegalMoves(nb, 'black');
          for (const bm of blackMoves) {
            if (state.interruptRequested) break;
            const bmBoard = applyBoardCopy(nb, bm);
            const savedRK = state.redKingPos;
            const savedBK = state.blackKingPos;
            const isPV = restPV.length > 0 && movesEqual(bm, restPV[0]);

            let childNode;
            if (isPV) {
              const sub = await pvToTree(bmBoard, restPV.slice(1), 'red', 1, depth, Date.now());
              state.redKingPos = savedRK;
              state.blackKingPos = savedBK;
              syncKingPos(bmBoard);
              childNode = {
                move: bm, notation: moveToNotation(nb, bm, 'black'),
                color: 'black', isMate: isCheckmate(bmBoard, 'red'),
                isStalemate: isStalemate(bmBoard, 'red'),
                children: sub ? [sub] : [],
                board: deepCopyBoard(bmBoard)
              };
              if (!childNode.isMate && !childNode.isStalemate && childNode.children.length === 0) {
                syncKingPos(bmBoard);
                const mate = isCheckmate(bmBoard, 'red');
                const stale = isStalemate(bmBoard, 'red');
                if (mate) childNode.isMate = true;
                else if (stale) childNode.isStalemate = true;
                else childNode.interrupted = true;
              }
            } else {
              state.redKingPos = savedRK;
              state.blackKingPos = savedBK;
              syncKingPos(bmBoard);
              const bmMate = isCheckmate(bmBoard, 'red');
              const bmStale = isStalemate(bmBoard, 'red');
              if (bmMate || bmStale) {
                childNode = {
                  move: bm, notation: moveToNotation(nb, bm, 'black'),
                  color: 'black', isMate: bmMate, isStalemate: bmStale,
                  children: [], board: deepCopyBoard(bmBoard)
                };
              } else {
                const ref = await findRefutation(bmBoard, 'red', Math.max(4, depth - 2), Date.now(), 5000);
                const refChildren = [];
                if (ref && ref.move) {
                  const refBoard = applyBoardCopy(bmBoard, ref.move);
                  syncKingPos(refBoard);
                  const losingMoves = generateLegalMoves(refBoard, 'black');
                  const refFollowups = await Promise.all(losingMoves.map(async bm2 => {
                    const bm2Board = applyBoardCopy(refBoard, bm2);
                    syncKingPos(bm2Board);
                    const ref2 = await findRefutation(bm2Board, 'red', Math.max(4, depth - 4), Date.now(), 5000);
                    const children2 = [];
                    if (ref2 && ref2.move && Math.abs(ref2.score) > MATE_VAL / 2) {
                      const ref2Board = applyBoardCopy(bm2Board, ref2.move);
                      syncKingPos(ref2Board);
                      const ref2Children = [];
                      if (ref2.pv && ref2.pv.length > 1) {
                        const oppMove = ref2.pv[1];
                        const oppBoard = applyBoardCopy(ref2Board, oppMove);
                        syncKingPos(oppBoard);
                        const ref2Sub = ref2.pv.length > 2
                          ? await pvToTree(oppBoard, ref2.pv.slice(2), 'red', 3, depth, Date.now())
                          : null;
                        ref2Children.push({
                          move: oppMove, notation: moveToNotation(ref2Board, oppMove, 'black'),
                          color: 'black',
                          isMate: isCheckmate(oppBoard, 'red'),
                          isStalemate: isStalemate(oppBoard, 'red'),
                          children: ref2Sub ? [ref2Sub] : [],
                          board: deepCopyBoard(oppBoard)
                        });
                      }
                      children2.push({
                        move: ref2.move, notation: moveToNotation(bm2Board, ref2.move, 'red'),
                        color: 'red',
                        isMate: isCheckmate(ref2Board, 'black'),
                        isStalemate: isStalemate(ref2Board, 'black'),
                        children: ref2Children,
                        board: deepCopyBoard(ref2Board)
                      });
                    }
                    return {
                      move: bm2, notation: moveToNotation(refBoard, bm2, 'black'),
                      color: 'black',
                      isMate: isCheckmate(bm2Board, 'red'),
                      isStalemate: isStalemate(bm2Board, 'red'),
                      children: children2,
                      board: deepCopyBoard(bm2Board)
                    };
                  }));
                  refChildren.push({
                    move: ref.move, notation: moveToNotation(bmBoard, ref.move, 'red'),
                    color: 'red', isMate: isCheckmate(refBoard, 'black'),
                    isStalemate: isStalemate(refBoard, 'black'),
                    children: refFollowups,
                    board: deepCopyBoard(refBoard)
                  });
                }
                state.redKingPos = savedRK;
                state.blackKingPos = savedBK;
                syncKingPos(bmBoard);
                if (refChildren.length === 0) continue;
                childNode = {
                  move: bm, notation: moveToNotation(nb, bm, 'black'),
                  color: 'black', isMate: isCheckmate(bmBoard, 'red'),
                  isStalemate: isStalemate(bmBoard, 'red'),
                  children: refChildren,
                  board: deepCopyBoard(bmBoard)
                };
              }
            }
            tree.children.push(childNode);
          }
        }
      }
      const wasInterrupted = state.interruptRequested;
      showResult(tree, wasInterrupted ? 0 : (result ? result.score : 0), wasInterrupted, initialBoard);
    } catch (e) {
      document.getElementById('result-content').innerHTML = `<p>分析錯誤：${e.message}</p>`;
    } finally {
      state.isAnalyzing = false;
      state.interruptRequested = false;
      document.getElementById('chk-continuous-check').disabled = false;
      document.querySelector('.chk-row').classList.remove('disabled');
      btn.textContent = '分析';
      document.getElementById('btn-interrupt').style.display = 'none';
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

  document.getElementById('btn-analyze').addEventListener('click', analyze);
  document.getElementById('btn-interrupt').addEventListener('click', () => {
    state.interruptRequested = true;
  });
  document.getElementById('depth-slider').addEventListener('input', function() {
    document.getElementById('depth-value').textContent = this.value;
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (state.isAnalyzing) return;
    initBoard();
    renderPieces();
    setupDragDrop();
    updateStatus();
    document.getElementById('result-content').innerHTML = '';
  });

  document.getElementById('btn-import-fen').addEventListener('click', () => {
    const fen = prompt('請輸入FEN編碼：');
    if (!fen) return;
    try {
      fenToBoard(fen);
      renderPieces();
      setupDragDrop();
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
    { label: '範例1', fen: '3k2c2/1P2n1N2/4bP3/9/9/9/r6R1/3p5/4p4/3K3C1 w - - 0 1' },
    { label: '範例2', fen: '1rbak3r/1N1Ra4/cR2b1N2/9/9/9/9/9/5p3/4K4 w - - 0 1' },
    { label: '範例3', fen: '2bk3cc/r3aR3/n1r1b4/9/9/6R2/9/3n5/4p4/1C3K3 w - - 0 1' },
    { label: '範例4', fen: '4k2P1/5P3/c8/9/9/3c4R/4r3C/B3p4/4p4/3K5 w - - 0 1' },
    { label: '範例5', fen: '3a1aC2/2PcPn3/2nkb3R/7C1/6b2/9/9/9/5p3/2rAK1p2 w - - 0 1' },
    { label: '範例6', fen: '9/9/3a1k3/6P2/9/9/3r5/2n3r2/C8/4K1p2 w - - 0 1' },
    { label: '範例7', fen: '3rka1R1/4aR3/4b4/9/9/9/6r2/7C1/3p5/c1BA1K3 w - - 0 1' },
    { label: '範例8', fen: '9/4a4/3a1k3/2r3R2/1n5N1/c7C/1n5N1/2r3R2/3p1p3/4K4 w - - 0 1' },
  ];

  function loadExamples() {
    const raw = localStorage.getItem('examples');
    if (!raw) {
      saveExamples(DEFAULT_EXAMPLES);
      return DEFAULT_EXAMPLES.slice();
    }
    try { return JSON.parse(raw); } catch { return DEFAULT_EXAMPLES.slice(); }
  }

  function saveExamples(arr) {
    localStorage.setItem('examples', JSON.stringify(arr));
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

    const list = document.createElement('div');
    function renderList() {
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
        loadBtn.addEventListener('click', () => {
          try {
            fenToBoard(items[i].fen);
            renderPieces();
            setupDragDrop();
            updateStatus();
            document.getElementById('result-content').innerHTML = '';
            overlay.remove();
          } catch (e) {
            alert('FEN格式錯誤：' + e.message);
          }
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'example-del';
        delBtn.textContent = '刪除';
        delBtn.addEventListener('click', () => {
          const cur = loadExamples();
          cur.splice(i, 1);
          saveExamples(cur);
          renderList();
        });

        row.appendChild(label);
        row.appendChild(fen);
        row.appendChild(loadBtn);
        row.appendChild(delBtn);
        list.appendChild(row);
      }

      const addRow = document.createElement('div');
      addRow.className = 'example-add';

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
        const l = labelInput.value.trim();
        const f = fenInput.value.trim();
        if (!l || !f) { alert('請輸入名稱與 FEN'); return; }
        try {
          fenToBoard(f);
          fenToBoard(f);
        } catch (e) {
          alert('FEN格式錯誤：' + e.message);
          return;
        }
        const cur = loadExamples();
        cur.push({ label: l, fen: f });
        saveExamples(cur);
        renderList();
      });

      addRow.appendChild(labelInput);
      addRow.appendChild(fenInput);
      addRow.appendChild(addBtn);
      list.appendChild(addRow);
    }
    renderList();

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(list);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  document.getElementById('btn-examples').addEventListener('click', showExamplesModal);
});