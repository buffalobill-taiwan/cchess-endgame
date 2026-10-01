// Browser session state; never imported by the engine.
import { ROWS, COLS } from './constants.js';

export const state = {
  board: [],
  pieceCount: 0,
  isAnalyzing: false,
  interruptRequested: false,
  continuousCheck: false,
};

export function initBoard() {
  state.board = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  state.pieceCount = 0;
}
initBoard();
