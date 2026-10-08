import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const digest = text => createHash('sha256').update(text).digest('hex');
let fingerprint;
function engine() {
  return fingerprint ??= digest(['endgame-analyze.mjs', 'endgame-book.mjs', 'endgame-graph.mjs',
    'endgame-checkpoint.mjs', '../js/board.js', '../js/rules.js',
    '../js/notation.js', '../js/constants.js', '../js/geometry.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'));
}
export function checkpointPath(init, directory = tmpdir()) {
  return join(directory, `checkpoint-endgame-${digest(`${init} w`)}.json`);
}
export function readCheckpoint(path) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (file.kind !== 'continuous-check-book' || file.version !== 1 || file.engine !== engine()) {
    throw new Error('連將殺快照版本或引擎不相容');
  }
  if (file.checksum !== digest(JSON.stringify(file.data))) throw new Error('連將殺快照校驗失敗');
  const d = file.data;
  if (!d || typeof d.name !== 'string' || typeof d.init !== 'string' || d.state?.init !== d.init ||
      !Array.isArray(d.state.first?.nodes) || !Array.isArray(d.state.counter?.nodes) ||
      !['expand1', 'solve1', 'prune', 'seeds', 'expand3', 'solve3', 'validate', 'export', 'steps', 'done'].includes(d.state.phase) ||
      ![d.depth, d.graphNodes, d.graphEdges].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('連將殺快照格式錯誤');
  }
  return d;
}
export function writeCheckpoint(path, data) {
  const contents = JSON.stringify({ kind: 'continuous-check-book', version: 1, engine: engine(),
    checksum: digest(JSON.stringify(data)), data });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    const fd = openSync(temporary, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
