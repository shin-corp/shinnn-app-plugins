# server（@app/server）

Express 5 + PostgreSQL 16（Drizzle ORM）の API サーバー。TypeScript の ESM で書く。
画面（client）とやり取りするデータの形は `shared` の API 定義が正本で、ここには書かない。

## よく使うコマンド

| コマンド                        | 内容                                          |
| ------------------------------- | --------------------------------------------- |
| `npm run dev -w server`         | ホットリロードつきで起動                      |
| `npm run check -w server`       | build + typecheck + lint（コミット前に通す）  |
| `npm run test -w server`        | テスト（DB は PGlite。PostgreSQL は不要）     |
| `npm run db:generate -w server` | スキーマの変更からマイグレーション SQL を生成 |
| `npm run db:migrate -w server`  | マイグレーションを適用                        |
| `npm run seed -w server`        | 動作確認用の初期データを投入                  |
| `npm run messages -w server`    | messages.json からメッセージキーを再生成      |
| `npm run token -w server`       | 開発中に画面へ持たせる JWT を 1 つ発行        |

`dev` / `db:migrate` / `seed` は `--env-file-if-exists=.env` で起動するので、`server/.env`（`.env.example` をコピーしたもの）が
あれば自動で読み込む。無い場合でも、既定値だけで足りる値なら起動する。

`check` は先に `@app/shared` のビルドが要る（`npm run build` か `npm run build -w shared`）。

## 起動順

1. `src/index.ts` が `config.ts` を読む（環境変数を zod で検証。ここで落ちたら値が足りない）
2. `createDb()` で DB のハンドルを作る（接続は最初の問い合わせまで張らない）
3. `createApp()` が middleware → ルーター → 404 → error middleware の順に組み立てる
4. `app.listen(PORT)`。`SIGTERM` / `SIGINT` で処理中の要求を終わらせてから止める

`app.ts`（組み立て）と `index.ts`（待ち受け）は分ける。テストは `app.ts` だけを使い、`app.listen(0)` で空きポートに立てる。

## 環境変数

値は `.env`（git 管理外）に置く。見本は `.env.example`、意味の一覧は `docs/env.md`。

| 名前           | 意味                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL への接続先                                                |
| `PORT`         | 待ち受けるポート番号                                                 |
| `JWT_SECRET`   | JWT（署名付きの通行証）の署名鍵。32 文字以上                         |
| `JWT_AUDIENCE` | JWT の受け取り手。`aud` がこの値と一致しないと通さない               |
| `CORS_ORIGIN`  | 画面を配信するオリジン。カンマ区切りで複数可                         |
| `TRUST_PROXY`  | `X-Forwarded-For` を信頼する範囲                                     |
| `NODE_ENV`     | 実行環境（development / test / production）                          |
| `LOG_LEVEL`    | ログの下限レベル                                                     |
| `DB_DRIVER`    | `pg`（既定）か `pglite`。pglite は PostgreSQL 無しで動かすためのもの |

`process.env` を直接読んでよいのは `drizzle.config.ts` だけ（アプリの外で動くため）。

## 構成と import の許可関係

```
api/<機能>/{index.ts, <機能>.controller.ts}  →  service/  →  db/
                          ＼                  ／
                             util/ ・ exception/
```

- `api` は DB を直接触らない（DB のハンドルを service へ渡すための型だけ許可）
- `service` は HTTP を知らない（`req` / `res` を持ち込まない）
- `db` と `util` / `exception` は上の層を import しない
- `repositories/` などの層は増やさない（`provider/` は外部システムとの連携専用に 1 つだけ置ける。`.claude/rules/ai-integration.md`）。
  1 ファイルが 150 行を超えたら、分割より先に減らせないか考える

この関係は `eslint.config.js` の `no-restricted-imports` で強制していて、破るとビルドが失敗する。

## エンドポイントを追加する 6 手順

1. **API 定義**: `shared/src/api/<機能>.ts` に zod スキーマと `defineRoute(...)` を書き、`<機能>Api` にまとめる
2. **ルーター**: `src/api/<機能>/index.ts` で `route(router, <機能>Api.xxx, controller.xxx)` を登録する。`router.get(...)` を直接書かない
3. **controller**: `src/api/<機能>/<機能>.controller.ts` は薄く。検証済みの入力を service へ渡し、戻り値を返すだけ
4. **service**: `src/service/<機能>.service.ts` に業務処理。失敗は `CommonException` で投げる
5. **テーブル**: 必要なら `src/db/schema/<テーブル>.ts` を足し、`db:generate` でマイグレーションを生成（SQL は手で書かない）
6. **テストと docs**: `tests/<機能>.test.ts` を追加し、`docs/仕様書.md` の受入条件と `docs/env.md` を更新する

API 定義・実装・テストは同じ PR にまとめる。片方だけ変えるとビルドか CI が落ちる。

メッセージを足すときは `resources/messages.json` だけを編集して `npm run messages` を実行する。
生成物の `src/util/message/message-keys.ts` は手で書き換えない。

## Express 5 の注意

1. async ハンドラの reject は自動で error middleware に渡る。`try / catch` で握り潰さない
2. `req.query` は読み取り専用。`?a[b]=1` はネストしない
3. ルートの書き方は path-to-regexp v8。`*` は `/*splat`、任意の部分は `/:file{.:ext}`、正規表現は書けない
4. `res.status()` は 100〜999 の整数以外で例外を投げる（`toResponseStatus()` で丸めている）
5. `req.body` は `express.json()` を通さないと `undefined`
6. `res.send(status)` / `res.json(obj, status)` / `req.param()` / `app.del` は無い。`res.status().json()` に統一
7. `express.urlencoded` の `extended` の既定は false
8. `app.listen(port, cb)` の `cb` にはエラー（ポートの重複など）が渡る

error middleware は 4 引数で `app.ts` に 1 か所だけ置く。エラー応答は `{ messageKey, message, details? }` の形で返す。

## セキュリティ既定

- `helmet` でセキュリティ関連のヘッダを付ける。`X-Powered-By` は出さない
- CORS は `CORS_ORIGIN` を明示する（`*` は使わない）。Cookie を使わないので `credentials` は許可しない
- `express.json({ limit })` で本文の大きさに上限を置き、`/api` 配下に rate limit を掛ける
- 認証は `isAuthenticated()`（Bearer トークン）。署名アルゴリズム（`alg`）・受け取り手（`aud`）・有効期限（`exp`）を明示して検証する（`exp` は `requiredClaims` で必須にする。無いトークンを通さないため）
- **CSRF 対策の middleware は入れていない**。認証情報を Cookie で持たず、毎回 `Authorization` ヘッダで送るため、他サイトからの自動送信では認証が通らない。Cookie セッションを導入するなら、その時にトークン型の対策を足す
- 静的ファイルは配信しない（画面は別に配信する）
- ログに認証情報や個人情報を書かない。`console` は使わず `util/log.ts` の `Log` を使う

## テストの書き方

- ファイル名は `<機能>.test.ts`（`.spec.ts` は CI で失敗する）
- `startServer()` で本番と同じ組み立てのサーバーを立て、native fetch で HTTP として確かめる。内部の関数を直接呼ばない
- 要求先の URL は API 定義から組み立てる（`server.url(itemsApi.getItem, { id })`）。URL を手で書かない。
  手本はサンプルの `tests/items.test.ts`（サンプルの `items` を消した後は、既存の機能を手本にする）
- `describe` は `正常系` / `異常系` / `エッジケース` に分け、テスト名の先頭に受入条件の番号（`AC-1` など）を書く
- DB はテストごとに新しい PGlite を作り、本番と同じマイグレーションを流す。テスト間でデータは混ざらない
- 実装とテストが食い違ったときは、まず実装が正しいかを確かめる。仕様書に照らして実装が誤っていれば実装を直す
