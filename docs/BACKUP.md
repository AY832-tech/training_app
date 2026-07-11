# Turso 自動バックアップ

## 仕組み

- GitHub Actions（`.github/workflows/backup.yml`）が **毎日 04:00 JST**（cron: `0 19 * * *` = UTC 19:00）に本番 Turso DB をバックアップする。
- 手順: SQL ダンプ生成 → 一時DBへの復元テスト（COUNT一致確認）→ AES-256-CBC（PBKDF2・20万イテレーション）で暗号化 → GitHub Actions の artifact として保存（**保持期間 90日**）。
- 復元不能なダンプを作らないことを最優先しており、復元テストに失敗した場合はワークフローが失敗し、暗号化・アップロードは行われない。
- リポジトリは public のため、**平文のSQLダンプを artifact に含めることは絶対に行わない**（暗号化後に平文ファイルを削除してからアップロードする）。
- 手動実行も可能（`workflow_dispatch`）。GitHub Actions の該当ワークフロー画面から「Run workflow」で実行できる。

## 必要な GitHub Secrets

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** から以下の3つを登録する。

| Secret名 | 値 |
|---|---|
| `TURSO_DATABASE_URL` | 本番Turso DBのURL（Renderの環境変数と同値） |
| `TURSO_AUTH_TOKEN` | 本番Turso DBの認証トークン（Renderの環境変数と同値） |
| `BACKUP_PASSPHRASE` | バックアップ暗号化用の任意のパスフレーズ（新規に決めてよい。紛失するとバックアップが復号できなくなるため、安全な場所に別途保管すること） |

いずれかが未設定の場合、ワークフローの「Check required secrets」ステップが明示的なメッセージとともに失敗する。

## 復号手順

ダウンロードした artifact 内の `backup.sql.enc` を復号する:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in backup.sql.enc -out backup.sql -pass pass:＜パスフレーズ＞
```

`backup.sql` が平文のSQLダンプとして得られる。

## 復元手順

### (a) ローカルの file DB へ復元して検証する

`scripts/backup-restore-test.js` を使うと、一時DB（`restore-test.db`）に復元してテーブルごとの行数を meta.json と突合できる。

```bash
node scripts/backup-restore-test.js backup.sql backup-meta.json
```

成功すると `restore OK: N tables / M rows` と表示され、一時DBファイルは自動削除される。不一致がある場合は差分を列挙して終了コード3で失敗し、調査のため一時DBファイルは残される。

### (b) 新しい Turso DB へ復元する

```bash
turso db shell <db名> < backup.sql
```

## 注意

- GitHub Actions の scheduled workflow は、リポジトリが **60日間活動（push等）が無いと自動的に無効化される**。定期実行が止まっていないか時々確認し、必要なら `workflow_dispatch` から手動実行するか、何らかのコミットを行って再有効化すること。
- artifact の保持期間は90日。長期保管したい場合は artifact をダウンロードして別途保存すること。
