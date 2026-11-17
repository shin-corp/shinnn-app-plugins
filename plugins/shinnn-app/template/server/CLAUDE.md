# server（@app/server）

Express 5 + PostgreSQL 16（Drizzle ORM）の API サーバーです。TypeScript の ESM で書きます。
書き方と層の決まりは、`server/` のファイルを触ると読み込まれる規約（`server-architecture.md`・`server-coding-conventions.md`・`db.md` など）にあります。
API を足す手順は `/shinnn-app:add-api` にあります。

## コマンド

| コマンド                        | 内容                                          |
| ------------------------------- | --------------------------------------------- |
| `npm run dev -w server`         | ホットリロードつきで起動                      |
| `npm run check -w server`       | build + typecheck + lint                      |
| `npm run test -w server`        | テスト（DB は PGlite。PostgreSQL は不要）     |
| `npm run db:generate -w server` | スキーマの変更からマイグレーション SQL を生成 |
| `npm run db:migrate -w server`  | マイグレーションを適用                        |
| `npm run seed -w server`        | 動作確認用の初期データを投入                  |
| `npm run messages -w server`    | messages.json からメッセージキーを再生成      |
| `npm run token -w server`       | 開発中に画面へ持たせる JWT を 1 つ発行        |

- `dev` / `db:migrate` / `seed` は、`server/.env` があれば読み込む。無いと、`config.ts` の検査で止まる（`DATABASE_URL`・`JWT_SECRET` などに既定値が無い）
- 環境変数の意味は `docs/env.md`、見本は `.env.example` にある
- `DB_DRIVER=pglite` のデータは `server/.pglite/` に残る。サーバーを動かしている間は、`db:migrate` や `seed` で同じ DB を開かない（別のプロセスから同時に開けない）
- `app.ts`（組み立て）と `index.ts`（待ち受け）を分ける。API のテストは `app.ts` だけを使う

Express 5 の注意と、外さないセキュリティの既定は、規約 `server-coding-conventions.md` にあります。

**CSRF 対策の middleware は入れていない。** 認証情報を Cookie で持たず、毎回 `Authorization` ヘッダで送るので、他サイトからの自動送信では認証が通らない。Cookie のセッションを入れるなら、そのときにトークン型の対策を足す。

テストの決まり（テストと実装が食い違ったときにどちらを直すか、テストの DB の作り方）は、規約 `testing.md` にあります。
