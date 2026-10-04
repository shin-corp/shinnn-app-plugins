---
paths:
  - 'server/src/**'
  - 'server/tests/**'
  - 'server/seed/**'
  - 'server/evals/**'
  - 'server/drizzle/**'
---

# アーキテクチャ規約（server）

サーバーは **`api/` → `service/` → `db/` の一方向**です。層を増やしません。
書き方は [server-coding-conventions.md](server-coding-conventions.md)、DB は [db.md](db.md) を参照。

「（検査: …）」には、その決まりを機械で確かめる仕組みを書いています。付いていない決まりは、レビューだけで確かめます。

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

`src/index.ts` は `app.listen()` を呼ぶだけです。テストは `app.ts` を import して `listen(0, '127.0.0.1')` します。

## 新規ファイルの配置判断

| 書こうとしているもの                   | 置き場所                                                                                                           |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| API の入出力の形                       | `shared/src/api/<機能>.ts`（server 内に作らない）                                                                  |
| ルート定義                             | `server/src/api/<機能>/index.ts`                                                                                   |
| リクエストの受け渡し                   | `server/src/api/<機能>/<機能>.controller.ts`                                                                       |
| 業務ルール・複数テーブルにまたがる処理 | `server/src/service/<機能>.service.ts`                                                                             |
| テーブル定義                           | `server/src/db/schema/<テーブル>.ts`                                                                               |
| クエリ・トランザクション               | `server/src/service/` から `db` を使って書く                                                                       |
| マイグレーション                       | `server/drizzle/`（`drizzle-kit generate` の生成物）                                                               |
| 環境変数                               | `server/src/config.ts`（起動時に zod で検証。読んでよい場所は server-coding-conventions.md の「環境変数」）        |
| エラーの型                             | `server/src/exception/common-exception.ts`                                                                         |
| メッセージ文言                         | `server/resources/messages.json` → `npm run messages` で生成                                                       |
| ログ                                   | `server/src/util/log.ts` の `Log` を使う（新設しない）                                                             |
| HTTP の状態コード                      | `server/src/util/http-status.ts` の `HttpStatus`（数字を直接書かない）                                             |
| 初期データ                             | `server/seed/`                                                                                                     |
| 外部システムとの連携（SDK の呼び出し） | `server/src/provider/<システム>.provider.ts`（`.claude/rules/ai-integration.md`）                                  |
| テスト                                 | `server/tests/<機能>.test.ts`                                                                                      |
| AI の評価（ケースと、それを流す処理）  | `server/evals/`（ケースは `<機能>/cases.json`、流す処理は `run.ts`。`.claude/rules/ai-integration.md` の「評価」） |

- **層を増やさない。** `repositories/`・`dto/`・`mapper/` などを新設しない
- 外部システム（AI の SDK・決済・メール送信など）との連携は `src/provider/` に置く
- アプリのコードでは、`provider/` を `service/` からだけ呼ぶ（検査: ESLint。`api/` からの import だけを止める）。
  ただし、AI の評価の採点は `server/evals/` から呼んでよい（`.claude/rules/ai-integration.md` の「評価」）
- ファイル名は kebab-case にする。`common.ts` のような何でも入る受け皿を作らない
- ファイルを分割する前に、削れる処理が無いかを確かめる

## import の許可関係

次の表は、手本のコードの主な依存の向きです。

```
index.ts       → app.ts, config.ts, db/, util/
app.ts         → api/<機能>/index.ts, config.ts, exception/, util/, db/（型のみ）
api/<機能>/    → service/, util/（route, auth）, exception/, db/（型のみ）, @app/shared
service/       → db/, provider/, exception/, util/, config.ts, @app/shared
provider/      → config.ts, exception/, util/（log）, 外部システムの SDK
db/            → config.ts, exception/, util/（log, message）, @app/shared（型のみ）
util/          → config.ts, exception/, @app/shared（型のみ）
exception/     → util/message/
seed/          → db/, config.ts, util/
tests/         → app.ts, tests/helpers/, config.ts, db/, @app/shared
evals/         → service/, provider/（採点の呼び出し）, config.ts, @app/shared
```

- **逆方向の import を作らない**（検査: ESLint。次の組み合わせだけを止める。`api/` から `db/` の値と `provider/`、
  `service/` から `api/`、`db/` から `api/`・`service/`、`provider/`・`util/`・`exception/` から `api/`・`service/`・`db/`。
  止まると `npm run check -w server` が失敗する）
- **`src/` では動的 import（`import()`）を使わない**（検査: ESLint）。ただし、`db/client.ts` と `db/migrate.ts` は
  使ってよい
- テスト（`tests/`）では、読み込む前に環境変数やモックを差し替えるとき（`vi.doMock` の後など）に動的 import を
  使ってよい（検査の対象外）
- **`client/` のソースを import しない**
- **`@app/shared` に業務ロジックと DB 依存を置かない**（置いてよいものは [api-contract.md](api-contract.md) の「新規ファイルの配置判断」）
- 循環する import が要るように見えたら、共通の型を `@app/shared` に移す

## 層ごとの責務

| 層                    | やること                                              | やらないこと                                  |
| :-------------------- | :---------------------------------------------------- | :-------------------------------------------- |
| `api/<機能>/index.ts` | API 定義と handler の結び付け、認証 middleware の適用 | 業務判断、SQL                                 |
| controller            | service を呼び、結果を返す                            | 業務判断、SQL、レスポンスの組み立て以外の加工 |
| service               | 業務ルール、複数クエリの調整、トランザクション        | `req` / `res` に触ること                      |
| `db/`                 | テーブル定義と接続                                    | 業務判断                                      |

**controller が 20 行を超えたら、業務判断が紛れ込んでいないかを確かめる。** 紛れ込んでいたら service に移す。

## エラー

- **error middleware は `app.ts` に 1 か所だけ置く**
- throw の形と例外の扱いは [server-coding-conventions.md](server-coding-conventions.md) の「エラー」
- エラーのレスポンスの形は `{ messageKey, message, details? }` にそろえる

## なぜ

3 層に固定するのは、「この処理はどこに書くか」で迷う時間を無くすためです。層が 5 つある構成では、層ごとの責務が
曖昧になるほど、転送するだけのコードが増えます。そうなると、非エンジニアには、「意味のあるコード」と「型を移し替える
だけのコード」の区別が付きません。

一方向の import を lint で強制するのは、規約を知らない人でも間違いに気づけるようにするためです。「気をつける」だけでは、
規約は守られません。`npm run check` が失敗すれば、規約を知らなくても間違いに気づけます。

動的 import を止めるのは、import の向きの検査をすり抜けさせないためです。向きの検査は、動的 import を見られません。
テストには、向きの検査を掛けていません。そのため、テストでは動的 import も止めません。
`db/client.ts` と `db/migrate.ts` で動的 import を使ってよいのは、開発とテストでしか使わない PGlite を、本番の
起動経路に載せないためです。

error middleware を 1 か所にするのは、エラーのレスポンスの形をアプリ全体で 1 つに保つためです。
画面側は `ApiError` 1 種類だけを扱えばよくなります。
