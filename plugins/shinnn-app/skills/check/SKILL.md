---
name: check
description: リポジトリ全体の型検査・lint・テストと、受入条件および API 定義のカバレッジを確認する。範囲を絞ったビルド・lint・テストの仕方と、落ちたときの直し方も持つ。/shinnn-app:pr が PR を出す前に 1 回呼ぶ。「チェックして」「テストを通して」「壊れていないか確認」「型エラーを見て」「lint を通して」「このテストだけ実行」でも起動
---

# まとめて確認する

PR を出す前に、CI と同じ内容を手元で通す。**ここが緑にならないうちは PR にしない。**
`/shinnn-app:pr` が手順 1 で呼ぶので、`feature` で作ったものは PR 1 本につき 1 回通る。実装の途中の確認は hook（触ったファイルの lint と関連テスト）が行う。

## 実行する順

1 つ落ちたら、**その場で直してから次に進む**（全部走らせてから直そうとしない）。

**ルートで `npm run check` / `npm test` を使う**（`npm run ... --workspaces` を直接呼ばない）。
ルートのスクリプトは先に `shared` を建てる。建てないと `@app/shared` が解決できず、
クローン直後の server / client が型エラーの山になる。

`--workspaces` は 1 つ落ちても残りのパッケージを走らせてから終了コード 1 を返す。
**最初のエラーで出力が終わらない**ので、ログは最後まで読んで、落ちたパッケージを取りこぼさない。

| 順 | コマンド | 見るもの |
|:--|:--|:--|
| 1 | `npm run check` | shared のビルド → 各パッケージのビルド・型検査・lint。`--max-warnings 0` なので警告も落ちる |
| 2 | `npm test` | テスト。DB を使うテストは既定で PGlite（実 PostgreSQL は不要） |
| 3 | `node scripts/check-ac-coverage.mjs` | `docs/仕様書.md` の受入条件 `AC-n` すべてに、対応するテストがあるか |
| 4 | `node scripts/check-api-coverage.mjs` | `shared/src/api` の全ルートにテストがあるか |
| 5 | `node scripts/check-test-naming.mjs` | テストのファイル名が `.test.ts` か（`.spec.ts` は CI で落ちる） |
| 6 | `node scripts/check-mandatory.mjs` | 必須項目（ファイル・deny・規約）の実体が残っているか |
| 7 | `node scripts/check-licenses.mjs` | 依存のライセンスが許可リスト（OSS）に収まっているか。外れたものは費用が発生する可能性があるのでシン株式会社に相談する |

`scripts/` の確認スクリプトが無い場合は、その項目を飛ばして「未導入」と報告する（勝手に作らない）。

## 一部だけ確かめるとき

実装の途中は hook が確かめる（保存のたびの `eslint --fix`、応答の終わりに変えたファイルの lint と関連テスト）。
手で範囲を絞るときは次を使う。**範囲を絞るコマンドは `shared` を建てない**ので、`shared` を変えた直後は先に `npm run build -w shared` を通す。

| 確かめたいこと | コマンド |
|:--|:--|
| 1 つのパッケージのビルド | `npm run build -w <client\|server\|shared>` |
| テストと seed も含めた型検査 | `npm exec -w <server\|shared> -- tsc -p tsconfig.check.json --noEmit` |
| 1 つのパッケージの lint | `npm run lint -w <パッケージ>`。自動修正は `npm exec -w <パッケージ> -- eslint --fix <パス>` |
| 1 つのパッケージのテスト | `npm run test -w <パッケージ>` |
| server / shared のテストを絞る | `npm exec -w <server\|shared> -- vitest run <パス>`。変えたファイルに関係するものだけなら `npm exec -w <server\|shared> -- vitest related --run <変更ファイル>` |
| client（画面）のテストを絞る | `npm run test -w client -- --filter '<テスト名の一部>'`（画面のテストは Angular のビルダー越しにしか動かないので、`vitest` を直接呼ばない） |

## 落ちたときの読み方

| 症状 | たいていの原因 | 直し方 |
|:--|:--|:--|
| 型エラーがたくさん出る | 最初の 1 件の波及 | **最初の 1 件から読む** |
| 型エラーが client に出る | `shared` の API 定義を変えたのに画面を直していない | `shared` の定義を正として画面側を合わせる。定義の方を戻さない |
| `Cannot find module '@app/shared'` | `shared` が未ビルド | 先に `npm run build -w shared` |
| lint の指摘 | 規約違反 | 自動修正できるものは先に `eslint --fix` で潰す。残りは下の表の規約に従って直す。**ルールの設定を緩めて通さない**（規約違反を規約の側で消しているだけになる）。意図が分からなければ `/shinnn-app:why <ルール名>` |
| テストが落ちる | 実装かテストのどちらかが違う | **実装が正か、テストが正かを先に決める。** 判断は `.claude/rules/testing.md` の「何をテストするか」の表に従う。テストを通すためだけの分岐を入れたくなったら、実装が間違っている合図 |
| テストは通るのに `check-ac-coverage` が落ちる | 受入条件を足したがテストを書いていない | AC-n をテスト名に含めたテストを足す |
| `check-api-coverage` が落ちる | API 定義を足したがテストが無い | 正常系 1 つと異常系 1 つを足す |
| DB のテストだけ落ちる | マイグレーション未適用 | `/shinnn-app:db-migrate` を実行する |

lint のルールごとの直し方の規約（`.claude/rules/` の下）:

| ルール | 規約 |
|:--|:--|
| `no-restricted-imports`、`no-restricted-syntax`（server の `src/` の動的 import） | `server-architecture.md`・`client-architecture.md` の「新規ファイルの配置判断」「import の許可関係」 |
| `no-console` | `server-coding-conventions.md` の「ログ」、`client-coding-conventions.md` の「その他」 |
| `@typescript-eslint/no-explicit-any` | `server-coding-conventions.md`・`client-coding-conventions.md` の「型」 |
| Angular の signals / 制御フロー | `client-coding-conventions.md` の「テンプレート」「状態」 |

## 報告

最後に、次の形で短く報告する。

```
check: OK / NG（NG なら落ちた項目と原因）
test: 成功 N / 失敗 N
AC カバレッジ: 満たしている AC / 全体
API 定義カバレッジ: テストがあるルート / 全体
```

範囲を絞って確かめたときは、確かめた範囲と結果（成功 N / 失敗 N、失敗したものの名前）だけを短く報告する。
