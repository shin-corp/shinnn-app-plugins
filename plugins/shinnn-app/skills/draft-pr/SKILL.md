---
name: draft-pr
description: 変更をブランチへコミット・プッシュしてドラフト PR を作り、設定が有効なら Copilot をレビュアーに設定する。PR の作成そのものだけを行う低レベルの手順。通常は /shinnn-app:pr から呼ばれる
---

# ドラフト PR を作る

`/shinnn-app:pr` の中の「PR を作る」部分だけを切り出したもの。
**PR を出す前の確認とレビューの回し方は `/shinnn-app:pr` が正。** 単独で使う場合もそちらを先に読む。

## 1. ブランチを整える

差分をきれいにするため、`main` の最新から切る。

```
git fetch origin main
git switch -c feature/<Issue 番号>-<slug> origin/main
```

すでにブランチがある場合はそのまま使う。`main` に直接コミットしない。

## 2. コミットしてプッシュする

```
git add <変更ファイル>
git commit -F <メッセージのパス>
git push -u origin <ブランチ名>
```

メッセージは `commit-message` の規約に従う。層ごとに分ける。

## 3. ドラフト PR を作る

```
gh pr create --draft --base main --title "<タイトル>" --body-file <本文のパス>
```

- **タイトルに対応する受入条件（`AC-n`）を入れる**
- 本文には `Closes #n` を必ず入れる（無いと CI の policy job が落ちる）
- 本文の見出しは `/shinnn-app:pr` の表に従う。「変更後の状態」と「次の一手」を省かない

## 4. レビュアーを設定する

`.shinnn/setup.json` の `optional.copilot-review` が `true` のときだけ、Copilot をレビュアーに追加する。

```
gh pr edit <PR 番号> --add-reviewer <Copilot のレビュアー名>
```

設定が `false`、または Copilot が使えない組織ではこの手順を飛ばす。**エラーにしない。**

CODEOWNERS があれば当社担当は自動で付く。手で足さない。

## 5. 報告

PR の番号と URL、ドラフトであること、次にやること（レビューを回す）を伝える。
**ready にしない。マージもしない。** どちらも人が行う。
