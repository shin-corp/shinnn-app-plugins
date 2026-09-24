# shinnn-app

アプリ開発標準に沿ってアプリを作るための Claude Code プラグインです。
アプリの土台になるテンプレートを同梱していて、`setup` がそれを展開したリポジトリで使います。

**このファイルはシン株式会社の保守担当向けです。** アプリを作る方向けの説明は、配布元の
[README](../../README.md)（`shin-corp/shinnn-app-plugins` のトップ）にあります。

## 何をするもの

| 種類 | 内容 |
|:--|:--|
| コマンド | 初回の `setup` と、日常の 5 つ（feature / check / pr / why / retro） |
| 内部スキル | API の追加、画面の追加、マイグレーション、レビュー、コミット規約 など 16 |
| レビュー担当 | 正確性 / セキュリティ / 規約 の 3 体。`code-review` から同時に動く |
| hooks | 取り決めの案内。保存のたびの `eslint --fix`、変更したファイルの lint とテスト、セッション開始時の状況 |
| 適用スクリプト | `scripts/apply-setup.mjs`。`setup` が `.shinnn/setup.json` / ワークフロー / `CODEOWNERS` を書き換える唯一の手段 |
| テンプレート | アプリの土台（`template/`）。`setup` が空のフォルダに展開する |

## コマンド

最初の 1 回に使うもの。

| コマンド | 内容 |
|:--|:--|
| `/shinnn-app:setup` | 初回セットアップ。同梱のテンプレートの展開・種類の選択・環境の確認・必要な機能の決定と適用 |

日常の 5 コマンド。毎日使うのは `feature` / `check` / `pr` の 3 つで、
`why` と `retro` は困ったとき・終わったときに使う。

| コマンド | 内容 |
|:--|:--|
| `/shinnn-app:feature <作りたいこと>` | PR 1 本ずつの Issue に分けて順番を決め、Issue の作成 → 仕様書への反映 → 実装 → テスト |
| `/shinnn-app:check` | 型検査・lint・テストと、受入条件および API 定義のカバレッジ |
| `/shinnn-app:pr` | コミット → プッシュ → ドラフト PR → レビューの収束 |
| `/shinnn-app:why <話題>` | 決まりの理由を、根拠を引いて説明する |
| `/shinnn-app:retro` | Issue への振り返りコメントと引き継ぎメモの追記 |

内部スキル: `add-api` / `add-screen` / `db-migrate` / `code-review` / `commit-message` /
`draft-pr` / `build-check` / `lint-check` / `pre-commit-check` / `test-run` / `mutation-check` /
`dev-stack-start` / `handover-check` / `sync-standards` / `session-retro`

`coding-guide` は `template/client/CLAUDE.md` と `template/.claude/rules/` に吸収したため未提供です。

## hooks

`.shinnn/setup.json` があるフォルダ（テンプレートから作ったアプリのリポジトリ）でだけ動きます。

| きっかけ | 内容 |
|:--|:--|
| ファイルの保存後 | そのファイルに `eslint --fix` を掛け、直せなかった指摘を返す |
| 応答の終了時 | 変更したファイル（新しく作ったフォルダの中のファイルも含む）の lint と関連するテストだけを走らせ、失敗があれば Claude に伝える。Claude はその場で直しに行く。伝えるのは依頼 1 回につき 1 回 |
| セッションの開始時 | 次に着手する Issue、open な PR、直近の CI を表示する。取得できなかった欄には理由を出す |

hooks は取り決めの案内で、`.env` や CI の設定や規約の編集を止めるのは `.claude/settings.json` の `deny` です。
`deny` で止まるファイルを変える必要があるときは、`/shinnn-app:setup` か `/shinnn-app:sync-standards` を使ってください。

## 前提

- Node 24 系（24.15 以上）。npm は Node.js 24 に同梱される 11 系
- `gh`（Issue と PR を使う機能に必要。無い場合、セッションの開始時には GitHub の画面の URL と、導入・ログインの案内を出します）
- hooks の Node スクリプトはシェルを介さずに外部コマンドを呼びます。Windows で `npm` のような
  バッチファイルを起動するときだけ `cmd.exe` 経由に切り替え、引数は自前で引用します
  （空白や `&` を含むファイル名がコマンドとして解釈されないようにするため）

## 開発

```
claude --plugin-dir ./plugins/shinnn-app
claude plugin validate ./plugins/shinnn-app
```

## ライセンス

MIT
