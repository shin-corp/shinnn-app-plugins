---
name: update-rules
description: プラグインが配布するルール（規約の rules・CLAUDE.md 雛形・アプリ作り方ガイド・権限の設定・git のフック・コミット時の整形の設定・確認のスクリプト・ワークフロー・PR テンプレート）の更新を、リポジトリへ取り込んで PR にする。標準バージョンに差があるときに実行する。「ルールを更新」「決まりごとを新しくして」「標準を更新」「rules を最新に」「バージョンが古いと言われた」で起動
---

# 標準の更新を取り込む

規約の正本は、プラグインに同梱されたテンプレート `${CLAUDE_PLUGIN_ROOT}/template/` の中にある。
リポジトリ側の `.claude/rules/` や `CLAUDE.md` はその写しなので、食い違ったら**テンプレート側で上書きする**。

## 1. 差を確認する

| 見る場所 | 意味 |
|:--|:--|
| `.claude/rules/.standards-version` | 今のリポジトリが持っている標準のバージョン |
| `${CLAUDE_PLUGIN_ROOT}/template/.claude/rules/.standards-version` | 配布されている標準のバージョン |

同じなら「更新はありません」と報告して終わる。**同じなのにファイルが違う場合**は、
リポジトリ側が手で書き換えられている。その差分を示し、どちらを採るか人に確認する。

プラグインは、`.claude/settings.json` の配布元の設定（`autoUpdate`）で起動後に自動で更新され、次に開いたときから新しい版になる。
新しい版が出ているはずなのに差が無いときは、開き直すか `/reload-plugins` を案内する。
`.claude/settings.json` に `autoUpdate` が無い古いリポジトリでは、先に `claude plugin update shinnn-app@shinnn --scope project` を案内する
（このスキルで `settings.json` を取り込めば、次からは自動になる）。

## 2. 変更点をまとめる

ファイルごとに、次の 3 つに分けて示す。

- **追加された規約**: 新しく守る必要があるもの
- **変わった規約**: 書き方が変わったもの。既存コードが違反していないかを確認する
- **消えた規約**: 守らなくてよくなったもの

分ける前に `node ${CLAUDE_PLUGIN_ROOT}/scripts/copy-standard.mjs --dry-run` で、写るファイルと飛ばす規約を見ておく。
「飛ばした」と出る規約（`server/` の無いリポジトリには増やさないもの）は、追加された規約に入れない。
「削除」と出たファイル（テンプレートから消したもの）は、3 分類とは別に、括弧の中の理由とあわせて示す。

規約の変更で**既存コードが違反する場合は、その一覧も出す**（直すかは別の作業として Issue にする）。

確認のスクリプト（`scripts/`）やワークフロー（`.github/workflows/`）が変わっていれば、何を確かめるようになったかも示す。

### 画面の `.ts` の整形

CI（`ci.yaml`）は、画面（`client`）の `.ts` が prettier の書き方にそろっているかを確かめる。そろっていないリポジトリに
取り込むと、取り込みの PR の CI が落ちる。取り込みの前に、次で確かめる。

```
npx prettier --list-different "client/**/*.ts"
```

ファイルが出たら、**取り込みより先に、整形だけの PR を別に出す**。整形の差分を取り込みの PR や機能の PR に混ぜると、
レビューで本当の変更が埋もれるため。

1. Issue を作る（題は `[整形] 画面の .ts の prettier での整形`、ラベルは `status:doing`）
2. `main` の最新から `feature/<Issue 番号>-format-client` を切り、`npx prettier --write "client/**/*.ts"` を実行する
3. 変わったのが改行・字下げ・引用符などの書式だけであることを `git diff` で確かめ、1 コミットにして `/shinnn-app:pr` で PR にする
   （本文に「書式だけの変更。振る舞いは変えない」と書く）
4. この PR をマージしてから、「3. Issue とブランチを用意する」以降の取り込みに進む。マージを人が行い、その場で進めないときは、
   ここで止めて「整形の PR をマージした後に、もう一度 `/shinnn-app:update-rules` を実行する」と伝える

`server` と `shared` の `.ts` には prettier を掛けない（規約 `git-workflow.md` の「やらないこと」）。

## 3. Issue とブランチを用意する

**`main` に直接コミット・push しない。** 先に Issue を作り、そのブランチで取り込んで PR にする。
ブランチ名（`feature/<Issue 番号>-<slug>`）と PR 本文の `Closes #<Issue 番号>` は `.claude/rules/git-workflow.md` の
規約どおりにする（CI の規約チェックが本文の `Closes` を確かめる）。

1. 取り込みの Issue を `gh issue create` で作る。題は `[標準] 標準 <新バージョン> の取り込み`、本文には手順 2 でまとめた
   3 分類と、消すファイルとその理由を書き、ラベルは `status:doing` を付ける
2. `main` の最新から、1 の Issue の番号でブランチを切る

   ```
   git fetch origin main
   git switch -c feature/<Issue 番号>-update-rules origin/main
   ```

`gh` が無い・ログインできない場合は、Issue を GitHub の画面で作ってもらい、Issue の番号を聞いてから同じ名前で
ブランチを切る。手順 5 の PR も画面で作ってもらい、本文に `Closes #<番号>` を入れてもらう。

## 4. 適用する

写すのはプラグインのスクリプトで行う（写し元は `${CLAUDE_PLUGIN_ROOT}/template/`）。
`.claude/` と `.github/workflows/` は権限の設定の deny で守られていて、`cp` や Edit / Write では書けない。
先に `--dry-run` で変わるファイルの一覧を出し、下の「写す前に見るもの」を済ませてから、`--dry-run` を外して実行する。

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/copy-standard.mjs --dry-run
node ${CLAUDE_PLUGIN_ROOT}/scripts/copy-standard.mjs
```

リポジトリの権限の設定が古く、このスクリプトの許可が無いと、実行の前に確認が出る。許可してもらって進める
（写した後の権限の設定には許可が入っているので、次からは出ない）。

写すのは、規約（`.claude/rules/`）、権限の設定（`.claude/settings.json`）、アプリ作り方ガイド、git のフック（`.husky/`）、
コミット時の整形の設定（`.lintstagedrc.json`）、確認のスクリプト（`scripts/*.mjs`）、ワークフロー（`.github/workflows/`）、PR テンプレート。
上書きと追加に加えて、**テンプレートから消したファイル**（一覧はプラグインの `scripts/retired-files.json`）が残っていれば消す。
一覧に無いファイルは消さないので、案件で足したファイルは残る。有効にしているワークフローは有効の名前に写し、
有効・無効は setup で選んだまま変えない。サーバー側を持たないリポジトリ（`server/` が無い）には、元から無かった規約を増やさない
（「飛ばした」と出るので、PR 本文の「追加された規約」には入れず、飛ばしたことを書く）。

写す前に見るもの（リポジトリ側で書き換えていたものを失わないため）。一覧で「更新」と出たファイルについて、
`git diff --no-index <テンプレートのファイル> <リポジトリのファイル>` で差を見る。

- 確認のスクリプト（`scripts/`）は CI と `/shinnn-app:check` が使う。リポジトリ側で書き換えていた箇所（許可するライセンスの追加など）が
  あれば、写した後に同じ変更を当て直し、PR 本文に書く
- ワークフロー（`.github/workflows/`）は Claude が編集できない（deny）ので、リポジトリ側の書き換えは人が入れたもの。
  書き換えがあれば、差を PR 本文に書き、写した後に人に当て直してもらう
- 「削除」と出たファイルは、`git log --oneline -- <ファイル>` でリポジトリ側の変更を見る。書き換えて使っていたなら、
  消えることと理由を PR 本文に書く（残すかはシン株式会社のレビューで決める。消さずに残すと、次の取り込みでまた消える）
- `.lintstagedrc.json`（コミット時の整形）でリポジトリ側で足していた対象があれば、写した後に同じ変更を当て直し、PR 本文に書く
- `.claude/settings.json`（権限）は丸ごと置き換わる。リポジトリ側で足していた許可や禁止があれば一覧にし、
  PR 本文に書く（残すかはシン株式会社のレビューで決める）

写した後に行うこと:

- `.gitignore` に `.claude/worktrees/` の行が無ければ、末尾に 1 行足す。ほかの行は触らない（案件ごとに書き足すファイルのため）
- `${CLAUDE_PLUGIN_ROOT}/template/CLAUDE.md` / `.../template/client/CLAUDE.md` / `.../template/server/CLAUDE.md`
  を、それぞれ `CLAUDE.md` / `client/CLAUDE.md` / `server/CLAUDE.md` へ当てる。**案件固有の記述を消さないように**
  マージする（雛形が変わった箇所だけを当て、埋めてある内容は残す）
- 標準のバージョンは `.claude/rules/.standards-version` の 1 か所だけにあり、上のコピーで新しいバージョンになる。
  ほかのファイルにバージョンを書き写さない。`.shinnn/setup.json` は setup だけが書き換えるので触らない
  （`templateVersion` は展開したテンプレートの版で、標準のバージョンではない）

## 5. PR にする

```
/shinnn-app:pr
```

PR 本文の 1 行目は `Closes #<手順 3 の Issue の番号>`。続けて、手順 2 でまとめた 3 分類、消したファイルとその理由、
**既存コードが違反している箇所の一覧**を書く。規約の変更に伴うコード修正は、この PR に混ぜない（別の Issue にする）。
ただし、取り込んだ確認のスクリプトで `/shinnn-app:check` や CI が落ちる場合は、通すのに要る修正だけをこの PR に含める
（落ちたままではマージできないため）。含めた修正は本文に分けて書く。
ready にするか、マージまで行うかは `/shinnn-app:pr` がマージの方針（`human` / `self-review`）に従って決める。

ワークフローを変える PR は、push とマージに `gh` の `workflow` スコープが要る。スコープの不足で断られたら、
`gh auth refresh -h github.com -s workflow` を案内する。

`.claude/settings.json` はセッションの開始時に読み込まれる。マージした後に Claude Code を起動し直すよう、利用者に伝える。
スキルの一覧に `frontend-design` が無ければ、起動し直してもらう前に
`claude plugin install frontend-design@claude-plugins-official --scope local` を実行する（権限の設定で有効にしていても、
入れるのは各自の手元。画面の見た目の案を立てる `/shinnn-app:add-screen` が使う）。配布元に無いと出て失敗したら、
`claude plugin marketplace add anthropics/claude-plugins-official` を実行してから入れ直す。

`.github/workflows/progress-snapshot.yaml` を消したときは、マージした後に、それが残っていたために設定できなかったブランチ保護を
設定できる。

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/protect-branch.mjs --dry-run` で設定する内容を見せて確認を取り、
   `--dry-run` を外して実行する（`/shinnn-app:setup` の手順 5 の 12 と同じ）
2. 最後の行に出る 1 行の要約（`ブランチ保護: …` で始まる）で、`README.md` の「有効な機能」表のブランチ保護の行を書き換え、
   `docs/decisions/` の setup の記録（`<番号>-setup.md`）に書き足す。Issue → ブランチ → PR で入れる

マージを人が行い、その場で 1・2 を行えないときは、PR 本文と「引き継ぎメモ」Issue に「マージの後にブランチ保護を設定する
（`/shinnn-app:update-rules` の手順 5 の終わり）」と残す。

## 6. 適用しない選択

案件の事情で採れない規約があるなら、**黙って外さない**。
`CLAUDE.local.md` に理由を書き、「引き継ぎメモ」Issue の「シン株式会社への要望」にも書く。
