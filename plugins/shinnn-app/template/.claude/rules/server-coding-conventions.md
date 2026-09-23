---
paths:
  - 'server/src/**'
  - 'server/tests/**'
  - 'server/seed/**'
---

# コーディング規約（server）

Express 5 と TypeScript の書き方です。置き場所は [server-architecture.md](server-architecture.md) を参照。

## API 定義と検証

- **ルートは `route(router, def, handler)` で定義する。** `router.get(...)` を直接書かない
- `route()` が params / query / body を zod で検証するので、**`req.body` / `req.query` / `req.params` を
  handler の中で直接参照しない**。handler は検証済みの `input` を受け取る
- 検証に失敗すると 400 の `CommonException`（`messageKey` は `APP_VALIDATION_FAILED`、
  `details` に zod の指摘）が自動で返る。handler で書かない
- **API 定義に無いルートを作らない。** 作りたくなったら先に `shared/src/api/` に定義を足す。
  CI の policy job が「API 定義にある全ルートにテストがある」ことを検査する

## Express 5 の注意（移行で変わった点）

1. async ハンドラの reject は自動で error middleware に渡る。`express-async-errors` は要らない。
   error middleware は必ず 4 引数で定義する（引数を減らすと通常の middleware と見なされる）
2. `req.query` は読み取り専用。書き換えない。既定のパーサは `?a[b]=1` をネストしない
3. ルートの書式は path-to-regexp v8。ワイルドカードは `/*splat`、省略可は `/:file{.:ext}`。
   `/foo/*` や正規表現をそのまま書くと起動時に例外になる
4. `res.status()` は 100〜999 の整数以外で例外を投げる。`res.status(err.statusCode ?? 500)` と書く
5. `req.body` は `express.json()` を通していないと `undefined`。分割代入する前に確認する
6. `res.send(status)` / `res.json(obj, status)` / `res.redirect(url, status)` / `req.param()` /
   `app.del()` は削除済み。**`res.status(...).json(...)` に統一する**
7. `express.urlencoded` の `extended` の既定は `false`
8. `app.listen(port, cb)` の cb に error が渡る（ポート使用中など）。無視しない

## 環境変数

- **読むのは `src/config.ts` だけ。** 他のファイルで `process.env` を参照しない
- `config.ts` は起動時に zod で検証し、足りなければ**起動を止める**。
  `default()` を安易に使わない（本番で設定漏れに気づけなくなる）
- 新しい環境変数を足したら、`server/.env.example` と `docs/env.md` に**名前だけ**追記する。値は書かない

## ログ

- **`console` を使わない**（ESLint で error）。`src/util/log.ts` の `Log` を使う
- ログに認証情報・トークン・個人情報・リクエストボディ全体を出さない
- 正常系のログを増やしすぎない。異常系と、外部との境界（起動・接続・外部呼び出し）に絞る

## エラー

- `throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] })` の形で throw する
- **状態コードを数字で書かない。** `src/util/http-status.ts` の `HttpStatus` の定数を使う
- **`messageKey` を文字列リテラルで書かない。** `MessageKeys` の定数を使う（[messages.md](messages.md)）
- `catch` して `console.error` だけして握りつぶさない。呼び出し元に投げ直すか、`Log.error` を残して throw する
- 予期しない例外をそのまま外に出さない。error middleware が 500 と汎用メッセージに変換する

## 型

- `any` を使わない（ESLint で error）。避けられない箇所は `unknown` + 型ガード
- **API の入出力型は `@app/shared` の zod スキーマから導出する。手書きの型定義を作らない**
- `as` キャストと non-null assertion（`!`）は最小限にする
- 定数は camelCase。`enum` を使わず `as const` + 型エイリアスの形にする

## セキュリティの既定（外さない）

- `helmet` を `app.ts` で有効にする
- CORS は許可する origin を明示する。**`*` と credentials を同時に使わない**
- `express.json({ limit: ... })` でボディの上限を設ける
- `express-rate-limit` を適用する
- **API サーバーから静的ファイルを配信しない。** 画面は別に配信する
- プロキシの背後で動かす場合、`trust proxy` の範囲を `config.ts` で明示する
- JWT を使う場合は `alg` と `aud` を明示して検証する

## 利用者ごとのデータ（他人のデータを見せない）

ログインしているか（認証）と、そのデータを扱ってよいか（認可）は別の確認です。`isAuthenticated()` は前者だけを見ます。

- データを作る前に、**誰のデータか**を仕様書の「データ」の章で決める（利用者ごと / 全員で共有 / 役割で分ける）
- 利用者ごとのデータは、テーブルに持ち主の列（`ownerId`）を置き、作成時に `currentUser(req).id` を入れる
- controller は `currentUser(req).id` を service に渡す。**service の取得・一覧・件数・更新・削除のすべての条件に持ち主を含める**。
  1 件を扱う条件は id と持ち主の組で書く（サンプルの `ownedItem()` が手本。消した後は既存の機能を手本にする）
- **他人のデータは 404 にする。** 403 にすると、その id のデータが存在することを知らせてしまう
- 持ち主の id を API の入力（本文・クエリ・パス）から受け取らない。必ずトークンから取る
- 一意性（名前の重複など）も持ち主ごとにする。全体で一意にすると、409 で他人のデータの存在が分かる
- 役割（管理者だけができる操作など）が要るなら、仕様書に書いてから service で確かめる。画面でボタンを隠すだけにしない

## なぜ

持ち主で絞るのを service のすべての条件に求めるのは、id だけで絞る書き方が最も多く、しかもテストで気づきにくいからです。
自分のデータだけで試すと、他人のデータに届く経路があっても全部のテストが通ります。
id は URL や画面に出るので、書き換えて他人のデータを開く攻撃は特別な道具なしでできます。

`req.body` の直接参照を禁じるのは、検証を通していない値がそのまま DB まで届く経路を無くすためです。
`route()` を必ず通せば「検証を書き忘れたエンドポイント」が存在できません。

`process.env` を 1 か所に集めるのは、設定漏れを**起動時**に見つけるためです。散らばっていると、
特定の画面を開いたときに初めて `undefined` が露見します。

`console` を禁じるのは、出力先と書式をそろえるためと、`console.log` がそのまま本番に残って
個人情報を吐き続ける事故を防ぐためです。

Express 5 の 8 項目を明示するのは、Claude の学習データに Express 4 の書き方が大量にあるためです。
4 の書き方はそのままでは動きません。
