import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const VERSION = 2;
const digest = text => createHash('sha256').update(text).digest('hex');
// Input is the normalized board-only FEN; all books start with red to move.
export function automaticCheckpointPath(init, directory = tmpdir()) {
  return join(directory, `checkpoint-${digest(`${init} w`)}.json`);
}
let fingerprint;
function engineFingerprint() {
  return fingerprint ??= digest([
    'game-analyze.mjs', 'game-solver.mjs', 'game-retrograde.mjs', 'game-steps.mjs', 'game-checkpoint.mjs',
    '../js/board.js', '../js/rules.js', '../js/notation.js', '../js/constants.js', '../js/geometry.js',
  ].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'));
}

export function readCheckpoint(path) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (file.version !== VERSION) throw new Error('工作快照版本不相容');
  if (file.engine !== engineFingerprint()) throw new Error('工作快照與目前引擎版本不相容');
  if (file.checksum !== digest(JSON.stringify(file.data))) throw new Error('工作快照校驗失敗');
  const d = file.data;
  if (!d || typeof d.name !== 'string' || typeof d.init !== 'string' ||
      !Number.isSafeInteger(d.depth) || !d.progress || !d.solver ||
      !Array.isArray(d.progress.pending) || !Array.isArray(d.progress.discovered) ||
      !Array.isArray(d.solver.proofs) || !Array.isArray(d.solver.transient) ||
      !Array.isArray(d.solver.iterations)) throw new Error('工作快照格式錯誤');
  return d;
}

// Replace atomically, so an interrupted write cannot destroy the last snapshot.
// Snapshots are local work files, never the public game-book JSON format.
export function writeCheckpoint(path, data) {
  const payload = JSON.stringify(data);
  const contents = JSON.stringify({ version: VERSION, engine: engineFingerprint(),
    checksum: digest(payload), data });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    const fd = openSync(temporary, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
