---
name: feature
description: 作りたいことを一行で受け取り、Issue の作成 → 仕様書への反映 → ブランチ作成 → shared → server → client → テスト の順で実装する。「機能を追加したい」「〜を作りたい」「新しい画面がほしい」で起動
---

# 機能を 1 本作る

一行の要望から、Issue・仕様・実装・テストまでを 1 本の流れで通す。
**1 Issue = 1 ブランチ = 1 PR** を崩さない。

引数（`$ARGUMENTS`）に作りたいことが書かれていれば、それを出発点にする。無ければ最初に聞く。

## 1. Issue を作る

- **確認の質問は 3 つまで。** 分からないことは仮置きし、Issue の「未決」に書く（質問を重ねて止めない）
- 聞くなら、この 3 つから選ぶ: 何のためか / 誰が使うか / 保存するデータは何か
- `gh issue create --template feature.yml` で作る。本文には次を必ず入れる

| 見出し | 内容 |
|:--|:--|
| 目的 | 何が嬉しいのかを 1〜2 行 |
| 画面 | 追加・変更する画面と、そこでできること |
| データ | 保存する項目と、その意味 |
| 受入条件 | `AC-1` から順に番号を振る。**1 行 = 1 つの確認できる事実**として書く |
| 未決 | 仮置きした点。人に確認してから決めること |

受入条件は、あとで「この AC に対応するテストがあるか」を CI が機械的に照合する。
**測れない書き方（「使いやすいこと」など）をしない。**

## 2. 仕様書に反映する

`docs/仕様書.md` の該当章に、Issue と同じ内容を追記する。Issue が正、仕様書はまとまった読み物という関係にする。
既存の記述と食い違う場合は、**書き換えずに人へ報告する**（仕様書の版は人が管理する）。

## 3. ブランチを作る

```
git fetch origin main
git switch -c feature/<Issue 番号>-<英小文字の短い slug> origin/main
```

例: `feature/12-item-archive`

## 4. 実装する（この順を守る）

| 順 | 場所 | やること |
|:--|:--|:--|
| 1 | `shared/src/api/` | zod スキーマと API 定義を書く。**ここが唯一の正**。手書きの型を作らない |
| 2 | `server/src/db/schema/` | テーブルを足すなら先にスキーマ。`/shinnn-app:db-migrate` でマイグレーションを生成する |
| 3 | `server/src/api/<機能>/` | router と controller。`route()` ヘルパーで API 定義を渡す。`req.body` を直接読まない |
| 4 | `server/src/service/` | 業務処理。エラーは `CommonException` + `MessageKeys` |
| 5 | `client/src/app/features/<機能>/` | 画面。API 呼び出しは `api-client.ts` の `call()` だけを通す |
| 6 | `server/tests/` と `client/` の `.test.ts` | 受入条件 `AC-n` ごとにテストを 1 つ以上。テスト名に `AC-n` を入れる |

**参照される側を先に書く。** shared を変えずに server や client だけ直したくなったら、それは API 定義の考え漏れなので shared に戻る。

各段階が終わるたびに、その層の `check` を通してから次へ進む（全部書いてからまとめて直さない）。
画面の作り方の詳細は `add-screen`、API の追加手順は `add-api` を読む。

## 5. コミットする

`commit-message` の規約に従い、**層ごとに分ける**（shared → server → client → テスト）。
実装とテストは別コミットにする。

## 6. 仕上げ

```
/shinnn-app:check
/shinnn-app:pr
```

## 迷ったとき

- 規約の理由が分からない: `/shinnn-app:why <話題>`
- 変更が大きくなりすぎた: `large-change` の手順で設計メモを先に書く。Issue を分けることも検討する
- 実装の途中で仕様の穴が見つかった: **勝手に決めず**、Issue にコメントして人に返す
