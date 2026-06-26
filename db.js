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
  `);

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
}

module.exports = { client, init, q, one, run, batch };
