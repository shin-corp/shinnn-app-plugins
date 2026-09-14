---
name: add-screen
description: 画面を 1 つ追加する 8 手順（ルート → ページ → API 呼び出し → 表示 → 入力 → 状態 → スタイル → テスト）。「画面を追加したい」「新しいページを作る」で起動
---

# 画面を 1 つ追加する

`client/CLAUDE.md` の「画面の作り方」を手順にしたもの。**層を新しく作らない**（フラット構成を崩さない）。

## 1. 置き場所を決める

`client/src/app/features/<機能名>/` に、その画面に関わるものをまとめて置く。
2 つ以上の画面から使うものだけを `client/src/app/shared/` に上げる。**1 つしか使わないうちは上げない。**

## 2. ルートを足す

`features/<機能名>/<機能名>.routes.ts` を作り、`app.routes.ts` から `loadChildren` で繋ぐ。
ページ本体は `loadComponent` で読み込むので、コンポーネントは `export default class` にする。

## 3. ページのコンポーネントを作る

- standalone（`imports` に必要なものを並べる。NgModule は使わない）
- `ChangeDetectionStrategy.OnPush`
- 依存は `inject()` で受け取る（コンストラクタ引数で受けない）
- セレクタは `app-kebab-case`

## 4. API を呼ぶ

**`api-client.ts` の `call()` だけ**を使う。`fetch` や `HttpClient` を画面から直接呼ばない。
渡す入力と返る値の型は `shared` の API 定義から決まるので、型を手で書かない。
手本はサンプルの `features/items/`（サンプルの `items` を消した後は、既存の機能を手本にする）。

```ts
const list = await call(itemsApi.listItems, { query: { limit: 20, offset: 0 } });
```

エラーは `ApiError`（`status` / `messageKey` / `message`）で来る。**利用者に見せる文言は `describeError()` で作る。**

## 5. 表示する

- テンプレートは `@if` / `@for`（`*ngIf` / `*ngFor` は使わない）
- 一覧・フォーム・ダイアログは Angular Material のコンポーネントを使い、自作しない
- 子コンポーネントには `input()` で渡す。子から機能の状態を直接読みに行かせない

## 6. 状態を持つ

- 画面の状態は `signal()`、そこから導ける値は `computed()`
- `effect()` は「外の世界へ出す」用途だけ。値の計算に使わない
- 購読が必要なら `takeUntilDestroyed(this.destroyRef)` を付ける

## 7. スタイルを当てる

- Tailwind のユーティリティと Material のテーマ変数だけを使う
- 独自の CSS ファイルを増やさない。どうしても必要なら理由をコメントに書く
- 色は必ずテーマ変数から取る（値を直接書かない）

## 8. テストを書く

受入条件 `AC-n` ごとに 1 つ以上。テスト名に `AC-n` を含める。
画面の見た目そのものではなく、**利用者にできること**（入力できる・一覧に出る・エラーが見える）を確認する。

## 確認

```
npm run check -w client
/shinnn-app:check
```
