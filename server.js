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
const round2 = (n) => Math.round(n * 100) / 100;
const todayLocal = () => new Date().toLocaleDateString('sv-SE');

// セットを各ワークアウトに付与（IN句で1クエリにまとめる）
async function attachSets(workouts) {
  if (!workouts.length) return workouts;
  const ids = workouts.map((w) => idn(w.id));
  const sets = await db.q(`
    SELECT ws.*, e.name AS exercise_name, e.unit, e.category
    FROM workout_sets ws JOIN exercises e ON e.id = ws.exercise_id
    WHERE ws.workout_id IN (${ids.map(() => '?').join(',')})
    ORDER BY ws.set_order, ws.id`, ids);
  const by = {};
  sets.forEach((s) => { (by[Number(s.workout_id)] ||= []).push(s); });
  workouts.forEach((w) => { w.sets = by[idn(w.id)] || []; });
  return workouts;
}

// ===== プログラム（メニュー）関連ヘルパ =====

// 起点日からの経過週（1始まり）
function weeksSince(start, today) {
  if (!start) return null;
  const ms = new Date(today + 'T00:00:00Z') - new Date(start + 'T00:00:00Z');
  return Math.floor(ms / (7 * 864e5)) + 1;
}

// 複数種目の「直近セッション」を1クエリでまとめて取得（{exercise_id: {date, sets}}）
async function lastSessionsFor(exIds) {
  if (!exIds.length) return {};
  const rows = await db.q(`
    SELECT exercise_id, date, weight, reps FROM (
      SELECT ws.exercise_id, w.date, ws.weight, ws.reps, ws.set_order, ws.id,
             DENSE_RANK() OVER (PARTITION BY ws.exercise_id ORDER BY w.date DESC, w.id DESC) rnk
      FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
      WHERE ws.exercise_id IN (${exIds.map(() => '?').join(',')})
    ) WHERE rnk = 1 ORDER BY exercise_id, set_order, id`, exIds);
  const map = {};
  rows.forEach((r) => {
    const k = Number(r.exercise_id);
    (map[k] ||= { date: r.date, sets: [] }).sets.push({ weight: r.weight, reps: r.reps });
  });
  return map;
}

// 次回重量の提案（手動 > 自動漸進 > 前回維持 > なし）
function suggest(pex, last) {
  if (pex.next_weight_manual != null) {
    return { weight: round2(pex.next_weight_manual), source: 'manual' };
  }
  if (!last || !last.sets.length) return { weight: null, source: 'none' };
  const lastWeight = Math.max(...last.sets.map((s) => Number(s.weight)));
  const metReps = last.sets.every((s) => Number(s.reps) >= pex.rep_max);
  const enoughSets = last.sets.length >= pex.target_sets;
  if (metReps && enoughSets) {
    return { weight: round2(lastWeight + pex.increment), source: 'progress' };
  }
  return { weight: lastWeight, source: 'last' };
}

// バージョンの days/exercises を読み込んで v に付与（2クエリ固定）
async function buildVersion(v) {
  if (!v) return null;
  const days = await db.q('SELECT * FROM program_days WHERE version_id = ? ORDER BY day_order, id', [v.id]);
  if (days.length) {
    const dids = days.map((d) => idn(d.id));
    const exs = await db.q(
      `SELECT pe.*, e.name AS exercise_name, e.unit, e.category, e.muscles
       FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.day_id IN (${dids.map(() => '?').join(',')})
       ORDER BY pe.item_order, pe.id`, dids);
    days.forEach((d) => { d.exercises = exs.filter((x) => Number(x.day_id) === idn(d.id)); });
  }
  v.days = days;
  return v;
}

// アクティブなプログラム（各種目に提案・前回値を付与）
async function buildActiveProgram() {
  const v = await db.one('SELECT * FROM program_versions WHERE is_active = 1 ORDER BY version_no DESC LIMIT 1');
  if (!v) return null;
  await buildVersion(v);
  const exIds = [...new Set(v.days.flatMap((d) => d.exercises.map((pe) => Number(pe.exercise_id))))];
  const lastMap = await lastSessionsFor(exIds);
  for (const d of v.days) {
    for (const pe of d.exercises) {
      const last = lastMap[Number(pe.exercise_id)] || null;
      pe.last_session = last;
      pe.suggestion = suggest(pex(pe), last);
    }
  }
  return v;
}
const pex = (r) => ({
  target_sets: Number(r.target_sets), rep_max: Number(r.rep_max),
  increment: Number(r.increment),
  next_weight_manual: r.next_weight_manual == null ? null : Number(r.next_weight_manual),
});

// days 構造を挿入（days=[{name, exercises:[{exercise_id,target_sets,rep_min,rep_max,increment,next_weight_manual,note}]}]）
async function insertDays(vid, days) {
  for (let di = 0; di < days.length; di++) {
    const d = await db.run('INSERT INTO program_days (version_id, day_order, name) VALUES (?, ?, ?)',
      [vid, di, String(days[di].name || `Day${di + 1}`)]);
    const did = idn(d.lastInsertRowid);
    const items = days[di].exercises || [];
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii];
      await db.run(
        `INSERT INTO program_exercises
         (day_id, exercise_id, item_order, target_sets, rep_min, rep_max, increment, next_weight_manual, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [did, Number(it.exercise_id), ii, num(it.target_sets, 3), num(it.rep_min, 8),
         num(it.rep_max, 12), num(it.increment, 2.5),
         it.next_weight_manual === '' || it.next_weight_manual == null ? null : num(it.next_weight_manual),
         String(it.note || '')]);
    }
  }
}

// コピー元の days をプレーン構造で取得
async function loadDaysStruct(vid) {
  const days = await db.q('SELECT * FROM program_days WHERE version_id = ? ORDER BY day_order, id', [vid]);
  const out = [];
  for (const d of days) {
    const exs = await db.q('SELECT * FROM program_exercises WHERE day_id = ? ORDER BY item_order, id', [d.id]);
    out.push({ name: d.name, exercises: exs });
  }
  return out;
}

// セッションで使用した種目の手動次回重量をクリア
async function clearUsedManual(versionId, sets) {
  if (!versionId) return;
  const exIds = [...new Set((sets || []).map((s) => Number(s.exercise_id)).filter(Boolean))];
  if (!exIds.length) return;
  const ph = exIds.map(() => '?').join(',');
  await db.run(
    `UPDATE program_exercises SET next_weight_manual = NULL
     WHERE next_weight_manual IS NOT NULL
       AND exercise_id IN (${ph})
       AND day_id IN (SELECT id FROM program_days WHERE version_id = ?)`,
    [...exIds, versionId]);
}

// 保存可能なセットだけに正規化する。存在しない種目や0以下・非数値の重量/回数は記録しない。
async function normalizeWorkoutSets(sets) {
  const candidates = (Array.isArray(sets) ? sets : []).map((s) => ({
    exercise_id: Number(s && s.exercise_id),
    weight: Number(s && s.weight),
    reps: Number(s && s.reps),
    manual_override: s && s.manual_override ? 1 : 0,
  })).filter((s) => Number.isInteger(s.exercise_id) && s.exercise_id > 0 &&
    Number.isFinite(s.weight) && s.weight > 0 && Number.isFinite(s.reps) && s.reps > 0);
  if (!candidates.length) return [];
  const ids = [...new Set(candidates.map((s) => s.exercise_id))];
  const rows = await db.q(`SELECT id FROM exercises WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const validIds = new Set(rows.map((r) => idn(r.id)));
  return candidates.filter((s) => validIds.has(s.exercise_id));
}

// ---- API ハンドラ（すべて async）----
const api = {
  'GET /api/exercises': async () =>
    db.q('SELECT * FROM exercises ORDER BY category, name'),

  'POST /api/exercises': async (b) => {
    const r = await db.run('INSERT INTO exercises (name, category, unit, muscles) VALUES (?, ?, ?, ?)',
      [String(b.name || '').trim(), String(b.category || 'その他'), String(b.unit || 'kg'),
       String(b.muscles || '').trim()]);
    return db.one('SELECT * FROM exercises WHERE id = ?', [idn(r.lastInsertRowid)]);
  },

  // 種目の対象筋を更新
  'PUT /api/exercises/:id': async (b, p) => {
    await db.run('UPDATE exercises SET muscles = COALESCE(?, muscles) WHERE id = ?',
      [b.muscles == null ? null : String(b.muscles).trim(), idn(p.id)]);
    return db.one('SELECT * FROM exercises WHERE id = ?', [idn(p.id)]);
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
    const sets = await normalizeWorkoutSets(b.sets);
    if (!sets.length) throw new Error('重量・回数が0より大きいセットを入力してください');
    const r = await db.run('INSERT INTO workouts (date, note, version_id, day_id) VALUES (?, ?, ?, ?)',
      [b.date, String(b.note || ''), b.version_id || null, b.day_id || null]);
    const wid = idn(r.lastInsertRowid);
    await db.batch(sets.map((s, i) => ({
      sql: 'INSERT INTO workout_sets (workout_id, exercise_id, set_order, weight, reps, manual_override) VALUES (?, ?, ?, ?, ?, ?)',
      args: [wid, s.exercise_id, i, s.weight, s.reps, s.manual_override],
    })));
    await clearUsedManual(b.version_id, sets);
    return (await attachSets(await db.q('SELECT * FROM workouts WHERE id = ?', [wid])))[0];
  },

  'PUT /api/workouts/:id': async (b, p) => {
    const id = idn(p.id);
    const sets = await normalizeWorkoutSets(b.sets);
    if (!sets.length) throw new Error('重量・回数が0より大きいセットを入力してください');
    const stmts = [
      { sql: 'UPDATE workouts SET date = ?, note = ?, version_id = ?, day_id = ? WHERE id = ?',
        args: [b.date, String(b.note || ''), b.version_id || null, b.day_id || null, id] },
      { sql: 'DELETE FROM workout_sets WHERE workout_id = ?', args: [id] },
      ...sets.map((s, i) => ({
        sql: 'INSERT INTO workout_sets (workout_id, exercise_id, set_order, weight, reps, manual_override) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, s.exercise_id, i, s.weight, s.reps, s.manual_override],
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
    if (!tpls.length) return tpls;
    const ids = tpls.map((t) => idn(t.id));
    const items = await db.q(`
      SELECT ti.*, e.name AS exercise_name, e.unit
      FROM template_items ti JOIN exercises e ON e.id = ti.exercise_id
      WHERE ti.template_id IN (${ids.map(() => '?').join(',')})
      ORDER BY ti.item_order, ti.id`, ids);
    tpls.forEach((t) => { t.items = items.filter((i) => Number(i.template_id) === idn(t.id)); });
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

  // ===== プログラム（メニュー）版管理 =====
  'GET /api/program': async () => {
    const vs = await db.q('SELECT * FROM program_versions ORDER BY version_no DESC');
    for (const v of vs) await buildVersion(v);
    return vs;
  },

  'GET /api/program/active': async () => buildActiveProgram(),

  'POST /api/program': async (b) => {
    // 新バージョン（抜本改訂）: 既存を非アクティブ化し、メソサイクル起点をリセット
    const maxNo = Number((await db.one('SELECT COALESCE(MAX(version_no), 0) n FROM program_versions')).n);
    const start = b.start_date || todayLocal();
    await db.run('UPDATE program_versions SET is_active = 0');
    const r = await db.run(
      `INSERT INTO program_versions (version_no, name, start_date, note, is_active, parent_version_id)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [maxNo + 1, String(b.name || `v${maxNo + 1}`), start, String(b.note || ''), b.copy_from_version_id || null]);
    const vid = idn(r.lastInsertRowid);
    let days = b.days;
    if ((!days || !days.length) && b.copy_from_version_id) days = await loadDaysStruct(b.copy_from_version_id);
    await insertDays(vid, days || []);
    return buildVersion(await db.one('SELECT * FROM program_versions WHERE id = ?', [vid]));
  },

  'PUT /api/program/:id': async (b, p) => {
    // 軽微編集: アクティブ版内を書き換え（start_date=メソサイクル起点は維持）
    const vid = idn(p.id);
    const prevManual = await db.q(
      `SELECT pe.exercise_id, pe.next_weight_manual FROM program_exercises pe
       JOIN program_days d ON d.id = pe.day_id
       WHERE d.version_id = ? AND pe.next_weight_manual IS NOT NULL`, [vid]);
    const manualMap = {};
    prevManual.forEach((r) => { manualMap[Number(r.exercise_id)] = r.next_weight_manual; });

    if (b.name != null || b.note != null) {
      await db.run('UPDATE program_versions SET name = COALESCE(?, name), note = COALESCE(?, note) WHERE id = ?',
        [b.name ?? null, b.note ?? null, vid]);
    }
    if (b.days) {
      const oldDays = await db.q('SELECT id FROM program_days WHERE version_id = ?', [vid]);
      const stmts = oldDays.map((d) => ({ sql: 'DELETE FROM program_exercises WHERE day_id = ?', args: [d.id] }));
      stmts.push({ sql: 'DELETE FROM program_days WHERE version_id = ?', args: [vid] });
      if (stmts.length) await db.batch(stmts);
      await insertDays(vid, b.days);
      for (const [exid, w] of Object.entries(manualMap)) {
        await db.run(
          `UPDATE program_exercises SET next_weight_manual = ?
           WHERE exercise_id = ? AND day_id IN (SELECT id FROM program_days WHERE version_id = ?)`,
          [w, Number(exid), vid]);
      }
    }
    await db.run('INSERT INTO version_changes (version_id, date, description) VALUES (?, ?, ?)',
      [vid, b.change_date || todayLocal(), String(b.change_description || '編集')]);
    return buildVersion(await db.one('SELECT * FROM program_versions WHERE id = ?', [vid]));
  },

  'POST /api/program/:id/activate': async (b, p) => {
    await db.batch([
      { sql: 'UPDATE program_versions SET is_active = 0', args: [] },
      { sql: 'UPDATE program_versions SET is_active = 1 WHERE id = ?', args: [idn(p.id)] },
    ]);
    return { ok: true };
  },

  'DELETE /api/program/:id': async (b, p) => {
    const vid = idn(p.id);
    const days = await db.q('SELECT id FROM program_days WHERE version_id = ?', [vid]);
    const stmts = days.map((d) => ({ sql: 'DELETE FROM program_exercises WHERE day_id = ?', args: [d.id] }));
    stmts.push({ sql: 'DELETE FROM program_days WHERE version_id = ?', args: [vid] });
    stmts.push({ sql: 'DELETE FROM version_changes WHERE version_id = ?', args: [vid] });
    stmts.push({ sql: 'DELETE FROM program_versions WHERE id = ?', args: [vid] });
    await db.batch(stmts);
    return { ok: true };
  },

  'GET /api/program/:id/changes': async (b, p) =>
    db.q('SELECT * FROM version_changes WHERE version_id = ? ORDER BY date DESC, id DESC', [p.id]),

  // 種目ごとの「次回目標重量」手動上書き
  'PUT /api/program-exercise/:id': async (b, p) => {
    const w = b.next_weight_manual === '' || b.next_weight_manual == null ? null : num(b.next_weight_manual);
    await db.run('UPDATE program_exercises SET next_weight_manual = ? WHERE id = ?', [w, idn(p.id)]);
    return db.one('SELECT * FROM program_exercises WHERE id = ?', [idn(p.id)]);
  },

  // ===== エクスポート / インポート =====
  // 全セッション記録（?format=csv で CSV ダウンロード）
  'GET /api/export/sessions': async (b, p, query) => {
    const rows = await db.q(`
      SELECT w.date, w.id AS workout_id, e.name AS exercise, e.unit,
             ws.set_order, ws.weight, ws.reps, ws.manual_override,
             pv.version_no, pd.name AS day_name, w.note
      FROM workout_sets ws
      JOIN workouts w ON w.id = ws.workout_id
      JOIN exercises e ON e.id = ws.exercise_id
      LEFT JOIN program_versions pv ON pv.id = w.version_id
      LEFT JOIN program_days pd ON pd.id = w.day_id
      ORDER BY w.date, w.id, ws.set_order, ws.id`);
    if ((query.format || 'json') === 'csv') {
      const cols = ['date', 'workout_id', 'exercise', 'unit', 'set_order', 'weight', 'reps',
        'manual_override', 'version_no', 'day_name', 'note'];
      const csvEsc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const body = rows.map((r) => cols.map((c) => csvEsc(r[c])).join(',')).join('\n');
      return { __raw: '\uFEFF' + cols.join(',') + '\n' + body, // BOM付き（Excel対応）
        headers: { 'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="sessions.csv"' } };
    }
    return { exported_at: new Date().toISOString(), count: rows.length, sessions: rows };
  },

  // メニューJSONを新バージョンとして取込（menu-schema.json 参照）
  'POST /api/program/import': async (b) => {
    const m = b.menu || b;
    if (!m || !Array.isArray(m.days) || !m.days.length) throw new Error('days（配列）が必要です');
    const days = [];
    for (const d of m.days) {
      if (!Array.isArray(d.exercises) || !d.exercises.length) throw new Error(`「${d.name || 'Day'}」に exercises が必要です`);
      const exs = [];
      for (const ex of d.exercises) {
        if (!ex.name) throw new Error('各種目に name が必要です');
        const exid = await db.ensureExercise(String(ex.name).trim(),
          String(ex.category || 'その他'), String(ex.unit || 'kg'));
        if (ex.muscles) {
          await db.run("UPDATE exercises SET muscles = ? WHERE id = ? AND muscles = ''",
            [String(ex.muscles).trim(), exid]);
        }
        exs.push({ exercise_id: exid, target_sets: num(ex.target_sets, 3),
          rep_min: num(ex.rep_min, 8), rep_max: num(ex.rep_max, 12),
          increment: num(ex.increment, 2.5), note: String(ex.note || '') });
      }
      days.push({ name: String(d.name || `Day${days.length + 1}`), exercises: exs });
    }
    return api['POST /api/program']({
      name: String(m.name || 'インポートメニュー'),
      note: String(m.note || 'JSONインポート'),
      start_date: m.start_date, days,
    });
  },

  // ===== ストレッチ =====
  'GET /api/stretches': async () =>
    db.q('SELECT * FROM stretches ORDER BY timing DESC, item_order, id'), // pre → post

  'POST /api/stretches': async (b) => {
    const timing = b.timing === 'pre' ? 'pre' : 'post';
    const mx = await db.one('SELECT COALESCE(MAX(item_order), -1) m FROM stretches WHERE timing = ?', [timing]);
    const r = await db.run(
      'INSERT INTO stretches (name, timing, detail, target, item_order) VALUES (?, ?, ?, ?, ?)',
      [String(b.name || '').trim(), timing, String(b.detail || '').trim(),
       String(b.target || '').trim(), Number(mx.m) + 1]);
    return db.one('SELECT * FROM stretches WHERE id = ?', [idn(r.lastInsertRowid)]);
  },

  'PUT /api/stretches/:id': async (b, p) => {
    await db.run(
      `UPDATE stretches SET name = COALESCE(?, name), timing = COALESCE(?, timing),
       detail = COALESCE(?, detail), target = COALESCE(?, target) WHERE id = ?`,
      [b.name == null ? null : String(b.name).trim(),
       b.timing == null ? null : (b.timing === 'pre' ? 'pre' : 'post'),
       b.detail == null ? null : String(b.detail).trim(),
       b.target == null ? null : String(b.target).trim(), idn(p.id)]);
    return db.one('SELECT * FROM stretches WHERE id = ?', [idn(p.id)]);
  },

  'DELETE /api/stretches/:id': async (b, p) => {
    await db.batch([
      { sql: 'DELETE FROM stretch_logs WHERE stretch_id = ?', args: [p.id] },
      { sql: 'DELETE FROM stretches WHERE id = ?', args: [p.id] },
    ]);
    return { ok: true };
  },

  // 指定日の実施ログ（?date=YYYY-MM-DD）
  'GET /api/stretch-logs': async (b, p, query) =>
    db.q('SELECT * FROM stretch_logs WHERE date = ?', [query.date || '']),

  // 実施チェック・保持秒の upsert
  'POST /api/stretch-logs': async (b) => {
    await db.run(`
      INSERT INTO stretch_logs (date, stretch_id, done, seconds) VALUES (?, ?, ?, ?)
      ON CONFLICT(date, stretch_id) DO UPDATE SET done = excluded.done, seconds = excluded.seconds`,
      [b.date, Number(b.stretch_id), b.done ? 1 : 0,
       b.seconds === '' || b.seconds == null ? null : num(b.seconds)]);
    return db.one('SELECT * FROM stretch_logs WHERE date = ? AND stretch_id = ?', [b.date, Number(b.stretch_id)]);
  },

  // 直近の実施状況サマリ（過去7日で何日やったか）
  'GET /api/stretch-summary': async (b, p, query) => {
    const today = query.today || todayLocal();
    const weekAgo = new Date(new Date(today + 'T00:00:00Z').getTime() - 6 * 864e5).toISOString().slice(0, 10);
    const r = await db.one(
      `SELECT COUNT(DISTINCT date) c FROM stretch_logs WHERE done = 1 AND date BETWEEN ? AND ?`,
      [weekAgo, today]);
    const lastRom = await db.one('SELECT * FROM rom_logs ORDER BY date DESC, id DESC LIMIT 1');
    let romDueDays = null;
    if (lastRom) {
      romDueDays = Math.floor((new Date(today + 'T00:00:00Z') - new Date(lastRom.date + 'T00:00:00Z')) / 864e5);
    }
    return { days_this_week: Number(r.c), last_rom: lastRom || null, rom_days_ago: romDueDays };
  },

  // ROM（可動域）メモ
  'GET /api/rom': async () => db.q('SELECT * FROM rom_logs ORDER BY date DESC, id DESC'),
  'POST /api/rom': async (b) => {
    const r = await db.run('INSERT INTO rom_logs (date, note) VALUES (?, ?)',
      [b.date, String(b.note || '')]);
    return db.one('SELECT * FROM rom_logs WHERE id = ?', [idn(r.lastInsertRowid)]);
  },
  'DELETE /api/rom/:id': async (b, p) => {
    await db.run('DELETE FROM rom_logs WHERE id = ?', [p.id]);
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

  // 全体統計: 週別推移（挙上量・回数・セット数）と部位別セット数（直近7日・直近28日）
  'GET /api/stats/overview': async (b, p, query) => {
    const today = query.today || todayLocal();
    const d7 = new Date(new Date(today + 'T00:00:00Z').getTime() - 6 * 864e5).toISOString().slice(0, 10);
    const d28 = new Date(new Date(today + 'T00:00:00Z').getTime() - 27 * 864e5).toISOString().slice(0, 10);
    // 週の起点は月曜（%w: 0=日曜）
    const weekExpr = `date(w.date, '-' || ((CAST(strftime('%w', w.date) AS INTEGER) + 6) % 7) || ' days')`;
    const [rWeeks, rCat7, rCat28] = await db.batchRead([
      { sql: `SELECT ${weekExpr} AS week_start,
                     COUNT(DISTINCT w.id) AS sessions,
                     COALESCE(SUM(ws.weight * ws.reps), 0) AS volume,
                     COUNT(ws.id) AS sets
              FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id = w.id
              GROUP BY week_start ORDER BY week_start DESC LIMIT 12`, args: [] },
      { sql: `SELECT e.category, COUNT(*) AS sets
              FROM workout_sets ws
              JOIN workouts w ON w.id = ws.workout_id
              JOIN exercises e ON e.id = ws.exercise_id
              WHERE w.date BETWEEN ? AND ? GROUP BY e.category`, args: [d7, today] },
      { sql: `SELECT e.category, COUNT(*) AS sets
              FROM workout_sets ws
              JOIN workouts w ON w.id = ws.workout_id
              JOIN exercises e ON e.id = ws.exercise_id
              WHERE w.date BETWEEN ? AND ? GROUP BY e.category`, args: [d28, today] },
    ]);
    return {
      weeks: rWeeks.rows.slice().reverse(), // 古い→新しい順
      category_7d: rCat7.rows,
      category_28d: rCat28.rows,
    };
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
    // 6クエリを1往復にまとめる（リモートDBの往復回数を削減）
    const [rActive, rTotal, rWeek, rVol, rBody, rMeal] = await db.batchRead([
      { sql: 'SELECT * FROM program_versions WHERE is_active = 1 ORDER BY version_no DESC LIMIT 1', args: [] },
      { sql: 'SELECT COUNT(*) c FROM workouts', args: [] },
      { sql: 'SELECT COUNT(*) c FROM workouts WHERE date BETWEEN ? AND ?', args: [weekAgo, today] },
      { sql: 'SELECT COALESCE(SUM(ws.weight*ws.reps),0) v FROM workout_sets ws JOIN workouts w ON w.id=ws.workout_id WHERE w.date BETWEEN ? AND ?', args: [weekAgo, today] },
      { sql: 'SELECT * FROM body_logs ORDER BY date DESC LIMIT 1', args: [] },
      { sql: 'SELECT COALESCE(SUM(protein),0) p, COALESCE(SUM(calories),0) c FROM meals WHERE date = ?', args: [today] },
    ]);
    const active = rActive.rows[0];
    let mesocycle = null;
    if (active && active.start_date) {
      const week = weeksSince(active.start_date, today);
      mesocycle = {
        version_no: active.version_no, name: active.name, start_date: active.start_date,
        week, due: week >= 8, over: week > 12,
      };
    }
    return {
      total_workouts: Number(rTotal.rows[0].c),
      workouts_this_week: Number(rWeek.rows[0].c),
      total_volume_this_week: Number(rVol.rows[0].v),
      latest_body: rBody.rows[0] || null,
      protein_today: rMeal.rows[0],
      mesocycle,
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
      if (result && result.__raw !== undefined) send(res, 200, result.__raw, result.headers || {});
      else send(res, 200, result ?? { ok: true });
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
