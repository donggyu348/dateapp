// 저장소: DATABASE_URL이 있으면 PostgreSQL, 없으면 data.json 파일
// 서버는 메모리의 db 객체로 동작하고, save()가 호출되면 바뀐 레코드만 모아서 저장한다.
// (서버 인스턴스 1개 기준 — 여러 대로 늘리려면 쿼리 기반으로 바꿔야 함)
const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['users', 'sessions', 'teams', 'posts', 'matches', 'feed'];
const emptyDb = () => Object.fromEntries(COLLECTIONS.map(c => [c, {}]));

async function createStore({ dataDir }) {
  return process.env.DATABASE_URL ? createPgStore(process.env.DATABASE_URL) : createFileStore(dataDir);
}

// ---------- 파일 (로컬 개발용) ----------
function createFileStore(dataDir) {
  const file = path.join(dataDir, 'data.json');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = emptyDb();
  const isNew = !fs.existsSync(file);
  if (!isNew) Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8')));

  let timer = null;
  const writeNow = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  return {
    kind: `파일 (${file})`,
    db,
    isNew,
    save() { clearTimeout(timer); timer = setTimeout(writeNow, 100); },
    async flush() { clearTimeout(timer); writeNow(); },
    async putUpload(name, mime, buf) { fs.writeFileSync(path.join(uploadDir, name), buf); },
    async getUpload(name) {
      const p = path.join(uploadDir, name);
      return fs.existsSync(p) ? { buf: fs.readFileSync(p) } : null;
    },
  };
}

// ---------- PostgreSQL (배포용: Supabase / Neon / Railway 등) ----------
async function createPgStore(url) {
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      name TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const db = emptyDb();
  const snapshot = new Map(); // "collection/id" -> 마지막으로 저장된 JSON
  const { rows } = await pool.query('SELECT collection, id, data FROM records');
  for (const r of rows) {
    if (!db[r.collection]) continue;
    db[r.collection][r.id] = r.data;
    snapshot.set(`${r.collection}/${r.id}`, JSON.stringify(r.data));
  }

  async function writeChanges() {
    const up = { c: [], id: [], data: [] };
    const seen = new Set();
    for (const c of COLLECTIONS) {
      for (const [id, rec] of Object.entries(db[c])) {
        const key = `${c}/${id}`;
        const json = JSON.stringify(rec);
        seen.add(key);
        if (snapshot.get(key) !== json) { up.c.push(c); up.id.push(id); up.data.push(json); }
      }
    }
    const del = [...snapshot.keys()].filter(k => !seen.has(k)).map(k => k.split('/'));
    if (!up.id.length && !del.length) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (up.id.length) {
        await client.query(
          `INSERT INTO records (collection, id, data)
           SELECT * FROM unnest($1::text[], $2::text[], $3::jsonb[])
           ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [up.c, up.id, up.data],
        );
      }
      if (del.length) {
        await client.query(
          `DELETE FROM records WHERE (collection, id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
          [del.map(d => d[0]), del.map(d => d[1])],
        );
      }
      await client.query('COMMIT');
      up.id.forEach((id, i) => snapshot.set(`${up.c[i]}/${id}`, up.data[i]));
      del.forEach(([c, id]) => snapshot.delete(`${c}/${id}`));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // 저장은 한 번에 하나씩, 저장 중에 또 바뀌면 끝난 뒤 한 번 더
  let timer = null, running = null, again = false;
  const run = () => {
    if (running) { again = true; return running; }
    running = writeChanges()
      .catch(e => console.error('DB 저장 실패 (다음 저장 때 재시도):', e.message))
      .finally(() => { running = null; if (again) { again = false; run(); } });
    return running;
  };

  return {
    kind: `PostgreSQL (${new URL(url).hostname})`,
    db,
    isNew: rows.length === 0,
    save() { clearTimeout(timer); timer = setTimeout(run, 150); },
    async flush() { clearTimeout(timer); await run(); if (running) await running; await pool.end(); },
    async putUpload(name, mime, buf) {
      await pool.query('INSERT INTO uploads (name, mime, data) VALUES ($1, $2, $3)', [name, mime, buf]);
    },
    async getUpload(name) {
      const { rows } = await pool.query('SELECT mime, data FROM uploads WHERE name = $1', [name]);
      return rows[0] ? { mime: rows[0].mime, buf: rows[0].data } : null;
    },
  };
}

module.exports = { createStore };
