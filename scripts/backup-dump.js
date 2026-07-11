'use strict';

// Turso（またはfile:のlibSQL）から自己完結のSQLダンプを作る。
// db.js は使わない（副作用: マイグレーション/シード投入を避けるため）。
// 使い方: node scripts/backup-dump.js [dumpPath=backup.sql] [metaPath=backup-meta.json]

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

function sourceSummary(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.host) return `${u.protocol}//${u.host}`;
    return u.protocol;
  } catch (e) {
    const m = String(urlStr).match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    return m ? m[1] + ':' : 'unknown';
  }
}

function escapeValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`非有限数値が見つかりました: ${v}`);
    }
    return String(v);
  }
  if (v instanceof ArrayBuffer) {
    return `X'${Buffer.from(v).toString('hex')}'`;
  }
  if (v instanceof Uint8Array) {
    return `X'${Buffer.from(v).toString('hex')}'`;
  }
  if (typeof v === 'string') {
    return `'${v.replace(/'/g, "''")}'`;
  }
  throw new Error(`未対応の値型です: ${typeof v}`);
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    process.stderr.write('Error: TURSO_DATABASE_URL が設定されていません\n');
    process.exit(1);
    return;
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const dumpPath = process.argv[2] || 'backup.sql';
  const metaPath = process.argv[3] || 'backup-meta.json';

  const client = createClient({ url, authToken, intMode: 'bigint' });

  const schemaResult = await client.execute(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type
       WHEN 'table' THEN 0
       WHEN 'index' THEN 1
       WHEN 'trigger' THEN 2
       WHEN 'view' THEN 3
       ELSE 4
     END, name`
  );

  const lines = [];
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN TRANSACTION;');
  for (const row of schemaResult.rows) {
    lines.push(`${row.sql};`);
  }

  const tableNames = schemaResult.rows
    .filter((r) => r.type === 'table')
    .map((r) => r.name);

  const tables = {};
  let totalRows = 0;

  for (const tname of tableNames) {
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) AS c FROM "${tname}"`,
      args: [],
    });
    const expectedCount = Number(countResult.rows[0].c);

    const dataResult = await client.execute({ sql: `SELECT * FROM "${tname}"`, args: [] });
    const cols = dataResult.columns;
    let emitted = 0;
    for (const row of dataResult.rows) {
      const values = cols.map((c) => escapeValue(row[c]));
      lines.push(`INSERT INTO "${tname}" VALUES (${values.join(', ')});`);
      emitted++;
    }

    if (emitted !== expectedCount) {
      process.stderr.write(
        `Error: テーブル"${tname}"の行数不一致（並行書込みの疑い）: COUNT=${expectedCount} emitted=${emitted}\n`
      );
      process.exit(2);
      return;
    }

    tables[tname] = emitted;
    totalRows += emitted;
  }

  lines.push('COMMIT;');

  const dumpAbs = path.resolve(dumpPath);
  const metaAbs = path.resolve(metaPath);
  fs.mkdirSync(path.dirname(dumpAbs), { recursive: true });
  fs.mkdirSync(path.dirname(metaAbs), { recursive: true });

  fs.writeFileSync(dumpAbs, lines.join('\n') + '\n', 'utf8');

  const meta = {
    generatedAt: new Date().toISOString(),
    source: sourceSummary(url),
    tables,
    totalRows,
  };
  fs.writeFileSync(metaAbs, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(`dumped ${tableNames.length} tables / ${totalRows} rows → ${dumpPath}`);
}

main().catch((e) => {
  process.stderr.write(`Error: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
