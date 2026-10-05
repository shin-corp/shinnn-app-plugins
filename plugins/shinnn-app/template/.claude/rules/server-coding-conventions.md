---
paths:
  - 'server/src/**'
  - 'server/tests/**'
  - 'server/seed/**'
---

# コーディング規約（server）

Express 5 と TypeScript の書き方です。置き場所は [server-architecture.md](server-architecture.md) を参照。

「（検査: …）」には、その決まりを機械で確かめる仕組みを書いています。付いていない決まりは、レビューだけで確かめます。

## API 定義と検証

- **ルートは `route(router, def, handler)` で定義する。** `router.get(...)` を直接書かない
- **handler の中で `req.body` / `req.query` / `req.params` を直接参照しない。** handler は、`route()` が zod で
  検証した `input` を受け取る
- handler で入力の検証を書かない。検証に失敗すると、`route()` が 400 の `CommonException`（`messageKey` は
  `APP_VALIDATION_FAILED`、`details` に zod の指摘）を返す
- **API 定義に無いルートを作らない。** 作りたくなったら、先に `shared/src/api/` に定義を足す
  （CI の API 定義の検査は、API 定義にあるルートだけを数える。API 定義に無いルートは、テストが無くても CI が通る）
- ただし、稼働確認の `/health` は、API 定義と `route()` を使わずに `app.ts` に置いてよい

## Express 5 の注意（移行で変わった点）

1. async の handler の reject は、自動で error middleware に渡る。`express-async-errors` を入れない。
   error middleware は 4 引数で定義する（引数を減らすと、通常の middleware と見なされる）
2. `req.query` は読み取り専用なので、書き換えない。既定のパーサは `?a[b]=1` をネストしない
3. ルートの書式は path-to-regexp v8 に従う。ワイルドカードは `/*splat`、省略可は `/:file{.:ext}` と書く。
   `/foo/*` や正規表現をそのまま書かない（起動時に例外になる）
4. `res.status()` には 100〜999 の整数だけを渡す（それ以外は例外になる）。例外から取り出した
   状態コードのように型の決まらない値は、`toResponseStatus()`（`src/util/http-status.ts`）を通して渡す。`HttpStatus` の
   定数は、そのまま渡してよい
5. `req.body` は、`express.json()` を通していないと `undefined` になる。middleware で `req.body` を分割代入する前に、
   値があるかを確かめる
6. `res.send(status)` / `res.json(obj, status)` / `res.redirect(url, status)` / `req.param()` / `app.del()` は
   削除済みなので使わない。**`res.status(...).json(...)` の形で書く**
7. `express.urlencoded` の `extended` の既定は `false` である
8. `app.listen(port, cb)` の `cb` には error が渡る（ポート使用中など）。その error を無視しない

## 環境変数

- **`process.env` を読むのは `src/config.ts` だけにする。** ただし、アプリの外で動く `drizzle.config.ts` と `scripts/`、
  子プロセスに環境を引き継ぐ `provider/`（[ai-integration.md](ai-integration.md) の `env`）は読んでよい
- `config.ts` は、起動時に zod で環境変数を検証する。値が足りなければ、**起動を止める**
- `default()` は、どの環境でも決まった値を置ける環境変数（`PORT`・`LOG_LEVEL` など）にだけ付ける。接続先や秘密の値
  （`DATABASE_URL`・`JWT_SECRET` など）には付けない
- 新しい環境変数を足したら、`server/.env.example` と `docs/env.md` に**名前だけ**を書き足す。値は書かない

## ログ

- **`console` を使わない**（検査: ESLint）。`src/util/log.ts` の `Log` を使う
- ログに、認証情報・トークン・個人情報・リクエストの本文全体を出さない
- ログに出すのは、異常系と、外部との境界（起動・接続・外部の呼び出し）だけにする

## エラー

- `throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] })` の形で throw する
- **状態コードを数字で書かない。** `src/util/http-status.ts` の `HttpStatus` の定数を使う
- **`messageKey` を文字列リテラルで書かない。** `MessageKeys` の定数を使う（[messages.md](messages.md)）
- `CommonException` の `details` に、内部の情報（テーブル名・SQL・スタックトレース・ファイルパス）を入れない。
  調査に必要な情報はログに入れる
- catch した例外を握りつぶさない。呼び出し元に投げ直すか、`Log.error` を残してから throw する
- error middleware の、予期しない例外を 500 と汎用のメッセージに変える処理を外さない

## 型

- `any` を使わない（検査: ESLint）。避けられない箇所は `unknown` と型ガードで書く
- **API の入出力の型は、`@app/shared` の zod スキーマから導く。手書きの型定義を作らない**
- `as` キャストと non-null assertion（`!`）は、型ガードや zod の検証で型を絞れない場合にだけ使う。手本では、
  ライブラリどうしの型の食い違い（`db/client.ts`・`db/migrate.ts`）、型引数で決まる型（`util/validate.ts`）、リポジトリの
  中のファイルを読んだ JSON（`messages.json`）に使っている
- ただし、テストでは、API 定義で形が決まっているレスポンスの本文（`res.json()`）に、検証せずに `as` で型を付けてよい
- `enum` を使わず、`as const` のオブジェクトと、その値から導いた型の形で書く（`HttpStatus` と `HttpStatusCode` の
  ように、名前は PascalCase）

## セキュリティの既定（外さない）

- `helmet` を `app.ts` で有効にする
- CORS では、許可する origin を明示する。**`*` と credentials を同時に使わない**
- `express.json({ limit: ... })` で本文の大きさの上限を設ける
- `express-rate-limit` を適用する
- **API サーバーから静的ファイルを配信しない。** 画面は別に配信する
- プロキシの背後で動かす場合は、`trust proxy` の範囲を `config.ts` で明示する
- JWT を使う場合は、`alg` と `aud` を明示して検証する

## 利用者ごとのデータ（他人のデータを見せない）

ログインしているか（認証）と、そのデータを扱ってよいか（認可）は別の確認です。`isAuthenticated()` は前者だけを見ます。

- テーブルを足す前に、**誰のデータか**を仕様書の「データ」の章で決める（利用者ごと / 全員で共有 / 役割で分ける）
- 利用者ごとのデータは、テーブルに持ち主の列（`ownerId`。[db.md](db.md) の「スキーマ」）を置く。作成時には、
  その列に `currentUser(req).id` を入れる
- controller は `currentUser(req).id` を service に渡す。**service の取得・一覧・件数・更新・削除のすべての条件に
  持ち主を含める**。1 件を扱う条件は、id と持ち主の組で書く（サンプルの `ownedItem()` が手本。消した後は既存の機能を
  手本にする）
- **他人のデータは 404 にする。** 403 にしない
- 持ち主の id を、API の入力（本文・クエリ・パス）から受け取らない。トークンから取る
- 一意性（名前の重複など）は、持ち主ごとに判定する。全体で一意にしない
- 役割（管理者だけができる操作など）が要るときは、仕様書に書いてから service で確かめる。画面でボタンを隠すだけにしない

## なぜ

持ち主で絞るのを service のすべての条件に求めるのは、他人のデータに届く経路を残さないためです。id だけで絞る
書き方は、最もよくある誤りです。しかも、テストで気づきにくい誤りです。自分のデータだけで試すと、他人のデータに届く
経路があっても、全部のテストが通ります。id は URL や画面に出ます。そのため、id を書き換えて他人のデータを開く攻撃は、
特別な道具なしでできます。

他人のデータを 403 にしないのは、その id のデータがあることを知らせないためです。403 は「データはあるが、扱えない」
という意味になります。一意性を全体で判定しないのも、同じ理由です。全体で判定すると、409 から、他人のデータがある
ことが分かります。

`req.body` の直接参照を禁じるのは、検証を通していない値が DB まで届く経路を無くすためです。`route()` を通す
ようにすれば、検証を書き忘れたエンドポイントは作れません。

`/health` を API 定義に入れないのは、監視から認証なしで呼べるようにするためです。API 定義のルートは `/api` の下に
置かれ、認証と rate limit が掛かります。

`details` に内部の情報を入れないのは、攻撃の手がかりを利用者に見せないためです。`details` は、文言と一緒に
レスポンスで画面へ返ります。

サーバーのテストが受け取るレスポンスの本文は、API 定義で形が決まっています。そのため、テストでは検証せずに型を
付けてよいとしています。

`process.env` を 1 か所に集めるのは、設定漏れを**起動時**に見つけるためです。読む箇所が散らばっていると、設定漏れに
気づくのは、特定の画面を開いて `undefined` が出たときになります。接続先や秘密の値に `default()` を付けないのも、
同じ理由です。付けると、本番で設定を忘れても起動してしまいます。

`console` を禁じる理由は 2 つあります。1 つ目は、ログの出力先と書式をそろえるためです。2 つ目は、`console.log` が
本番に残り、個人情報を出し続けるのを防ぐためです。

Express 5 の 8 項目を明示するのは、Claude が Express 4 の書き方で書くのを防ぐためです。Claude の学習データには、
Express 4 の書き方が大量にあります。4 の書き方は、5 ではそのままでは動きません。
