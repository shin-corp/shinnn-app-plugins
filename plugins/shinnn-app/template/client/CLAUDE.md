# CLAUDE.md（client）

Claude Code が `client/` 配下で作業する際の指針。
リポジトリ全体の方針はルートの [CLAUDE.md](../CLAUDE.md) を参照する。

## 概要

画面を担当する Angular アプリケーション。UI は日本語。
サーバー（`server/`）が提供する `/api` を呼ぶ。入出力の形は `shared/` の **API 定義**が唯一の正。

> **API 定義**: 画面とサーバーがやり取りするデータの形（URL・入力・出力）を `shared/src/api/` に 1 か所で書いたもの。
> 両側が同じ定義を参照するので、片方を変えるともう片方がビルドエラーになる。

## 技術スタック

| 項目           | 内容                                                                      |
| :------------- | :------------------------------------------------------------------------ |
| フレームワーク | Angular 22（standalone / signals / 新制御フロー / zoneless）              |
| 言語           | TypeScript 6.0（strict + Angular 厳密テンプレートチェック）               |
| UI 部品        | Angular Material + CDK（MIT）                                             |
| スタイル       | Tailwind CSS 4 のユーティリティ。独自 CSS を書き足さない                  |
| テスト         | Vitest（`ng test`。ファイル名は `*.test.ts`、**`*.spec.ts` は使わない**） |
| Lint           | ESLint + angular-eslint（`ng lint`）                                      |

> 版を変えたらこの表と `docs/env.md` を同時に直す。実態と食い違った記述は残さない。

## コマンド

| コマンド                  | 説明                                                                |
| :------------------------ | :------------------------------------------------------------------ |
| `npm run dev -w client`   | 開発サーバー（localhost:4200、`/api` を localhost:3000 へプロキシ） |
| `npm run build -w client` | ビルド（型検査もここで行われる）                                    |
| `npm run lint -w client`  | ESLint                                                              |
| `npm run check -w client` | build + lint                                                        |
| `npm run test -w client`  | Vitest（`src/**/*.test.ts`）                                        |

`dev` の前に `server/` が localhost:3000 で起動している必要がある（`proxy.conf.json`）。
`@app/shared` を先に建てる必要がある（`npm run build -w shared`。ルートの `npm run build` なら順に建つ）。
ルートの `npm run dev` は `shared` も監視してビルドし直す。`@app/shared` は開発サーバーの事前バンドル（依存を最初に 1 回だけ
まとめてキャッシュする仕組み）から外してある（`angular.json` の `prebundle.exclude`）。外さないと、`shared` を建て直しても
画面は古い API 定義のまま動く。

## ディレクトリ構成

```
client/
├── angular.json          # ビルド・dev-server・test・lint
├── proxy.conf.json       # /api を localhost:3000 へ
├── .postcssrc.json       # Tailwind 4（@tailwindcss/postcss）
└── src/
    ├── styles.css        # Tailwind と Material のレイヤ順、Material のトークン
    └── app/
        ├── app.config.ts     # アプリ全体のプロバイダ
        ├── app.routes.ts     # 1 機能 = 1 遅延読み込みルート
        ├── app.component.ts  # ツールバーと router-outlet だけのシェル
        ├── api-client.ts     # call()。サーバー呼び出しはここ経由のみ
        ├── features/
        │   ├── _example/     # 手本の在りかを示すだけ。実装は置かない
        │   └── items/        # サンプル縦切り。新しい画面はこれをまねる
        └── shared/
            └── data-table/   # 並べ替え・ページング・列絞り込み付きの表
```

## 配置と依存のルール

- `services/` `repositories/` `stores/` `core/` `infrastructures/` を**作らない**。client は「画面 + API クライアント」だけ
- `shared/` に置くのは **2 画面以上で使うもの**だけ（同梱の `data-table` は例外）
- 機能どうしを直接 import しない。共有したくなったら `shared/` へ上げる（ESLint がビルドを止める）
- `@app/shared` の入口は `'@app/shared'` と `'@app/shared/api'` だけ。深い import をしない
- server の実装を import しない（画面のバンドルに巻き込まれる）
- 1 ファイル 150 行を超えたら、分割より先に削ることを検討する

## Angular 規約

| 対象           | 決まり                                                                                          |
| :------------- | :---------------------------------------------------------------------------------------------- |
| コンポーネント | standalone のみ。**NgModule 禁止**                                                              |
| 制御フロー     | `@if` / `@for` / `@switch`。**`*ngIf` / `*ngFor` 禁止**                                         |
| 状態           | `signal()` / `computed()` / `input()` / `output()`。**`@Input()` / `@Output()` デコレータ禁止** |
| 取得           | `api-client.ts` の `call()` + `resource()`。**手動 `subscribe` 禁止**。NgRx 禁止                |
| HTTP           | **`HttpClient` 禁止**（`call()` は fetch で動く）。`fetch` を画面から直接呼ばない               |
| DI             | `inject()` 関数（コンストラクタインジェクションは使わない）                                     |
| 変更検知       | 全コンポーネントに `ChangeDetectionStrategy.OnPush`                                             |
| 型             | `any` を使わない。**手書きの API 型定義禁止**（`shared` の zod が正）                           |
| 子への受け渡し | `input()` か `MAT_DIALOG_DATA`。子が親の状態を直接読み書きしない                                |

- `@for` の追跡は `track item.id` / `track $index` を直書きする。`trackBy` ヘルパーは作らない
- 派生値は `computed()`。`effect()` + `set()` で導出値を作らない（`effect()` は通知など副作用だけ）
- ファイル名は kebab-case。ページコンポーネントは `export default class`（遅延読み込み用）
- コメント・JSDoc は日本語

## スタイル

- 見た目は **Tailwind のユーティリティ + Material の部品**で作る。`styles.css` にクラス定義を書き足さない
- `styles.css` がカスケードレイヤの順を `tailwind-base → material → tailwind-utilities` に固定している。
  この順のおかげで Material の見た目が Tailwind の preflight に潰されず、余白などはユーティリティで上書きできる
- 配色は Material のシステム変数（`--mat-sys-*`）。`@theme` で Tailwind の色（`text-primary` など）に流し込んである。
  新しい色を直値で書かない
- 配色と書体は `styles.css` の 1 か所で決める（画面だけで使うものも、役割の名前で `@theme` に足す）。
  方針は `docs/仕様書.md` の「見た目の方針」、入れ方の決まりは `.claude/rules/client-styling.md` の「テーマと書体」

## 画面の決まり

画面を足す手順は `/shinnn-app:add-screen`。ここには守る決まりだけを書く。手本は `features/items/`
（サンプルの `items` を消した後は、既存の機能を手本にする）。

- **取得と 3 状態**: 取得は `resource()` + `call()`。**読み込み中・0 件・失敗の 3 状態を必ず出し分ける**。
  失敗は `MatSnackBar` に `describeError()` の文言を出す
- **一覧**: `shared/data-table` を使う。列定義（`DataTableColumn`）を書くだけにして、並べ替え・ページング・絞り込みを画面ごとに実装しない。
  `data-table` が扱うのは**画面が取得済みの行だけ**なので、取得件数は `limit` を明示して決める（省略するとサーバーの既定 20 件になる）。
  **100 件を超えうる一覧はサーバーページングにする**（`limit` と `offset` を画面の signal にして、ページャの操作で読み直す）。
  総件数（`total`）と取得件数が食い違う場合は、そのことを画面に出す
- **入力**: `MatDialog` + Reactive Forms + Material の form field / select。編集対象は `MAT_DIALOG_DATA` で受け取る
- **見た目**: 画面を足す・見た目を変えるときは、コードを書く前に `frontend-design` スキルで案を立てる
  （`add-screen` の手順 0 と 3。見た目を変える依頼も `/shinnn-app:feature` から進める）。
  アプリ全体の方針は `docs/仕様書.md` の「見た目の方針」に沿う

## API 呼び出し

```ts
import { itemsApi } from '@app/shared/api';
import { call } from '../../api-client';

const list = await call(itemsApi.listItems, { query: { limit: 20 } });
```

- URL を個別に組み立てない。`call()` が API 定義の `path` から組み立てる
- 認証トークンは `localStorage` の `token` を Bearer で付ける（無ければ付けない）。
  ログイン画面はテンプレートに含めていないので、**開発中は `npm run token -w server` で発行した値を
  `localStorage.setItem('token', '<発行された値>')` で入れる**（手順は README.md）
- 2xx 以外は `ApiError`（`status` / `messageKey` / `message` / `details`）が投げられる。
  画面は `describeError()` で文言にするか、`messageKey` を見て出し分ける
- 型が `any` に落ちたら、API 定義の `response` が未指定であることを疑う

## コーディング規約

詳細はルートの `.claude/rules/` にある（`paths` で `client/src/**` を対象にしたファイルが自動で読み込まれる）。
rules の記述が本ファイルと食い違う場合は、**本ファイルを正とし rules を直す**。
