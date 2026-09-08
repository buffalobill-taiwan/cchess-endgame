// ═══════════════════════════════════════════
// ZOBRIST HASHING
// ═══════════════════════════════════════════

import { ROWS, COLS } from './constants.js';

// ─── Piece index: {color, type} → 0..13 ───

const PIECE_INDEX = {
  red:   { king:0, advisor:1, elephant:2, horse:3, chariot:4, cannon:5, soldier:6 },
  black: { king:7, advisor:8, elephant:9, horse:10, chariot:11, cannon:12, soldier:13 },
};

// ─── Random key tables (generated once at load) ───

function rand32() { return Math.floor(Math.random() * 0x100000000) | 0; }

const NUM_PIECE_TYPES = 14;
const NUM_SQUARES = ROWS * COLS; // 90

const ZOBRIST_PIECE_LO = new Array(NUM_PIECE_TYPES);
const ZOBRIST_PIECE_HI = new Array(NUM_PIECE_TYPES);
for (let i = 0; i < NUM_PIECE_TYPES; i++) {
  ZOBRIST_PIECE_LO[i] = new Int32Array(NUM_SQUARES);
  ZOBRIST_PIECE_HI[i] = new Int32Array(NUM_SQUARES);
  for (let s = 0; s < NUM_SQUARES; s++) {
    ZOBRIST_PIECE_LO[i][s] = rand32();
    ZOBRIST_PIECE_HI[i][s] = rand32();
  }
}

const ZOBRIST_SIDE_LO = rand32();
const ZOBRIST_SIDE_HI = rand32();
const ZOBRIST_CC_LO = rand32();
const ZOBRIST_CC_HI = rand32();

// ─── Compute Zobrist from a full board ───

export function zobristFromBoard(board, color, continuousCheck) {
  let lo = 0, hi = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) continue;
      const idx = PIECE_INDEX[p.color][p.type];
      const sq = r * COLS + c;
      lo ^= ZOBRIST_PIECE_LO[idx][sq];
      hi ^= ZOBRIST_PIECE_HI[idx][sq];
    }
  }
  // side to move
  if (color === 'black') {
    lo ^= ZOBRIST_SIDE_LO;
    hi ^= ZOBRIST_SIDE_HI;
  }
  // continuous check flag
  if (continuousCheck) {
    lo ^= ZOBRIST_CC_LO;
    hi ^= ZOBRIST_CC_HI;
  }
  return { lo, hi };
}

// ─── Export tables for makeMove/unmakeMove in rules.js ───

export { PIECE_INDEX, ZOBRIST_PIECE_LO, ZOBRIST_PIECE_HI, ZOBRIST_SIDE_LO, ZOBRIST_SIDE_HI };
