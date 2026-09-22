---
name: sync-standards
description: プラグインが配布する標準（CLAUDE.md 雛形・rules・アプリ作り方ガイド）の更新を、リポジトリへ取り込んで PR にする。標準バージョンに差があるときに実行する。「標準を更新」「rules を最新に」「バージョンが古いと言われた」で起動
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

プラグイン自体が古い可能性もあるので、先に `claude plugin update` を案内する。

## 2. 変更点をまとめる

ファイルごとに、次の 3 つに分けて示す。

- **追加された規約**: 新しく守る必要があるもの
- **変わった規約**: 書き方が変わったもの。既存コードが違反していないかを確認する
- **消えた規約**: 守らなくてよくなったもの

規約の変更で**既存コードが違反する場合は、その一覧も出す**（直すかは別の作業として Issue にする）。

## 3. Issue とブランチを用意する

**`main` に直接コミット・push しない。** 先に Issue を作り、そのブランチで取り込んで PR にする。
ブランチ名（`feature/<Issue 番号>-<slug>`）と PR 本文の `Closes #<Issue 番号>` は `.claude/rules/git-workflow.md` の
規約どおりにする（CI の規約チェックが本文の `Closes` を確かめる）。

1. 取り込みの Issue を `gh issue create` で作る。題は `[標準] 標準 <新バージョン> の取り込み`、本文には手順 2 でまとめた
   3 分類を書き、ラベルは `status:doing` を付ける
2. `main` の最新から、1 の Issue の番号でブランチを切る

   ```
   git fetch origin main
   git switch -c feature/<Issue 番号>-sync-standards origin/main
   ```

`gh` が無い・ログインできない場合は、Issue を GitHub の画面で作ってもらい、Issue の番号を聞いてから同じ名前で
ブランチを切る。手順 5 の PR も画面で作ってもらい、本文に `Closes #<番号>` を入れてもらう。

## 4. 適用する

コピー元はすべて `${CLAUDE_PLUGIN_ROOT}/template/` の下にある。

```
cp ${CLAUDE_PLUGIN_ROOT}/template/.claude/rules/*.md .claude/rules/
cp ${CLAUDE_PLUGIN_ROOT}/template/.claude/rules/.standards-version .claude/rules/
cp ${CLAUDE_PLUGIN_ROOT}/template/docs/アプリ作り方ガイド.md docs/
```

- コピーは Bash 経由で行う（`.claude/rules/` への Edit / Write は `.claude/settings.json` の deny が止める）
- サーバー側を持たないリポジトリには、**元から無かった規約を増やさない**。
  コピー前に `.claude/rules/` の顔ぶれを控えておき、増えた分は消す
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

PR 本文の 1 行目は `Closes #<手順 3 の Issue の番号>`。続けて、手順 2 でまとめた 3 分類と、
**既存コードが違反している箇所の一覧**を書く。規約の変更に伴うコード修正は、この PR に混ぜない（別の Issue にする）。
ready にするか、マージまで行うかは `/shinnn-app:pr` がマージの方針（`human` / `self-review`）に従って決める。

## 6. 適用しない選択

案件の事情で採れない規約があるなら、**黙って外さない**。
`CLAUDE.local.md` に理由を書き、「引き継ぎメモ」Issue にも残して当社に見えるようにする。
