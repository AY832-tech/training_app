'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- 認証 ----
// APP_PASSWORD が設定されていれば有効。未設定（ローカル開発）なら認証なし。
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_ENABLED = APP_PASSWORD.length > 0;
// パスワードから決まる Cookie トークン（パスワードを知らないと作れない）
const SESSION_TOKEN = AUTH_ENABLED
  ? crypto.createHmac('sha256', APP_PASSWORD).update('muscle-app-session-v1').digest('hex')
  : '';
const COOKIE = `session=${SESSION_TOKEN}; HttpOnly; Path=/; Max-Age=15552000; SameSite=Lax`;

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  const tok = parseCookies(req).session || '';
  // タイミング攻撃対策に固定長比較
  return tok.length === SESSION_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(SESSION_TOKEN));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) reject(new Error('payload too large')); });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const num = (v, d = 0) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
const idn = (v) => Number(v); // BigInt -> Number

// セットを各ワークアウトに付与
async function attachSets(workouts) {
  for (const w of workouts) {
    w.sets = await db.q(`
      SELECT ws.*, e.name AS exercise_name, e.unit, e.category
      FROM workout_sets ws JOIN exercises e ON e.id = ws.exercise_id
      WHERE ws.workout_id = ? ORDER BY ws.set_order, ws.id`, [w.id]);
  }
  return workouts;
}

// ---- API ハンドラ（すべて async）----
const api = {
  'GET /api/exercises': async () =>
    db.q('SELECT * FROM exercises ORDER BY category, name'),

  'POST /api/exercises': async (b) => {
    const r = await db.run('INSERT INTO exercises (name, category, unit) VALUES (?, ?, ?)',
      [String(b.name || '').trim(), String(b.category || 'その他'), String(b.unit || 'kg')]);
    return db.one('SELECT * FROM exercises WHERE id = ?', [idn(r.lastInsertRowid)]);
  },

  'DELETE /api/exercises/:id': async (b, p) => {
    await db.run('DELETE FROM exercises WHERE id = ?', [p.id]);
    return { ok: true };
  },

  'GET /api/workouts': async (b, p, query) => {
    const from = query.from || '0000-01-01';
    const to = query.to || '9999-12-31';
    const ws = await db.q('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', [from, to]);
    return attachSets(ws);
  },

  'POST /api/workouts': async (b) => {
    const r = await db.run('INSERT INTO workouts (date, note) VALUES (?, ?)', [b.date, String(b.note || '')]);
    const wid = idn(r.lastInsertRowid);
    if ((b.sets || []).length) {
      await db.batch(b.sets.map((s, i) => ({
        sql: 'INSERT INTO workout_sets (workout_id, exercise_id, set_order, weight, reps) VALUES (?, ?, ?, ?, ?)',
        args: [wid, s.exercise_id, i, num(s.weight), num(s.reps)],
      })));
    }
    return (await attachSets(await db.q('SELECT * FROM workouts WHERE id = ?', [wid])))[0];
  },

  'PUT /api/workouts/:id': async (b, p) => {
    const id = idn(p.id);
    const stmts = [
      { sql: 'UPDATE workouts SET date = ?, note = ? WHERE id = ?', args: [b.date, String(b.note || ''), id] },
      { sql: 'DELETE FROM workout_sets WHERE workout_id = ?', args: [id] },
      ...(b.sets || []).map((s, i) => ({
        sql: 'INSERT INTO workout_sets (workout_id, exercise_id, set_order, weight, reps) VALUES (?, ?, ?, ?, ?)',
        args: [id, s.exercise_id, i, num(s.weight), num(s.reps)],
      })),
    ];
    await db.batch(stmts);
    return (await attachSets(await db.q('SELECT * FROM workouts WHERE id = ?', [id])))[0];
  },

  'DELETE /api/workouts/:id': async (b, p) => {
    await db.batch([
      { sql: 'DELETE FROM workout_sets WHERE workout_id = ?', args: [p.id] },
      { sql: 'DELETE FROM workouts WHERE id = ?', args: [p.id] },
    ]);
    return { ok: true };
  },

  'GET /api/templates': async () => {
    const tpls = await db.q('SELECT * FROM templates ORDER BY name');
    for (const t of tpls) {
      t.items = await db.q(`
        SELECT ti.*, e.name AS exercise_name, e.unit
        FROM template_items ti JOIN exercises e ON e.id = ti.exercise_id
        WHERE ti.template_id = ? ORDER BY ti.item_order, ti.id`, [t.id]);
    }
    return tpls;
  },

  'POST /api/templates': async (b) => {
    const r = await db.run('INSERT INTO templates (name) VALUES (?)', [String(b.name || '無題')]);
    const tid = idn(r.lastInsertRowid);
    if ((b.items || []).length) {
      await db.batch(b.items.map((it, i) => ({
        sql: 'INSERT INTO template_items (template_id, exercise_id, item_order, target_sets, target_reps) VALUES (?, ?, ?, ?, ?)',
        args: [tid, it.exercise_id, i, num(it.target_sets, 3), num(it.target_reps, 10)],
      })));
    }
    return (await api['GET /api/templates']()).find((t) => t.id === tid);
  },

  'DELETE /api/templates/:id': async (b, p) => {
    await db.batch([
      { sql: 'DELETE FROM template_items WHERE template_id = ?', args: [p.id] },
      { sql: 'DELETE FROM templates WHERE id = ?', args: [p.id] },
    ]);
    return { ok: true };
  },

  'GET /api/body': async () => db.q('SELECT * FROM body_logs ORDER BY date'),

  'POST /api/body': async (b) => {
    await db.run(`
      INSERT INTO body_logs (date, weight, body_fat, note) VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET weight = excluded.weight, body_fat = excluded.body_fat, note = excluded.note`,
      [b.date,
       b.weight === '' || b.weight == null ? null : num(b.weight),
       b.body_fat === '' || b.body_fat == null ? null : num(b.body_fat),
       String(b.note || '')]);
    return db.one('SELECT * FROM body_logs WHERE date = ?', [b.date]);
  },

  'DELETE /api/body/:id': async (b, p) => {
    await db.run('DELETE FROM body_logs WHERE id = ?', [p.id]);
    return { ok: true };
  },

  'GET /api/meals': async (b, p, query) => {
    const from = query.from || '0000-01-01';
    const to = query.to || '9999-12-31';
    return db.q('SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', [from, to]);
  },

  'POST /api/meals': async (b) => {
    const r = await db.run('INSERT INTO meals (date, name, calories, protein, fat, carbs) VALUES (?, ?, ?, ?, ?, ?)',
      [b.date, String(b.name || ''), num(b.calories), num(b.protein), num(b.fat), num(b.carbs)]);
    return db.one('SELECT * FROM meals WHERE id = ?', [idn(r.lastInsertRowid)]);
  },

  'DELETE /api/meals/:id': async (b, p) => {
    await db.run('DELETE FROM meals WHERE id = ?', [p.id]);
    return { ok: true };
  },

  'GET /api/stats/exercise/:id': async (b, p) =>
    db.q(`
      SELECT w.date AS date,
             MAX(ws.weight) AS max_weight,
             SUM(ws.weight * ws.reps) AS volume,
             MAX(ws.weight * (1 + ws.reps / 30.0)) AS est_1rm
      FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
      WHERE ws.exercise_id = ?
      GROUP BY w.date ORDER BY w.date`, [p.id]),

  // クライアントから今日(ローカル日付)を受け取りタイムゾーンずれを防ぐ
  'GET /api/summary': async (b, p, query) => {
    const today = query.today || new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(new Date(today + 'T00:00:00Z').getTime() - 6 * 864e5).toISOString().slice(0, 10);
    return {
      total_workouts: Number((await db.one('SELECT COUNT(*) c FROM workouts')).c),
      workouts_this_week: Number((await db.one('SELECT COUNT(*) c FROM workouts WHERE date BETWEEN ? AND ?', [weekAgo, today])).c),
      total_volume_this_week: Number((await db.one(
        `SELECT COALESCE(SUM(ws.weight*ws.reps),0) v FROM workout_sets ws JOIN workouts w ON w.id=ws.workout_id WHERE w.date BETWEEN ? AND ?`,
        [weekAgo, today])).v),
      latest_body: (await db.one('SELECT * FROM body_logs ORDER BY date DESC LIMIT 1')) || null,
      protein_today: await db.one('SELECT COALESCE(SUM(protein),0) p, COALESCE(SUM(calories),0) c FROM meals WHERE date = ?', [today]),
    };
  },
};

function matchRoute(method, pathname) {
  if (api[`${method} ${pathname}`]) return { handler: api[`${method} ${pathname}`], params: {} };
  for (const key of Object.keys(api)) {
    const [m, pattern] = key.split(' ');
    if (m !== method || !pattern.includes(':')) continue;
    const pSeg = pattern.split('/'), uSeg = pathname.split('/');
    if (pSeg.length !== uSeg.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pSeg.length; i++) {
      if (pSeg[i].startsWith(':')) params[pSeg[i].slice(1)] = decodeURIComponent(uSeg[i]);
      else if (pSeg[i] !== uSeg[i]) { ok = false; break; }
    }
    if (ok) return { handler: api[key], params };
  }
  return null;
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) =>
      e2 ? send(res, 404, { error: 'not found' }) : send(res, 200, html, { 'Content-Type': MIME['.html'] }));
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 認証エンドポイント
  if (pathname === '/api/auth') {
    if (req.method === 'GET') return send(res, 200, { authed: isAuthed(req), required: AUTH_ENABLED });
    if (req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      const ok = AUTH_ENABLED && typeof b.password === 'string' &&
        b.password.length === APP_PASSWORD.length &&
        crypto.timingSafeEqual(Buffer.from(b.password), Buffer.from(APP_PASSWORD));
      if (!AUTH_ENABLED) return send(res, 200, { ok: true });
      if (!ok) return send(res, 401, { error: 'パスワードが違います' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': COOKIE });
    }
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
  }

  if (pathname.startsWith('/api/')) {
    if (!isAuthed(req)) return send(res, 401, { error: 'unauthorized' });
    const route = matchRoute(req.method, pathname);
    if (!route) return send(res, 404, { error: 'route not found' });
    try {
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const result = await route.handler(body, route.params, Object.fromEntries(url.searchParams));
      send(res, 200, result ?? { ok: true });
    } catch (e) {
      console.error(e);
      const msg = /UNIQUE/.test(e.message) ? '同じ名前が既に存在します' : e.message;
      send(res, 400, { error: msg });
    }
    return;
  }

  if (req.method === 'GET') return serveStatic(res, pathname);
  send(res, 405, { error: 'method not allowed' });
});

db.init()
  .then(() => server.listen(PORT, () => {
    console.log(`💪 筋トレ管理アプリ → http://localhost:${PORT}  (認証: ${AUTH_ENABLED ? 'ON' : 'OFF'})`);
  }))
  .catch((e) => { console.error('DB初期化に失敗:', e); process.exit(1); });
