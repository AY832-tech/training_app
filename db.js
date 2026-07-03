'use strict';

const { createClient } = require('@libsql/client');

// 本番: Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
// ローカル: file:data/app.db （環境変数が無ければ自動でこちら）
const url = process.env.TURSO_DATABASE_URL || 'file:data/app.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

if (url.startsWith('file:')) {
  require('node:fs').mkdirSync('data', { recursive: true });
}

const client = createClient({ url, authToken });

// クエリ補助（libSQL は非同期）
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const one = async (sql, args = []) => (await client.execute({ sql, args })).rows[0];
const run = async (sql, args = []) => await client.execute({ sql, args });
const batch = async (stmts) => await client.batch(stmts, 'write');
const idn = (v) => Number(v);

// 既存テーブルに列が無ければ追加（SQLite は ADD COLUMN IF NOT EXISTS 非対応のため自前判定）
async function addColumnIfMissing(table, col, def) {
  const cols = await q(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === col)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

// 種目を名前で確保（無ければ作成）して id を返す
async function ensureExercise(name, category, unit = 'kg') {
  const row = await one('SELECT id FROM exercises WHERE name = ?', [name]);
  if (row) return idn(row.id);
  const r = await run('INSERT INTO exercises (name, category, unit) VALUES (?, ?, ?)', [name, category, unit]);
  return idn(r.lastInsertRowid);
}

async function init() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS exercises (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      category  TEXT NOT NULL DEFAULT 'その他',
      unit      TEXT NOT NULL DEFAULT 'kg',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workouts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      date      TEXT NOT NULL,
      note      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workout_sets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id  INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      set_order   INTEGER NOT NULL DEFAULT 0,
      weight      REAL NOT NULL DEFAULT 0,
      reps        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sets_workout ON workout_sets(workout_id);
    CREATE INDEX IF NOT EXISTS idx_sets_exercise ON workout_sets(exercise_id);
    CREATE TABLE IF NOT EXISTS templates (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS template_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      item_order  INTEGER NOT NULL DEFAULT 0,
      target_sets INTEGER NOT NULL DEFAULT 3,
      target_reps INTEGER NOT NULL DEFAULT 10
    );
    CREATE TABLE IF NOT EXISTS body_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      date      TEXT NOT NULL UNIQUE,
      weight    REAL,
      body_fat  REAL,
      note      TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS meals (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      date      TEXT NOT NULL,
      name      TEXT NOT NULL DEFAULT '',
      calories  REAL NOT NULL DEFAULT 0,
      protein   REAL NOT NULL DEFAULT 0,
      fat       REAL NOT NULL DEFAULT 0,
      carbs     REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);

    -- ===== プログラム（メニュー）版管理 =====
    CREATE TABLE IF NOT EXISTS program_versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_no  INTEGER NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      start_date  TEXT,
      end_date    TEXT,
      note        TEXT NOT NULL DEFAULT '',
      is_active   INTEGER NOT NULL DEFAULT 0,
      parent_version_id INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS program_days (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id  INTEGER NOT NULL,
      day_order   INTEGER NOT NULL DEFAULT 0,
      name        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pdays_version ON program_days(version_id);
    CREATE TABLE IF NOT EXISTS program_exercises (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id       INTEGER NOT NULL,
      exercise_id  INTEGER NOT NULL,
      item_order   INTEGER NOT NULL DEFAULT 0,
      target_sets  INTEGER NOT NULL DEFAULT 3,
      rep_min      INTEGER NOT NULL DEFAULT 8,
      rep_max      INTEGER NOT NULL DEFAULT 12,
      increment    REAL NOT NULL DEFAULT 2.5,
      next_weight_manual REAL,
      note         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pex_day ON program_exercises(day_id);
    CREATE TABLE IF NOT EXISTS version_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id  INTEGER NOT NULL,
      date        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_vchanges_version ON version_changes(version_id);
  `);

  // 既存テーブルへの列追加（マイグレーション。既存データは保持）
  await addColumnIfMissing('workouts', 'version_id', 'INTEGER');
  await addColumnIfMissing('workouts', 'day_id', 'INTEGER');
  await addColumnIfMissing('workout_sets', 'manual_override', 'INTEGER NOT NULL DEFAULT 0');

  // 初期種目シード（既存デプロイ済みなら既に存在＝スキップ）
  const c = Number((await one('SELECT COUNT(*) AS c FROM exercises')).c);
  if (c === 0) {
    const defaults = [
      ['ベンチプレス', '胸', 'kg'], ['ダンベルプレス', '胸', 'kg'], ['チェストフライ', '胸', 'kg'],
      ['ラットプルダウン', '背中', 'kg'], ['デッドリフト', '背中', 'kg'], ['ベントオーバーロウ', '背中', 'kg'],
      ['スクワット', '脚', 'kg'], ['レッグプレス', '脚', 'kg'], ['レッグカール', '脚', 'kg'],
      ['ショルダープレス', '肩', 'kg'], ['サイドレイズ', '肩', 'kg'],
      ['バーベルカール', '腕', 'kg'], ['トライセプスプレスダウン', '腕', 'kg'],
      ['アブローラー', '腹', '回'], ['プランク', '腹', '秒'],
    ];
    await batch(defaults.map((d) => ({
      sql: 'INSERT INTO exercises (name, category, unit) VALUES (?, ?, ?)', args: d,
    })));
  }

  await seedProgram();
}

// 初回のみ: Upper/Lower/Full の初期メニューを v1 として投入
async function seedProgram() {
  const cnt = Number((await one('SELECT COUNT(*) AS c FROM program_versions')).c);
  if (cnt > 0) return;

  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (ローカル)
  const v = await run(
    `INSERT INTO program_versions (version_no, name, start_date, is_active, note)
     VALUES (1, ?, ?, 1, ?)`,
    ['初期メニュー（Upper/Lower/Full・週3）', today, '初期登録']
  );
  const vid = idn(v.lastInsertRowid);

  // [種目名, 部位, セット, rep_min, rep_max, (unit省略=kg)]
  const days = [
    { name: 'Day1 上半身', items: [
      ['ベンチプレス', '胸', 4, 6, 10],
      ['ベントオーバーロウ', '背中', 4, 8, 12],
      ['インクラインダンベルプレス', '胸', 3, 8, 12],
      ['ラットプルダウン', '背中', 3, 8, 12],
      ['サイドレイズ', '肩', 3, 12, 15],
      ['ケーブルプレスダウン', '腕', 3, 10, 15],
      ['ダンベルカール', '腕', 3, 10, 12],
    ] },
    { name: 'Day2 下半身・体幹', items: [
      ['スクワット', '脚', 4, 6, 10],
      ['ルーマニアンデッドリフト', '脚', 3, 8, 12],
      ['レッグプレス', '脚', 3, 10, 15],
      ['レッグカール', '脚', 3, 10, 15],
      ['スタンディングカーフレイズ', '脚', 4, 10, 15],
      ['アブローラー', '腹', 3, 8, 12],
      ['ケーブルウッドチョップ', '腹', 3, 10, 12],
    ] },
    { name: 'Day3 全身', items: [
      ['デッドリフト', '背中', 3, 5, 8],
      ['ショルダープレス', '肩', 3, 8, 12],
      ['懸垂', '背中', 3, 8, 12],
      ['ブルガリアンスクワット', '脚', 3, 8, 12],
      ['ディップス', '胸', 3, 10, 15],
      ['サイドレイズ', '肩', 3, 12, 15],
      ['シーテッドカーフレイズ', '脚', 3, 15, 20],
      ['フェイスプル', '肩', 3, 12, 15],
    ] },
  ];

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const d = await run('INSERT INTO program_days (version_id, day_order, name) VALUES (?, ?, ?)',
      [vid, di, day.name]);
    const did = idn(d.lastInsertRowid);
    for (let ii = 0; ii < day.items.length; ii++) {
      const [nm, cat, sets, rmin, rmax] = day.items[ii];
      const exid = await ensureExercise(nm, cat, 'kg');
      // アイソレーション系は増量幅を小さめ(1.25kg)に
      const isol = ['サイドレイズ', 'ケーブルプレスダウン', 'ダンベルカール', 'レッグカール',
        'フェイスプル', 'ケーブルウッドチョップ'].includes(nm);
      await run(
        `INSERT INTO program_exercises
         (day_id, exercise_id, item_order, target_sets, rep_min, rep_max, increment)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [did, exid, ii, sets, rmin, rmax, isol ? 1.25 : 2.5]
      );
    }
  }
}

module.exports = { client, init, q, one, run, batch, ensureExercise };
