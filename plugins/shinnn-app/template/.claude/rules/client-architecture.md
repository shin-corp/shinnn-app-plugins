---
paths:
  - 'client/src/**/*.ts'
  - 'client/src/**/*.html'
---

# アーキテクチャ規約（client）

画面は **「features/ の中の画面」と「api-client.ts」だけ**で構成します。
全体方針は [../../CLAUDE.md](../../CLAUDE.md)、書き方は [client-coding-conventions.md](client-coding-conventions.md) を参照。

「（検査: …）」には、その決まりを機械で確かめる仕組みを書いています。付いていない決まりは、レビューだけで確かめます。

## データの流れ

```
shared/src/api/          API 定義（zod スキーマ）… 唯一の正
        ↓ 型がそのまま伝わる
client/src/app/api-client.ts   call() の置き場所（サーバー呼び出しはここだけ）
        ↓ resource() / toSignal()
client/src/app/features/<機能>/   画面（signal で状態を持つ）
```

## 新規ファイルの配置判断

| 書こうとしているもの                     | 置き場所                                                                            |
| :--------------------------------------- | :---------------------------------------------------------------------------------- |
| 画面本体                                 | `client/src/app/features/<機能>/<機能>-page.component.ts`                           |
| その画面でしか使わない子コンポーネント   | 同じ `features/<機能>/` の中                                                        |
| 画面のルート定義                         | `features/<機能>/<機能>.routes.ts`（`app.routes.ts` から `loadChildren`）           |
| API 呼び出し                             | 画面から `api-client.ts` の `call()` を呼ぶ（呼び出し用のファイルと関数を作らない） |
| API の入出力型                           | `shared/src/api/`（client には置かない）                                            |
| 2 画面以上で実際に使う表示部品・純粋関数 | `client/src/app/shared/`                                                            |
| 表・一覧                                 | 同梱の `client/src/app/shared/data-table/`（自前で作り直さない）                    |
| テスト                                   | 対象の隣に `<対象>.test.ts`                                                         |

- **新しい画面は `features/items/` をコピーして作り、ファイルの分け方と名前をそろえる**
  （サンプルの `items` を消した後は、既存の機能を手本にする）
- `services/` `repositories/` `stores/` `core/` `infrastructures/` `mapper/` のような**層を新設しない**
- `client/src/app/shared/` に部品や関数を置くのは、**2 つ以上の画面で実際に使ってから**にする。ただし、同梱の
  `data-table` は例外とする
- ファイル名は kebab-case にする。`*.util.ts` / `*.helper.ts` のサフィックスを使わない
- `common.ts` のような何でも入る受け皿を作らない

## import の許可関係

```
features/<機能>/  → api-client.ts, @app/shared（zod スキーマと型）,
                    同じ features/<機能>/ の中, app/shared/（共通部品）, @angular/*, @angular/material/*
app/shared/       → @app/shared（型のみ）, 同じ部品のフォルダの中, @angular/*, @angular/material/*
api-client.ts     → @app/shared（API 定義）のみ
app.routes.ts     → features/<機能>/<機能>.routes.ts（loadChildren）
```

- **上の表に無い import を作らない**
- **画面をまたいで import しない**（`features/items` から `features/orders` を参照しない）（検査: ESLint）。
  共通化したくなったら `app/shared/` へ移す
- **`server/` のソースを import しない**（検査: ESLint。`@app/server` からの import だけを止める）。共有するのは
  `@app/shared` の zod スキーマだけ
- 逆方向の import（`app/shared/` から `features/` を参照するなど）を作らない（検査: ESLint）

## 画面の状態

- 状態は**その画面のコンポーネントの `signal()`** に持つ。グローバルストアを作らない
- サーバーから取ったデータは `resource()` / `toSignal()` のまま使い、`signal()` へコピーし直さない
- 派生値の作り方は [client-coding-conventions.md](client-coding-conventions.md) の「状態」
- サーバーからデータを読み込む画面には、**empty / loading / error の 3 状態**の表示を用意する

## なぜ

層を増やさないのは、後から読む非エンジニアが「どこを直せばよいか」を見つけられるようにするためです。
`repository` → `mapper` → `store` → `facade` と 4 回転送するだけのコードは、機能が増えるほど、直す場所を
分かりにくくします。画面 1 つを直すのに開くファイルを 2 つ（画面と `api-client.ts`）に固定すると、Claude も人も
迷いません。

`server/` のソースを import しないのは、画面のバンドルにサーバーの部品を入れないためです。サーバーの実装を
import すると、DB ドライバまで画面のバンドルに入ります。

`api-client.ts` に通信を集めるのは、URL やエラー処理が画面ごとにばらけるのを防ぐためです。URL の組み立てと
エラーの変換は、`call()` の 1 か所にあります。API 定義を変えると、呼び出している画面に型エラーが出ます。

`shared/` を「2 画面以上で使ってから」にするのは、共通部品の作りすぎを防ぐためです。
1 画面しか使わない共通部品は、変更するたびに「他の画面を壊さないか」を確認する手間だけが増えます。
