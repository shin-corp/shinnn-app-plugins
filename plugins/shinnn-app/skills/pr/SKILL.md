---
name: pr
description: 変更をコミット・プッシュしてドラフト PR を作り、レビューが収束するまで回す。マージの方針が self-review なら CI の通過後にマージまで行う。PR 本文には対応 Issue（Closes #n）・変更後の状態・次の一手を必ず書く。「PR を作って」「レビューに出したい」で起動
---

# PR を出してレビューを収束させる

`main` 向けのドラフト PR を作り、指摘が Critical / Warning = 0 になるまで回す。
その先は `.shinnn/setup.json` の `mergePolicy` で決まる（キーが無ければ `human`）。

| `mergePolicy` | 収束したあと |
|:--|:--|
| `human`（既定） | **ready にするのもマージするのも人。** Claude はドラフトのまま渡し、収束したことを報告する |
| `self-review` | Claude が ready にし、CI の通過を待ってマージする（「7. マージする」） |

## 1. PR を出す前に確認する

`/shinnn-app:check` が緑であること。加えて、`git diff origin/main...HEAD` を通しで読み、次を潰す。
**レビュアーに指摘される前に自分で直す。**

- **コメントと実装の食い違い**: 変更した箇所だけでなく、その挙動を説明している周辺のコメントと JSDoc も対象
- **コメントの内容**: 将来の読み手に有用な記述（仕様・制約・非自明な理由）だけを残す。レビュー対応の経緯は書かない
- **既存コードとの整合**: 同じことをする処理が既にあるなら同じ書き方に揃える。別流儀を持ち込まない
- **改行コードだけの差分が無いこと**: 次の 2 つの結果が一致すること

  ```
  git diff --shortstat origin/main...HEAD
  git diff --ignore-cr-at-eol --shortstat origin/main...HEAD
  ```

  ずれていたら、内容と無関係な全行差分が出ている。レビューを著しく妨げるので必ず直す。
  原因はたいてい、テキストとして読み書きするスクリプト（`sed -i` を含む）が改行を変換したこと
- **制御文字の混入が無いこと**: NUL が 1 バイトでも入ると git がバイナリ扱いし、差分が一切出なくなる

## 2. コミットしてプッシュする

コミットは `commit-message` の規約に従い、層ごとに分ける。

```
git push -u origin <ブランチ名>
```

`main` への push は `.husky/pre-push` が断る。断られたら、作業ブランチを切ってそちらに push する。

## 3. ドラフト PR を作る

```
gh pr create --draft --base main --title "<タイトル>" --body-file <本文のパス>
```

本文には**必ず**次を入れる。

| 見出し | 内容 |
|:--|:--|
| 対応 Issue | `Closes #n`。これが無いと CI の policy job が落ち、マージしても Issue が閉じない |
| 目的 | なぜこの変更が要るのか |
| 変更点 | 箇条書き・体言止め |
| 対応した受入条件 | `AC-n` の一覧。数えられるものは数値も |
| 確認した結果 | `/shinnn-app:check` の結果 |
| **変更後の状態** | この PR がマージされると、アプリが何をできるようになるか（利用者の言葉で 2〜3 行） |
| **次の一手** | 次に作るべきもの。無ければ「無し」 |
| 規約で迷った点 | 判断に迷って仮置きした点。人の判断を待つもの |

「変更後の状態」と「次の一手」は、**当社が引き継ぐときに最初に読む欄**なので省略しない。

## 4. レビューを回す

回す量は PR の中身で決める。まずコードの差分があるかを見る。

```
git -c core.quotepath=false diff --name-only origin/main...HEAD
```

| PR の性質 | レビュー |
|:--|:--|
| コードを変える PR | `/shinnn-app:code-review` → （有効なら）Copilot。どちらも Critical / Warning が 0 件になるまで |
| 文書だけの PR（`docs/` と `*.md` のみ） | `/shinnn-app:code-review` を 1 巡だけ。Copilot には依頼しない |

`core.quotepath=false` を省くと、日本語のファイル名がエスケープされて判定を誤る。

Copilot が有効な設定なら、コードレビューが 1 巡してから依頼する（レビュー回数に上限があるため、
設計レベルの指摘を先に潰しておく）。

## 5. 指摘への対応

- **1 コメント = 1 コミット**。どのコミットが何に対応したかを、コメントへの返信に SHA 付きで書く
- Critical / Warning が 1 件でも残っている間は次の段階に進まない
- Info は必須ではない。見送るなら**理由を返信と PR 本文に残す**（次に同じ指摘が来たとき再検証しないで済む）
- **動作に影響が大きい指摘は自分で判断せず人に相談する**
- 指摘が規約と食い違う場合は、指摘を鵜呑みにせず `/shinnn-app:why` で規約の意図を確認してから答える

## 6. 報告

収束したら、残った指摘（見送ったもの）と人の判断待ちの項目を一覧にして報告する。
`mergePolicy` が `human` ならここで終わり（ready にはしない）。`self-review` なら続けて 7 に進む。

## 7. マージする（`mergePolicy: self-review` のときだけ）

次の**すべて**を満たすときだけマージする。1 つでも欠けたら人に渡す。

- Critical / Warning の指摘が 0 件で、見送った指摘の理由を PR 本文に書いてある
- 「規約で迷った点」に人の判断待ちの項目が無い
- `/shinnn-app:check` が緑

```
gh pr ready <番号>
gh pr checks <番号> --watch --fail-fast
gh pr merge <番号> --merge --delete-branch
git switch main && git pull --ff-only
```

- CI が落ちたら、直してからやり直す。`--admin` などで検査を飛ばさない
- リポジトリが auto-merge を許可しているなら、ready の直後に `gh pr merge <番号> --auto --merge --delete-branch` としてもよい
  （CI が通った時点でマージされる）。その場合も `gh pr view <番号> --json state` でマージされたことを確かめてから報告する
- `gh pr merge` が `workflow` スコープの不足で失敗したら（ワークフローを変える PR）、人にマージを頼む。
  `gh auth refresh -h github.com -s workflow` で足せる
- 報告には、マージしたこと・閉じた Issue・`main` の状態（CI の結果）を書く
