`/shinnn-app:feature` の SKILL.md の「止めた Issue を再開する」から読む。

### 止めた Issue を再開する

利用者が、止めた Issue（`status:blocked`）について決めた内容を伝えたら、次を順に行う。

1. 決まった内容を Issue にコメントする
2. ラベルを替える（`gh issue edit <番号> --remove-label status:blocked --add-label status:doing`）
3. その Issue のブランチに `git switch` で戻る
4. PR 本文の「規約で迷った点」から、決まった項目を消す（`gh pr edit <PR 番号> --body-file <本文のパス>`）
5. このスキルの「4. 実装する」から続ける。PR は既にあるので、`pr` の手順 3 では push だけを行う
