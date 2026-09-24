---
name: add-screen
description: 画面を 1 つ追加する 7 手順（受入条件と API 定義 → 置き場所とルート → ページ → 取得と表示 → 入力 → スタイル → テスト）。「画面を追加したい」「新しいページを作る」で起動
---

# 画面を 1 つ追加する

このスキルは順番だけを示す。守る決まりは `client/CLAUDE.md` と `.claude/rules/` の client の規約
（`client-architecture.md`・`client-coding-conventions.md`・`client-styling.md`）にある。**層を新しく作らない。**

最初に手本のサンプル `client/src/app/features/items/` を読む（サンプルの `items` を消した後は、既存の機能を手本にする）。
読むと、`client/CLAUDE.md` と client の規約も読み込まれる。

## 1. 受入条件と API 定義を確かめる

Issue の受入条件を読み、作る画面と要るデータを確かめる。`shared/src/api/<機能>.ts` に API 定義が無ければ、
先に `/shinnn-app:add-api` で shared と server を用意する（同じ PR）。

## 2. 置き場所とルート

`features/<機能>/` を作り、`<機能>.routes.ts` を `app.routes.ts` から `loadChildren` で繋ぐ。
置き場所の決まりは `.claude/rules/client-architecture.md` の「新規ファイルの配置判断」。

## 3. ページのコンポーネント

`client/CLAUDE.md` の「Angular 規約」に従って作る。

## 4. 取得と表示

`client/CLAUDE.md` の「画面の決まり」（取得と 3 状態、一覧）と「API 呼び出し」に従う。

## 5. 入力

`client/CLAUDE.md` の「画面の決まり」（入力）に従う。

## 6. スタイル

`.claude/rules/client-styling.md` に従う。

## 7. テスト

`.claude/rules/testing.md` の「画面のテスト」に従う。画面に現れる受入条件（表示・操作）は、ここで `AC-n` のテストにする。

## 確認

```
npm run check -w client
```

画面のパッケージの型検査と lint だけを通す。まとめての `/shinnn-app:check` は、`/shinnn-app:pr` が PR を出す前に 1 回通すので、ここでは走らせない。
