---
name: add-api
description: API のエンドポイントを 1 つ追加する 6 手順（API 定義 → テーブル → service → router と controller → テスト → docs）。「API を足したい」「エンドポイントを追加」で起動
---

# API を 1 つ追加する

このスキルは順番だけを示す。守る決まりは `server/CLAUDE.md` と `.claude/rules/` の規約にある。

最初に手本を読む。サンプルの `shared/src/api/items.ts`・`server/src/api/items/`・`server/src/service/items.service.ts`・
`server/tests/items.test.ts` が手本（サンプルの `items` を消した後は、既存の機能を手本にする）。
これらを読むと、対応する規約も読み込まれる。

**参照される側を先に書く**（API 定義 → テーブル → service → controller）。参照する側を先に書くと、途中で型が通らない。

## 1. API 定義（`shared/src/api/<機能>.ts`）

入出力の zod スキーマと `defineRoute(...)` を書き、その機能の `<機能>Api` に束ねる。
書き方は `.claude/rules/api-contract.md` の「スキーマの書き方」「ルート定義」。

## 2. テーブル（`server/src/db/schema/`。要るときだけ）

スキーマを足してから `/shinnn-app:db-migrate` を実行する。決まりは `.claude/rules/db.md`。

## 3. service（`server/src/service/<機能>.service.ts`）

業務処理を書く。エラー・ログ・利用者ごとのデータの絞り込みは `.claude/rules/server-coding-conventions.md`、
クエリとトランザクションは `.claude/rules/db.md` の「クエリとトランザクション」に従う。

## 4. router と controller（`server/src/api/<機能>/`）

`route()` ヘルパーに API 定義とハンドラを渡す（`.claude/rules/server-coding-conventions.md` の「API 定義と検証」）。
controller は検証済みの入力を service へ渡し、戻り値を返すだけにする（`.claude/rules/server-architecture.md` の「層ごとの責務」）。

router を新設したら、`server/src/app.ts` の `app.use(...)` に足す（パスは API 定義が持つので、mount 先に URL を書かない）。

## 5. テスト（`server/tests/<機能>.test.ts`）

`.claude/rules/testing.md` の「テスト名」「観点」「サーバーのテスト」に従う。受入条件があれば `AC-n` のテストを書き、
利用者ごとのデータなら別の利用者で確かめるテストも書く。

## 6. docs とメッセージ

- 新しい環境変数は、`.claude/rules/server-coding-conventions.md` の「環境変数」のとおりに書き足す
- 仕様に関わる変更なら `docs/仕様書.md` の該当章を直す
- 新しいメッセージは `.claude/rules/messages.md` の「編集の手順」で足す

## PR

shared → server → client を同じ PR に入れ、コミットは層ごとに分ける（`.claude/rules/git-workflow.md`）。
