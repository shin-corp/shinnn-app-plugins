---
name: pr
description: 変更をコミットし、push の前に /shinnn-app:code-review の指摘を収束させる（直しきれなければ PR を作って人に渡す）。そのあと push してドラフト PR を作る。マージの方針が self-review なら CI の通過後にマージまで行う（CI が始まらないときは、手元の確かめで代える）。PR 本文には対応 Issue（Closes #n）・変更後の状態・次の一手を必ず書く。「PR を作って」「レビューに出したい」で起動。セッション開始時の状況に「CI で確かめていないマージ」が出たときの確認（手順 9）でも起動
---

# PR を出してレビューを収束させる

push の前にセルフレビューで指摘を Critical / Warning = 0 にしてから、`main` 向けのドラフト PR を作る（直しきれなければ、PR を作って人に渡す。2 の終わり）。
PR に付いた指摘も、Critical / Warning = 0 になるまで回す。
その先は `.shinnn/setup.json` の `mergePolicy` で決まる（キーが無ければ `human`）。

| `mergePolicy` | 収束したあと |
|:--|:--|
| `human`（既定） | **ready にするのもマージするのも人。** Claude はドラフトのまま渡し、収束したこと（2 で直しきれなかったときは、残った指摘）を報告する |
| `self-review` | Claude が ready にし、CI の通過を待ってマージする（「7. マージする」）。CI が始まらないときは、CI の通過を「8. CI が始まらないとき」の手元の確かめで代える |

「9. CI で確かめていないマージを確かめる」だけを行うときは、0〜8 を飛ばす。

## 0. 流れに乗っているかを見る

この変更の Issue が無いとき（`main` の上にいる、またはブランチの名前が `feature/<番号>-`・`fix/<番号>-` で始まらない）は、
`/shinnn-app:feature` の「続きから始める」の 0 のうち 1〜3（Issue、作業ブランチ、手元の `main` の戻し）だけを行ってから、
このスキルの 1 に進む（0 の 4 には進まない。`pr` を二重に走らせないため）。
この手順を先に行うのは、PR 本文の `Closes #n` とブランチの名前に Issue 番号を入れるため。

## 1. PR を出す前に確認する

`/shinnn-app:check` を通し、緑であること（`check` の冒頭に挙げた `npm audit` の失敗だけは除く）。
まとめての `check` を走らせるのは、PR 1 本につきここの 1 回だけ
（`feature` は直前に `check` を走らせずにこのスキルを呼ぶ。実装の途中の確認は hook が行う）。
ただし、CI が始まらないときの「8. CI が始まらないとき」の 2 は、`check` を通し直す。
加えて、`git diff origin/main...HEAD` を通しで読み、次を満たさない箇所を直す。
**レビュアーに指摘される前に自分で直す。**

- **ルートの `CLAUDE.md` の「共通方針」に反していないこと**: コメント（周辺のコメントと JSDoc も含む）と既存との整合
- **改行コードだけの差分が無いこと**: 次の 2 つの結果が一致すること

  ```
  git diff --shortstat origin/main...HEAD
  git diff --ignore-cr-at-eol --shortstat origin/main...HEAD
  ```

  ずれていたら、内容と無関係な全行差分が出ている。レビューを著しく妨げるので必ず直す。
  原因はたいてい、テキストとして読み書きするスクリプト（`sed -i` を含む）が改行を変換したこと
- **制御文字の混入が無いこと**: NUL が 1 バイトでも入ると git がバイナリ扱いし、差分が一切出なくなる
- **受入条件のテストが効いていること**: 受入条件（`AC-n`）を足した・変えたとき（`git diff origin/main...HEAD -- docs/仕様書.md`
  に出るとき）と、不具合を直したとき（テストそのものの不具合を除く）は、`/shinnn-app:mutation-check` で実装を壊し
  （不具合なら直す前の実装に戻し）、そのテストが落ちることを確かめる。
  落ちなければテストを作り直す。CI は受入条件ごとにテストが**あるか**しか見ないので、テストが**効いているか**はここで確かめる
- **AI の出力が基準を満たすこと**: `.claude/rules/ai-integration.md` の「評価」の「回すとき」に当たる変更なら、その節に沿って評価を回す
  （モデルを何度も呼び時間がかかるので、バックグラウンドで回す）。基準を満たさなければ直して回し直す。
  2 回直しても満たさなければ、直すのをやめて改善の Issue を `gh issue create` で作る（題は `[改善] <機能> の AI の出力`、
  ラベルは `status:next`、本文に満たさなかったケースと結果）。満たさなかった結果と Issue の番号を「確認した結果」に書いて、2 以降に進む。
  人の判断待ちの項目にはしない（`self-review` を止めないため。評価は回すたびに時間と費用がかかる）。
  CI は実際のモデルを呼ばないので、出力の良し悪しはここで確かめる
- **テストそのものの不具合の直しが効いていること**: まれに落ちるテストや、特定の環境（OS など）でだけ落ちるテストを直したときは、
  落ちた環境で、直す前と後を同じ条件（同時に走らせる数と回数。例: `npm test -w server` を 2 本同時に 10 回）で繰り返し、
  落ちた回数を比べる。直す前の数を測っていなければ、直した差分を `git stash` で退けて測り、`git stash pop` で戻す
  （コミット済みなら、直す前の状態のファイルを `git checkout <直す前のコミット> -- <ファイル>` で出して測り、`git checkout HEAD -- <ファイル>` で戻す）。
  条件と、前後の落ちた回数を PR 本文の「確認した結果」に書く

## 2. コミットして、push の前にレビューを回す

コミットの前に `.claude/rules/git-workflow.md` の「コミットメッセージ」「コミットの分け方」を読み直し、それに従って層ごとに分ける。

コミットしたら、3 で `--body-file` に渡す本文のファイルを先に書く（欄は 3 の表）。
本文のファイルは scratchpad の `pr-body.md` に置き、リポジトリには置かない。
リポジトリに置かないのは、コミットに混ぜないため。
PR がまだ無い間、`code-review` はこのファイルから決着済みの前提（「見送った指摘」など）を読む。

続けて、push の前に `/shinnn-app:code-review` を回す。
push の前に回すのは、Actions（GitHub の上で CI を動かす仕組み）の使える時間（分）を節約するため。
CI は、PR を作ったときと、その後の push で走る。
`code-review` の指摘の直しを push の前に済ませれば、その直しのために CI が増えることはない。

回す量は PR の中身で決める。まずコードの差分があるかを見る。

```
git -c core.quotepath=false diff --name-only origin/main...HEAD
```

| PR の性質 | `code-review` |
|:--|:--|
| コードを変える PR | Critical / Warning が 0 件になるまで回す |
| 文書だけの PR（`docs/` と `*.md` のみ） | 1 巡だけ回す（直した後に回し直さない） |

`core.quotepath=false` を省くと、日本語のファイル名がエスケープされて判定を誤る。

指摘は 5 に従って直す。直したものをコミットしてから、次の巡を回す。
見送った指摘とその理由は、本文のファイルの「見送った指摘」に書き足す。

Critical / Warning を直しきれないときは、PR を作ってから人に渡す。
直しきれないとは、同じ指摘が 2 巡続けて残ったときと、人の判断を待つ指摘が残ったときのこと。
残った指摘は、本文のファイルの「規約で迷った点」に書く。
続けて、3 で push してドラフト PR を作る。
そのあとは 4 と 5 を飛ばして、6 の報告に進む。
PR を作ってから渡すのは、止まった作業を人が見つけられるようにするため。

## 3. push してドラフト PR を作る

```
git push -u origin <ブランチ名>
```

`main` には push しない（GitHub のブランチ保護か `.husky/pre-push` が断る）。断られたら、作業ブランチを切ってそちらに push する。

```
gh pr create --draft --base main --title "<タイトル>" --body-file <本文のパス>
```

本文には**必ず**次を入れる。

| 見出し | 内容 |
|:--|:--|
| 対応 Issue | `Closes #n`。これが無いと CI の規約チェック（`policy.yaml`）が落ち、マージしても Issue が閉じない |
| 目的 | なぜこの変更が要るのか |
| 変更点 | 箇条書き・体言止め |
| 対応した受入条件 | `AC-n` の一覧。数えられるものは数値も |
| 確認した結果 | `/shinnn-app:check` の結果。受入条件を足した・変えたとき、不具合を直したときは変異で確かめた結果（`mutation-check` の報告の 1 行）。テストそのものの不具合を直したときは、繰り返しの条件と前後の落ちた回数。AI の評価を回したときは、その合否と記録のファイル。API 定義（`shared/src/api/`）を変えてテストを変えないときは、この欄の中に `テストを変えない理由: <理由>` の 1 行を置く（HTML のコメントの外に書き、見出しにしない。CI は行の頭を見る。`.claude/rules/api-contract.md` の「変更の手順」） |
| **変更後の状態** | この PR がマージされると、アプリが何をできるようになるか（利用者の言葉で 2〜3 行） |
| **次の一手** | 次に作るべきもの。無ければ「無し」 |
| 規約で迷った点 | 判断に迷って仮置きした点。人の判断を待つもの（2 で直しきれなかったレビューの指摘を含む） |
| 見送った指摘 | レビューで見送った指摘と、その理由。2 で見送ったものは、2 で本文のファイルに書く。PR に付いた指摘で見送ったものは、5 の対応の後に足す。無ければ「無し」 |

「変更後の状態」と「次の一手」は、**シン株式会社が引き継ぐときに最初に読む欄**なので省略しない。

## 4. Copilot のレビューを依頼する

PR を作ったら、コードを変える PR（2 の判定）で、Copilot が有効な設定のときだけ、Copilot にレビューを依頼する。
文書だけの PR では依頼しない。

**Copilot が有効な設定**とは、`.shinnn/setup.json` の `optional.copilot-review` が `true` のこと。
2 の `code-review` で直した後に依頼するのは、設計レベルの指摘を先に直しておくため。
Copilot のレビューには、回数の上限がある。

```
gh pr edit <PR 番号> --add-reviewer <Copilot のレビュアー名>
```

設定が `false`、または組織で Copilot が使えないときは飛ばす。**エラーにしない。**
シン株式会社の担当者は `CODEOWNERS` で自動でレビュアーに付くので、手で足さない。

Copilot の指摘は、5 に従って Critical / Warning を 0 件にする。

## 5. 指摘への対応

2 の `code-review` の指摘にも、PR に付いた指摘（Copilot・PR の AI レビュー・シン株式会社の担当者）にも、次の決まりを当てる。

- Critical / Warning が 1 件でも残っている間は次の段階に進まない。ただし、2 で直しきれないときは、2 に書いた形で PR を作って人に渡す
- Info は必須ではない。見送るなら**理由を PR 本文に残す**（PR が無い間は本文のファイルに書く。次に同じ指摘が来たとき再検証しないで済む）。PR に付いた指摘なら、返信にも残す
- **動作に影響が大きい指摘は自分で判断せず人に相談する**
- 指摘が規約と食い違う場合は、指摘を鵜呑みにせず `/shinnn-app:why` で規約の意図を確認してから答える

PR に付いた指摘には、さらに次の決まりを当てる。

- **1 コメント = 1 コミット**。どのコミットが何に対応したかを、コメントへの返信に SHA 付きで書く
- **push は、1 巡の指摘をすべて直してから 1 回**にする（Actions の分を節約するため。push のたびに CI が走る）。
  コメントへの返信は、その push の後に書く
- PR 本文の書き換え（「見送った指摘」など）も、1 巡につき 1 回にまとめる（Actions の分を節約するため。本文を直すと規約チェック（`policy.yaml`）が走り直す）

## 6. 報告

収束したら（2 で直しきれずに PR を作ったときも）、残った指摘（見送ったもの）と人の判断待ちの項目、`code-review` の「範囲外で気づいた点」を一覧にして報告する。
範囲外で気づいた点はこの PR では直さず、Issue にするかを人に決めてもらう。

続けて `/shinnn-app:retro` で、この PR の Issue に振り返り（詰まり / 学び / 次に試す）を残し、
引き継ぐ人が知らないと困ることを「引き継ぎメモ」Issue に足す。利用者に頼まれるのを待たない。

続けて、`mergePolicy` にかかわらず、最新のコミットの CI の状態を `gh pr checks <番号>` で見る。

- すべて緑: `human` はここで終わる（ready にはしない）。`self-review` は 7 に進む
- 実行中がある: `gh pr checks <番号> --watch` で終わるまで待ち、結果で分ける
- 失敗がある: 「8. CI が始まらないとき」の 1 の見分け方で、CI が始まっていないかを見る
  - step が動いて落ちた job がある: ふつうの CI の失敗なので、直して push し、この 6 の CI の確認からやり直す（`retro` はやり直さない）。
    8 の 1 の出力で、落ちた step（`failed=`）が「依存の脆弱性」（`npm audit`）だけなら、`check` の「`npm audit` で勧告が出たとき」に従う
    （同じ節の 1 で、前に作った直しの Issue と PR を見つけて続きから進める）。この PR が原因でなければ、直しの PR がマージされて
    `main` を取り込むまで、この PR の CI は落ちたままになる。取り込んだら、この 6 の CI の確認からやり直す
  - CI が始まっていない: 8 の 1〜3 を行う
    - `human`: 8 の 4 の報告をして終わる
    - `self-review`: 7 の CI の条件だけを 8 の手元の確かめで満たす。7 の残りの条件（指摘が 0 件・人の判断待ちが無い）もすべて満たすときだけ、
      7 のコマンドの代わりに 8 の 4 でマージする。満たさないときは、8 の 4 の報告（`human` と同じ）をして人に渡す

## 7. マージする（`mergePolicy: self-review` のときだけ）

次の**すべて**を満たすときだけマージする。1 つでも欠けたら人に渡す。

- Critical / Warning の指摘が 0 件で、見送った指摘の理由を PR 本文に書いてある
- 「規約で迷った点」に人の判断待ちの項目が無い
- 最新のコミットで CI が緑（CI は `check` と同じ内容を走らせるので、ここで `check` を走らせ直さない）。
  ただし、CI が始まらないときは、この条件を 8 の 2 の手元の確かめで満たし、マージは下のコマンドではなく 8 の 4 で行う
  （始まっていない CI を `gh pr checks` で待たない）

```
gh pr ready <番号>
gh pr checks <番号> --watch --fail-fast
gh pr merge <番号> --merge --delete-branch
git switch main && git pull --ff-only
```

- CI が落ちたら（step が動いて落ちたら）、直してからやり直す。`--admin` などで検査を飛ばさない
- リポジトリが auto-merge を許可しているなら、ready の直後に `gh pr merge <番号> --auto --merge --delete-branch` としてもよい
  （CI が通った時点でマージされる）。その場合も `gh pr view <番号> --json state` でマージされたことを確かめてから報告する
- `gh pr merge` が `workflow` スコープの不足で失敗したら（ワークフローを変える PR）、人にマージを頼む。
  `gh auth refresh -h github.com -s workflow` で足せる
- 報告には、マージしたこと・閉じた Issue・`main` の状態（CI の結果）を書く

## 8. CI が始まらないとき

「CI が始まらない」の定義と、手元の確かめでマージに進んでよい条件は、規約 `git-workflow.md` の「CI が始まらないとき」にある。
ここは手順。`mergePolicy` が `human` でも `self-review` でも使う。

1. 最新のコミットの CI の実行を見る。CI は `ci.yaml` と `policy.yaml` の 2 つのワークフローで動く。

   ```
   gh run list --commit <最新のコミットの SHA> --json databaseId,workflowName,conclusion
   gh run view <実行の番号> --json jobs --jq '.jobs[] | "\(.databaseId) \(.name) \(.conclusion) step=\(.steps | length) failed=\([.steps[] | select(.conclusion == "failure") | .name] | join(","))"'
   ```

   `gh run list --commit` は、同じワークフローの古い実行も返す（本文の編集で `policy.yaml` の実行が増える）。
   `workflowName` ごとに、一覧の先頭（いちばん新しい）実行だけを見る。`--workflow` で絞らない
   （標準を取り込む前の、`policy.yaml` が無いリポジトリでは 404 になる）。
   その実行の番号ごとに `gh run view` を繰り返す（2 つのワークフローとも見る）。

   - 実行がまだ終わっていなければ（`conclusion` が空）、待つ
   - 落ちた（`failure`）job が 1 つ以上あり、落ちた job がすべて `step=0` なら、CI が始まっていない（`ci.yaml` が緑で、`policy.yaml` だけが `step=0` で落ちた場合も含む）
   - step が動いて落ちた job が 1 つでもあれば、ふつうの CI の失敗として直す（この節には進まない）
   - 理由の表示は `gh api "repos/{owner}/{repo}/check-runs/<job の databaseId>/annotations" --jq '.[].message'` で読み、報告に写す
2. 最新のコミットで、手元で確かめる。
   - `git status --porcelain` が空であること（コミットしていない変更があると、確かめたものと PR が食い違う）
   - `npm run dev` を止めてから `npm ci` を通す（`package.json` と `package-lock.json` の食い違いを見る。Windows では動いている開発サーバーがファイルを掴み、`npm ci` が失敗する）
   - `/shinnn-app:check` を通し直す。ここでは `check` の 9（実行時の依存の `npm audit`）も含めてすべて緑であること（`check` の冒頭の
     `npm audit` の例外は当てない。10 の開発用の依存の勧告は止めない）。9 が落ちたら、`check` の「`npm audit` で勧告が出たとき」に従う。
     この PR が原因でなければ、直しを先にマージしてから `main` を取り込む
   - PR 本文に `Closes #<Issue 番号>` があること（`gh pr view <番号> --json body`）
   - `shared/src/api/` を変えたなら、テストも変えているか、本文に「テストを変えない理由」があること
   - 認証情報の混入（gitleaks）は手元では確かめない（9 の `main` の CI が履歴をすべて走査する）
3. 「引き継ぎメモ」Issue（番号は `.shinnn/setup.json` の `handoverIssue`）の本文に、見出し `## CI で確かめていないマージ` の下へ
   `- #<PR 番号>（<YYYY-MM-DD>）` の 1 行を足す。見出しが無ければ、本文の末尾に見出しごと足す。ほかの見出しの下は変えない。

   ```
   gh issue view <Issue 番号> --json body --jq .body > <ファイル>
   （ファイルを書き換える）
   gh issue edit <Issue 番号> --body-file <ファイル>
   ```
4. 必須のチェックがあるかを確かめて、マージを進める。次のどちらかで 1 以上が出れば、必須のチェックがある。

   ```
   gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.checks | length'
   gh api repos/{owner}/{repo}/rules/branches/main --jq '[.[] | select(.type == "required_status_checks")] | length'
   ```

   1 つ目はブランチ保護、2 つ目はルールセット（新しい方式のブランチ保護）を見る。1 つ目は、ブランチ保護が無ければ 404 で終わる（必須のチェックは無い）。
   - 必須のチェックが無い: 2 の手元の確かめが通っていれば、次のマージに進む
   - 必須のチェックがある: 2 の手元の確かめが通ったら、**人に**外してもらう。ブランチ保護なら Settings → Branches → main のルールを消す。
     ルールセットなら Settings → Rules → Rulesets で必須のチェックを外す。
     頼むときに、3 と同じやり方で `- ブランチ保護を外している（<YYYY-MM-DD>。ブランチ保護 / ルールセット）` の行も足す（すでにあれば足さない）
   - マージ（`self-review`）: `gh pr ready <番号>` → `gh pr merge <番号> --merge --delete-branch`。
     GitHub がブランチ保護（必須のチェック）で断ったら、人に渡す。`--admin` で飛ばさない
   - 報告（`human`）: CI が始まらなかったこと・理由の表示・手元の確かめの結果を書き、マージを人に頼む（保護があれば、外すことも頼む）
   - `ci.yaml` に `workflow_dispatch` が無い、または `policy.yaml` が無いリポジトリ（標準を取り込む前）では、報告に `/shinnn-app:update-rules` で標準を取り込むことを添える（9 で `main` の CI を走らせるために要る）

## 9. CI で確かめていないマージを確かめる

セッション開始時の状況に「CI で確かめていないマージ」が出たときに行う。

1. `git fetch` で `origin/main` を最新にする。
2. 標準を取り込む前のリポジトリ（`ci.yaml` に `workflow_dispatch` が無い、または `policy.yaml` が無い）では、`main` の CI を手で走らせられない。
   先に `/shinnn-app:update-rules` で標準を取り込む。その PR のマージで `main` に push の CI が走るので、その結果で 4 に進む
   （`gh run list --branch main --event push --limit 2 --json databaseId,workflowName,headSha` で、`ci.yaml` と `policy.yaml` の実行を取る）。
3. `main` の CI を、2 つのワークフローとも手で走らせ、その実行を取る。`gh workflow run` は実行の番号を返さないので、走らせる前の時刻（UTC）を控え、それ以降に作られた実行だけを取る。

   ```
   date -u +%Y-%m-%dT%H:%M:%SZ
   gh workflow run ci.yaml --ref main
   gh workflow run policy.yaml --ref main
   gh run list --branch main --event workflow_dispatch --created ">=<控えた時刻>" --json databaseId,workflowName,headSha
   ```

   実行が出るまで数秒かかる。2 つ出るまで待ってから取る。2 つの実行の `headSha` が `origin/main` のコミットと同じことを確かめる。
4. 実行ごとに `gh run watch <実行の番号> --exit-status` で結果を待つ（時間がかかるので、Bash の `run_in_background` で動かす）。
5. 結果で分ける。
   - まだ始まらない（8 の見分け方）: 行を残して終わる
   - 2 つとも緑:
     1. 見出しの下の行のうち、マージ済みの PR の行を消す。まだ open な PR は、その PR の最新のコミットの 2 つの実行を
        `gh run rerun <実行の番号>` でやり直し（ワークフローごとに最新の実行）、どちらも緑なら消す。マージせずに閉じた PR の行は消す
     2. 「ブランチ保護を外している」の行があれば、保護を戻す（戻す時期は規約 `git-workflow.md` の「CI が始まらないとき」）。
        - ブランチ保護: `node ${CLAUDE_PLUGIN_ROOT}/scripts/protect-branch.mjs --dry-run` で設定する内容を人に見せ、
          了承を得てから `--dry-run` を外して実行する（`setup` の手順 5 の 12 と同じ）
        - ルールセット: 外した必須のチェックを、人に戻してもらう

        戻ったら、その行を消す。スクリプトが保護が残っていると示して終わったときも、保護は戻っているので消す
   - どちらかが落ちた: `gh issue create` で直す Issue を作る。題は `[不具合] main の CI が落ちている`、ラベルは `status:next`、
     本文に落ちた job と、見出しの下の PR の番号を書く。行は、直して `main` の CI が緑になるまで残す。
     ただし、落ちた step が「依存の脆弱性」（`npm audit`）だけなら、この Issue は作らない（落ちた step は 8 の 1 の `gh run view` で見る）。
     `git switch main && git pull --ff-only` の後に、リポジトリの「依存の脆弱性」の行と同じ `npm audit` で勧告の出たパッケージを見る。
     `check` の「`npm audit` で勧告が出たとき」の冒頭と 1 に従って、直しの Issue を探すか作る（`feature` の「続きから始める」が先に取る）。
     行は、その直しで `main` の CI が緑になるまで残す
