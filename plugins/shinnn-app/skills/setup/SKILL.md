---
name: setup
description: アプリの初回セットアップを対話で行う。空のフォルダでは同梱のテンプレートを展開して git と GitHub のリポジトリを用意する。テンプレートを展開した後は、テンプレートの選択・環境の検出・必須項目の確認・選択項目の決定・適用までを 1 回で通す。再実行すると選択の変更を差分の PR にする。「セットアップ」「初期設定」「最初に何をすればいい」で起動
---

# 初回セットアップ

アプリ用の空のフォルダでプラグインを入れた直後に実行する。テンプレートがまだ無ければ同梱のものを展開して、git と GitHub の
リポジトリを用意し、Claude Code を起動し直してもらう。起動し直した後にもう一度実行し、決めたことを
`.shinnn/setup.json` に記録して、ワークフローや設定ファイルを生成する。あとから選択を変えたくなったら、このスキルをもう一度実行する。

**このスキルだけが `.github/`、`.shinnn/`、`CODEOWNERS` を書き換えてよい。**
書き換えは Edit / Write ツールではなく、プラグイン同梱のスクリプトで行う。テンプレートの展開は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs`（「0. テンプレートの展開」）、選択の適用は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs`（引数は「5. 適用」）。

`.github/workflows/`、`.shinnn/`、`CODEOWNERS` への Edit / Write は `.claude/settings.json` の deny が止める。
スクリプトで書くのは、何をどう変えたかが差分に残るようにするため。`.claude/settings.json` は、手順 0 の展開スクリプトが
`claude plugin install` の書いたものをテンプレートのものに置き換える場合を除き、setup でも書き換えない。
標準の更新は `/shinnn-app:sync-standards` が扱う。

## 進め方

最初に `.claude/rules/.standards-version` があるかを見る。

- **無い**（テンプレートがまだ無いフォルダ）: 手順 0 だけを行い、起動し直すよう伝えて終える
- **ある**: 手順 1〜6 を順に行う

各手順の結果を短くまとめてから次に進み、**利用者が決める項目は必ず質問する**。

### 0. テンプレートの展開

`CLAUDE.md` と `.claude/rules/` はセッションの開始時に読み込まれるので、展開した直後のセッションには規約が入っていない。
権限の設定（`.claude/settings.json`）も含めて確実に効かせるため、手順 0 を行ったセッションでは手順 1 に進まない。
`node` と `git` が要る。無ければ導入を案内してから始める。

1. **フォルダが空であることを確かめる。** `claude plugin install` が作った `.claude/` と `.git/` はあってよい。
   ほかのファイルがあれば、空のフォルダで始め直すよう伝えて止める
2. **展開する内容を見せてから展開する。** まず `--dry-run` で版とファイル数を示して確認を取り、`--dry-run` を外して実行する

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs --dry-run
   ```

   スクリプトは、プラグインに同梱されたテンプレート（`${CLAUDE_PLUGIN_ROOT}/template/`）を今のフォルダにコピーして展開する。
   ダウンロードしないので、ネットワークにも認証にも依存しない。既にファイルがあれば上書きせずに止まる。
   例外は `claude plugin install --scope project` が書いた `.claude/settings.json`
   （`enabledPlugins` と `extraKnownMarketplaces` だけのもの）で、テンプレートの同じファイルに置き換える

   版は、プラグインの版に標準の版を添えて `プラグイン v<プラグインの版>（標準 <標準の版>）` の形で示される。
   テンプレートはプラグインに同梱して配るので、テンプレートの版はプラグインの版と同じ。展開した `.shinnn/setup.json` の
   `templateVersion` にもプラグインの版が入り、どの版のテンプレートから作ったかが残る。
   テンプレートの `package.json` の `version` はアプリ自身の版で、テンプレートの版ではない

   | 引数 | 内容 |
   |:--|:--|
   | `--dest <パス>` | 展開先。既定はプロジェクトのフォルダ |
   | `--dry-run` | 版とファイル数を示すだけで、書き込まない |

3. **git に記録する。** `.git` が無ければ `git init -b main`。続けて `git add -A` →
   `git commit -m "テンプレートの取り込み"`。
   最初のコミットには対象のパッケージが無いので、コミットの接頭辞（`[server]` など）を付けない
4. **GitHub にリポジトリを作る。** リモートが無ければ、置き場所（組織かアカウント）とリポジトリ名（既定はフォルダ名）を聞いて実行する

   ```
   gh repo create <置き場所>/<名前> --private --source . --remote origin --push
   ```

   作れない場合（組織でリポジトリを作る権限が無い、`gh` が無い）は、GitHub の画面で空のリポジトリ（README なし）を
   作ってもらい、`git remote add origin <URL>` と `git push -u origin main` を実行する
5. **起動し直してもらう。** 次の 4 点を**省かずに**伝えて、ここで終える
   - `/exit` で終了し、同じフォルダで `claude` を起動し直す
   - 起動したら、もう一度 `/shinnn-app:setup` を実行する
   - 理由: 規約（`CLAUDE.md` と `.claude/rules/`）は起動時に読み込まれるため
   - 最後に次の 1 文をそのまま添える:
     「画面の別の場所に、英語で同じ内容の案内（`restart claude` など）が出ることがあります。Claude Code が自動で作る要約なので、上の手順のとおりに進めてください。」
     Claude Code がターンの終わりに作る状況の要約は英語になることが多く、プラグインからは日本語にできないため

### 1. テンプレートの選択

| プロファイル | 内容 | 向いている場合 |
|:--|:--|:--|
| `full` | shared + server（Express + PostgreSQL）+ client（Angular） | 画面とデータの保存の両方が要る |
| `client-only` | shared + client のみ。サーバーと DB を持たない | 画面だけ、または既存の API を使う |

**`client-only` は現状、シン株式会社の担当者が手で適用する。** 自動適用はまだ実装しておらず、`server/` の削除・
ルートの `package.json` の `workspaces` の編集・`api-client.ts` の模擬実装への差し替えなど 9 手順が要る
（内容は `.shinnn/profiles/client-only.md`）。選ばれたら、**その場では終わらないこと**と所要・段取りを伝え、
初回セッションは `full` のまま進める。既定は `full`。

すでに `.shinnn/setup.json` がある場合は、記録されているプロファイルを既定にして「変更しますか」と聞く。

### 2. 環境の検出

`node scripts/setup-env.mjs` を実行して、OS / Node / npm / Git / gh（ログインの状態とスコープ）/ Docker と PostgreSQL の候補を調べる。
スクリプトが出す表を示し、**足りないものは導入手順を案内する**（管理者として実行したターミナルが必要なものはその旨を伝える）。

- Node は 24 系（24.15 以上）が前提。npm は Node.js 24 に同梱される 11 系をそのまま使う
- `gh` が無い場合、Issue と PR を使う機能（セッション開始時の一覧、Issue と PR の作成、マージ）は動かない。導入を案内し、
  入るまでは Issue と PR を GitHub の画面で扱ってもらう。GitHub 自体を使えない顧客は対象外（手順 0 から GitHub のリポジトリを前提にしている）
- PostgreSQL は検出順に従って選ぶ。Docker は `docker` コマンドが動けばよく、Docker Desktop でも WSL の Docker Engine でも構わない
  （WSL の中だけにある場合、Windows 側からは見えないので「使えません」になる。WSL でコンテナを起動すれば `localhost:5432` の検出で拾える）
- Docker が使えない場合は組み込み版（`embedded-postgres`）の導入まで代行する。手で PostgreSQL を入れてもらう案内はしない（管理者権限が要らない組み込み版で足りる）
- GitHub 側は、シン株式会社の担当者のアカウントの招待状況を確認する。招待は手順 5 の 9 で行う。
  ブランチ保護（`main` に入れる変更に CI の通過を必須にする GitHub の設定）は、使えるプランなら手順 5 の 12 で設定する。
  テンプレートは `main` に直接書き込む仕組みを持たないので、CI の通過を必須にしても止まるものは無い
- トークンのスコープは表の gh の行で見る。`workflow` が無いと、ワークフローを変える PR を `gh` からマージできない。
  マージの方針を `self-review` にするなら `gh auth refresh -h github.com -s workflow` を案内する

`client-only` を選んだ場合、PostgreSQL の確認は飛ばす。

### 3. 必須項目の一覧表示

**選べない項目**として、次を「なぜ必須か」を 1 行添えて示す。ここで質問はしない。

| 項目 | なぜ必須か |
|:--|:--|
| root の `CLAUDE.md` / `.claude/rules/` / `settings.json` の deny | 構成と規約が同じでないと、シン株式会社が引き継げない |
| import 制約 lint | 層をまたぐ参照を人の注意ではなく機械で止める |
| husky の pre-commit | 壊れたコードが履歴に入らないようにする |
| husky の pre-push | `main` に直接 push しないようにする（ブランチ保護を使えないプランでも効く） |
| CI の check / test / policy | 品質の判断を人の気分に依存させない |
| Issue テンプレートとラベル | 進捗の正本が Issues なので、形が揃っていないと読めない |
| `docs/仕様書.md` と `docs/env.md` | 引き継ぎで最初に読む 2 つ |
| セキュリティ既定（helmet / CORS / ボディ上限 / レート制限） | 後から入れると全経路の見直しになる |
| Dependabot と `npm audit`、依存のライセンス検査 | 依存の脆弱性と、費用が発生するライセンスを放置しない |
| コミット規約と引き継ぎの完了定義 | 履歴と完了の基準を揃える |
| CODEOWNERS（シン株式会社の担当者） | レビューが必ずシン株式会社に届くようにする |

費用はいずれも無料（GitHub Actions の無料枠内）。

### 4. 選択項目の確認

**1 つずつ**聞く。各項目について 推奨 / 費用 / 入れない場合に何が起きるか を示し、既定値は Enter で採用できるようにする。

| 項目 | キー | 推奨 | 費用 | 入れないと |
|:--|:--|:--|:--|:--|
| 月次の健全性レポート（health report） | `health-report` | 入れる | 無料 | 滞留している Issue と直近の CI の結果が月に一度まとまらない |
| Copilot のコードレビュー | `copilot-review` | Copilot Business を使えるなら入れる | Copilot の利用料に含まれる | PR のレビューがシン株式会社の週次だけになる |
| PR の自動 AI レビュー（claude-code-action） | `claude-pr-review` | 変更が多いなら入れる | **利用者負担**。Pro / Max のサブスク枠、または API キーの従量課金 | 同上 |
| `@claude` メンションへの応答 | `claude-mention` | 任意 | 同上 | PR 上で質問できない |

選択項目はこの 4 つと、手順 1 のプロファイルに合わせて決まる `client-only-profile` だけ。表に無い機能を選択項目として勧めない。

#### シン株式会社の担当者のアカウント（`reviewer`）

`CODEOWNERS` に入れて、PR のレビューがシン株式会社に届くようにするアカウント。**既定値は持たない。**
同席しているシン株式会社の担当者に、GitHub のアカウント名を入力してもらう。

- setup を実行している人（`gh auth status` のアカウント）を候補に出さない。PR は `gh` にログインしている
  アカウントで作られ、GitHub は PR の作成者にレビューを依頼しないので、`CODEOWNERS` に入れてもシン株式会社にレビューが届かない
- 入力の例を示すなら `@<アカウント名>` の形にする。実在しうるアカウント名を作って例に出さない（別人を指すおそれがある）
- 決まらなければ `--reviewer` を渡さず、`@SHINNN_REVIEWER` のままにする。決まったら setup を再実行して差し替える。
  それまで PR のレビュー依頼は自動で出ないこと、手順 5 の 9 の招待も行わないことを伝える
- 再実行のときは、`.shinnn/setup.json` の `reviewer` が `@SHINNN_REVIEWER` 以外なら、それを既定にして「変更しますか」と聞く

#### マージの方針（`mergePolicy`）

PR を誰がマージするかを決める。既定は `human`。

| 値 | 動き | 選ぶ場合 |
|:--|:--|:--|
| `human`（既定） | Claude はドラフトのまま渡し、人が ready にしてマージする | シン株式会社のレビューを必ず通したい |
| `self-review` | `/shinnn-app:pr` がセルフレビュー（Critical / Warning が 0）と CI の通過を確かめ、ready にしてマージまで行う | 顧客が「シン株式会社のレビューを待たずに進める」と明示した |

`self-review` を選ぶ前に、次を相手に説明して同意を取る:

- **Claude が人の確認なしにマージまで行う設定**であること。`.claude/settings.json` は `gh pr` を許可しているので、`gh pr merge` の実行時に確認は出ない。止めたければ `human` に戻す（setup の再実行）
- Claude がマージするのは **CI が緑の PR だけ**（`/shinnn-app:pr` が確かめる）。使えるプランなら手順 5 の 12 でブランチ保護も設定し、
  CI が緑でない PR は GitHub の側でもマージできなくする。承認（Approve）は必須にしないので、Claude が作った PR を Claude がマージできる
- `gh` のトークンに `workflow` スコープがあるか（ワークフローを変える PR のマージに要る。手順 2 で確認する）
- リポジトリの auto-merge を許可するか（手順 5 の 10）

`@claude` メンションへの応答と PR の AI レビューは、**発言者をリポジトリの関係者（OWNER / MEMBER /
COLLABORATOR）に限る条件と `--allowed-tools` が雛形に入っている**。公開リポジトリで第三者のコメント 1 件から
顧客の枠が消費されるのを防ぐためなので、有効化のときにこの 2 つを外さない。

**シン株式会社のキーは提供しない。** 費用が発生する項目を選んだ場合は、認証情報の置き場所（リポジトリの secret）と、
消費するのが誰の枠かをその場で説明し、**値そのものは利用者に入力してもらう**（Claude は読み書きしない）。
費用の目安は「およそいくら」までにとどめ、断定した金額を示さない。

### 5. 適用

**初回も再実行も、`main` に直接コミット・push しない。** 適用の前に Issue とブランチを用意し、変更は PR にする。
ブランチ名（`feature/<Issue 番号>-<slug>`）と PR 本文の `Closes #<Issue 番号>` は `.claude/rules/git-workflow.md` の
規約どおりにする（CI の規約チェックが本文の `Closes` を確かめる）。

1. ラベル（`status:next` / `status:doing` / `status:blocked` / `type:feature` / `type:bug` / `type:deps` / `report`）を
   `gh label create` で投入する。Issue テンプレート（`feature.yml` / `bug.yml`）はテンプレートに入っている。
   `type:deps` は `dependabot-issue.yaml` が Dependabot の PR に対応する Issue を作るときに、`report` は月次の健全性レポートが
   Issue を作るときに使う（健全性レポートを有効にしない場合も作っておく）。
   `type:deps` と `status:next` は、`dependabot-issue.yaml` が先に作っていることがある。既にあるラベルは `gh label create` が
   `already exists` で失敗するが、そのまま使う（`--force` で色や説明を上書きしない）
2. 適用の Issue を `gh issue create` で作る。題は初回なら `[設定] 初回セットアップの適用`、再実行なら変える内容に合わせる
   （例: `[設定] PR の AI レビューの有効化`）。本文には決めた内容を箇条書きで書き、ラベルは `status:doing` を付ける
3. `main` の最新から、2 の Issue の番号でブランチを切る。手順 2（環境の検出）で出た変更（組み込み版の PostgreSQL の導入など）は、
   コミットせずにこのブランチへ持ち越す

   ```
   git fetch origin main
   git switch -c feature/<Issue 番号>-setup origin/main
   ```

   `gh` が無い・ログインできない場合は、ラベルと Issue を GitHub の画面で作ってもらい、Issue の番号を聞いてから
   同じ名前でブランチを切る。下の 13 の PR も画面で作ってもらい、本文に `Closes #<番号>` を入れてもらう
4. 保護されたファイル（`.shinnn/setup.json` / `.github/workflows/` / `CODEOWNERS`）を、適用スクリプトで**まとめて 1 回**
   書き換える。まず `--dry-run` を付けて内容を見せ、確認を取ってから実行する

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs --dry-run --profile full --reviewer @<シン株式会社の担当者のアカウント> --database docker --merge-policy human --enable health-report --disable claude-pr-review,claude-mention
   ```

   | 引数 | 内容 |
   |:--|:--|
   | `--profile` | `full` / `client-only`（`optional.client-only-profile` も一緒に合わせる） |
   | `--reviewer` | `CODEOWNERS` の `@SHINNN_REVIEWER` を置き換えるシン株式会社の担当者のアカウント |
   | `--database` | `database-url` / `local-postgres` / `docker` / `embedded-postgres` / `pglite` / `managed` |
   | `--merge-policy` | `human`（既定。人が ready にしてマージする）/ `self-review`（`/shinnn-app:pr` がセルフレビューと CI の通過後にマージする） |
   | `--enable` / `--disable` | 選択項目。`.shinnn/setup.json` の `optional` にあるキーだけを受け付ける |
   | `--handover-issue` | 「引き継ぎメモ」Issue の番号（下の 8 で Issue を作ってから渡す） |
   | `--complete` | `setupCompletedAt` に現在時刻を入れる |

   **ワークフローは追加も削除もしない。** 雛形は `.github/workflows/*.yaml.disabled` として同梱してあり、
   スクリプトが `.disabled` を外す（有効化）／付け直す（無効化）だけを行う。
   選ばなかったものを消さないのは、あとから選び直したときに戻せるようにするため。
   スクリプトが触らない残りのファイル（5〜7）は、通常の Edit / Write で書く
5. `docs/` の雛形（`仕様書.md` / `env.md` / `decisions/`）を、無いものだけ作る
6. `README.md` の「有効な機能」表を、決めた内容で書き換える（マージの方針とブランチ保護の行も含める。ブランチ保護は 12 の結果を書く）
7. `docs/decisions/` の**空いている次の番号**で `<番号>-setup.md` を作り、**選んだ理由と選ばなかった理由**を残す
   （テンプレートに `0001-template-stack.md`・`0002-package-manager.md`・`0003-node-version.md` が同梱されているので、初回は通常 `0004-setup.md`）
8. 「引き継ぎメモ」Issue を作成して pin する（`gh issue create` → `gh issue pin`）。`.shinnn/setup.json` に
   `handoverIssue` があれば作らない。番号が決まったら `--handover-issue <番号> --complete` でもう一度スクリプトを実行する
9. シン株式会社の担当者が collaborator（リポジトリの共同作業者）に招待されていなければ招待する。
   `gh api -X PUT repos/{owner}/{repo}/collaborators/<シン株式会社の担当者のアカウント（@ なし）> -f permission=maintain`
   （リポジトリの管理者権限が要る。権限の指定は組織のリポジトリでだけ有効で、個人アカウントのリポジトリでは無視される）。
   招待されていないと `CODEOWNERS` に書いてもレビュー依頼が届かない
10. マージの方針が `self-review` なら、リポジトリで auto-merge を許可するかを聞く。許可する場合は
    `gh api -X PATCH repos/{owner}/{repo} -f allow_auto_merge=true`（リポジトリの管理者権限が要る）。
    許可しなくても `/shinnn-app:pr` は CI の完了を待ってからマージするので、動きは変わらない
11. Dependabot のアラート（依存の脆弱性の通知）とセキュリティ更新（脆弱性を直す PR の自動作成）を有効にする。
    `.github/dependabot.yml` はメジャー更新を PR にしないが、セキュリティ更新はその指定に関係なく PR になる。
    private のリポジトリでは既定で無効のことがあるので、必ず実行する。セキュリティ更新はアラートが有効でないと使えないので、この順に行う。
    `gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts`
    `gh api -X PUT repos/{owner}/{repo}/automated-security-fixes`
    （どちらもリポジトリの管理者権限が要る）。できなければ止めずに結果を報告し、GitHub の画面で
    Settings → 「Security and quality」の「Advanced Security」（画面によっては「Code security」）を開き、
    「Dependabot alerts」と「Dependabot security updates」の **Enable** を押すよう案内する
12. ブランチ保護を、使えるプランなら設定する。まず `--dry-run` で設定する内容を見せて確認を取り、`--dry-run` を外して実行する

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/protect-branch.mjs --dry-run
    ```

    対象は `main`。`.github/workflows/ci.yaml` の 3 つのジョブの通過を必須にし（必須のチェックの名前は各ジョブの `name:` で、テンプレートのままなら「型検査と lint」「テスト」「規約チェック」）、管理者にも同じ条件を課す。
    承認（Approve）は必須にしない（`self-review` では Claude が作った PR を Claude がマージするので、必須にするとマージできない）。
    マージの前にブランチを `main` の最新に追いつかせることと、履歴を一直線にすることも必須にしない
    （`/shinnn-app:pr` はマージコミットを作ってマージする）。
    既にブランチ保護があれば（従来の方式でも、ルールセットで効いているルールでも）上書きせず、今の必須のチェックを示して終わる。
    private で無料のプランのように使えない場合やリポジトリの管理者権限が無い場合は「使えない（理由）」、`gh` が無い・
    ログインしていない場合は「設定していない（理由）」と示し、どちらもエラーにせず終わる。
    最後の行に出る 1 行の要約（`ブランチ保護: …` で始まる）を、そのまま 6 の「有効な機能」表と 7 の記録に書き足す
13. 変更をコミットし、`/shinnn-app:pr` で PR にする。本文の 1 行目は `Closes #<2 で作った Issue の番号>`。
    費用が発生する項目を増やした場合は、本文に費用の目安を書く。ready にするか、マージまで行うかは
    `/shinnn-app:pr` がマージの方針（`human` / `self-review`）に従って決める

`.shinnn/setup.json` の形（キーはテンプレート同梱のものと同じにする。**勝手に増やさない・減らさない**）:

```json
{
  "templateVersion": "0.1.0",
  "setupCompletedAt": "2026-01-01T00:00:00.000Z",
  "profile": "full",
  "reviewer": "@<シン株式会社の担当者のアカウント>",
  "mergePolicy": "human",
  "database": { "mode": "docker" },
  "mandatory": ["claude-md", "claude-rules", "claude-settings-deny", "import-restriction-lint", "husky-pre-commit", "ci-check", "ci-test", "ci-policy", "issue-templates", "issue-labels", "docs-specification", "docs-env", "security-defaults", "dependabot", "npm-audit", "commit-convention", "handover-definition", "codeowners"],
  "optional": { "client-only-profile": false, "health-report": true, "copilot-review": false, "claude-pr-review": false, "claude-mention": false },
  "handoverIssue": 2
}
```

`templateVersion` には、手順 0 で展開したプラグインの版が入る（展開スクリプトが書く）。どの版のテンプレートから作ったかの記録になる。
標準の版は `.shinnn/setup.json` に持たない。`.claude/rules/.standards-version` の 1 か所だけにあり、`/shinnn-app:sync-standards` が更新する。

**再実行のとき**は、既存の `.shinnn/setup.json` と今回の選択を比べ、**差分のある項目だけ**を変更する。
進め方は初回と同じで、手順 5 の 2 の Issue の題を変える内容に合わせる。

### 6. 次の一手

setup の PR がまだマージされていなければ、先にマージしてもらう（マージの方針が `human` なら、人が ready にしてマージする）。
最後に、次に打つコマンドを 1 つだけ示す。

```
/shinnn-app:feature "アプリの目的と、最初に作る画面"
```

あわせて、`docs/初回セッション.md` があればその台本を案内する。

## 失敗したとき

- 展開スクリプトが既存のファイルとの衝突で止まる: 上書きしない。空のフォルダを作って始め直してもらう
- `git commit` が名前とメールアドレスの未設定で止まる: `git config --global user.name` と `user.email` の設定を案内する
- `gh repo create` が失敗する（組織でリポジトリを作る権限が無い、`gh` が無い）: GitHub の画面で空のリポジトリ（README なし）を
  作ってもらい、`git remote add origin <URL>` と `git push -u origin main` を実行する
- `gh` の認証が切れている: `gh auth login` を案内する。ログインできなければ、手順 5 の 3 の `gh` が無い場合と同じく
  Issue と PR を GitHub の画面で作ってもらい、ラベルの投入は後回しにする
- Dependabot のアラートやセキュリティ更新を有効にできない（管理者権限が無い）: 止めずに続け、手順 5 の 11 の画面での手順を案内する
- ブランチ保護のスクリプトが「使えない（理由）」と示して終わる（private で無料のプラン、管理者権限が無い）: 止めずに続け、
  理由を「有効な機能」表と `docs/decisions/` の記録に残す。プランを変えるか、管理者が setup を再実行すれば設定できる
- ブランチ保護のスクリプトが、既にあるブランチ保護を示して終わる: 上書きしない。必須のチェックに CI の 3 つのジョブが無ければ、
  差分を示して人に判断してもらう
- ブランチ保護のスクリプトが、`main` に直接コミットするワークフローが残っているとして設定しない: 止めずに続け、理由を記録に残してシン株式会社に相談する
- ブランチ保護のスクリプトが終了コード 1 で終わる（想定外の失敗）: 出力をそのまま示し、ブランチ保護は「未設定」として記録して続ける
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
