# お手本の機能

新しい画面を作るときは、このディレクトリではなく [`../items/`](../items/) を手本にする。

`items` は item（name / description / status）の一覧・作成・編集・削除を、
API 定義（`shared`）→ サーバー（`server`）→ 画面（`client`）まで一通り実装したもの。
画面を足す手順（`/shinnn-app:add-screen`）と、`client/CLAUDE.md` の「画面の決まり」は、この `items` の形に沿っている。

見るところ:

| ファイル                  | 何の手本か                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `items.routes.ts`         | 1 機能 = 1 遅延読み込みルート                                     |
| `items-page.component.ts` | `resource()` での取得、`shared/data-table` の使い方、失敗の見せ方 |
| `item-form.component.ts`  | MatDialog と Reactive Forms、`MAT_DIALOG_DATA` での受け渡し       |
| `item-status.ts`          | API 定義の enum と画面の表示名の対応づけ                          |

このディレクトリには実装を置かない。増やすのは `features/<機能>/` の側。
