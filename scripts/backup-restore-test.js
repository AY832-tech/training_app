'use strict';

// dumpファイルが実際に復元可能かを一時DBで検証する。
// 使い方: node scripts/backup-restore-test.js [dumpPath=backup.sql] [metaPath=backup-meta.json]

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

function cleanupDbFiles(base) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = base + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

async function main() {
  const dumpPath = process.argv[2] || 'backup.sql';
  const metaPath = process.argv[3] || 'backup-meta.json';

  if (!fs.existsSync(dumpPath)) {
    process.stderr.write(`Error: dumpファイルが見つかりません: ${dumpPath}\n`);
    process.exit(1);
    return;
  }
  if (!fs.existsSync(metaPath)) {
    process.stderr.write(`Error: metaファイルが見つかりません: ${metaPath}\n`);
    process.exit(1);
    return;
  }

  const dumpSql = fs.readFileSync(dumpPath, 'utf8');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const metaTables = meta.tables || {};
  const metaTableNames = Object.keys(metaTables);

  const dbBase = path.resolve('restore-test.db');
  cleanupDbFiles(dbBase);

  const client = createClient({ url: `file:${dbBase}`, intMode: 'bigint' });

  await client.executeMultiple(dumpSql);

  const dbTablesResult = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  const dbTableNames = dbTablesResult.rows.map((r) => r.name);

  const mismatches = [];
  let totalRows = 0;

  for (const tname of metaTableNames) {
    const expected = Number(metaTables[tname]);
    if (!dbTableNames.includes(tname)) {
      mismatches.push(`${tname}: meta=${expected} だが復元DBにテーブルが存在しない`);
      continue;
    }
    const r = await client.execute(`SELECT COUNT(*) AS c FROM "${tname}"`);
    const actual = Number(r.rows[0].c);
    totalRows += actual;
    if (actual !== expected) {
      mismatches.push(`${tname}: meta=${expected} actual=${actual}`);
    }
  }

  // 必須テーブル存在チェック（meta・復元DBの両方に無ければ失敗）
  const required = ['workouts', 'workout_sets', 'exercises'];
  for (const t of required) {
    const inMeta = metaTableNames.includes(t);
    const inDb = dbTableNames.includes(t);
    if (!inMeta && !inDb) {
      mismatches.push(`必須テーブル"${t}"がmeta・復元DBの両方に存在しない`);
    }
  }

  if (mismatches.length > 0) {
    process.stderr.write('Error: 復元検証で不一致を検出しました:\n');
    for (const m of mismatches) process.stderr.write(`  - ${m}\n`);
    process.exit(3);
    return;
  }

  console.log(`restore OK: ${metaTableNames.length} tables / ${totalRows} rows`);

  cleanupDbFiles(dbBase);
}

main().catch((e) => {
  process.stderr.write(`Error: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
