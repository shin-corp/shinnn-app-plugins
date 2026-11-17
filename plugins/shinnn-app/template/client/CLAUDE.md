# CLAUDE.md（client）

画面を担当する Angular のアプリです。サーバー（`server/`）の `/api` を呼び、入出力の形は `shared/` の API 定義に従います。
書き方の決まりは、`client/src/` のファイルを触ると読み込まれる規約（`client-architecture.md`・`client-coding-conventions.md`・`client-styling.md`）にあります。

## 動かし方

- `npm run dev -w client` で開発サーバー（localhost:4200）が立つ。`/api` は localhost:3000 のサーバーへ送るので、先にサーバーを起動しておく
- ルートの `npm run dev` は、`shared` を保存するとビルドし直して画面に反映する
- `@app/shared` は、開発サーバーの事前バンドル（依存を最初に 1 回だけまとめてキャッシュする仕組み）から外してある（`angular.json` の `prebundle.exclude`）。外したままにする（戻すと、`shared` をビルドし直しても画面が古い API 定義のまま動く）
- 確かめるのは `npm run check -w client`（ビルドと lint）と `npm run test -w client`（Vitest）
- `@app/shared` は `'@app/shared'` と `'@app/shared/api'` からだけ import する。深い import をしない

## 画面の決まり

画面を足す手順は `/shinnn-app:add-screen` にある。手本は `features/items/`（サンプルの `items` を消した後は、既存の機能を手本にする）。

- **取得と 3 状態**: 取得は `resource()` + `call()`。**読み込み中・0 件・失敗の 3 状態を出し分ける**。
  失敗は `MatSnackBar` に `describeError()` の文言を出す
- **一覧**: `shared/data-table` を使う。列定義（`DataTableColumn`）を書くだけにして、並べ替え・ページング・絞り込みを画面ごとに実装しない。
  `data-table` が扱うのは**画面が取得済みの行だけ**なので、取得件数は `limit` を明示して決める（省略するとサーバーの既定 20 件になる）。
  **100 件を超えうる一覧はサーバーページングにする**（`limit` と `offset` を画面の signal にして、ページャの操作で読み直す）。
  総件数（`total`）と取得件数が食い違う場合は、そのことを画面に出す
- **入力**: `MatDialog` + Reactive Forms + Material の form field / select。編集対象は `MAT_DIALOG_DATA` で受け取る
- **見た目**: アプリ全体の方針は `docs/仕様書.md` の「見た目の方針」に沿う。`frontend-design` スキルでデザインの指導を受ける場面は、
  規約 `client-styling.md` の「デザインの指導」にある。見た目を変える依頼も `/shinnn-app:feature` から進める

## API 呼び出し

```ts
import { itemsApi } from '@app/shared/api';
import { call } from '../../api-client';

const list = await call(itemsApi.listItems, { query: { limit: 20 } });
```

- `call()` は、`localStorage` の `token` を Bearer で付ける（無ければ付けない）。
  ログイン画面はテンプレートに含めていないので、**開発中は `npm run token -w server` で発行した値を
  `localStorage.setItem('token', '<発行された値>')` で入れる**（手順は README.md）
- 型が `any` になったら、API 定義の `response` が未指定でないかを確かめる
