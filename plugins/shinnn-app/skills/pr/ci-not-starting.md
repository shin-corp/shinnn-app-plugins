`/shinnn-app:pr` の SKILL.md の「8. CI が始まらないとき」と「9. CI で確かめていないマージを確かめる」から読む。

## 8. CI が始まらないとき

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

   今の本文は `gh issue view <Issue 番号> --json body --jq .body` で読む。
   書き換えた本文は、Write ツールで scratchpad の `issue-body.md` に書き、`gh issue edit <Issue 番号> --body-file <そのファイル>` に渡す。
   リダイレクトでファイルに書くと、確認が出るか、リポジトリの中にファイルが残る。Windows PowerShell 5.1 では、本文の先頭に BOM（文字コードを示す印）も入る。
4. 必須のチェックがあるかを確かめて、マージを進める。次の 1 つ目で 1 以上が出るか、2 つ目に `required_status_checks` の行が出れば、必須のチェックがある。

   ```
   gh api "repos/{owner}/{repo}/branches/main/protection" --jq '.required_status_checks.checks | length'
   gh api "repos/{owner}/{repo}/rules/branches/main" --jq '.[].type'
   ```

   1 つ目はブランチ保護、2 つ目はルールセット（新しい方式のブランチ保護）を見る。1 つ目は、ブランチ保護が無ければ 404 で終わる（必須のチェックは無い）。
   - 必須のチェックが無い: 2 の手元の確かめが通っていれば、次のマージに進む
   - 必須のチェックがある: 2 の手元の確かめが通ったら、**人に**外してもらう。ブランチ保護なら Settings → Branches → main のルールを消す。
     ルールセットなら Settings → Rules → Rulesets で必須のチェックを外す。
     頼むときに、3 と同じやり方で `- ブランチ保護を外している（<YYYY-MM-DD>。ブランチ保護 / ルールセット）` の行も足す（すでにあれば足さない）
   - マージ（`auto-merge`）: `gh pr ready <番号>` → `gh pr merge <番号> --merge --delete-branch`。
     GitHub がブランチ保護（必須のチェック）で断ったら、人に渡す（`--admin` の禁止は規約 `git-workflow.md` の「やらないこと」）
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
   node -p "new Date().toISOString().slice(0, 19) + 'Z'"
   gh workflow run ci.yaml --ref main
   gh workflow run policy.yaml --ref main
   gh run list --branch main --event workflow_dispatch --created ">=<控えた時刻>" --json databaseId,workflowName,headSha
   ```

   時刻は秒までで控える。実行の `createdAt` は秒までなので、ミリ秒を付けると、同じ秒に作られた実行が外れる。
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
     `check` の「`npm audit` で勧告が出たとき」の、元の PR が無いときの順で、直しの Issue を決めるところ（2 の 2）まで進める
     （2 の 5 には進まない。`feature` の「続きから始める」が先に取る）。
     行は、その直しで `main` の CI が緑になるまで残す
