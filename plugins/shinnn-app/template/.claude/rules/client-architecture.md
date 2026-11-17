---
paths:
  - 'client/src/**/*.ts'
  - 'client/src/**/*.html'
---

# アーキテクチャ規約（client）

画面は **「features/ の中の画面」と「api-client.ts」だけ**で構成します。

## 新規ファイルの配置判断

- 画面本体は `client/src/app/features/<機能>/<機能>-page.component.ts` に置く
- その画面でしか使わない子コンポーネントは、同じ `features/<機能>/` の中に置く
- 画面のルート定義は `features/<機能>/<機能>.routes.ts` に置く（`app.routes.ts` から `loadChildren` で読み込む）
- API は、画面から `api-client.ts` の `call()` で呼ぶ
- API の呼び出し用のファイルと関数を作らない
- 表示部品と純粋関数を `client/src/app/shared/` に置くのは、2 つ以上の画面で実際に使ってからにする（同梱の `data-table` は例外）
- 表・一覧は、同梱の `client/src/app/shared/data-table/` で作る。自前で作り直さない
- `services/` `repositories/` `stores/` `core/` `infrastructures/` `mapper/` のような**層を新設しない**
- `*.util.ts` / `*.helper.ts` の接尾辞を使わない

## import の許可関係

- **画面をまたいで import しない**（`features/items` から `features/orders` を参照しない）（検査: ESLint。
  `features/` と `app/shared/` の中で、`../<名前>/…` の形と、パスに `features/` を含む形の import だけを止める。
  同じ機能のサブフォルダから隣のフォルダへの `../<名前>/…` と、`app/shared/` の部品どうしの import も止まる）
- **`server/` のソースを import しない**（検査: ESLint。`@app/server` からの import だけを止める）
- 逆方向の import（`app/shared/` から `features/` を参照するなど）を作らない（検査: ESLint。`app/shared/` から
  `features/` への import だけを止める）

## 画面の状態

- 状態は**その画面のコンポーネントの `signal()`** に持つ。グローバルストアを作らない
- サーバーから取ったデータは `resource()` / `toSignal()` のまま使い、`signal()` へコピーし直さない

## 理由

この規約の理由は `.claude/rules-why/client-architecture.md` にあります。決まりに当てはまるかを迷ったときに読みます。
