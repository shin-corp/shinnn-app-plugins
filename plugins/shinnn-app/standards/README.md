# 標準（standards）

アプリ開発標準のうち、**顧客リポジトリへ配らないもの**を置く場所。

配る規約と雛形の実体は、同梱のテンプレート `template/` の中にあります。テンプレートを展開した直後の
リポジトリが最初から最新の標準を持っているように、そこを唯一の正本にしています。

## どこに何があるか

| 内容 | 場所 | 顧客リポジトリでの置き場所 |
|:--|:--|:--|
| ファイル種別ごとの規約 | `template/.claude/rules/*.md` | `.claude/rules/` |
| 全体方針の雛形（案件固有の節は空） | `template/CLAUDE.md` | `CLAUDE.md` |
| 画面側の方針 | `template/client/CLAUDE.md` | `client/CLAUDE.md` |
| サーバー側の方針 | `template/server/CLAUDE.md` | `server/CLAUDE.md` |
| 標準のバージョン | `template/.claude/rules/.standards-version` | `.claude/rules/.standards-version` |
| 顧客向けの 2 ページ | `template/docs/アプリ作り方ガイド.md` | `docs/アプリ作り方ガイド.md` |
| レビューの観点と書き方 | `REVIEW.md`（このディレクトリ） | 配らない。シン株式会社のレビュアーとレビューエージェントが読む |

## 顧客リポジトリへどう届くか

Claude Code のプラグインが配布できるのはスキル・エージェント・hooks・MCP・LSP で、
`CLAUDE.md` と `.claude/rules/` は配布できません。そのため、

1. 新しいリポジトリには、`/shinnn-app:setup` が `template/` を展開して置く
2. すでにあるリポジトリには、`/shinnn-app:sync-standards` が `template/` からコピーして PR にする

という形にしています。`SessionStart` の表示は、リポジトリの `.claude/rules/.standards-version` と
プラグインが持つ `template/.claude/rules/.standards-version` を比べ、差があれば同期を促します。

## 更新の流れ

1. `template/` の該当ファイルを直す
2. `template/.claude/rules/.standards-version` を上げる（プラグインの `version` とは別の値）
3. marketplace のリリースに含める
4. 各リポジトリで `claude plugin update` → `/shinnn-app:sync-standards` → PR

規約を足すときは、**末尾に `## なぜ` の節を必ず置きます。**
`/shinnn-app:why` がこの節を引用して説明するため、理由の無い規約は説明できません。

## 書くときの決まり

- 日本語。コードの識別子だけ英語
- 非エンジニアが読む前提。専門用語は初出で 1 行の説明を添える
- 認証情報・顧客名・社内の URL・個人のローカルパスを書かない（公開リポジトリです）
- `template/.claude/rules/*.md` には frontmatter の `paths` を必ず書く。書かないと常に読み込まれてコンテキストを圧迫する
