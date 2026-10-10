// All growing collections live in SQLite. Only scalar cursors/config stay in JS.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
export const GRAPH_LIMIT = 16777216;
export const GRAPH_EDGE_LIMIT = GRAPH_LIMIT * 8;
const digest = value => createHash('sha256').update(value).digest('hex');
let fingerprint;
export function engineFingerprint() {
  return fingerprint ??= digest(['endgame-analyze.mjs', 'endgame-database.mjs', 'endgame-disk-book.mjs',
    'endgame-incremental.mjs', 'endgame-graph.mjs', '../js/board.js', '../js/rules.js', '../js/notation.js', '../js/constants.js', '../js/geometry.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'));
}
export function databasePath(init, directory = tmpdir()) {
  return join(directory, `checkpoint-endgame-${digest(`${init} w`)}.sqlite`);
}
function validate(data) {
  if (data?.kind !== 'continuous-check-sqlite' || data.version !== 1 || data.engine !== engineFingerprint()) {
    throw new Error('連將殺資料庫版本或引擎不相容（舊 JSON 快照不能用於 SQLite 續算）');
  }
  return data;
}
export function readMetadata(path) {
  if (!existsSync(path)) throw Object.assign(new Error(`資料庫不存在：${path}`), { code: 'ENOENT' });
  const db = new DatabaseSync(path, { readOnly: true });
  try { return validate(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='analysis'").get()?.value ?? 'null')); }
  finally { db.close(); }
}
// Never archive or clone an actively owned database, even across versions.
export function assertDatabaseIdle(path) {
  let db, owner;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
  } catch { return; } // A corrupt/non-SQLite file has no usable owner record.
  finally { db?.close(); }
  if (owner) {
    try { process.kill(owner.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; }
    throw new Error(`資料庫正由程序 ${owner.pid} 使用`);
  }
}
const schema = `
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nodes(
 id INTEGER PRIMARY KEY,g INTEGER NOT NULL,fen TEXT NOT NULL,side TEXT NOT NULL,
 depth INTEGER NOT NULL,parent INTEGER,move TEXT,origin INTEGER,origin_move TEXT,
 terminal TEXT,winner TEXT,distance INTEGER,best INTEGER,remaining INTEGER,longest INTEGER,
 UNIQUE(g,fen,side));
CREATE INDEX IF NOT EXISTS nodes_graph ON nodes(g,id);
CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY,src INTEGER NOT NULL,ord INTEGER NOT NULL,
 dst INTEGER NOT NULL,move TEXT NOT NULL,UNIQUE(src,ord));
CREATE INDEX IF NOT EXISTS edges_reverse ON edges(dst,id);
CREATE TABLE IF NOT EXISTS proof_queue(node INTEGER PRIMARY KEY,distance INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS proof_distance ON proof_queue(distance,node);
CREATE TABLE IF NOT EXISTS first_work(node INTEGER PRIMARY KEY,depth INTEGER NOT NULL,active INTEGER NOT NULL,
 expanded INTEGER NOT NULL,stop INTEGER,fixed INTEGER NOT NULL DEFAULT 0,
 lower_kind INTEGER NOT NULL DEFAULT 1,lower_distance INTEGER DEFAULT 0,
 upper_kind INTEGER NOT NULL DEFAULT 3,upper_distance INTEGER DEFAULT 0,
 possibilities INTEGER NOT NULL DEFAULT 7);
CREATE INDEX IF NOT EXISTS first_frontier ON first_work(active,expanded,depth,node);
CREATE INDEX IF NOT EXISTS first_cut ON first_work(active,fixed,node) WHERE stop>0;
CREATE INDEX IF NOT EXISTS first_choices ON first_work(active,fixed,node) WHERE expanded=1;
CREATE TABLE IF NOT EXISTS stop_queue(node INTEGER PRIMARY KEY,distance INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS stop_priority ON stop_queue(distance,node);
CREATE TABLE IF NOT EXISTS first_reach(seq INTEGER PRIMARY KEY,node INTEGER UNIQUE NOT NULL,depth INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS first_batches(depth INTEGER PRIMARY KEY,before INTEGER,after INTEGER,stops INTEGER,cut_edges INTEGER,cycles INTEGER);
CREATE TABLE IF NOT EXISTS retained(seq INTEGER PRIMARY KEY,node INTEGER UNIQUE NOT NULL,parent INTEGER,move TEXT);
CREATE TABLE IF NOT EXISTS locked(fen TEXT PRIMARY KEY,move TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seeds(node INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS final_nodes(seq INTEGER PRIMARY KEY,fen TEXT NOT NULL,side TEXT NOT NULL,UNIQUE(fen,side));
CREATE TABLE IF NOT EXISTS responses(seq INTEGER PRIMARY KEY,fen TEXT UNIQUE NOT NULL,target TEXT);
CREATE TABLE IF NOT EXISTS steps(seq INTEGER PRIMARY KEY,fen TEXT UNIQUE NOT NULL,distance INTEGER NOT NULL);
`;
export class EndgameDatabase {
  constructor(path, config, { fresh = false } = {}) {
    this.path = path;
    this.statements = new Map();
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=1000; PRAGMA cache_size=-32768; PRAGMA temp_store=FILE; PRAGMA mmap_size=0;');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
      this.db.exec(schema);
      this.db.exec('BEGIN IMMEDIATE');
      const owner = this.get('SELECT pid FROM owner WHERE id=1');
      if (owner) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error(`資料庫正由程序 ${owner.pid} 使用`);
      }
      const stored = this.get("SELECT value FROM metadata WHERE key='analysis'");
      if (stored && !fresh) this.data = validate(JSON.parse(stored.value));
      else {
        if (stored && JSON.parse(stored.value).kind !== 'continuous-check-sqlite') throw new Error('拒絕覆寫非連將殺資料庫');
        for (const table of ['first_work','stop_queue','first_reach','first_batches','nodes','edges','proof_queue','retained','locked','seeds','final_nodes','responses','steps']) this.db.exec(`DELETE FROM ${table}`);
        this.data = { kind: 'continuous-check-sqlite', version: 1, engine: engineFingerprint(), ...config,
          state: { phase: 'expand1', graphs: { 1: { nodes: 0, edges: 0, cursor: 0 }, 3: { nodes: 0, edges: 0, cursor: 0 } },
            firstDepth: 2, counterDepth: 0, stats: {}, retainCursor: 0, seedCursor: 0, finalCursor: 0, stepCursor: 0 } };
      }
      Object.assign(this.data, config);
      this.run('INSERT OR REPLACE INTO owner VALUES(1,?)', process.pid);
      this.persist();
      this.db.exec('COMMIT; BEGIN IMMEDIATE');
      this.units = 0; this.lastCommit = Date.now();
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.db.close(); throw error;
    }
  }
  statement(sql) {
    if (!this.statements.has(sql)) this.statements.set(sql, this.db.prepare(sql));
    return this.statements.get(sql);
  }
  get(sql, ...params) { return this.statement(sql).get(...params); }
  all(sql, ...params) { return this.statement(sql).all(...params); }
  run(sql, ...params) { return this.statement(sql).run(...params); }
  persist() { this.run("INSERT OR REPLACE INTO metadata VALUES('analysis',?)", JSON.stringify(this.data)); }
  checkpoint() {
    this.persist(); this.db.exec('COMMIT; BEGIN IMMEDIATE');
    this.units = 0; this.lastCommit = Date.now();
  }
  // A failed transition rolls back at most the current bounded batch. Cursors
  // and graph writes are always committed in the same transaction.
  rollback() {
    this.db.exec('ROLLBACK; BEGIN IMMEDIATE');
    this.data = JSON.parse(this.get("SELECT value FROM metadata WHERE key='analysis'").value);
    this.units = 0;
  }
  tick() {
    if (++this.units >= 1024 || Date.now() - this.lastCommit >= 1000) this.checkpoint();
  }
  close() {
    if (!this.db) return;
    try {
      this.persist();
      this.run('DELETE FROM owner WHERE id=1 AND pid=?', process.pid);
      this.db.exec('COMMIT');
    } finally { this.db.close(); this.db = null; }
  }
}

// Stream only a successfully completed book. Never construct a full table or
// one enormous JSON string, even when the database holds millions of nodes.
export function* bookChunks(path, pretty = false) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA cache_size=-8192; PRAGMA mmap_size=0;');
    const data = validate(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='analysis'").get().value));
    if (data.state.phase !== 'done') throw new Error('資料庫尚未完成，不能輸出部分棋譜');
    const meta = { name: data.name, step: data.state.step, init: data.init };
    yield pretty ? `{\n  "meta": ${JSON.stringify(meta, null, 2).replaceAll('\n', '\n  ')},\n  "table": {` : `{"meta":${JSON.stringify(meta)},"table":{`;
    let first = true, buffer = '';
    for (const row of db.prepare('SELECT fen,target FROM responses ORDER BY seq').iterate()) {
      buffer += `${first ? '' : ','}${pretty ? '\n    ' : ''}${JSON.stringify(row.fen)}:${pretty ? ' ' : ''}${JSON.stringify(row.target)}`;
      first = false;
      if (buffer.length >= 65536) { yield buffer; buffer = ''; }
    }
    if (buffer) yield buffer;
    yield pretty ? '\n  }\n}\n' : '}}\n';
  } finally { db.close(); }
}
