---
name: check
description: リポジトリ全体の型検査・lint・テストと、受入条件および API 定義のカバレッジを確認する。PR を出す前や、変更が一段落したときに実行する。「チェックして」「テストを通して」「壊れていないか確認」で起動
---

# まとめて確認する

PR を出す前に、CI と同じ内容を手元で通す。**ここが緑にならないうちは PR にしない。**

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
| 7 | `node scripts/check-licenses.mjs` | 依存のライセンスが許可リスト（OSS）に収まっているか。外れたものは費用が発生する可能性があるので当社に相談する |

`scripts/` の確認スクリプトが無い場合は、その項目を飛ばして「未導入」と報告する（勝手に作らない）。

## 落ちたときの読み方

| 症状 | たいていの原因 | 直し方 |
|:--|:--|:--|
| 型エラーが client に出る | `shared` の API 定義を変えたのに画面を直していない | `shared` の定義を正として画面側を合わせる。定義の方を戻さない |
| `no-restricted-imports` | 層をまたいだ参照 | `.claude/rules/` の配置判断表で、その処理の置き場所を決め直す |
| テストは通るのに `check-ac-coverage` が落ちる | 受入条件を足したがテストを書いていない | AC-n をテスト名に含めたテストを足す |
| `check-api-coverage` が落ちる | API 定義を足したがテストが無い | 正常系 1 つと異常系 1 つを足す |
| DB のテストだけ落ちる | マイグレーション未適用 | `/shinnn-app:db-migrate` を実行する |

## 報告

最後に、次の形で短く報告する。

```
check: OK / NG（NG なら落ちた項目と原因）
test: 成功 N / 失敗 N
AC カバレッジ: 満たしている AC / 全体
API 定義カバレッジ: テストがあるルート / 全体
```

## 関連

| やりたいこと | スキル |
|:--|:--|
| ビルドだけ確認する | `build-check` |
| lint だけ確認する | `lint-check` |
| テストだけ走らせる | `test-run` |
| コミット直前の一括確認 | `pre-commit-check` |
