---
name: add-screen
description: 画面を 1 つ追加する手順（見た目の方針 → 受入条件と API 定義 → 置き場所とルート → ページ → 取得と表示 → 入力 → 見た目 → テスト）。見た目の案は frontend-design スキルで立てる。「画面を追加したい」「新しいページを作る」で起動
---

# 画面を 1 つ追加する

このスキルは順番だけを示す。守る決まりは `client/CLAUDE.md` と `.claude/rules/` の client の規約
（`client-architecture.md`・`client-coding-conventions.md`・`client-styling.md`）にある。**層を新しく作らない。**

最初に手本のサンプル `client/src/app/features/items/` を読む（サンプルの `items` を消した後は、既存の機能を手本にする）。
読むと、`client/CLAUDE.md` と client の規約も読み込まれる。

**画面のコードを書く前に、手順 0 で見た目の方針を確かめる。手順 6 では、Skill ツールで `frontend-design:frontend-design` を
呼んでから見た目を作る。どちらも飛ばさない。** `frontend-design` を呼ぶときは、次の条件を必ず添える。

- 業務の画面なので、目新しさより、使う人が迷わず・間違えずに速く進められることを優先する
- 部品は Angular Material、見た目は Tailwind のユーティリティで作る。守る決まりは `.claude/rules/client-styling.md`
  （独自の CSS を書かない、配色は生成したテーマ、書体は npm で同梱）。案が規約とぶつかるときは規約に従う

スキルの一覧に `frontend-design` が無い（入っていない）ときは、`claude plugin install frontend-design@claude-plugins-official --scope local`
を実行し、次に起動したときから使えることを利用者に伝える。今回は使わずに、規約に沿って進める。

## 0. 見た目の方針を確かめる

`docs/仕様書.md` の「見た目の方針」を読む。埋まっていれば、その方針に沿って 1 へ進む。
空か節が無ければ（アプリで最初の画面）、先に方針を決める。見た目を変えたいと頼まれたときも、ここから始める。

1. Skill ツールで `frontend-design:frontend-design` を呼び、使う人と場面・配色（主色と、4〜6 色の役割）・書体・
   画面の骨組み・大事にすることの案を立てる。依頼には、仕様書の「目的」と「画面」も添える
2. 案を利用者に見せて確かめる（色の値と、画面のどこに使うか。書体の名前）
3. 確かめた内容を仕様書の「見た目の方針」に書く（節が無ければ「画面」の章の終わりに足す）
4. テーマと書体を入れる（決まりは `client-styling.md` の「テーマと書体」）

   ```
   npm exec -w client -- ng generate @angular/material:theme-color --primary-color=<主色> --is-scss=false --directory=src/ --interactive=false
   npm install <書体のパッケージ> -w client
   ```

   生成した `client/src/theme.css` を `styles.css` の同梱のテーマの代わりに読み込み、書体のパッケージを読み込んで、
   書体の名前を `styles.css` の決まった場所に入れる

5. `npm run dev` で画面を開いてもらい、見た目を確かめてもらう

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

## 6. 見た目

Skill ツールで `frontend-design:frontend-design` を呼び、この画面の配置・情報の優先度・読み込み中と 0 件と失敗のときの文言を決める。
依頼には、仕様書の「見た目の方針」とこの画面の受入条件を添え、方針の配色と書体を使うと書く。
この画面だけで使う色や書体が要る案になったら、利用者に確かめてから、役割の名前で `styles.css` の `@theme` に足し、
「見た目の方針」の「画面だけの追加」に書く。作るときの決まりは `.claude/rules/client-styling.md`（「テーマと書体」）。

## 7. テスト

`.claude/rules/testing.md` の「画面のテスト」に従う。画面に現れる受入条件（表示・操作）は、ここで `AC-n` のテストにする。

## 確認

```
npm run check -w client
```

画面のパッケージの型検査と lint だけを通す。まとめての `/shinnn-app:check` は、`/shinnn-app:pr` が PR を出す前に 1 回通すので、ここでは走らせない。
