---
paths:
  - 'server/src/**'
  - 'server/tests/**'
  - 'server/seed/**'
  - 'server/evals/**'
  - 'server/drizzle/**'
---

# アーキテクチャ規約（server）

サーバーの層の依存は **`api/` → `service/` → `db/` の一方向**です。層を増やしません。

## 新規ファイルの配置判断

- ルート定義は `server/src/api/<機能>/index.ts` に置く
- リクエストの受け渡しは `server/src/api/<機能>/<機能>.controller.ts` に置く
- 業務ルールと、複数テーブルにまたがる処理は `server/src/service/<機能>.service.ts` に置く
- テーブル定義は `server/src/db/schema/<テーブル>.ts` に、1 ファイルに 1 テーブルずつ置く
- DB への接続は `server/src/db/client.ts` のものを使う。接続を作るファイルを新設しない
- クエリとトランザクションは、`server/src/service/` から `db` を使って書く
- マイグレーションは `server/drizzle/` に置く（`drizzle-kit generate` の生成物）
- 環境変数は `server/src/config.ts` に定義する
- エラーの型は `server/src/exception/common-exception.ts` に置く
- メッセージの文言は `server/resources/messages.json` に書く（`npm run messages` で生成する）
- 初期データは `server/seed/` に置く
- 外部システムとの連携（SDK の呼び出し）は `server/src/provider/<システム>.provider.ts` に置く（`.claude/rules/ai-integration.md`）
- テストは `server/tests/<機能>.test.ts` に置く
- AI の評価（ケースと、それを流す処理）は `server/evals/` に置く（ケースは `<機能>/cases.json`、流す処理は `run.ts`。
  `.claude/rules/ai-integration.md` の「評価」）
- **層を増やさない。** `repositories/`・`dto/`・`mapper/` などを新設しない
- アプリのコードでは、`provider/` を `service/` からだけ呼ぶ（検査: ESLint。`api/` からの import だけを止める）。
  ただし、AI の評価の採点は `server/evals/` から呼んでよい（`.claude/rules/ai-integration.md` の「評価」）

## import の許可関係

- **逆方向の import を作らない**（検査: ESLint。次の組み合わせだけを止める。`api/` から `db/` の値と `provider/`、
  `service/` から `api/`、`db/` から `api/`・`service/`、`provider/`・`util/`・`exception/` から `api/`・`service/`・`db/`）
- **`src/` では動的 import（`import()`）を使わない**（検査: ESLint）。ただし、`db/client.ts` と `db/migrate.ts` は
  使ってよい
- テスト（`tests/`）では、読み込む前に環境変数やモックを差し替えるとき（`vi.doMock` の後など）に動的 import を
  使ってよい（検査の対象外）

## 層ごとの責務

- `api/<機能>/index.ts` には、API 定義と handler の結び付けと、認証 middleware の適用を書く。業務判断と SQL を書かない
- controller には、service の呼び出しと、結果を返す処理を書く。業務判断・SQL・レスポンスの組み立て以外の加工を書かない
- service には、業務ルール・複数クエリの調整・トランザクションを書く。`req` / `res` に触らない
- `db/` には、テーブル定義と接続を置く。業務判断を書かない

**controller が 20 行を超えたら、業務判断が紛れ込んでいないかを確かめる。** 紛れ込んでいたら service に移す。

## エラー

- **error middleware は `app.ts` に 1 か所だけ置く**
- エラーのレスポンスの形は `{ messageKey, message, details? }` にそろえる

## 理由

この規約の理由は `.claude/rules-why/server-architecture.md` にあります。決まりに当てはまるかを迷ったときに読みます。
