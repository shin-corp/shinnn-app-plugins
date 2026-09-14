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

| ルール | 何を防ぐか | 直し方 |
|:--|:--|:--|
| `no-restricted-imports` | 層をまたいだ参照 | `.claude/rules/` の配置判断表で置き場所を決め直す。import を許す方向に設定を変えない |
| `no-restricted-syntax`（動的 import） | 依存関係を静的に追えなくなること | 静的 import に直す |
| `no-console` | 出力先が揃わないこと | `Log` を使う |
| `@typescript-eslint/no-explicit-any` | 型がある意味を失うこと | 実際の型を書く。分からないなら `unknown` にして絞り込む |
| Angular の signals / 制御フロー | 古い書き方の混在 | `signal()` と `@if` / `@for` に直す |

## 落ちたとき

- **自動修正できるものは先に `--fix` で潰す**。残るのは設計の問題であることが多い
- `no-restricted-imports` は設定を緩めて通さない。**それは規約違反を規約の側で消しているだけ**
- 規約の意図が分からないときは `/shinnn-app:why <ルール名>`

## 報告

```
lint: OK / NG
NG の場合: ルール別の件数と、代表的な箇所（ファイル:行）
```
