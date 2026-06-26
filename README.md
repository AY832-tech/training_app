# 💪 筋トレ管理アプリ

筋トレ・食事・体組成を記録する PWA。外出先のスマホからでも使え、複数端末で同じデータを共有できます。
**データはクラウドDB（Turso）に保存**し、アプリ本体は **Render の無料枠**で公開します。**パスワード保護つき**。

---

## 構成
- フロント: バニラ JS の PWA（フレームワークなし）
- サーバー: Node.js（標準 `http`）+ REST API
- DB: **Turso / libSQL**（本番）/ ローカルは `file:data/app.db`（同じコードで動作）
- 認証: 環境変数 `APP_PASSWORD` による簡易パスワード認証（HttpOnly Cookie セッション）

## 環境変数
| 変数 | 用途 | 未設定時 |
|------|------|----------|
| `APP_PASSWORD` | ログインパスワード | **認証OFF**（誰でもアクセス可） |
| `TURSO_DATABASE_URL` | Turso の DB URL（`libsql://...`） | ローカル `file:data/app.db` を使用 |
| `TURSO_AUTH_TOKEN` | Turso のアクセストークン | （ローカルでは不要） |
| `TZ` | タイムゾーン | システム既定（Renderは`Asia/Tokyo`推奨） |
| `PORT` | 待ち受けポート | 3000（Renderが自動設定） |

---

## 🏠 ローカルで動かす
```bash
npm install
npm start                       # 認証OFFで http://localhost:3000
# パスワードを試すなら:
APP_PASSWORD=好きな文字列 npm start
```

---

## 🚀 ネット公開の手順（Render + Turso・無料）

### STEP 1. GitHub にコードを上げる
このフォルダを GitHub のリポジトリにプッシュします。
```bash
git init
git add .
git commit -m "筋トレ管理アプリ"
# GitHub で空のリポジトリを作成し、その URL を指定:
git remote add origin https://github.com/<あなた>/muscle-training-app.git
git branch -M main
git push -u origin main
```

### STEP 2. Turso でデータベースを作る（無料）
1. https://turso.tech にサインアップ
2. CLI を入れて DB を作成（※ Web ダッシュボードからでも作成可）
   ```bash
   # macOS / Linux
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth signup            # ブラウザでログイン
   turso db create muscle-app
   turso db show muscle-app --url        # ← これが TURSO_DATABASE_URL
   turso db tokens create muscle-app     # ← これが TURSO_AUTH_TOKEN
   ```
   出てきた **URL** と **トークン** を STEP 3 で使います。

### STEP 3. Render にデプロイ（無料）
1. https://render.com にサインアップし、GitHub と連携
2. **New +** → **Blueprint** を選び、STEP 1 のリポジトリを指定
   （`render.yaml` を自動で読み込みます。Blueprint を使わず **New + → Web Service** で
   `Build: npm install` / `Start: npm start` を手入力してもOK）
3. **Environment** で次の3つを入力（秘密情報なので画面で設定）:
   - `APP_PASSWORD` … 好きなログインパスワード
   - `TURSO_DATABASE_URL` … STEP 2 の URL
   - `TURSO_AUTH_TOKEN` … STEP 2 のトークン
4. デプロイ完了後、`https://muscle-training-app-xxxx.onrender.com` のような URL が発行されます。

### STEP 4. スマホで使う
1. 上記 URL をスマホのブラウザで開く → パスワードでログイン
2. ブラウザのメニューから **「ホーム画面に追加」** → アプリのように起動できます

> ⚠️ Render の無料枠は **15分アクセスが無いとスリープ**します。スリープ後の初回アクセスは
> 起動に 30〜60 秒かかりますが、**データは Turso に保存されているので消えません**。
> 常時すぐ起動したい場合は Render の有料プラン（約$7/月）にすると解決します。

---

## 機能
| タブ | 内容 |
|------|------|
| 🏠 ホーム | 今週のトレ回数・総挙上量、今日のたんぱく質/カロリー、最新体重。クイック記録／ログアウト |
| 📋 トレ記録 | 種目・重量・回数・セットを記録／編集。種目管理、テンプレート（例「胸の日」）展開 |
| 🍚 食事 | メニューごとに P/カロリー/脂質/炭水化物を記録。日別合計 |
| ⚖️ 体組成 | 体重・体脂肪率を記録（同日は上書き）＋推移グラフ |
| 📈 統計 | 種目別の推定1RM（Epley式）・最大重量・総挙上量グラフ |

## ファイル構成
```
server.js                 HTTP + REST API + パスワード認証
db.js                     Turso/libSQL 接続・スキーマ・初期種目シード
render.yaml               Render デプロイ設定（Blueprint）
.env.example              環境変数のひな型
public/                   フロント（index.html / app.js / styles.css / charts.js / sw.js ほか）
data/app.db               ローカル開発用 SQLite（本番では使わない・gitignore済み）
```

## データのバックアップ
本番データは Turso にあります。`turso db shell muscle-app .dump > backup.sql` などで取得できます。
