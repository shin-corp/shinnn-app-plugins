# claude-plugins

Claude Code のプラグインを配布する marketplace（プラグインの配布元）です。

アプリ開発標準に沿ってアプリを作るための、コマンド・レビュー担当・自動チェックをまとめて配ります。
テンプレート [`shinnn-app-starter`](https://github.com/shin-corp/shinnn-app-starter) と対で使います。

## 収録しているプラグイン

| プラグイン | 内容 |
|:--|:--|
| `shinnn-app` | 初回の setup と日常の 5 コマンド（feature / check / pr / why / retro）、内部スキル、レビューエージェント 3 体、規約を守るための hooks |

## 導入

Claude Code が入っていることが前提です（Node 24 / npm 11 / Git / gh も必要）。

アプリ用の空のフォルダを作り、その中で次を実行します。フォルダの信頼を聞かれたら承認してください。

```
claude plugin marketplace add shin-corp/shinnn-app-plugins
claude plugin install shinnn-app@shinnn --scope project
claude
```

project スコープ（そのフォルダだけ）で入れるのは、hooks がファイルの編集とコマンドを確認するためです。
hooks は、テンプレートから作ったリポジトリ（`.claude/rules/.standards-version` がある）でだけ動きます。

## 最初にやること

```
/shinnn-app:setup
```

空のフォルダでは、まずテンプレート `shinnn-app-starter` のうちプラグインが対応する版を取得して展開し、
git のリポジトリと GitHub の非公開リポジトリを作ります。終わったら `/exit` で終了し、同じフォルダで `claude` を
起動し直して、もう一度 `/shinnn-app:setup` を実行してください。`CLAUDE.md` と `.claude/rules/` は起動時に読み込まれるためです。

2 回目は、対話でテンプレートの種類と必要な機能を決め、`.shinnn/setup.json` に記録します。
あとから選択を変えたくなったら、もう一度実行してください（変更は PR になります）。

## 既にあるアプリのリポジトリに加わる

clone したフォルダで `claude` を起動すると、`.claude/settings.json` の `extraKnownMarketplaces` で配布元が
自動で登録されます。プラグインは次で入れます。

```
claude plugin install shinnn-app@shinnn --scope local
```

`--scope project` にしないのは、共有の `.claude/settings.json` のキーの並びが書き直されて差分ができるためです。
入れた後は、開いている Claude Code で `/reload-plugins` を実行するか、起動し直してください。

## 日常の 5 コマンド

上の `setup` は最初の 1 回（と設定を変えるとき）だけです。日常で使うのは次の 5 つで、
毎日使うのは `feature` / `check` / `pr` の 3 つです。

| コマンド | いつ使うか |
|:--|:--|
| `/shinnn-app:feature <作りたいこと>` | 作りたいことがあるとき（まとめていくつでも）。Issue に分けて、1 つずつ実装まで通す |
| `/shinnn-app:check` | 変更が一段落したとき。CI と同じ内容を手元で通す |
| `/shinnn-app:pr` | レビューに出すとき |
| `/shinnn-app:why <話題>` | 決まりの理由が分からないとき |
| `/shinnn-app:retro` | 作業が終わったとき |

このほかに、`add-api` / `add-screen` / `db-migrate` / `code-review` などの内部スキルがあり、
必要な場面で自動的に使われます。

## 更新

アプリのフォルダで、入れたときと同じスコープを付けて実行し、Claude Code を起動し直します
（既にあるリポジトリに加わった人は `--scope local`）。スコープを付けないと user スコープが対象になります。

```
claude plugin update shinnn-app@shinnn --scope project
```

規約（`.claude/rules/` と `CLAUDE.md`）はプラグインでは配れない仕組みのため、
更新後に `/shinnn-app:sync-standards` を実行して、リポジトリ側へ取り込んで PR にします。
セッションの開始時にバージョンの差があれば案内します。

## リポジトリの構成

```
.claude-plugin/marketplace.json   配布するプラグインの一覧
plugins/shinnn-app/
  .claude-plugin/plugin.json      プラグインの定義
  .starter-version                setup が取得するテンプレート shinnn-app-starter の版
  skills/                         コマンドと内部スキル
  agents/                         レビュー担当 3 体
  hooks/hooks.json                自動チェックの設定
  scripts/                        hooks から呼ぶ Node スクリプトと、setup の取得・適用スクリプト
  standards/                      規約の正本とレビュー観点
```

## 開発

手元で動かして試す場合:

```
claude --plugin-dir ./plugins/shinnn-app
```

変更したら `/reload-plugins` で読み直せます。

setup のテンプレートの取得は、手元のテンプレートから空のフォルダへ展開して試せます（`--dry-run` を付けると版とファイル数だけを表示します）。

```
node plugins/shinnn-app/scripts/fetch-template.mjs --from <テンプレートのディレクトリ> --dest <空のフォルダ>
```

公開前に検証します。

```
claude plugin validate ./plugins/shinnn-app
```

hooks と setup の Node スクリプトには回帰テストがあります（CI でも同じものを実行します）。

```
node --test "plugins/shinnn-app/scripts/**/*.test.mjs"
```

**このリポジトリは公開されます。** 認証情報・顧客名・社内の URL・個人のローカルパスを書かないでください。

## ライセンス

MIT
