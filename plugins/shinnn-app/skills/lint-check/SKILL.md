---
name: lint-check
description: ESLint を実行してコード品質と規約違反を検出し、ルール別に整理して報告する。「lint を通して」「規約違反を見て」で起動
---

# Lint の確認

## 実行

| 範囲 | コマンド |
|:--|:--|
| すべて | `npm run lint` |
| 1 つのパッケージ | `npm run lint -w <client\|server\|shared>` |
| 自動修正 | `npm exec -w <パッケージ> -- eslint --fix <パス>` |

**`--max-warnings 0` の設定なので、警告も失敗になる。** 警告を残したまま先へ進まない。

## このテンプレートで特に効いているルール

直し方は、ルールごとに次の規約に従う（`.claude/rules/` の下）。

| ルール | 規約 |
|:--|:--|
| `no-restricted-imports`、`no-restricted-syntax`（server の `src/` の動的 import） | `server-architecture.md`・`client-architecture.md` の「新規ファイルの配置判断」「import の許可関係」 |
| `no-console` | `server-coding-conventions.md` の「ログ」、`client-coding-conventions.md` の「その他」 |
| `@typescript-eslint/no-explicit-any` | `server-coding-conventions.md`・`client-coding-conventions.md` の「型」 |
| Angular の signals / 制御フロー | `client-coding-conventions.md` の「テンプレート」「状態」 |

## 落ちたとき

- **自動修正できるものは先に `--fix` で潰す**。残るのは設計の問題であることが多い
- `no-restricted-imports` は設定を緩めて通さない。**それは規約違反を規約の側で消しているだけ**
- 規約の意図が分からないときは `/shinnn-app:why <ルール名>`

## 報告

```
lint: OK / NG
NG の場合: ルール別の件数と、代表的な箇所（ファイル:行）
```
