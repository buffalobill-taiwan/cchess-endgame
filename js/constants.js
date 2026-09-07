export const ROWS = 10, COLS = 9, CELL = 54, PAD = 30;
export const W = PAD * 2 + (COLS - 1) * CELL;
export const H = PAD * 2 + (ROWS - 1) * CELL;

export const CHARS = {
  red:   { king:'帥', advisor:'仕', elephant:'相', horse:'傌', chariot:'俥', cannon:'炮', soldier:'兵' },
  black: { king:'將', advisor:'士', elephant:'象', horse:'馬', chariot:'車', cannon:'砲', soldier:'卒' },
};

export const PIECE_VALUES = { king:10000, chariot:900, cannon:450, horse:400, elephant:200, advisor:200, soldier:100 };
export const MATE_VAL = 100000, INF = 999999;
export const TYPES = ['chariot','horse','cannon','advisor','elephant','soldier','king'];