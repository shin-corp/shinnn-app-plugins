---
name: sync-standards
description: プラグインが配布する標準（CLAUDE.md 雛形・rules・レビュー観点）の更新を、リポジトリへ取り込んで PR にする。標準バージョンに差があるときに実行する。「標準を更新」「rules を最新に」「バージョンが古いと言われた」で起動
---

# 標準の更新を取り込む

プラグインの `standards/` が規約の正本。リポジトリ側の `.claude/rules/` はその写しなので、
食い違ったら**標準側で上書きする**。

## 1. 差を確認する

| 見る場所 | 意味 |
|:--|:--|
| `.claude/rules/.standards-version` | 今のリポジトリが持っている標準のバージョン |
| プラグインの `standards/.standards-version` | 配布されている標準のバージョン |

同じなら「更新はありません」と報告して終わる。**同じなのにファイルが違う場合**は、
リポジトリ側が手で書き換えられている。その差分を示し、どちらを採るか人に確認する。

プラグイン自体が古い可能性もあるので、先に `claude plugin update` を案内する。

## 2. 変更点をまとめる

ファイルごとに、次の 3 つに分けて示す。

- **追加された規約**: 新しく守る必要があるもの
- **変わった規約**: 書き方が変わったもの。既存コードが違反していないかを確認する
- **消えた規約**: 守らなくてよくなったもの

規約の変更で**既存コードが違反する場合は、その一覧も出す**（直すかは別の作業として Issue にする）。

## 3. 適用する

```
git switch -c chore/sync-standards-<新バージョン> origin/main
```

- `standards/rules/` の規約を `.claude/rules/` へ上書きコピーする（`README.md` は配らない）
- `standards/claude-md/root|client|server/CLAUDE.md` を、それぞれ `CLAUDE.md` / `client/CLAUDE.md` /
  `server/CLAUDE.md` へ当てる。**案件固有の記述を消さないように**マージする
  （雛形が変わった箇所だけを当て、埋めてある内容は残す）
- `standards/アプリ作り方ガイド.md` を `docs/アプリ作り方ガイド.md` へ上書きコピーする
- `standards/.standards-version` の値を `.claude/rules/.standards-version` に書く
- `.shinnn/setup.json` の `standardsVersion` も更新する

コピーは Bash 経由で行う（`.claude/rules/` は Edit / Write のガードが止める）。

## 4. PR にする

```
/shinnn-app:pr
```

PR 本文には、手順 2 でまとめた 3 分類と、**既存コードが違反している箇所の一覧**を書く。
規約の変更に伴うコード修正は、この PR に混ぜない（別の Issue にする）。

## 5. 適用しない選択

案件の事情で採れない規約があるなら、**黙って外さない**。
`CLAUDE.local.md` に理由を書き、「引き継ぎメモ」Issue にも残して当社に見えるようにする。
