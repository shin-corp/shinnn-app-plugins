# 環境変数と実行環境

**値を書かないでください。** 名前と「どこに置くか」だけを書きます。
実際の値は `.env`（git に入りません）と GitHub の secret に置きます。

## サーバー（server）

`server/.env` に置きます。雛形は `server/.env.example` です。

| 名前           | 用途                                                             | 置き場所                      | 必須                       |
| :------------- | :--------------------------------------------------------------- | :---------------------------- | :------------------------- |
| `DATABASE_URL` | PostgreSQL の接続先                                              | `server/.env` / CI は secret  | はい                       |
| `JWT_SECRET`   | JWT（署名付きの通行証）の署名鍵。32 文字以上                     | `server/.env` / 本番は secret | はい                       |
| `JWT_AUDIENCE` | JWT の受け取り手。`aud` がこの値と一致しないと通さない           | `server/.env`                 | はい                       |
| `CORS_ORIGIN`  | 画面を配信するオリジン（カンマ区切り。`*` は使えない）           | `server/.env`                 | はい                       |
| `TRUST_PROXY`  | `X-Forwarded-For` を信頼する範囲（`false` / `true` / 段数 / IP） | `server/.env`                 | いいえ（既定 `false`）     |
| `PORT`         | サーバーが待ち受けるポート                                       | `server/.env`                 | いいえ（既定 3000）        |
| `NODE_ENV`     | 実行モード（`development` / `test` / `production`）              | 実行環境                      | いいえ（既定 development） |
| `LOG_LEVEL`    | ログの下限レベル（`trace`〜`fatal` / `silent`）                  | 実行環境                      | いいえ（既定 info）        |
| `DB_DRIVER`    | DB の接続方式（`pg` / `pglite`）。`pglite` は本番で使わない      | 実行環境                      | いいえ（既定 pg）          |

テストは常に PGlite（Postgres の WASM 版）を使うので、テスト用の接続先は要りません。

開発中に画面から API を呼ぶための通行証は `npm run token -w server` で発行します
（`JWT_SECRET` と `JWT_AUDIENCE` を使います。手順は README.md）。

<!-- 環境変数を足したら、この表と server/.env.example の両方に名前を追記してください。
     server/src/config.ts が読む値と、この表が一致している必要があります。 -->

## 画面（client）

画面はビルド時に設定を埋め込みます。API の呼び先は開発時 `client/proxy.conf.json`、
本番は配信するサーバーの設定で決めます。**画面のコードに秘密の値を書かないでください**
（ブラウザに配布されるので、誰でも読めます）。

## GitHub の secret

| 名前                      | 用途                       | 設定する条件                |
| :------------------------ | :------------------------- | :-------------------------- |
| `GITHUB_TOKEN`            | Actions が自動で用意します | 設定不要                    |
| `CLAUDE_CODE_OAUTH_TOKEN` | PR の AI レビュー          | AI レビューを有効にした場合 |
| `ANTHROPIC_API_KEY`       | 同上（API キーを使う場合） | 同上                        |

## 版

| もの                             | 版    |
| :------------------------------- | :---- |
| Node.js                          | 24 系 |
| npm                              | 11 系 |
| PostgreSQL                       | 16    |
| Express                          | 5 系  |
| Drizzle ORM                      | 0.45  |
| Angular（Material / CDK を含む） | 22 系 |
| Tailwind CSS                     | 4 系  |
| zod                              | 4 系  |

<!-- ここから下は node scripts/setup-env.mjs --write が追記します。 -->
