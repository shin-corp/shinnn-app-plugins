---
paths:
  - 'shared/src/**'
---

# API 定義の規約

**API 定義** = 画面とサーバーがやり取りするデータの形（URL・入力・出力）を 1 か所に書いたものです。
`shared/src/api/` の zod スキーマが**唯一の正**で、server と client はここから型を導きます。

## 新規ファイルの配置判断

| 書こうとしているもの                 | 置き場所                                                       |
| :----------------------------------- | :------------------------------------------------------------- |
| ある機能の入出力スキーマとルート定義 | `shared/src/api/<機能>.ts`                                     |
| 複数の機能で共有するスキーマ         | `shared/src/api/<概念>.ts`（**2 か所以上で実際に使ってから**） |
| ルート定義のヘルパー                 | `shared/src/api/route.ts`（触らない）                          |
| 再エクスポート                       | `shared/src/api/index.ts` と `shared/src/index.ts`             |

- **`shared` に業務ロジックを置かない。** 計算・判定・DB アクセスは書かない
- **`shared` から `server` / `client` を import しない。** 依存は一方向
- Node の API（`fs` / `path` / `process`）を import しない。ブラウザでも動く必要がある
- スキーマを「フィールドの共通部分」で切り出さない。**概念（パラメータのまとまり）単位で切り出す**

## スキーマの書き方

- 1 つの機能につき、次を定義する
  - `<X>Schema`: サーバーが返す形（id・作成日時・更新日時を含む）
  - `<X>InputSchema` から派生させた `Create<X>Schema` / `Update<X>Schema`（更新は `.partial()`）
  - `<X>ListQuerySchema`: 一覧の絞り込み（`limit` / `offset` に既定値を持たせる）
  - `<X>ListSchema`: `{ items, total }`
- **制約を書く。** 文字列は `.min()` / `.max()`、id は `.uuid()`、列挙は `z.enum()`。
  `z.string()` だけで済ませない。ここに書いた制約がサーバーの入力検証になる
- 日時は ISO 8601 の文字列。`Date` オブジェクトを API 定義に出さない（JSON で往復しない）
- 既定値は `.default()` で表す。server 側の handler で `?? 20` と書かない

## ルート定義

手本はサンプルの `shared/src/api/items.ts`（サンプルの `items` を消した後は、既存の機能を手本にする）。

```ts
export const listItems = defineRoute({
  method: 'GET',
  path: '/api/items',
  query: ItemListQuerySchema,
  response: ItemListSchema,
});

export const itemsApi = { listItems, getItem, createItem, updateItem, deleteItem } as const;
```

- `path` は `/api/` で始め、パスパラメータは `:id` の形にする
- **`as const` を付ける。** 定義を書き換えられない形に保つため。
  CI の検査もこの形（`export const <機能>Api = { ... } as const;`）を探している
- 本文を返さない削除は `response: z.undefined()`（サーバーは 204 を返す）
- 機能ごとに `<機能>Api` オブジェクトをまとめて export する。
  CI の policy job がこのキーを見て「全ルートにテストがあるか」を検査する

## 変更の手順

API 定義を変えるときは、**`shared` → `server` → `client` を同じ PR で**直します。

1. `shared/src/api/<機能>.ts` を変更する
2. `shared` をビルドする（server / client は `shared/dist` を読む）。`npm run dev` の最中は保存するたびに自動で
   ビルドし直され、server は再起動、画面も作り直される。`npm run dev` を使っていないときは `npm run build -w shared`
3. `server` の handler を型エラーが消えるまで直す
4. `client` の呼び出しを型エラーが消えるまで直す
5. 両方のテストを直す。CI の policy job は、`shared/src/api` を変えたのにテストが 1 つも変わっていない PR を落とす。
   コメントや整形だけの変更のようにテストを変えなくてよいときは、PR 本文に `テストを変えない理由: <理由>` の行を書く
   （CI はこの行があれば通す。HTML のコメントの中と、見出しにした形は読まない）

- **手書きの型定義を作らない。** `interface Item { ... }` を server / client に書かない
- 破壊的な変更（フィールドの削除・型変更）は、PR 本文に影響範囲を書く

## なぜ

1 か所に書いて両側が参照すると、**片方だけ直した状態がビルドエラーになります。** 手で書き写す方式では、
サーバーがフィールドを消しても画面はコンパイルが通り、実行して初めて `undefined` に気づきます。

テストを変えなくてよい変更を、PR 本文の理由の行で通せるようにしているのは、CI を通すためだけに意味の無い
テストの変更を足さないためです。理由は PR に残るので、レビューする人が本当にテストが要らないかを確かめられます。

zod にする理由は、同じ定義が「型」としても「実行時の検証」としても使えるからです。型だけの定義
（`interface`）は、外から来た JSON が本当にその形かを確かめてくれません。

外部ライブラリを使わないのは、この種のライブラリが数年で更新を止める例が多いためです。
100 行程度のヘルパーなら、止まっても自分たちで直せます。
