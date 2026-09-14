---
paths:
  - 'server/src/**'
  - 'server/tests/**'
  - 'server/seed/**'
  - 'server/drizzle/**'
---

# アーキテクチャ規約（server）

サーバーは **`api/` → `service/` → `db/` の一方向**です。層を増やしません。
書き方は [server-coding-conventions.md](server-coding-conventions.md)、DB は [db.md](db.md) を参照。

## リクエストの流れ

```
shared/src/api/            API 定義（zod スキーマ）… 唯一の正
        ↓
src/app.ts                 Express の app を組み立てる（middleware と router の mount）
        ↓
src/api/<機能>/index.ts    Router。route() で API 定義と handler を結ぶ
        ↓
src/api/<機能>/<機能>.controller.ts   薄い。入力を service に渡し、戻り値を返すだけ
        ↓
src/service/<機能>.service.ts        業務ルール。失敗は CommonException を throw
        ↓
src/db/                    Drizzle。SQL を書く唯一の場所
```

`src/index.ts` は `app.listen()` を呼ぶだけです。テストは `app.ts` を import して `listen(0)` します。

## 新規ファイルの配置判断

| 書こうとしているもの                   | 置き場所                                                                          |
| :------------------------------------- | :-------------------------------------------------------------------------------- |
| API の入出力の形                       | `shared/src/api/<機能>.ts`（server 内に作らない）                                 |
| ルート定義                             | `server/src/api/<機能>/index.ts`                                                  |
| リクエストの受け渡し                   | `server/src/api/<機能>/<機能>.controller.ts`                                      |
| 業務ルール・複数テーブルにまたがる処理 | `server/src/service/<機能>.service.ts`                                            |
| テーブル定義                           | `server/src/db/schema/<テーブル>.ts`                                              |
| クエリ・トランザクション               | `server/src/service/` から `db` を使って書く                                      |
| マイグレーション                       | `server/drizzle/`（`drizzle-kit generate` の生成物。手で書かない）                |
| 環境変数                               | `server/src/config.ts`（起動時に zod で検証。読むのはここだけ）                   |
| エラーの型                             | `server/src/exception/common-exception.ts`                                        |
| メッセージ文言                         | `server/resources/messages.json` → `npm run messages` で生成                      |
| ログ                                   | `server/src/util/log.ts` の `Log` を使う（新設しない）                            |
| HTTP の状態コード                      | `server/src/util/http-status.ts` の `HttpStatus`（数字を直接書かない）            |
| 初期データ                             | `server/seed/`                                                                    |
| 外部システムとの連携（SDK の呼び出し） | `server/src/provider/<システム>.provider.ts`（`.claude/rules/ai-integration.md`） |
| テスト                                 | `server/tests/<機能>.test.ts`                                                     |

- **`repositories/` `dto/` `mapper/` を新設しない。** この 3 層で足ります
- 外部システム（AI の SDK・決済・メール送信など）との連携だけは `src/provider/` に置く。`service/` からだけ呼び、
  `api/` から直接呼ばない。import の許可関係は ESLint に最初から入っている（`server/eslint.config.js`）
- ファイル名は kebab-case。`common.ts` のような何でも入る受け皿を作らない
- ファイルが長くなったら、分割の前に削れないかを検討する

## import の許可関係

```
index.ts       → app.ts, config.ts, util/log.ts
app.ts         → api/<機能>/index.ts, util/（error middleware, log）, config.ts
api/<機能>/    → service/, util/route.ts, exception/, @app/shared
service/       → db/, provider/, exception/, util/（log, message）, config.ts, @app/shared
provider/      → config.ts, exception/, util/（log）, 外部システムの SDK（api / service / db は import しない）
db/            → config.ts, exception/, @app/shared（型のみ）
util/          → exception/ のみ
exception/     → util/message/ のみ
seed/          → db/, config.ts
tests/         → app.ts, tests/helpers/, @app/shared
```

- **逆方向の import を作らない**（`db/` から `service/` を呼ばない、`service/` から `api/` を呼ばない）。
  ESLint の `no-restricted-imports` で止める。`npm run check -w server` が失敗する
- **動的 import（`import()`）を使わない。** 静的に検査できないので `no-restricted-syntax` で止める。
  例外は `db/client.ts` と `db/migrate.ts` だけ（開発とテストでしか使わない PGlite を本番の起動経路に載せないため）
- **`client/` のソースを import しない**
- **`@app/shared` に業務ロジックと DB 依存を置かない。** zod スキーマだけ
- 循環が必要に見えたら、共通部分を型として `@app/shared` に切り出す

## 層ごとの責務

| 層                    | やること                                              | やらないこと                                  |
| :-------------------- | :---------------------------------------------------- | :-------------------------------------------- |
| `api/<機能>/index.ts` | API 定義と handler の結び付け、認証 middleware の適用 | 業務判断、SQL                                 |
| controller            | service を呼び、結果を返す                            | 業務判断、SQL、レスポンスの組み立て以外の加工 |
| service               | 業務ルール、複数クエリの調整、トランザクション        | `req` / `res` に触ること                      |
| `db/`                 | テーブル定義と接続                                    | 業務判断                                      |

**controller が 20 行を超えたら、業務判断が紛れ込んでいないか疑う。**

## エラー

- 失敗は `CommonException { statusCode, messageKey, details? }` を throw する
- **error middleware は `app.ts` に 1 か所だけ。** 4 引数（`(err, req, res, next)`）で定義する
- Express 5 では async ハンドラの reject が自動で error middleware に渡る。
  `try / catch` で握りつぶして 200 を返さない
- レスポンスの形は `{ messageKey, message, details? }` に統一する

## なぜ

3 層に固定するのは、「この処理はどこに書くか」で迷う時間を無くすためです。層が 5 つある構成は、
層ごとの責務が曖昧になるほど転送コードが増え、非エンジニアには「意味のあるコード」と
「型を移し替えるだけのコード」の区別が付かなくなります。

一方向の import を lint で強制するのは、規約が「気をつける」で守られないからです。ビルドが失敗すれば、
規約を知らなくても間違いに気づけます。

error middleware を 1 か所にするのは、エラー応答の形をアプリ全体で 1 つに保つためです。
画面側は `ApiError` 1 種類だけを扱えばよくなります。
