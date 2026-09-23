---
name: dev-stack-start
description: 開発用のサーバー群（PostgreSQL・API サーバー・画面）を起動・停止する。引数で対象を選ぶ（server / client / all / stop）。「開発サーバーを起動」「動かして確認したい」「止めて」で起動
---

# 開発環境の起動と停止

引数（`$ARGUMENTS`）で対象を選ぶ。省略時は `all`。

| 引数 | 対象 |
|:--|:--|
| `server` | PostgreSQL と API サーバー |
| `client` | 画面（API は別途必要） |
| `all` | すべて |
| `stop` | 起動したものを止める |

## 起動の順番

**この順を守る。** 逆にすると接続できずに落ちる。

1. **PostgreSQL**: `.shinnn/setup.json` の `database.mode` に記録された方法で起動する
   - `docker`: `docker compose --profile dev up -d`
   - `local-postgres` / `database-url` / `managed`: すでに動いているものを使う。
     起動していなければ人に伝える
   - `embedded-postgres` / `pglite`: 起動の手順は `docs/env.md` の「ローカルの PostgreSQL」節に
     `node scripts/setup-env.mjs --write` が記録している。そこに書かれた方法で起動する
2. **マイグレーションの適用**: `npm run db:migrate -w server`
3. **API 定義**: `npm run build -w shared` のあと、`npm run dev -w shared`（`tsc --watch`。`shared/src` の変更で `shared/dist` を作り直す）
4. **API サーバー**: `npm run dev -w server`（`node --watch` + tsx。`src/` と `shared/dist` の変更で自動再起動する）
5. **画面**: `npm run dev -w client`（`shared/dist` の変更でも作り直す）

長く動き続けるプロセス（3〜5）は**バックグラウンドで起動する**。前面で実行すると応答が返らなくなる。

**再起動に注意。** API サーバーは import しているファイルが変わると再起動し、処理中の要求はその場で切れる（画面側のプロキシは空の 502 を返す）。`shared/src` の保存（3 の監視が作り直す）、`shared` のビルド（ルートの `npm run check` / `npm run build` も含む）、ブランチの切り替えがこれに当たる。時間のかかる要求（外部 API の呼び出しなど）を確かめている間は、これらを実行しない。

## 起動の確認

| 対象 | 確認方法 |
|:--|:--|
| PostgreSQL | サーバーの起動ログに接続エラーが出ていないこと |
| API サーバー | `curl http://localhost:<PORT>/health`（ポートは `docs/env.md`。認証は要らない） |
| 画面 | ブラウザで開ける。API へのリクエストが proxy 経由で通る |

ポートと環境変数の一覧は `docs/env.md` が正。**このスキルに値を直接書かない**（環境ごとに違う）。

## 停止

起動したプロセスを止め、Docker を使った場合は `docker compose down` する。
**次の人が同じ状態から始められるように後始末する。**

## うまく行かないとき

| 症状 | 原因 | 直し方 |
|:--|:--|:--|
| ポートが使われている | 前回のプロセスが残っている | 残っているプロセスを止めてから起動する |
| DB に接続できない | PostgreSQL が起動していない / 接続先が違う | 起動を確認し、`.env` の接続先を人に確認してもらう |
| テーブルが無い | マイグレーション未適用 | `/shinnn-app:db-migrate` |
| 画面から API に届かない | proxy の設定 | `client` の proxy 設定の転送先と API のポートを突き合わせる |
