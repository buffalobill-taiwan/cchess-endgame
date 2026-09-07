import { ROWS, COLS } from './constants.js';

export const state = {
  board: [],
  redKingPos: null,
  blackKingPos: null,
  pieceCount: 0,
  isAnalyzing: false,
  interruptRequested: false,
  continuousCheck: false,
  _dragDropProcessed: false,
};

export function initBoard() {
  state.board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  state.redKingPos = null;
  state.blackKingPos = null;
  state.pieceCount = 0;
}
initBoard();

// ─── helpers ───
export function opp(c) { return c === 'red' ? 'black' : 'red'; }
export function movesEqual(a, b) { return a.from.row===b.from.row && a.from.col===b.from.col && a.to.row===b.to.row && a.to.col===b.to.col; }
export function inPalace(row, col, color) {
  if (col < 3 || col > 5) return false;
  return color === 'red' ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
}
export function onOwnSide(row, color) { return color === 'red' ? row >= 5 : row <= 4; }