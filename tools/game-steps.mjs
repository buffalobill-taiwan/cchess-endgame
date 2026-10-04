import { parseFen, boardToFen } from '../js/notation.js';
import { applyBoardCopy, findKings } from '../js/board.js';
import { generateLegalMoves } from '../js/rules.js';

// The table already fixes black's response. Each edge costs one red move, so
// BFS finds the shortest route from the initial position to a null (red win).
// Visited positions make cyclic games finite without counting loops as wins.
export function countWinningSteps(init, table, checkDeadline = () => {}) {
  checkDeadline();
  if (!Object.values(table).includes(null)) return null;
  const pending = [{ fen: init, steps: 0 }];
  const visited = new Set([init]);
  for (let i = 0; i < pending.length; i++) {
    checkDeadline();
    const { fen, steps } = pending[i];
    const { board } = parseFen(fen);
    const kings = findKings(board);
    if (!kings.red || !kings.black) continue;
    for (const move of generateLegalMoves(board, 'red')) {
      checkDeadline();
      const afterRed = boardToFen(applyBoardCopy(board, move)).split(' ')[0];
      if (!Object.hasOwn(table, afterRed)) throw new Error(`應手表缺少局面：${afterRed}`);
      const next = table[afterRed];
      if (next === null) return steps + 1;
      if (!visited.has(next)) {
        visited.add(next);
        pending.push({ fen: next, steps: steps + 1 });
      }
    }
  }
  return null;
}
