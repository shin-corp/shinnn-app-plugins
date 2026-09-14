# 標準（standards）

アプリ開発標準の**正本**を置く場所。顧客リポジトリの `.claude/rules/` と `CLAUDE.md` は、
ここにあるものの写しです。食い違ったら**こちらが正**として上書きします。

## 中身

| 場所 | 内容 | 顧客リポジトリでの置き場所 |
|:--|:--|:--|
| `.standards-version` | 標準のバージョン。プラグインの `version` と同じ値を入れる | `.claude/rules/.standards-version` |
| `claude-md/root/CLAUDE.md` | 全体方針の雛形（案件固有の節は空） | `CLAUDE.md` |
| `claude-md/client/CLAUDE.md` | 画面側の方針 | `client/CLAUDE.md` |
| `claude-md/server/CLAUDE.md` | サーバー側の方針 | `server/CLAUDE.md` |
| `rules/*.md` | ファイル種別ごとの規約（`README.md` は配らない） | `.claude/rules/` |
| `アプリ作り方ガイド.md` | 顧客向けの 2 ページ | `docs/アプリ作り方ガイド.md` |
| `REVIEW.md` | レビューの観点と書き方 | 配布しない。当社のレビュアーとレビューエージェントが読む |

中身はテンプレート `shinnn-app-starter` の同名ファイルと同じものです。**直すときは標準側を直し、
`shinnn-app-starter` へも同じ内容を反映します**（テンプレートから作った直後のリポジトリが、
最初から最新の標準を持っている状態にするため）。

## なぜプラグイン側に置くのか

Claude Code のプラグインが配布できるのは スキル・エージェント・hooks・MCP・LSP で、
`CLAUDE.md` と `.claude/rules/` は配布できません。そのため、

1. 正本はプラグインの `standards/` に置く
2. 顧客リポジトリへは `/shinnn-app:sync-standards` がファイルとしてコピーし、PR にする

という形にしています。バージョンの比較は `.standards-version` と `plugin.json` の `version` で行い、
差があれば `SessionStart` の表示で同期を促します。

## 更新の流れ

1. `standards/` を直す
2. `.standards-version` と `plugin.json` の `version` を上げる（同じ値にする）
3. marketplace のリリースに含める
4. 各リポジトリで `claude plugin update` → `/shinnn-app:sync-standards` → PR

規約を足すときは、**末尾に `## なぜ` の節を必ず置きます。**
`/shinnn-app:why` がこの節を引用して説明するため、理由の無い規約は説明できません。

## 書くときの決まり

- 日本語。コードの識別子だけ英語
- 非エンジニアが読む前提。専門用語は初出で 1 行の説明を添える
- 認証情報・顧客名・社内の URL・個人のローカルパスを書かない（公開リポジトリです）
- `rules/*.md` には frontmatter の `paths` を必ず書く。書かないと常に読み込まれてコンテキストを圧迫する
