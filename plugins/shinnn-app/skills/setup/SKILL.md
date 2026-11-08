---
name: setup
description: アプリの初回セットアップを対話で行う。空のフォルダでは同梱のテンプレートを展開して git と GitHub のリポジトリを用意する。テンプレートを展開した後は、テンプレートの選択・環境の検出・必須項目の確認・選択項目の決定・適用までを 1 回で通す。最後に作りたいアプリ（既にあるアプリの作り直しを含む）を聞き、続けて /shinnn-app:feature を始める。再実行すると選択の変更を差分の PR にする。初回のセットアップが途中で止まったときは、再実行で済んでいないところから続ける。「セットアップ」「初期設定」「最初に何をすればいい」「セットアップの選択を変えたい」「セットアップの続き」「前の担当者の権限を決めたい」で起動
---

# 初回セットアップ

アプリ用の空のフォルダでプラグインを入れた直後に実行する。テンプレートがまだ無ければ同梱のものを展開して、git と GitHub の
リポジトリを用意する。そのあと、Claude Code を起動し直してもらう。起動し直した後にもう一度実行する。その実行で、決めたことを
`.shinnn/setup.json` に記録して、ワークフローや設定ファイルを生成する。あとから選択を変えたくなったら、このスキルをもう一度実行する。
初回のセットアップが途中で止まったときも、もう一度実行する。済んでいないところから続く。

**選択（`.shinnn/setup.json` の値）・`CODEOWNERS`・ワークフローの有効と無効を変えてよいのは、このスキルだけ。**
既存のアプリへ標準（規約・権限の設定・ワークフローの中身・PR テンプレートなど）を写すのは `/shinnn-app:update-rules`。
update-rules は、標準を写した後に setup と同じ適用のスクリプトを `--align-only` で実行し、`.shinnn/setup.json` の形だけを今の標準に揃える
（選択・ワークフロー・`CODEOWNERS` は変えない）。
書き換えは Edit / Write ツールではなく、プラグイン同梱のスクリプトで行う。テンプレートの展開は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs`（「0. テンプレートの展開」）、選択の適用は
`node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs`（引数は「5. 適用」）。

`.github/workflows/`、`.shinnn/`、`CODEOWNERS` への Edit / Write は `.claude/settings.json` の deny が止める。
スクリプトで書くのは、何をどう変えたかが差分に残るようにするため。`.claude/settings.json` は、手順 0 の展開スクリプトが
`claude plugin install` の書いたものをテンプレートのものに置き換える場合を除き、setup でも書き換えない。
標準の更新は `/shinnn-app:update-rules` が扱う。

## 進め方

最初に、今の状態を次の順に見る。

1. **`.claude/rules/.standards-version` が無い**（テンプレートがまだ無いフォルダ）: 手順 0 を 1 から行い、起動し直すよう伝えて終える
2. **手順 0 の git と GitHub の用意が済んでいない**: 次の 3 つのコマンドで順に見て、済んでいないものを行う

   ```
   git log -1 --oneline -- .claude/rules/.standards-version
   git fetch origin main
   git log -1 --oneline origin/main -- .claude/rules/.standards-version
   ```

   | 結果 | 行うこと |
   |:--|:--|
   | 1 つ目が失敗する、または何も出さない（テンプレートをコミットしていない） | 手順 0 の 3。終わったら 2 つ目を見る |
   | 2 つ目が `origin` が無いと言って失敗する | 手順 0 の 4 |
   | 2 つ目が `origin` に `main` が無いと言って失敗する（`couldn't find remote ref`） | 手順 0 の 4 の `git push` |
   | 2 つ目がそのほかの理由で失敗する | 「失敗したとき」の `git fetch origin main` の項目に従う |
   | 3 つ目が何も出さない（`origin` の `main` にテンプレートが無い） | 「失敗したとき」の `git push -u origin main` の項目に従う |

   どれかを行ったら、手順 0 の 5 に進む。どれも行わなかったら、3 に進む
3. **リポジトリの `.claude/rules/.standards-version` が `${CLAUDE_PLUGIN_ROOT}/template/.claude/rules/.standards-version` と違う**:
   今のブランチが `main` か `feature/<番号>-setup` なら、比べる前に `git log HEAD..origin/main --oneline -- .claude/rules/.standards-version` を見る。
   コミットが出たら、手順 5 の 3 のとおり `origin/main` を取り込んでから比べる。
   それでも違うときは、`feature/<番号>-setup` の未コミットの変更をコミットする。`/shinnn-app:update-rules` はブランチを切るときに未コミットの変更を持ち越す。
   コミットしてから、先に `/shinnn-app:update-rules` で標準を取り込むよう伝えて終える（規約・CLAUDE.md 雛形・アプリ作り方ガイド・権限の設定・git のフック・コミット時の整形の設定・確認のスクリプト・ワークフロー・PR テンプレート・Dependabot の設定の更新は setup ではなく update-rules が扱う）
4. **適用の途中で止まっている**（題が `[設定] 初回セットアップの適用` の open な Issue がある。探し方と、2 つ以上あるときの決め方は手順 5 の 2）:
   Issue の本文の決めた内容を示し、変えるものがあるかを 1 回だけ聞く。変えるものと本文に無いものだけを手順 1〜4 のとおりに聞く。
   変えたら `gh issue edit` で本文を直す。残りの手順 1〜4 は飛ばし、手順 5 を 1 から順に行う。
   `gh` が無い・ログインできないときは、適用の Issue を既に作ったかを聞く
5. **どれでもない**: 手順 1〜6 を順に行う。ただし、「前の担当者の権限を決めたい」と頼まれたときは、手順 1〜5 を行わず手順 6 に進む

各手順の結果を短くまとめてから次に進み、**利用者が決める項目は質問する**。
ただし、`args`（setup を呼んだときに `/shinnn-app:setup` の後ろに書いた文）に答えがある項目は、質問せずにその答えを使う。
`args` に「既定のまま」か「質問せずに」とあれば、次のとおりに進める。

- 既定のある項目は、質問せずに既定を採る
- 実行の前の確認（`--dry-run` の結果を見せて取る確認）は取らない
- シン株式会社の担当者のアカウントは、`args` に無く、記録の `reviewer` が `@SHINNN_REVIEWER` のとき（初回など、既定が無いとき）は、質問せずに決まらなかったとき（手順 4）の扱いにする
- そのほかの既定の無い項目は、質問する

### 0. テンプレートの展開

`CLAUDE.md` と `.claude/rules/` はセッションの開始時に読み込まれるので、展開した直後のセッションには規約が入っていない。
権限の設定（`.claude/settings.json`）も含めて確実に反映させるため、手順 0 の 2 で展開したセッションでは手順 1 に進まない。
`node` と `git` が要る。無ければ導入を案内してから始める。
3 と 4（と、「失敗したとき」の `git push -u origin main` の項目の重ね直し）は、テンプレートを取り込むコミットを `main` に作って GitHub に送る手順。規約 `git-workflow.md` の「やらないこと」のただし書きに当たる。

1. **フォルダが空であることを確かめる。** `claude plugin install` が作った `.claude/` と `.git/` はあってよい。
   GitHub でリポジトリを作る画面で付けられる `README.md`・`LICENSE`・`.gitignore` も、あってよい（そのリポジトリを clone したフォルダなど）。
   2 の展開で、`README.md` と `.gitignore` はテンプレートのものに置き換わり、`LICENSE` は残る。
   ほかのファイルがあれば、次の 3 つを伝えて止める
   - 空のフォルダで始め直す。setup は、この道具を使わずに作ったアプリ（以下「元のアプリ」）のフォルダに標準を当てない
     （規約と確認のスクリプトと CI は、テンプレートの構成を前提にしている）
   - 元のアプリを作り直すときは、空のフォルダで新しいアプリを作る。元のアプリのフォルダはそのまま残し、新しいフォルダにコピーしない。
     新しいフォルダで `claude --add-dir <元のアプリのフォルダ>` で起動してから setup を実行する。
     最後の問い（手順 6）に `<元のアプリのフォルダ>にあるアプリを作り直したい` と答えると、起動し直さずに作り直しへ進む
     （setup の PR がマージされていれば、そのまま始まる。マージされていなければ、マージした後に `feature` を打つ）
   - このフォルダでプラグインを入れたときに、`claude plugin install --scope project` が `.claude/settings.json` を書いている。
     元のアプリに要らなければ、利用者に git で元に戻すか消してもらう
2. **展開する内容を見せてから展開する。** まず `--dry-run` で版とファイル数（置き換えるファイルと残すファイルも）を示して確認を取り、`--dry-run` を外して実行する

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-template.mjs --dry-run
   ```

   スクリプトは、プラグインに同梱されたテンプレート（`${CLAUDE_PLUGIN_ROOT}/template/`）を今のフォルダにコピーして展開する。
   ダウンロードしないので、ネットワークにも認証にも依存しない。既にファイルがあれば上書きせずに止まる。
   例外の 1 つ目は、`claude plugin install --scope project` が書いた `.claude/settings.json`
   （`enabledPlugins` と `extraKnownMarketplaces` だけのもの）。スクリプトはこのファイルをテンプレートの同じファイルに置き換える。
   例外の 2 つ目は、GitHub の作成画面で付けられる 3 つ。スクリプトは、`README.md` と `.gitignore` をテンプレートのものに置き換え、
   `LICENSE` は書かずに残す（`--dry-run` の「置き換えるファイル」と「残すファイル」に出る）

   版は、プラグインの版に標準の版を添えて `プラグイン v<プラグインの版>（標準 <標準の版>）` の形で示される。
   テンプレートはプラグインに同梱して配るので、テンプレートの版はプラグインの版と同じ。展開した `.shinnn/setup.json` の
   `templateVersion` にもプラグインの版が入り、どの版のテンプレートから作ったかが残る。
   テンプレートの `package.json` の `version` はアプリ自身の版で、テンプレートの版ではない

   | 引数 | 内容 |
   |:--|:--|
   | `--dest <パス>` | 展開先。既定はプロジェクトのフォルダ |
   | `--dry-run` | 版・ファイル数・置き換えるファイル・残すファイルを示すだけで、書き込まない |

3. **git に記録する。** `.git` が無ければ `git init -b main`。今のブランチが `main` でなければ `git branch -M main`。続けて `git add -A` →
   `git commit -m "テンプレートの取り込み"`。
   テンプレートを取り込むコミットには対象のパッケージが無いので、コミットの接頭辞（`[server]` など）を付けない。
   GitHub で作ったリポジトリを clone したフォルダでは、`README.md` などの最初のコミットの上に、このコミットが重なる
4. **GitHub にリポジトリを作る。** リモートが無ければ、置き場所（組織かアカウント）とリポジトリ名を聞いて実行する。
   置き場所の既定は、`gh` にログインしているアカウントにする（次の 1 つ目のコマンドが出す名前）。リポジトリ名の既定は、フォルダ名にする

   ```
   gh api user --jq .login
   gh repo create <置き場所>/<名前> --private --source . --remote origin --push
   ```

   作れない場合（組織でリポジトリを作る権限が無い、`gh` が無い）は、GitHub の画面でリポジトリを非公開（Private）で作ってもらう
   （`README.md`・`LICENSE`・`.gitignore` は付けてもよい）。続けて、`git remote add origin <URL>` と `git push -u origin main` を実行する。
   `origin` があれば、リポジトリを作らずに `git push -u origin main` だけを実行する。
   clone したフォルダでは、手元の `main` が `origin` の `main` の続きになっているので、そのまま送れる。
   `git push -u origin main` が断られたら、「失敗したとき」の `git push -u origin main` の項目に従う。

   `gh repo create --private` で作ったリポジトリのほかに送るとき（`origin` が前からあったとき、画面で作ってもらったとき、
   「失敗したとき」の同じ名前のリポジトリを使うとき）は、最初の `git push -u origin main` の前に公開範囲を見る

   ```
   gh repo view --json visibility --jq .visibility
   ```

   `PUBLIC` なら、送るとアプリのコードが誰にでも見えるようになることを伝える。
   GitHub の画面で非公開（Private）にしてから進めるか、公開のまま進めるかを聞く（既定の無い項目なので、`args` に「質問せずに」とあっても聞く）。
   `gh` が無くて見られないときは、GitHub の画面で公開範囲を確かめてもらう。
   `gh repo view` は権限の設定の許可に無いので、実行の前に確認が出る。許可してもらって進める
5. **起動し直してもらう。** このセッションで 2 の展開をしていなければ、規約は読み込まれている。
   その場合は起動し直しを伝えず、「進め方」の 3 に進む。2 の展開をしていれば、次の 4 点を**省かずに**伝えて、ここで終える
   - `/exit` で終了し、同じフォルダで `claude` を起動し直す。このセッションの作業フォルダの一覧に、このフォルダの外のフォルダがあれば、そのフォルダを `--add-dir` で付ける
   - 起動したら、もう一度 `/shinnn-app:setup` を実行する。今回 `/shinnn-app:setup` の後ろに文を書いていれば、同じ文を付ける
   - 理由: 規約（`CLAUDE.md` と `.claude/rules/`）は起動時に読み込まれるため
   - 最後に次の 1 文をそのまま添える。
     「画面の別の場所に、英語で同じ内容の案内（`restart claude` など）が出ることがあります。Claude Code が自動で作る要約なので、上の手順のとおりに進めてください。」
     Claude Code がターンの終わりに作る状況の要約は、英語になることが多い。プラグインからはこの要約を日本語にできないので、この 1 文を添える

### 1. テンプレートの選択

| プロファイル | 内容 | 向いている場合 |
|:--|:--|:--|
| `full` | shared + server（Express + PostgreSQL）+ client（Angular） | 画面とデータの保存の両方が要る |
| `client-only` | shared + client のみ。サーバーと DB を持たない | 画面だけ、または既存の API を使う |

**`client-only` は現状、シン株式会社の担当者が手で適用する。** 自動適用はまだ実装していない。手で適用するには、`server/` の削除・
ルートの `package.json` の `workspaces` の編集・`api-client.ts` の模擬実装への差し替えなど 9 手順が要る
（内容は `.shinnn/profiles/client-only.md`）。選ばれたら、**その場では終わらないこと**と所要・段取りを伝え、
この回は `full` のまま進める。既定は `full`。

すでに `.shinnn/setup.json` がある場合は、記録されているプロファイルを既定にして「変更しますか」と聞く。

### 2. 環境の検出

`node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-env.mjs` を実行して、OS / Node / npm / Claude Code / Git / gh（ログインの状態とスコープ）/ Docker と PostgreSQL の候補を調べる。
スクリプトが出す表を示し、**足りないものは導入手順を案内する**（管理者として実行したターミナルが必要なものはその旨を伝える）。

- Node は 24 系（24.15 以上）が前提。npm は Node.js 24 に同梱される 11 系をそのまま使う
- Claude Code は 2.1.283 以上が前提。この版から、ターミナルの対話のセッションは、プランによらず権限の自動判定（auto mode）で始まる。
  auto mode では確認が減る。表の版は、PATH で最初に見つかる `claude` のもの（デスクトップアプリが動かしている版とは違うことがある）。
  古ければ `claude update` を案内する。デスクトップアプリでは、画面の権限のモードの切り替えで選ぶ
- `gh` が無い場合、Issue と PR を使う機能（セッション開始時の一覧、Issue と PR の作成、マージ）は動かない。導入を案内し、
  入るまでは Issue と PR を GitHub の画面で扱ってもらう。GitHub 自体を使えない顧客は対象外（手順 0 から GitHub のリポジトリを前提にしている）
- PostgreSQL は検出順に従って選ぶ。Docker は `docker` コマンドが動けばよく、Docker Desktop でも WSL の Docker Engine でも構わない
  （WSL の中だけにある場合、Windows 側からは見えないので「使えません」になる。WSL でコンテナを起動すれば `localhost:5432` の検出で拾える）
- Docker も PostgreSQL も無い場合は PGlite（API サーバーの中で動く PostgreSQL）を使う。入れるものは無い。
  `server/.env` は、手順 5 の 5 でスクリプトが作る（`server/.env.example` を写したもの。`DB_DRIVER` は `pglite`、`JWT_SECRET` はランダムな値）。
  Claude は `.env` の値を読み書きしない。スクリプトは値を書くだけで、出力に値を出さない。
  手で PostgreSQL を入れてもらう案内はしない。本番と同じ PostgreSQL で確かめたい利用者には、マネージドの無料枠（`managed`）も示す
- 選んだ方式は手順 5 で `--database` に渡し、`docs/env.md` にも書く
- GitHub 側は、シン株式会社の担当者のアカウントが招待されているかを確認する。招待は手順 5 の 9 で行う。
  ブランチ保護（`main` に入れる変更に CI の通過を必須にする GitHub の設定）は、使えるプランなら手順 5 の 12 で設定する。
  テンプレートは `main` に直接書き込む仕組みを持たないので、CI の通過を必須にしても止まるものは無い
- トークンのスコープは表の gh の行で見る。`workflow` が無くても、表の結果を伝えるだけで止めない
- `workflow` は、ワークフローを変える PR の push とマージに要る。そういう PR は 2 種類ある。
  1 つ目は、ワークフローを持つ選択項目（`health-report`・`claude-pr-review`・`claude-mention`）を入れる・外す setup の PR。
  外すときも、適用のスクリプトがワークフローのファイル名を変える。
  2 つ目は、標準の取り込み（`/shinnn-app:update-rules`）の PR
- `workflow` が無ければ、手順 4 でワークフローを持つ選択項目を入れる・外すと決まったときに、`gh auth refresh -h github.com -s workflow` を案内する。
  マージが `workflow` の不足で失敗したときは、「失敗したとき」の `gh pr merge` の項目に従う

`client-only` を選んだ場合、PostgreSQL の確認は飛ばす。

### 3. 必須項目の一覧表示

**選べない項目**として、次の項目に「なぜ必須か」を 1 行添えて示す。ここで質問はしない。

| 項目 | なぜ必須か |
|:--|:--|
| root の `CLAUDE.md` / `.claude/rules/` / `settings.json` の deny | 構成と規約が同じでないと、シン株式会社が引き継げない |
| import 制約 lint | 層をまたぐ参照を人の注意ではなく機械で止める |
| husky の pre-commit | コミットするファイルに自動で直せない lint のエラーがあれば、コミットを止める。画面の `.ts` と json・md・yaml は prettier で整える（型エラーとテストの失敗は CI が止める） |
| husky の commit-msg | コミットメッセージの形が規約に合わなければ、コミットを止める |
| husky の pre-push | 誤って `main` に push したときに止める安全網（確実に止めるのは手順 5 の 12 のブランチ保護） |
| CI の check / test / policy | 品質の判断を人の気分に依存させない |
| Issue テンプレートとラベル | 進捗を Issues で管理するので、形が揃っていないと読めない |
| `docs/仕様書.md` と `docs/env.md` | 引き継ぎで最初に読む 2 つ |
| セキュリティ既定（helmet / CORS / ボディ上限 / レート制限） | 後から入れると全経路の見直しになる |
| Dependabot と `npm audit`、依存のライセンス検査 | 依存の脆弱性と、費用が発生するライセンスを放置しない |
| コミット規約と引き継ぎの完了定義 | 履歴と完了の基準を揃える |
| CODEOWNERS（シン株式会社の担当者） | PR がシン株式会社の担当者に届くようにする |

費用はいずれも無料（GitHub Actions の無料枠内）。
ただし、private のリポジトリでは、Actions の分（CI が動いた時間）に月の上限がある。`auto-merge` で PR が増えると、使う分も増える。
上限を超えたときは、規約 `git-workflow.md` の「CI が始まらないとき」に従う。

### 4. 選択項目の確認

次の表を示し、「すべて入れない（既定）」でよいかを **1 回だけ**聞く。Enter で既定を採る。
入れたいものがあると言われたときだけ、その項目ごとに、費用と入れない場合に何が起きるかを示して聞く。

| 項目 | キー | 推奨 | 費用 | 入れないと |
|:--|:--|:--|:--|:--|
| 月次の健全性レポート（health report） | `health-report` | 入れない（既定） | Actions の分を使う（private のリポジトリでは、月の上限に数える） | 滞留している Issue と直近の CI の結果が月に一度まとまらない |
| Copilot のコードレビュー | `copilot-review` | 入れない（既定） | Copilot の契約が要る。レビューのたびに Copilot の利用枠を使う | PR のレビューがシン株式会社の週次だけになる |
| PR の自動 AI レビュー（claude-code-action） | `claude-pr-review` | 入れない（既定） | **利用者負担**。Pro / Max のサブスク枠、または API キーの従量課金。Actions の分も使う（private のリポジトリでは、月の上限に数える） | 同上 |
| `@claude` メンションへの応答 | `claude-mention` | 入れない（既定） | 同上 | PR 上で質問できない |

4 つとも、既定は入れない。どれも Actions の分か利用料を使うので、利用者が選んだときだけ入れる。
health report・PR の AI レビュー・`@claude` メンションへの応答は、Actions の分を使う（private のリポジトリでは、月の上限に数える）。
Copilot・PR の AI レビュー・`@claude` メンションへの応答には、利用料がかかる。

再実行（`.shinnn/setup.json` の `setupCompletedAt` が `null` でない記録）のときは、記録の `optional` の値を既定にする。
表の「推奨」の代わりに記録の値を示し、「変更しますか」と 1 回だけ聞く。

選択項目はこの 4 つと、手順 1 のプロファイルに合わせて決まる `client-only-profile` だけ。表に無い機能を選択項目として勧めない。

#### シン株式会社の担当者のアカウント（`reviewer`）

`CODEOWNERS` に入れて、PR のレビューがシン株式会社に届くようにするアカウント。**既定値は持たない。**
シン株式会社から知らされている担当者の GitHub アカウント名を聞く。

- setup を実行している人（`gh auth status` のアカウント）を候補に出さない。PR は `gh` にログインしている
  アカウントで作られる。GitHub は PR の作成者にレビューを依頼しないので、そのアカウントを `CODEOWNERS` に入れてもシン株式会社にレビューが届かない
- 入力の例を示すなら `@<アカウント名>` の形にする。実在しうるアカウント名を作って例に出さない（別人を指すおそれがある）
- 決まらなければ `--reviewer` を渡さず、`@SHINNN_REVIEWER` のままにする。決まったら setup を再実行して差し替える。
  それまで PR のレビュー依頼は自動で出ないこと、手順 5 の 9 の招待も行わないことを伝える
- 決まらなかったときは、手順 6 の最後の報告の「してほしいこと」に、アカウント名をシン株式会社の担当者に聞くことを書く。
  分かったら setup を再実行することも書く
- 再実行のときは、`.shinnn/setup.json` の `reviewer` が `@SHINNN_REVIEWER` 以外なら、それを既定にして「変更しますか」と聞く
- 再実行で別のアカウントに変えるときは、前の担当者の権限の扱いを手順 6 で聞くと伝える

#### マージの方針（`mergePolicy`）

PR を誰がマージするかを決める。既定は `auto-merge`。

| 値 | 動き | 選ぶ場合 |
|:--|:--|:--|
| `auto-merge`（既定） | Claude が確認を挟まずに、進められる Issue が無くなるまで作りきる。`/shinnn-app:pr` がセルフレビュー（Critical / Warning が 0）と CI の通過を確かめ、ready にしてマージまで行う（CI が始まらないときは、規約 `git-workflow.md` の「CI が始まらないとき」に従う）。作りきった後に、動く画面を見ながら調整する | 最後まで作ってから、動く画面を見て調整したい（元のアプリの作り直しを含む） |
| `human` | Claude はドラフトのまま渡し、人が ready にしてマージする | シン株式会社のレビューを通してからマージしたい |

質問では、表に添えて `auto-merge` の意味を次のとおり示す。Enter で既定の `auto-merge` を採る。

- **Claude が人の確認なしにマージまで行う設定**であること。`.claude/settings.json` は `gh pr` を許可しているので、`gh pr merge` の実行時に確認は出ない
- Claude がマージするのは **CI が緑の PR だけ**であること（`/shinnn-app:pr` が確かめる。ただし、CI が始まらないときは、規約 `git-workflow.md` の「CI が始まらないとき」に従う）。使えるプランなら手順 5 の 12 でブランチ保護も設定し、
  CI が緑でない PR は GitHub の側でもマージできなくする。承認（Approve）は必須にしないので、Claude が作った PR を Claude がマージできる
- 決まっていないことは、Claude が仮に決めて進めること。仮に決めたことは、最後にまとめて報告する（規約 `git-workflow.md` の「`auto-merge` のとき」）
- 止めたければ、setup を再実行して `human` に戻せること

`gh` のトークンの `workflow` スコープは、この質問では扱わない。要る場面と案内の仕方は、手順 2 にある。

再実行（`setupCompletedAt` が `null` でない記録）のときは、記録の `mergePolicy` を既定にして「変更しますか」と聞く。記録が `human` なら、Enter で `human` のまま残す。
記録に `mergePolicy` が無ければ、`human` を既定にする。

`@claude` メンションへの応答と PR の AI レビューは、**発言者をリポジトリの関係者（OWNER / MEMBER /
COLLABORATOR）に限る条件と `--allowed-tools` が雛形に入っている**。この 2 つは、公開リポジトリで第三者のコメント 1 件から
顧客の枠が消費されるのを防ぐためのもの。有効化のときにこの 2 つを外さない。

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
   `type:deps` と `status:next` は、`dependabot-issue.yaml` が先に作っていることがある。既にあるラベルでは `gh label create` が
   `already exists` で失敗する。そのラベルはそのまま使う（`--force` で色や説明を上書きしない）
2. 適用の Issue を用意する。題は初回なら `[設定] 初回セットアップの適用`、再実行なら変える内容に合わせる
   （例: `[設定] PR の AI レビューの有効化`）。初回は、open な Issue の一覧から、題がこのとおりのものを探す

   ```
   gh issue list --state open --limit 200 --json number,title
   ```

   1 つあれば、新しく作らずにその Issue を使う。2 つ以上あれば、番号を示してどれを使うかを聞く。
   見つからないときと再実行では、`gh issue create` で作る。本文には決めた内容を箇条書きで書き、ラベルは `status:doing` を付ける
3. 2 の Issue の番号でブランチを用意する。手順 2（環境の検出）で出た変更があれば、コミットせずにこのブランチへ持ち越す

   ```
   git fetch origin
   git switch -c feature/<Issue 番号>-setup origin/main
   ```

   既にある Issue を使うときは、`git switch -c` の前に `git switch feature/<Issue 番号>-setup` を試す。
   ブランチが手元か `origin` にあれば、これで移れる。移れたら `git switch -c` で切らない。
   `git log HEAD..origin/main --oneline` にコミットが出たら、未コミットの変更をこのブランチにコミットしてから、
   `git merge origin/main` で取り込む。`git merge` は権限の設定の許可に無いので、実行の前に確認が出る。許可してもらって進める。
   `main` の標準の版が進んでいると、4 のスクリプトが止まる。取り込むのは、これを防ぐため。

   `gh` が無い・ログインできない場合は、ラベルと Issue を GitHub の画面で作ってもらう。その Issue の番号を聞いてから、
   同じ名前でブランチを用意する。既に Issue を作ってあれば、その番号を聞く。
   下の 13 の PR も画面で作ってもらい、本文に `Closes #<番号>` を入れてもらう
4. 保護されたファイル（`.shinnn/setup.json` / `.github/workflows/` / `CODEOWNERS`）を、適用スクリプトで**まとめて 1 回**
   書き換える。まず `--dry-run` を付けて内容を見せ、確認を取ってから実行する

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/apply-setup.mjs --dry-run --profile full --reviewer @<シン株式会社の担当者のアカウント> --database docker --merge-policy auto-merge
   ```

   | 引数 | 内容 |
   |:--|:--|
   | `--profile` | `full` / `client-only`（`optional.client-only-profile` も一緒に合わせる） |
   | `--reviewer` | `CODEOWNERS` の担当を割り当てる行で、`@SHINNN_REVIEWER` と記録の前の担当者を置き換えるシン株式会社の担当者のアカウント（1 つだけ） |
   | `--database` | `database-url` / `local-postgres` / `docker` / `pglite` / `managed` |
   | `--merge-policy` | `auto-merge`（初回の既定。`/shinnn-app:pr` がセルフレビューと CI の通過後にマージする。CI が始まらないときは「CI が始まらないとき」に従う）/ `human`（人が ready にしてマージする）。再実行では、記録を変えるときだけ渡す（渡さなければ記録の値が残る） |
   | `--enable` / `--disable` | 選択項目。`.shinnn/setup.json` の `optional` にあるキーだけを受け付ける。入れる項目があるときは `--enable`、記録で入っていた項目を外すときは `--disable` を付ける。選択項目がすべて既定のオフのままなら、どちらも付けない |
   | `--handover-issue` | 「引き継ぎメモ」Issue の番号（下の 8 で Issue を作ってから渡す） |
   | `--complete` | `setupCompletedAt` に現在時刻を入れる |

   **ワークフローは追加も削除もしない。** 雛形は `.github/workflows/*.yaml.disabled` として同梱してある。
   スクリプトは `.disabled` を外す（有効化）／付け直す（無効化）だけを行う。
   選ばなかったものを消さないのは、あとから選び直したときに戻せるようにするため。
   スクリプトが触らない残りのファイル（5〜7）は、通常の Edit / Write で書く
5. `docs/` の雛形（`仕様書.md` / `env.md` / `decisions/`）を、無いものだけ作る。`full` なら続けて、選んだ DB の用意方法の
   手順（起動と停止）を `docs/env.md` の「ローカルの PostgreSQL」節に書く

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-env.mjs --write --database <選んだ方式>
   ```

   節が既にあれば、スクリプトは書き足さない。再実行で方式を変えたときは、出力された節で既にある節を置き換える。
   方式が `pglite` なら、`--server-env` も付けて、`server/.env` も作る

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-env.mjs --write --database pglite --server-env
   ```

   `server/.env` が無ければ、スクリプトは `server/.env.example` を写して作る（`DB_DRIVER=pglite`、`JWT_SECRET` はランダムな値）。
   既にあれば上書きせず、`DB_DRIVER` と `JWT_SECRET` が PGlite で動く形になっているかだけを示す。
   スクリプトが「なっていません」と示した項目と、「値が空の項目」に挙げた項目は、手順 6 の報告の「してほしいこと」に書く。
   再実行で方式を `pglite` からほかの方式に変えたときは、`server/.env` の `DB_DRIVER` が `pglite` のまま残る（API サーバーは PGlite で動き続ける）。
   `DB_DRIVER` を `pg` にすること（行を消してもよい）と、接続先の `DATABASE_URL` を確かめることを、手順 6 の報告の「してほしいこと」に書く
6. `README.md` の「有効な機能」表を、決めた内容で書き換える（マージの方針とブランチ保護の行も含める。ブランチ保護は 12 の結果を書く）
7. `docs/decisions/` の**空いている次の番号**で `<番号>-setup.md` を作り、**選んだ理由と選ばなかった理由**を残す
   （テンプレートに `0001-template-stack.md`・`0002-package-manager.md`・`0003-node-version.md` が同梱されているので、初回は通常 `0004-setup.md`）。
   既にある Issue を使っていて、`<番号>-setup.md` が既にあれば、新しく作らずにそれを書き直す
8. 「引き継ぎメモ」Issue を作成して pin する（`gh issue create` → `gh issue pin`）。本文には見出し「## 引き継ぎの注意」
   （主に `retro` が書く）と「## シン株式会社への要望」（標準を直してほしいことと、シン株式会社の判断を待つことを書く）と「## 規約で迷った点」
   （`retro` が PR 本文の同じ名前の欄から写す）の 3 つを置く。`.shinnn/setup.json` に
   `handoverIssue` があれば作らない。無くても、open な「引き継ぎメモ」Issue があれば作らず、それを pin して番号を使う。
   番号が決まったら `--handover-issue <番号> --complete` でもう一度スクリプトを実行する
9. シン株式会社の担当者が collaborator（リポジトリの共同作業者）に招待されていなければ招待する。
   `gh api -X PUT "repos/{owner}/{repo}/collaborators/<シン株式会社の担当者のアカウント（@ なし）>" -f permission=maintain`
   （リポジトリの管理者権限が要る。権限の指定は組織のリポジトリでだけ有効で、個人アカウントのリポジトリでは無視される）。
   招待されていないと `CODEOWNERS` に書いてもレビュー依頼が届かない。
   前の担当者の権限は、ここでは変えない。手順 6 で扱う
10. GitHub の自動マージの機能（CI が通った時点でマージする機能）は、有効にしない。利用者にも聞かない。
    `/shinnn-app:pr` が CI の完了を待ってからマージするので、要らない
11. Dependabot のアラート（依存の脆弱性の通知）とセキュリティ更新（脆弱性を直す PR の自動作成）を有効にする。
    `.github/dependabot.yml` はメジャー更新を PR にしないが、セキュリティ更新はその指定に関係なく PR になる。
    private のリポジトリでは既定で無効のことがあるので、必ず実行する。セキュリティ更新はアラートが有効でないと使えないので、この順に行う。
    `gh api -X PUT "repos/{owner}/{repo}/vulnerability-alerts"`
    `gh api -X PUT "repos/{owner}/{repo}/automated-security-fixes"`
    （どちらもリポジトリの管理者権限が要る）。できなければ、止めずに結果を報告する。そのうえで、GitHub の画面で
    Settings → 「Security and quality」の「Advanced Security」（画面によっては「Code security」）を開き、
    「Dependabot alerts」と「Dependabot security updates」の **Enable** を押すよう案内する
12. ブランチ保護を、使えるプランなら設定する。まず `--dry-run` で設定する内容を見せて確認を取り、`--dry-run` を外して実行する

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/protect-branch.mjs --dry-run
    ```

    対象は `main`。`.github/workflows/ci.yaml` と `policy.yaml` の 3 つのジョブの通過を必須にする（必須のチェックの名前は各ジョブの `name:` で、テンプレートのままなら「型検査と lint」「テスト」「規約チェック」）。管理者にも同じ条件を課す。
    承認（Approve）は必須にしない（`auto-merge` では Claude が作った PR を Claude がマージするので、必須にするとマージできない）。
    マージの前にブランチを `main` の最新に追いつかせることと、履歴を一直線にすることも必須にしない
    （`/shinnn-app:pr` はマージコミットを作ってマージする）。
    既にブランチ保護があれば（従来の方式でも、ルールセットで有効になっているルールでも）上書きせず、今の必須のチェックを示して終わる。
    private で無料のプランのように使えない場合や、リポジトリの管理者権限が無い場合は「使えない（理由）」と示す。`gh` が無い・
    ログインしていない場合は「設定していない（理由）」と示す。どちらもエラーにせず終わる。
    「使えない」の理由には GitHub のレスポンスがそのまま出て、リポジトリを公開すれば使えると書いてあることがある。
    リポジトリを公開する案は示さない。公開すると、アプリのコードが誰にでも見えるようになる。
    最後の行に出る 1 行の要約（`ブランチ保護: …` で始まる）で、6 の「有効な機能」表のブランチ保護の行を書く（既にあれば書き換える）。
    同じ要約を 7 の記録にも書き足す。要約が `設定した` か `既にある` のときは、「引き継ぎメモ」Issue の「引き継ぎの注意」に
    ブランチ保護の項目が残っていれば、その項目を消す
13. 変更をコミットし、`/shinnn-app:pr` で PR にする。本文の 1 行目は `Closes #<2 の Issue の番号>`。
    このブランチの open な PR が既にあれば（`gh pr view --json state` が `OPEN`）、`/shinnn-app:pr` の手順 3 で `gh pr create` を飛ばし、push だけを行う。
    費用が発生する項目を増やした場合は、本文に費用の目安を書く。ready にするか、マージまで行うかは
    `/shinnn-app:pr` がマージの方針（`human` / `auto-merge`）に従って決める

`.shinnn/setup.json` の形は次のとおり。キーはテンプレート同梱のものと同じにする。**勝手に増やさない・減らさない**。

```json
{
  "templateVersion": "0.1.0",
  "setupCompletedAt": "2026-01-01T00:00:00.000Z",
  "profile": "full",
  "reviewer": "@<シン株式会社の担当者のアカウント>",
  "mergePolicy": "auto-merge",
  "database": { "mode": "docker" },
  "mandatory": ["claude-md", "claude-rules", "claude-settings-deny", "import-restriction-lint", "husky-pre-commit", "ci-check", "ci-test", "ci-policy", "issue-templates", "issue-labels", "docs-specification", "docs-env", "security-defaults", "dependabot", "npm-audit", "commit-convention", "handover-definition", "codeowners"],
  "optional": { "client-only-profile": false, "health-report": false, "copilot-review": false, "claude-pr-review": false, "claude-mention": false },
  "handoverIssue": 2
}
```

`templateVersion` には、手順 0 で展開したプラグインの版が入る（展開スクリプトが書く）。どの版のテンプレートから作ったかの記録になる。
標準の版は `.shinnn/setup.json` に持たない。`.claude/rules/.standards-version` の 1 か所だけにあり、`/shinnn-app:update-rules` が更新する。

**再実行のとき**は、既存の `.shinnn/setup.json` と今回の選択を比べ、**差分のある項目だけ**を変更する。
進め方は初回と同じ。手順 5 の 2 の Issue の題は、変える内容に合わせる。前の setup の PR がマージされてから再実行する。
ただし、初回の PR がマージされる前は、「進め方」の 4 のとおり同じ Issue とブランチで続ける。
初回の後の再実行では、前の PR のマージの前に再実行すると、`origin/main` から切ったブランチには前の記録が無い。
そのため、記録のファイル名がぶつかる。
古いテンプレートから作ったリポジトリでは、選択を変えなくても、適用のスクリプトが記録をテンプレートの形に揃える
（今の標準に無いキー・古い説明・今の標準に無い選択項目を消し、無い選択項目を足す。選んでいた値は残す）。`--dry-run` の出力に
「テンプレートの形に揃える」と出たら、その内容も PR 本文に書く。

### 6. 次の一手

担当者を変えた再実行で setup の PR がまだマージされていなければ、先にマージしてもらう（マージの方針が `human` なら、人が ready にしてマージする）。
そのほかの実行では、マージを待たずに最後の報告へ進む。マージされていなければ、報告の「してほしいこと」に書く。
担当者を変えた再実行で、その場でマージしないときは、マージの後に「前の担当者の権限を決めたい」と伝えて `/shinnn-app:setup` を実行するよう頼む。

マージされたら、前の担当者の権限の扱いを次の順に決める。`main` の `CODEOWNERS` は、マージされるまで前の担当者を指している。
その間に外すと、PR のレビュー依頼がどちらの担当者にも届かない。

1. **前の担当者を探す。** 次の出力の `"reviewer"` の行を読む。一番上の `+` から始まる行の値が、今の担当者になる。`-` から始まる行の値が、今までの担当者になる。
   今までの担当者から `@SHINNN_REVIEWER` と今の担当者を除く（アカウント名の大文字と小文字は区別しない）。誰も残らなければ、2〜5 を飛ばす。
   誰も残らなかったこと（初回など）は、報告しない

   ```
   git fetch origin main
   git log -p -G reviewer --format=%h origin/main -- .shinnn/setup.json
   ```

2. **権限が残っている人を絞る。** 残った人ごとに次の 2 つを見て、どちらにも当たらない人を除く。
   `gh issue view <handoverIssue>` の「引き継ぎの注意」に `前の担当者 @<アカウント> の権限を残している` の行がある人も除く。
   理由が `setup を実行しているアカウント` の行は、今も同じアカウントで実行しているときだけ除く。誰も残らなければ、3〜5 を飛ばす

   - `gh api "repos/{owner}/{repo}/collaborators/<アカウント（@ なし）>/permission"` の `permission` が `write` か `admin`（`maintain` は `write` と出る）
   - `gh api "repos/{owner}/{repo}/invitations"` の `invitee.login` にある（招待が残っている）

   `is not a user` と出た人は、GitHub にアカウントが無いので除く。名前を変えた人の権限は、新しい名前に残る。
   `gh api "repos/{owner}/{repo}/collaborators"` の一覧に覚えのない人がいないかを確かめてもらうよう報告する。
   ほかの理由で読めない（リポジトリの管理者権限が無いなど）ときは、除かずに 5 の「外せない」にする

3. **外してよいかを確かめる。** 次の順に見る。

   - 今の担当者の `permission`（2 と同じコマンド）が `write` か `admin` でなければ、誰も外さず 5 の「外せない」にする。
     招待を受けるまでは、今の担当者にレビュー依頼が届かない。招待が残っていなければ、手順 5 の 9 のコマンドで招待する
   - `gh auth status` でアカウントを確かめられなければ、誰も外さず 5 の「外せない」にする
   - `gh auth status` のアカウントと同じ人は、聞かずに 5 の「残す」にする（理由は `setup を実行しているアカウント`）。外すと、そのアカウントがリポジトリに入れなくなる

4. **外すか残すかを聞く。** 3 で決まらなかった人がまだ関わっているかは、Claude には分からない。次の 3 つを示してから、人ごとに聞く。

   - その人に割り当てられた open な Issue と、その人がレビューを頼まれている open な PR
     （`gh issue list --assignee <アカウント（@ なし）>` と `gh pr list --search review-requested:<アカウント（@ なし）>`）
   - 外すと起きること: Issue の割り当てが外れる。その人の fork（その人のアカウントに作った、このリポジトリの写し）が消える
   - 分からなければ、シン株式会社に確かめられること

5. **答えのとおりに行う。**

   - 外す: `gh api -X DELETE "repos/{owner}/{repo}/collaborators/<アカウント（@ なし）>"` を実行する。
     招待が残っていれば、`gh api -X DELETE "repos/{owner}/{repo}/invitations/<招待の id>"` を実行する。
     2 の `permission` をもう一度見て、結果を報告する。4 で示した PR は、`gh pr edit <番号> --add-reviewer <今の担当者（@ なし）>` で頼み直す
   - 残す: 「引き継ぎの注意」に `前の担当者 @<アカウント> の権限を残している。理由: <理由>` の行を足す
   - 分からない: 権限は変えない。「シン株式会社への要望」に `前の担当者 @<アカウント> の権限を外してよいかを確かめてほしい` の行を足す（同じ行があれば足さない）
   - 外せない（リポジトリの管理者権限が無い、組織の権限で入れる、3 で誰も外さないと決まった）: 止めずに、理由を報告する。行は足さない

   「分からない」と「外せない」の人には、次の再実行でまた聞く。
   外した人の行は、「引き継ぎの注意」と「シン株式会社への要望」から消す。残すと決めた人と 2 で除いた人の行は、「シン株式会社への要望」から消す。
   行を足すときと消すときは、`gh issue view <handoverIssue> --json body --jq .body` で今の本文を読む。
   書き換えた本文は、Write ツールで scratchpad の `issue-body.md` に書き、`gh issue edit <handoverIssue> --body-file <そのファイル>` に渡す。

`gh` が無い・ログインできない場合は、1 で人が残ったときに、GitHub の画面の Settings → Collaborators（組織のリポジトリでは Collaborators and teams）を案内する。
今の担当者が招待を受けていることを、その画面で確かめてもらう。4 の「外すと起きること」を示してから、外すか残すかを人に決めてもらう。
残すなら、Issue の画面で 5 の「残す」の行を足してもらう。

前の担当者の権限を決めるためだけの再実行は、ここで終える。それ以外の実行では、次へ進む。
報告の前に、setup の PR（手順 5 の 13）がマージ済みかを、次のコマンドで見る。

```
gh pr view <setup の PR の番号> --json state
```

最後に、利用者の言葉で、次の順に 1 回だけ報告する。

1. **決めた内容**: プロファイル、DB の用意方法、マージの方針、選択項目、シン株式会社の担当者のアカウント
2. **してほしいこと**: 利用者にしかできないこと（setup の PR のマージ（`state` が `MERGED` でないとき）、担当者のアカウントを聞くこと、`server/.env` の作成と書き換え、費用が発生する項目の secret の入力など）。無ければ書かない。
   方式が `pglite` のときの `server/.env` は、手順 5 の 5 のスクリプトが示した項目だけを書く
3. **入らなかったもの**: 入れられなかったものを 1 行ずつ書く。ブランチ保護は、手順 5 の 12 の結果に 1 行で触れるだけにする（詳しくは「有効な機能」表と記録に書いてある）
4. **次の問い**: 「作りたいアプリの目的と、最初に作る画面を教えてください」の 1 つだけ

GitHub の自動マージの機能（手順 5 の 10）は、報告に入れない。

4 の問いは、初回のセットアップのときだけ置く。初回とは、題が `[設定] 初回セットアップの適用` の Issue（手順 5 の 2）で進めた実行のこと。
「進め方」の 4 で続けた実行も、この Issue で進めるので初回に当たる。
再実行では、1〜3 を報告して終える（すでに作り始めたアプリで、作りたいアプリを聞き直さない）。

初回でも、`args` に 4 の問いの答えがあれば（例: `最後の問いの答えは <場所> にあるアプリを作り直したい`）、問わずにその答えを使う。
そのときは、報告の 4 に、問いの代わりに使う答えを書く。下の 2 つも添えない。

問いの後ろに、次の 2 つを添える。

- 元のアプリ（手順 0 の 1）を作り直すときは、`<元のアプリのフォルダ>にあるアプリを作り直したい` と答える
- 普段の進め方と画面の開き方は、`docs/アプリ作り方ガイド.md` にある

答え（`args` にあった答えを含む）を受けたら、報告の前と同じコマンドで、setup の PR をもう一度見る。
`state` が `MERGED` なら、Skill ツールで `shinnn-app:feature` を呼ぶ。`args` には、答えに合わせて次の表のものを渡す。
利用者にコマンドを打たせず、このセッションで続けて行う。

| 答え | `feature` に渡す `args` |
|:--|:--|
| アプリの目的と、最初に作る画面 | 答えのまま |
| 元のアプリを作り直す（元のアプリのフォルダが、このセッションの作業フォルダに入っている） | `<元のアプリのフォルダ>にあるアプリを作り直したい` |

このセッションの作業フォルダは、起動のときの `--add-dir` と、設定の `additionalDirectories` で足したフォルダを含む。
Claude Code が Claude に知らせる作業フォルダの一覧に出るので、それと答えの場所を比べる。
答えの場所が `~` で始まるときは、`~` をホームのフォルダに置き換えて比べる。
`args` の `<元のアプリのフォルダ>` には、作業フォルダの一覧に出ている形のパスを書く。
作り直すという答えに場所が無ければ、場所を聞く。

`feature` を呼んだら、setup はそこで終わる。その後は `feature` の手順に従う。

`MERGED` でなければ（`human` で人のマージを待つとき、`workflow` スコープの不足でマージが失敗したときなど）、`feature` を呼ばない。
マージされる前の `main` の記録は、`setupCompletedAt` が `null` のテンプレートの値のままである。
そのため、`feature` は setup で選んだ方針にかかわらず `human` として動く。
setup の PR をマージした後に、表の `args` を付けた `/shinnn-app:feature` を打つよう伝える。

作り直すと答え、元のアプリのフォルダがこのセッションの作業フォルダに入っていないときも、`feature` を呼ばない
（作業フォルダに入っていないフォルダは、読むたびに確認が出る）。次の案内を示して終える。

- `/exit` で終了する。ターミナルでこのフォルダに移り、`claude --add-dir <元のアプリのフォルダ>` で起動する
- 起動したら、`/shinnn-app:feature <元のアプリのフォルダ>にあるアプリを作り直したい` と入力する（setup の PR が `MERGED` でなければ、マージした後に入力する）

作り直すと答えて `feature` を呼ばずに終えるとき、マージの方針が `human` なら、`auto-merge` に変えると確認を挟まずに最後まで作りきることも伝える。
変えたいと言われたら、setup を再実行し、「マージの方針（`mergePolicy`）」の質問のとおりに進める。

## 失敗したとき

- 展開スクリプトが既存のファイルとの衝突で止まる: 上書きしない。手順 0 の 1 と同じ 3 つを伝える
- `git commit` が名前とメールアドレスの未設定で止まる: `git config --global user.name` と `user.email` の設定を案内する
- 「進め方」の `git fetch origin main` が接続か認証の問題で失敗する: リポジトリを作らず、`origin` も変えない。
  `gh auth login` かネットワークの確認を案内する。直ったら setup を再実行する
- `gh repo create` が失敗する（組織でリポジトリを作る権限が無い、`gh` が無い）: GitHub の画面でリポジトリを非公開（Private）で作ってもらう
  （`README.md`・`LICENSE`・`.gitignore` は付けてもよい）。続けて、`git remote add origin <URL>` と `git push -u origin main` を実行する
  （その前に、手順 0 の 4 のとおり公開範囲を見る）
- `git push -u origin main` が断られる、または `origin` の `main` にテンプレートが無い: 上書きしない（`--force` を付けない）。次の順に行う
  1. 手順 0 の 4 のとおり公開範囲を見てから、`git push -u origin main` を実行する。手元の `main` が `origin` の `main` の続きなら（GitHub で作ったリポジトリを clone したフォルダなど）、これで送れる
  2. 断られたら、`origin` の `main` のファイルを見る。`git ls-tree` は権限の設定の許可に無いので、実行の前に確認が出る。許可してもらって進める

     ```
     git fetch origin main
     git ls-tree -r --name-only origin/main
     ```

  3. ファイルが `README.md`・`LICENSE`・`.gitignore` のほかに無ければ（GitHub の作成画面で付けたもの）、テンプレートのコミットを `origin` の `main` の上に重ね直す。
     `git reset --soft origin/main` は、手元の `main` を `origin` の `main` に合わせる。作業フォルダとステージした中身（テンプレート）は変えない。
     `origin` の `main` に `LICENSE` があるときだけ、`git checkout origin/main -- LICENSE` でそれを戻す（手順 0 の 2 と同じく、利用者が選んだライセンスを残す）。
     `git reset`・`git checkout` は権限の設定の許可に無いので、実行の前に確認が出る。許可してもらって進める

     ```
     git reset --soft origin/main
     git checkout origin/main -- LICENSE
     git commit -m "テンプレートの取り込み"
     git push -u origin main
     ```

  4. ほかのファイルもあれば、`origin` は別のアプリのリポジトリを指している。GitHub の画面で空のリポジトリを非公開（Private）で作ってもらい、
     `git remote set-url origin <URL>` と `git push -u origin main` を実行する（その前に、手順 0 の 4 のとおり公開範囲を見る）
- `git merge origin/main` が衝突で止まる: `.shinnn/setup.json` の衝突は、`git checkout --theirs .shinnn/setup.json` → `git add .shinnn/setup.json` で `main` の側を取り、
  `git commit --no-edit` でマージを終える。そのあと、手順 5 の 4 を実行し直して選択を入れ直す。ほかのファイルが衝突したら、`git merge --abort` で戻して報告する
- `gh repo create` が、同じ名前のリポジトリが既にあると言って失敗する: `gh repo view <置き場所>/<名前> --json isEmpty,url` で中身を見る。
  空なら、`git remote add origin <URL>` と `git push -u origin main` を実行する（その前に、手順 0 の 4 のとおり公開範囲を見る）。
  空でなければ、`gh api "repos/<置き場所>/<名前>/contents" --jq '.[].name'` で、いちばん上のファイルとフォルダの名前を見る。
  `gh api` は権限の設定の許可に無いので、実行の前に確認が出る。許可してもらって進める。
  `README.md`・`LICENSE`・`.gitignore` のほかに無ければ、`git remote add origin <URL>` を実行してから、上の `git push -u origin main` の項目に従う。
  ほかにもあれば、別の名前を聞く
- `gh` の認証が切れている: `gh auth login` を案内する。ログインできなければ、手順 5 の 3 の `gh` が無い場合と同じく
  Issue と PR を GitHub の画面で作ってもらい、ラベルの投入は後回しにする
- Dependabot のアラートやセキュリティ更新を有効にできない（管理者権限が無い）: 止めずに続け、手順 5 の 11 の画面での手順を案内する
- ブランチ保護のスクリプトが「使えない（理由）」と示して終わる（private で無料のプラン、管理者権限が無い）: 止めずに続け、
  理由を「有効な機能」表と `docs/decisions/` の記録に残す。`main` への push を確実に止めるのはブランチ保護である。
  プランを変えれば設定できること（費用がかかる）を伝える。管理者権限が無いときは、管理者が setup を再実行すれば設定できることを伝える。
  リポジトリを公開する案は示さない（手順 5 の 12）
- ブランチ保護のスクリプトが、既にあるブランチ保護を示して終わる: 上書きしない。必須のチェックに CI の 3 つのジョブ（`ci.yaml` の 2 つと `policy.yaml` の 1 つ）が無ければ、
  差分を示して人に判断してもらう
- ブランチ保護のスクリプトが、`main` に直接コミットするワークフローが残っているとして設定しない: 止めずに続ける。理由を記録に残して、シン株式会社に相談する。
  そのワークフローの扱いが決まったら、setup を再実行する
- ブランチ保護のスクリプトが終了コード 1 で終わる（設定できなかった）: 止めずに続け、出力をそのまま示す。記録は手順 5 の 12 と同じく、
  最後の行の要約（`ブランチ保護: 設定できなかった（…）`）で書く。要約の行が出ていなければ（スクリプトが途中で止まった）、
  `ブランチ保護: 設定できなかった（スクリプトが途中で止まった）` と書く。「引き継ぎメモ」Issue の「引き継ぎの注意」にも、
  原因と、直した後に setup を再実行することを書く。原因を直したら、setup を再実行する。再実行の手順 5 の 12 で、
  「有効な機能」表のブランチ保護の行が書き換わり、結果は新しい setup の記録に残る。原因が `ci.yaml` か `policy.yaml` のときは、
  人が直したそのファイル（または `/shinnn-app:update-rules` で標準に戻したもの）を `main` に取り込んでから再実行する
- すでに `.github/workflows/` に手を入れたファイルがある: 上書きせず、差分を示して人に判断してもらう
- `gh pr merge` が `workflow` スコープの不足で失敗する: `gh auth refresh -h github.com -s workflow` を案内する。それまでは人がマージする
- 適用スクリプトが `選択項目 … は optional にありません` で止まる: 項目そのものを増やすのは標準の変更にあたる。
  勝手に `.shinnn/setup.json` を書き足さず、「引き継ぎメモ」Issue の「シン株式会社への要望」に上げる
- 適用スクリプトが `CODEOWNERS の規則の行に … がありません` と注意を出す: 記録の担当者と `CODEOWNERS` の担当者が違っている。
  担当を割り当てる行にある前の担当者を `--reviewer` で指定して実行し、続けて使う担当者を `--reviewer` で指定して実行する。
  その行に前の担当者が無ければ、「引き継ぎメモ」Issue の「シン株式会社への要望」に上げる

## 関連

| やりたいこと | スキル |
|:--|:--|
| 最初の機能を作る | `/shinnn-app:feature` |
| 標準の更新を取り込む | `/shinnn-app:update-rules` |
| 引き継ぎの条件を満たしているか見る | `/shinnn-app:handover-check` |
