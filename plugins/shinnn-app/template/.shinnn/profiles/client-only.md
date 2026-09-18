# プロファイル: client-only

**画面だけを作る構成**です。サーバーとデータベースを用意せず、画面の作り方だけを学びたい場合や、
既に別のサーバーがある場合に選びます。

`/shinnn-app:setup` でこのプロファイルを選ぶと、下の手順が自動で適用されます。
**この文書は適用される内容の説明です。手で作業する必要はありません。**

> 自動適用の実装は Phase 2 で入ります。それまでは、当社担当がこの手順に沿って手で適用します。

## 何が変わるか

| 項目                                     | full                            | client-only                                    |
| :--------------------------------------- | :------------------------------ | :--------------------------------------------- |
| `server/`                                | あり                            | 削除する                                       |
| `shared/`                                | あり                            | **残す**（API 定義は画面の型として使い続ける） |
| `client/src/app/api-client.ts`           | `call()` が実際にサーバーを呼ぶ | 同じ関数の形のまま、手元の模擬データを返す     |
| `client/src/app/features/`               | そのまま                        | **そのまま**（画面のコードは変えない）         |
| データベース                             | PostgreSQL が要る               | 要らない                                       |
| `docker-compose.yml`                     | 使う                            | 削除する                                       |
| CI の `test` job                         | server と client のテスト       | client のテストのみ                            |
| CI の `policy` job の API 定義カバレッジ | 検査する                        | 自動で飛ばす（`server/` が無いため）           |

**画面のコードは full と同じままです。** あとからサーバーを足すときに、画面を書き直さずに済みます。

## 適用の手順

1. `server/` ディレクトリを削除する
2. ルートの `package.json` の `workspaces` から `server` を外す
3. ルートの `package.json` から `messages` スクリプトを外す
4. `docker-compose.yml` を削除する
5. `client/src/app/api-client.ts` の `call()` の中身を、模擬データを返す実装に差し替える
   - **関数の形（引数と戻り値の型）は変えない。** API 定義から導いた型のままにする
   - 模擬データは `client/src/app/mock-data.ts` に置く。画面の中に書かない
   - 遅延（`await new Promise((r) => setTimeout(r, 300))`）を入れて、loading の表示を確かめられるようにする
   - エラーを再現するための切り替え（`mock-data.ts` の定数）を用意する
6. `.claude/rules/` から `server-architecture.md` / `server-coding-conventions.md` / `db.md` / `messages.md` を削除する
7. `docs/env.md` の「サーバー」と「ローカルの PostgreSQL」の節を削除する
8. `README.md` の構成表から `server/` の行を削除する
9. `.shinnn/setup.json` の `profile` を `client-only`、`optional.client-only-profile` を `true` にする

## あとからサーバーを足すとき

`/shinnn-app:setup` を再実行して `full` を選びます。差分が PR になります。

- `api-client.ts` の模擬実装が、本物の `call()` に戻ります
- 画面のコードは変わりません（`api-client.ts` が公開している関数の形が同じため）
- `shared/src/api/` の API 定義が、そのままサーバーの実装の出発点になります

**模擬データで作っている間も、`shared/src/api/` の zod スキーマを正として書いてください。**
ここを崩すと、サーバーを足すときに画面を書き直すことになります。
