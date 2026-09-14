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

```
claude plugin marketplace add shin-corp/shinnn-app-plugins
```

`shinnn-app-starter` から作ったリポジトリなら、`.claude/settings.json` に marketplace と有効化の設定が
入っているので、リポジトリを開いて信頼（trust）とインストールを承認するだけで使えるようになります。

自分で入れる場合は次のとおりです。

```
/plugin install shinnn-app@shinnn
```

インストール後に `Run /reload-plugins to activate.` と表示されたら、`/reload-plugins` を実行してください。

## 最初にやること

リポジトリを作った直後に 1 回だけ実行します。

```
/shinnn-app:setup
```

対話でテンプレートと必要な機能を決め、`.shinnn/setup.json` に記録します。
あとから選択を変えたくなったら、もう一度実行してください（変更は PR になります）。

## 日常の 5 コマンド

上の `setup` は最初の 1 回（と設定を変えるとき）だけです。日常で使うのは次の 5 つで、
毎日使うのは `feature` / `check` / `pr` の 3 つです。

| コマンド | いつ使うか |
|:--|:--|
| `/shinnn-app:feature <一行>` | 作りたいことがあるとき。Issue から実装まで通す |
| `/shinnn-app:check` | 変更が一段落したとき。CI と同じ内容を手元で通す |
| `/shinnn-app:pr` | レビューに出すとき |
| `/shinnn-app:why <話題>` | 決まりの理由が分からないとき |
| `/shinnn-app:retro` | 作業が終わったとき |

このほかに、`add-api` / `add-screen` / `db-migrate` / `code-review` などの内部スキルがあり、
必要な場面で自動的に使われます。

## 更新

```
claude plugin update shinnn-app
```

規約（`.claude/rules/` と `CLAUDE.md`）はプラグインでは配れない仕組みのため、
更新後に `/shinnn-app:sync-standards` を実行して、リポジトリ側へ取り込んで PR にします。
セッションの開始時にバージョンの差があれば案内します。

## リポジトリの構成

```
.claude-plugin/marketplace.json   配布するプラグインの一覧
plugins/shinnn-app/
  .claude-plugin/plugin.json      プラグインの定義
  skills/                         コマンドと内部スキル
  agents/                         レビュー担当 3 体
  hooks/hooks.json                自動チェックの設定
  scripts/                        hooks から呼ぶ Node スクリプトと、setup の適用スクリプト
  standards/                      規約の正本とレビュー観点
```

## 開発

手元で動かして試す場合:

```
claude --plugin-dir ./plugins/shinnn-app
```

変更したら `/reload-plugins` で読み直せます。公開前に検証します。

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
