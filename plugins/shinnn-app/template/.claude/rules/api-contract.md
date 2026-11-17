---
paths:
  - 'shared/src/**'
---

# API 定義の規約

`shared/src/api/` の zod スキーマが**唯一の正**です。

## 新規ファイルの配置判断

| 書こうとしているもの                 | 置き場所                                                                                                |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------ |
| ある機能の入出力スキーマとルート定義 | `shared/src/api/<機能>.ts`                                                                              |
| 複数の機能で共有するスキーマ         | `shared/src/api/<概念>.ts`（**2 つ以上の機能で実際に使ってから**）                                      |
| ルート定義のヘルパー                 | `shared/src/api/route.ts`（編集しない）                                                                 |
| 再エクスポート                       | `shared/src/api/index.ts` に 1 行足す（`shared/src/index.ts` は `api/index.ts` を読むので、編集しない） |

- `shared` には、入力の検証と変換を zod のスキーマとして置いてよい
- **`shared` から `server` / `client` を import しない。** 依存の向きは `server` → `shared` と `client` → `shared` だけ
- `shared` で、Node.js にしか無い機能（`fs` / `path` / `process` など）を使わない
- API 定義のための外部ライブラリを入れない。ルートは `route.ts` の `defineRoute()` で定義する
- 2 つのスキーマに同じフィールドがあるというだけで、共通のスキーマに切り出さない。**切り出すのは、概念（意味を持つ
  パラメータのまとまり）だけ**

## スキーマの書き方

- スキーマは、次の名前と役割で定義する。その機能に無いもの（一覧を返さない機能の `<X>ListSchema` など）は定義しない
  - `<X>Schema`: サーバーが返す形（id・作成日時・更新日時を含む）
  - `<X>InputSchema`: `<X>Schema` から id と日時を除いた、作成と更新で受け取る項目
  - `Create<X>Schema` / `Update<X>Schema`: `<X>InputSchema` から派生させる（更新は `.partial()`）
  - `<X>ParamsSchema`: パスパラメータ（`:id` など）
  - `<X>ListQuerySchema`: 一覧の絞り込み（`limit` / `offset` に既定値を持たせる）
  - `<X>ListSchema`: `{ items, total }`
- **各フィールドに、取りうる値の範囲を制約として書く。** `z.string()` や `z.number()` だけで済ませない
  - 文字列: `.max()` を付ける。空を許さない項目には `.min(1)` も付ける
  - 数値: 整数なら `.int()` を付ける。下限・上限があるものは `.min()` / `.max()` を付ける
  - id: `z.uuid()`
  - 列挙: `z.enum()`
- 日時は ISO 8601 の文字列（`z.iso.datetime()`）で表す。`Date` 型を API 定義に使わない
- 既定値は、スキーマの `.default()` で表す。handler の中で既定値を補わない（`?? 20` など）

## ルート定義

手本はサンプルの `shared/src/api/items.ts`（サンプルの `items` を消した後は、既存の機能を手本にする）。

- `path` は `/api/` で始める。パスパラメータは `:<名前>` の形で書く（例: `:id`）
- 本文を返さないルート（削除など）は `response: z.undefined()` にする（サーバーは 204 を返す）
- **機能ごとに、ルートをまとめたオブジェクトを `export const <機能>Api = { ... } as const;` の形で export する。**
  中には、先に `export const` で定義したルートを名前で並べる（オブジェクトの中で `defineRoute()` を呼ばない）

## 変更の手順

API 定義を変えるときは、**`shared` → `server` → `client` を同じ PR で**直します。

- `shared` を変えたら、`npm run build -w shared` を実行する（`npm run dev` の最中は自動でビルドし直される）
- **`shared/src/api/` の下を変えた PR では、`server/tests/` の下のファイルか `*.test.ts` を 1 つ以上変える**
  （検査: CI）。ただし、テストを変えなくてよい変更（コメントや整形だけなど）では、テストを変えずに、PR 本文に
  `テストを変えない理由: <理由>` の行を書いてよい（CI は、この行があれば通す。HTML のコメントの中の行と、見出しに
  した行は読まない）
- 破壊的な変更（フィールドの削除・名前の変更・型の変更）をするときは、PR 本文に影響範囲を書く

## 理由

この規約の理由は `.claude/rules-why/api-contract.md` にあります。決まりに当てはまるかを迷ったときに読みます。
