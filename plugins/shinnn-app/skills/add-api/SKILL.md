---
name: add-api
description: API のエンドポイントを 1 つ追加する 6 手順（API 定義 → controller → service → DB スキーマ → テスト → docs）。「API を足したい」「エンドポイントを追加」で起動
---

# API を 1 つ追加する

**API 定義（`shared`）が唯一の正**。ここを先に書き、server と client はそれを参照する。
手書きの型を作らない。

## 1. API 定義（`shared/src/api/`）

入出力の zod スキーマと、ルートの定義を書く。手本はサンプルの `shared/src/api/items.ts`
（サンプルの `items` を消した後は、既存の機能を手本にする）。

```ts
export const CreateItemSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
});

export const createItem = defineRoute({
  method: 'POST',
  path: '/api/items',
  body: CreateItemSchema,
  response: ItemSchema,
});
```

- `path` のパラメータは `/api/items/:id` の形で書く
- 本文を返さない削除系は `response: z.undefined()`（204 になる）
- 定義したルートは、その機能の `xxxApi` オブジェクトに `as const` で束ねる

## 2. controller（`server/src/api/<機能>/`）

`route()` ヘルパーに定義とハンドラを渡す。**`req.body` / `req.query` / `req.params` を直接読まない。**
検証はヘルパーが行い、失敗すれば 400 の `CommonException`（`APP_VALIDATION_FAILED`）になる。

```ts
route(router, itemsApi.createItem, async (input) => itemService.create(input.body));
```

router を新設したら、`server/src/app.ts` の `app.use(...)` に足す（パスは API 定義が持つので、mount 先に URL を書かない）。

## 3. service（`server/src/service/`）

業務処理はここに書く。controller には条件分岐を置かない。

- エラーは `throw new CommonException(statusCode, MessageKeys.XXX, details)`
- ログは `Log` のみ（`console` は lint が落とす）
- 複数の書き込みが 1 つの意味を持つなら `db.transaction` で包む
- **利用者ごとのデータは、controller から `currentUser(req).id` を受け取り、取得・一覧・件数・更新・削除のすべての条件を持ち主で絞る。**
  他人のデータは 404 にする。持ち主の id を API の入力から受け取らない

## 4. DB スキーマ（`server/src/db/schema/`）

テーブルが要るなら、スキーマを足してから `/shinnn-app:db-migrate` を実行する。
`server/drizzle/` の生成物は手で書かない。

## 5. テスト（`server/tests/`）

**ルート 1 つにつき最低 2 本**（正常系・異常系）。エッジケースは必要に応じて足す。

- 実サーバーを立てて（`app.listen(0)`）、`fetch` で本番と同じ HTTP 経路を叩く
- 受入条件があるなら、テスト名に `AC-n` を含める（CI が照合する）
- 利用者ごとのデータなら、別の利用者のトークン（`createAuthHeaders({ subject })`）で 404 になることと、一覧に入らないことを確かめる
- テストの DB は既定で PGlite。実 PostgreSQL でしか確認できないものは、接続先を渡す環境変数を足し、`docs/env.md` に名前を書く

## 6. docs

- 新しい環境変数を足したら `docs/env.md` に書く
- 仕様に関わる変更なら `docs/仕様書.md` の該当章を直す
- 新しいメッセージは `server/resources/messages.json` に足し、`npm run messages` で生成する。
  生成された `message-keys.ts` は手で書かない

## 順番と PR

**shared → server → client を同じ PR に入れる。** 片方だけ変えると、参照している側が壊れたまま main に入る。
コミットは層ごとに分ける（`.claude/rules/git-workflow.md` の「コミットの分け方」）。
