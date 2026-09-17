---
name: handover-check
description: 引き継ぎの完了定義を満たしているかを項目ごとに判定し、足りないものを一覧にする。開発の区切りや保守の引き渡し前に実行する。「引き継げる状態か」「完了定義の確認」「引き渡し前チェック」で起動
---

# 引き継ぎの完了定義を確認する

保守を引き受けられる状態かどうかを、**人の印象ではなく項目ごとの合否**で判定する。
CI の `policy` job と同じ観点で、手元でも見られるようにしたもの。

## 判定する項目

上から順に確認し、それぞれ OK / NG と、NG の理由・直し方を出す。

| # | 項目 | 確認方法 |
|:--|:--|:--|
| 1 | `main` の CI が緑 | `gh run list --branch main --limit 1` |
| 2 | 受入条件 `AC-n` すべてに対応するテストがある | `node scripts/check-ac-coverage.mjs` |
| 3 | 自動テストで確かめられないもの（規約が手元での確認を求めているもの）の記録が `docs/results/` にある | `.claude/rules/` で `docs/results/` への記録を求めている規約（`ai-integration.md` など）と、その対象がリポジトリにあるかを突き合わせる |
| 4 | API 定義の全ルートにテストがある | `node scripts/check-api-coverage.mjs` |
| 5 | 「引き継ぎメモ」Issue が埋まっていて、最終更新が最後のマージと同じ週 | `gh issue view <handoverIssue>` と `git log -1 --date=iso main` |
| 6 | open Issue すべてに `status` ラベルと次の一手がある | `gh issue list --state open --json number,labels,title` |
| 7 | `docs/progress.md` が最後のマージと一致している | `node scripts/progress-snapshot.mjs --check` |
| 8 | `docs/env.md` が `process.env` の全キーと DB の起動方法を網羅している | ソース中の `process.env.` を集めて突き合わせる |
| 9 | `docs/decisions/` に主要な設計判断がある | ファイルの有無と、最後の PR で決めたことの反映 |
| 10 | すべての TODO に Issue 番号が付いている | `src/` の `TODO` を検索し、`#n` の無いものを列挙 |
| 11 | `src/` に `console.log` と `any` が無い | `npm run lint` が緑であること |
| 12 | 標準バージョンが最新 | `.claude/rules/.standards-version` とプラグインの `version` |
| 13 | README に 起動 / テスト / デプロイ が 3 コマンドで書かれている | README を読む |
| 14 | 1 MB 超のファイルと実データが git に入っていない | `git ls-files` のサイズ確認 |
| 15 | 当社担当のアカウントが maintain 権限を持っている | `gh api repos/{owner}/{repo}/collaborators` |
| 16 | 必須項目が宣言も実体も残っている（ファイル・deny・規約） | `node scripts/check-mandatory.mjs` |
| 17 | 依存のライセンスが許可リスト（OSS）に収まっている（外れたものは費用が発生する可能性があるので当社に相談） | `node scripts/check-licenses.mjs` |

受入条件は #2 のテストで確かめる。受入条件ごとに手で確かめた記録は求めない（テストと二重に管理しないため）。

`gh` が使えない場合、GitHub に依存する項目（1 / 5 / 6 / 15）は「確認できず」として、手で確認する手順を示す。

## 報告

```
引き継ぎ判定: 満たしている N / 17

NG の項目
- #3 AI の呼び出し（server/src/provider/）を手元で動かした記録が docs/results/ に無い
  → 動かした手順と結果を docs/results/ に残す
```

**NG を勝手に直さない。** 何が足りないかを示し、直すかどうかは人が決める。
直す場合は Issue を立ててから `/shinnn-app:feature` で進める。
