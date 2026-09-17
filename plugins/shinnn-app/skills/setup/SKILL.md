---
name: setup
description: アプリの初回セットアップを対話で行う。空のフォルダではテンプレートを取得して git と GitHub のリポジトリを用意する。テンプレートを取得した後は、テンプレートの選択・環境の検出・必須項目の確認・選択項目の決定・適用までを 1 回で通す。再実行すると選択の変更を差分の PR にする。「セットアップ」「初期設定」「最初に何をすればいい」で起動
---

# 初回セットアップ

アプリ用の空のフォルダでプラグインを入れた直後に実行する。テンプレートがまだ無ければ取得して、git と GitHub の
リポジトリを用意し、Claude Code を起動し直してもらう。起動し直した後にもう一度実行し、決めたことを
`.shinnn/setup.json` に記録して、ワークフローや設定ファイルを生成する。あとから選択を変えたくなったら、このスキルをもう一度実行する。

**このスキルだけが `.github/`、`.shinnn/`、`CODEOWNERS` を書き換えてよい。**
書き換えは Edit / Write ツールではなく、プラグイン同梱のスクリプトで行う。テンプレートの取得は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs`（「0. テンプレートの取得」）、選択の適用は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs`（引数は「5. 適用」）。

`.github/workflows/`、`.shinnn/`、`CODEOWNERS` への Edit / Write は `.claude/settings.json` の deny が止める。
スクリプトで書くのは、何をどう変えたかが差分に残るようにするため。`.claude/settings.json` は、手順 0 の取得スクリプトが
`claude plugin install` の書いたものをテンプレートのものに置き換える場合を除き、setup でも書き換えない。
標準の更新は `/shinnn-app:sync-standards` が扱う。

## 進め方

最初に `.claude/rules/.standards-version` があるかを見る。

- **無い**（テンプレートがまだ無いフォルダ）: 手順 0 だけを行い、起動し直すよう伝えて終える
- **ある**: 手順 1〜6 を順に行う

各手順の結果を短くまとめてから次に進み、**利用者が決める項目は必ず質問する**。

### 0. テンプレートの取得

`CLAUDE.md` と `.claude/rules/` はセッションの開始時に読み込まれるので、取得した直後のセッションには規約が入っていない。
権限の設定（`.claude/settings.json`）も含めて確実に効かせるため、手順 0 を行ったセッションでは手順 1 に進まない。
`node` と `git` が要る。無ければ導入を案内してから始める。

1. **フォルダが空であることを確かめる。** `claude plugin install` が作った `.claude/` と `.git/` はあってよい。
   ほかのファイルがあれば、空のフォルダで始め直すよう伝えて止める
2. **取得する内容を見せてから展開する。** まず `--dry-run` で版とファイル数を示して確認を取り、`--dry-run` を外して実行する

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs --dry-run
   ```

   スクリプトは、プラグインが対応する版（プラグインの `.starter-version`）の公開リポジトリのタグの圧縮ファイル
   `https://github.com/shin-corp/shinnn-app-starter/archive/refs/tags/v<版>.tar.gz` を取得して、今のフォルダに展開する。
   既にファイルがあれば上書きせずに止まる。例外は `claude plugin install --scope project` が書いた `.claude/settings.json`
   （`enabledPlugins` と `extraKnownMarketplaces` だけのもの）で、テンプレートの同じファイルに置き換える

   | 引数 | 内容 |
   |:--|:--|
   | `--dest <パス>` | 展開先。既定はプロジェクトのフォルダ |
   | `--from <ディレクトリ \| .tar.gz \| URL>` | 別の取得元。ネットワークが制限された環境や、公開前のテンプレートを手元で試すとき |
   | `--dry-run` | 版とファイル数を示すだけで、書き込まない |

3. **git に記録する。** `.git` が無ければ `git init -b main`。続けて `git add -A` →
   `git commit -m "テンプレート shinnn-app-starter v<版> の取り込み"`。
   最初のコミットには対象のパッケージが無いので、コミットの接頭辞（`[server]` など）を付けない
4. **GitHub にリポジトリを作る。** リモートが無ければ、置き場所（組織かアカウント）とリポジトリ名（既定はフォルダ名）を聞いて実行する

   ```
   gh repo create <置き場所>/<名前> --private --source . --remote origin --push
   ```

   作れない場合（組織でリポジトリを作る権限が無い、`gh` が無い）は、GitHub の画面で空のリポジトリ（README なし）を
   作ってもらい、`git remote add origin <URL>` と `git push -u origin main` を実行する
5. **起動し直してもらう。** 次を伝えて、ここで終える
   - `/exit` で終了し、同じフォルダで `claude` を起動し直す
   - 起動したら、もう一度 `/shinnn-app:setup` を実行する
   - 理由: 規約（`CLAUDE.md` と `.claude/rules/`）は起動時に読み込まれるため

### 1. テンプレートの選択

| プロファイル | 内容 | 向いている場合 |
|:--|:--|:--|
| `full` | shared + server（Express + PostgreSQL）+ client（Angular） | 画面とデータの保存の両方が要る |
| `client-only` | shared + client のみ。サーバーと DB を持たない | 画面だけ、または既存の API を使う |

**`client-only` は現状、当社担当が手で適用する。** 自動適用はまだ実装しておらず、`server/` の削除・
ルートの `package.json` の `workspaces` の編集・`api-client.ts` の模擬実装への差し替えなど 9 手順が要る
（内容は `.shinnn/profiles/client-only.md`）。選ばれたら、**その場では終わらないこと**と所要・段取りを伝え、
初回セッションは `full` のまま進める。既定は `full`。

すでに `.shinnn/setup.json` がある場合は、記録されているプロファイルを既定にして「変更しますか」と聞く。

### 2. 環境の検出

`node scripts/setup-env.mjs` を実行して、OS / Node / npm / Git / gh / Docker と PostgreSQL の候補を調べる。
結果を表で示し、**足りないものは導入手順を案内する**（管理者として実行したターミナルが必要なものはその旨を伝える）。

- Node は 24 系（24.15 以上）が前提。npm は Node.js 24 に同梱される 11 系をそのまま使う
- `gh` が無い場合、Issue と PR を使う機能は動かない。`docs/progress.md` を手で更新する運用に切り替えるかを聞く
- PostgreSQL は検出順に従って選ぶ。Docker が使えない場合は組み込み版（`embedded-postgres`）の導入まで代行する
- GitHub 側は、当社担当アカウントの招待状況とブランチ保護が使えるかを確認する。招待とブランチ保護の設定は手順 5 で行う
- `gh auth status` でトークンのスコープを見る。`workflow` が無いと、ワークフローを変える PR を `gh` からマージできない。
  マージの方針を `self-review` にするなら `gh auth refresh -h github.com -s workflow` を案内する

`client-only` を選んだ場合、PostgreSQL の確認は飛ばす。

### 3. 必須項目の一覧表示

**選べない項目**として、次を「なぜ必須か」を 1 行添えて示す。ここで質問はしない。

| 項目 | なぜ必須か |
|:--|:--|
| root の `CLAUDE.md` / `.claude/rules/` / `settings.json` の deny | 構成と規約が同じでないと、当社が引き継げない |
| import 制約 lint | 層をまたぐ参照を人の注意ではなく機械で止める |
| husky の pre-commit | 壊れたコードが履歴に入らないようにする |
| CI の check / test / policy | 品質の判断を人の気分に依存させない |
| Issue テンプレートとラベル | 進捗の正本が Issues なので、形が揃っていないと読めない |
| 進捗スナップショットの Action | クローンだけで状況が分かるようにする |
| `docs/仕様書.md` と `docs/env.md` | 引き継ぎで最初に読む 2 つ |
| セキュリティ既定（helmet / CORS / ボディ上限 / レート制限） | 後から入れると全経路の見直しになる |
| Dependabot と `npm audit`、依存のライセンス検査 | 依存の脆弱性と、費用が発生するライセンスを放置しない |
| コミット規約と引き継ぎの完了定義 | 履歴と完了の基準を揃える |
| CODEOWNERS（当社担当） | レビューが必ず当社に届くようにする |

費用はいずれも無料（GitHub Actions の無料枠内）。

### 4. 選択項目の確認

**1 つずつ**聞く。各項目について 推奨 / 費用 / 入れない場合に何が起きるか を示し、既定値は Enter で採用できるようにする。

| 項目 | 推奨 | 費用 | 入れないと |
|:--|:--|:--|:--|
| Playwright の E2E と nightly 実行 | 画面が 3 つを超えるなら入れる | 無料 | 画面の壊れに気づくのがレビュー時になる |
| 月次 health report（決定論の集計部分） | 入れる | 無料 | 滞留した Issue と CI の傾向が見えない |
| GitHub Projects のボード | 任意 | 無料 | Issues の一覧だけで管理する |
| Copilot のコードレビュー | Copilot Business を使えるなら入れる | Copilot の利用料に含まれる | PR のレビューが当社の週次だけになる |
| PR の自動 AI レビュー（claude-code-action） | 変更が多いなら入れる | **利用者負担**。Pro / Max のサブスク枠、または API キーの従量課金 | 同上 |
| `@claude` メンションへの応答 | 任意 | 同上 | PR 上で質問できない |
| health report の AI 要約 | 任意 | 同上 | 数値だけが出る |

#### マージの方針（`mergePolicy`）

PR を誰がマージするかを決める。既定は `human`。

| 値 | 動き | 選ぶ場合 |
|:--|:--|:--|
| `human`（既定） | Claude はドラフトのまま渡し、人が ready にしてマージする | 当社のレビューを必ず通したい |
| `self-review` | `/shinnn-app:pr` がセルフレビュー（Critical / High が 0）と CI の通過を確かめ、ready にしてマージまで行う | 顧客が「当社のレビューを待たずに進める」と明示した |

`self-review` を選ぶ前に、次を相手に説明して同意を取る:

- **Claude が人の確認なしにマージまで行う設定**であること。`.claude/settings.json` は `gh pr` を許可しているので、`gh pr merge` の実行時に確認は出ない。止めたければ `human` に戻す（setup の再実行）
- `main` のブランチ保護で CI を必須にする（使えるプランなら）。Claude がマージするのは **CI が緑の PR だけ**
- `gh` のトークンに `workflow` スコープがあるか（ワークフローを変える PR のマージに要る。手順 2 で確認する）
- リポジトリの auto-merge を許可するか（手順 5 の 7）

`@claude` メンションへの応答と PR の AI レビューは、**発言者をリポジトリの関係者（OWNER / MEMBER /
COLLABORATOR）に限る条件と `--allowed-tools` が雛形に入っている**。公開リポジトリで第三者のコメント 1 件から
顧客の枠が消費されるのを防ぐためなので、有効化のときにこの 2 つを外さない。

**当社のキーは提供しない。** 費用が発生する項目を選んだ場合は、認証情報の置き場所（リポジトリの secret）と、
消費するのが誰の枠かをその場で説明し、**値そのものは利用者に入力してもらう**（Claude は読み書きしない）。
費用の目安は「およそいくら」までにとどめ、断定した金額を示さない。

### 5. 適用

保護されたファイル（`.shinnn/setup.json` / `.github/workflows/` / `CODEOWNERS`）は、**まとめて 1 回**
適用スクリプトで書き換える。まず `--dry-run` を付けて内容を見せ、確認を取ってから実行する。

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs --dry-run --profile full --reviewer @<当社担当のアカウント> --database docker --merge-policy human --enable health-report --disable claude-pr-review,claude-mention
```

| 引数 | 内容 |
|:--|:--|
| `--profile` | `full` / `client-only`（`optional.client-only-profile` も一緒に合わせる） |
| `--reviewer` | `CODEOWNERS` の `@SHINNN_REVIEWER` を置き換える当社担当のアカウント |
| `--database` | `database-url` / `local-postgres` / `docker` / `embedded-postgres` / `pglite` / `managed` |
| `--merge-policy` | `human`（既定。人が ready にしてマージする）/ `self-review`（`/shinnn-app:pr` がセルフレビューと CI の通過後にマージする） |
| `--enable` / `--disable` | 選択項目。`.shinnn/setup.json` の `optional` にあるキーだけを受け付ける |
| `--handover-issue` | 「引き継ぎメモ」Issue の番号（下の 5 で Issue を作ってから渡す） |
| `--complete` | `setupCompletedAt` に現在時刻を入れる |

**ワークフローは追加も削除もしない。** 雛形は `.github/workflows/*.yaml.disabled` として同梱してあり、
スクリプトが `.disabled` を外す（有効化）／付け直す（無効化）だけを行う。
選ばなかったものを消さないのは、あとから選び直したときに戻せるようにするため。

スクリプトが触らない残りは、通常の Edit / Write で行う。

1. Issue テンプレート（`feature.yml` / `bug.yml`）とラベル（`status:next` / `status:doing` / `status:blocked` / `type:feature` / `type:bug` / `type:deps`）を `gh` で投入する。`type:deps` は `dependabot-issue.yaml` が Dependabot の PR に対応する Issue を作るときに使う
2. `docs/` の雛形（`仕様書.md` / `env.md` / `decisions/`）を、無いものだけ作る
3. `README.md` の「有効な機能」表を、決めた内容で書き換える（マージの方針の行も含める）
4. `docs/decisions/` の**空いている次の番号**で `<番号>-setup.md` を作り、**選んだ理由と選ばなかった理由**を残す
   （テンプレートに `0001-template-stack.md`・`0002-package-manager.md`・`0003-node-version.md` が同梱されているので、通常は `0004-setup.md`）
5. 「引き継ぎメモ」Issue を作成して pin する（`gh issue create` → `gh issue pin`）。
   番号が決まったら `--handover-issue <番号> --complete` でもう一度スクリプトを実行する
6. 当社担当が collaborator（リポジトリの共同作業者）に招待されていなければ招待する。
   `gh api -X PUT repos/{owner}/{repo}/collaborators/<当社担当のアカウント（@ なし）> -f permission=maintain`
   （リポジトリの管理者権限が要る。権限の指定は組織のリポジトリでだけ有効で、個人アカウントのリポジトリでは無視される）。
   招待されていないと `CODEOWNERS` に書いてもレビュー依頼が届かない
7. マージの方針が `self-review` なら、リポジトリで auto-merge を許可するかを聞く。許可する場合は
   `gh api -X PATCH repos/{owner}/{repo} -f allow_auto_merge=true`（リポジトリの管理者権限が要る）。
   許可しなくても `/shinnn-app:pr` は CI の完了を待ってからマージするので、動きは変わらない

`.shinnn/setup.json` の形（キーはテンプレート同梱のものと同じにする。**勝手に増やさない・減らさない**）:

```json
{
  "templateVersion": "0.1.0",
  "standardsVersion": "0.1.0",
  "setupCompletedAt": "2026-01-01T00:00:00.000Z",
  "profile": "full",
  "reviewer": "@<当社担当のアカウント>",
  "mergePolicy": "human",
  "database": { "mode": "docker" },
  "mandatory": ["claude-md", "claude-rules", "claude-settings-deny", "import-restriction-lint", "husky-pre-commit", "ci-check", "ci-test", "ci-policy", "issue-templates", "issue-labels", "progress-snapshot", "docs-specification", "docs-env", "security-defaults", "dependabot", "npm-audit", "commit-convention", "handover-definition", "codeowners"],
  "optional": { "client-only-profile": false, "playwright-e2e": false, "e2e-nightly": false, "health-report": true, "copilot-review": false, "github-projects-board": false, "claude-pr-review": false, "claude-mention": false, "health-report-ai-summary": false },
  "handoverIssue": 1
}
```

**再実行のとき**は、既存の `.shinnn/setup.json` と今回の選択を比べ、**差分のある項目だけ**を変更する。
変更は `chore/setup-<日付>` ブランチにコミットし、`/shinnn-app:pr` で PR にする（`main` に直接コミットしない）。
費用が発生する項目を増やした場合は、PR 本文に費用の目安を書く。

### 6. 次の一手

最後に、次に打つコマンドを 1 つだけ示す。

```
/shinnn-app:feature "アプリの目的と、最初に作る画面"
```

あわせて、`docs/初回セッション.md` があればその台本を案内する。

## 失敗したとき

- 取得スクリプトが HTTP のエラーで止まる: 対応する版のテンプレートがまだ公開されていないか、ネットワークが制限されている。
  別の場所で取得した圧縮ファイル（手順 0 の URL）を `--from <.tar.gz のパス>` で渡せる。版が公開されていなければ当社に知らせてもらう
- 取得スクリプトが既存のファイルとの衝突で止まる: 上書きしない。空のフォルダを作って始め直してもらう
- `git commit` が名前とメールアドレスの未設定で止まる: `git config --global user.name` と `user.email` の設定を案内する
- `gh repo create` が失敗する（組織でリポジトリを作る権限が無い、`gh` が無い）: GitHub の画面で空のリポジトリ（README なし）を
  作ってもらい、`git remote add origin <URL>` と `git push -u origin main` を実行する
- `gh` の認証が切れている: `gh auth login` を案内する。ラベルと Issue の投入だけを後回しにし、他は適用する
- ブランチ保護が設定できない: プランで使えないことがある。**エラーにせず**「CI と週次レビューで担保する」と説明して続行する
- すでに `.github/workflows/` に手を入れたファイルがある: 上書きせず、差分を示して人に判断してもらう
- `gh pr merge` が `workflow` スコープの不足で失敗する: `gh auth refresh -h github.com -s workflow` を案内する。それまでは人がマージする
- 適用スクリプトが `選択項目 … は optional にありません` で止まる: 項目そのものを増やすのは標準の変更にあたる。
  勝手に `.shinnn/setup.json` を書き足さず、「引き継ぎメモ」Issue に上げる

## 関連

| やりたいこと | スキル |
|:--|:--|
| 最初の機能を作る | `/shinnn-app:feature` |
| 標準の更新を取り込む | `/shinnn-app:sync-standards` |
| 引き継ぎの条件を満たしているか見る | `/shinnn-app:handover-check` |
