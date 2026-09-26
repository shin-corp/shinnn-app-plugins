---
name: add-screen
description: 画面を 1 つ追加する手順（見た目の方針 → 受入条件と API 定義 → 置き場所とルート → 画面の案 → ページ → 取得と表示 → 入力 → スタイル → テスト）。見た目の案は frontend-design スキルで立てる。「画面を追加したい」「新しいページを作る」で起動
---

# 画面を 1 つ追加する

このスキルは順番だけを示す。守る決まりは `client/CLAUDE.md` と `.claude/rules/` の client の規約
（`client-architecture.md`・`client-coding-conventions.md`・`client-styling.md`）にある。**層を新しく作らない。**

最初に手本のサンプル `client/src/app/features/items/` を読む（サンプルの `items` を消した後は、既存の機能を手本にする）。
読むと、`client/CLAUDE.md` と client の規約も読み込まれる。

**画面のコードを書く前に、手順 0 で見た目の方針を確かめ、手順 3 で Skill ツールで `frontend-design:frontend-design` を
呼んで画面の案を立てる。どちらも飛ばさない。** `frontend-design` を呼ぶときは、次の条件を必ず添える。

- 業務の画面なので、目新しさより、使う人が迷わず・間違えずに速く進められることを優先する
- 部品は Angular Material、見た目は Tailwind のユーティリティで作る。守る決まりは `.claude/rules/client-styling.md`
  （「テーマと書体」を含む）。案が規約とぶつかるときは規約に従う

スキルの一覧に `frontend-design` が無い（入っていない）ときは、`claude plugin install frontend-design@claude-plugins-official --scope local`
を実行する。配布元に無いと出て失敗したら、`claude plugin marketplace add anthropics/claude-plugins-official` を実行してから
入れ直す。入れたものは、次に起動したときから使える。

- 「見た目の方針」が空なら、ここで止めて起動し直してもらい、起動し直した後に手順 0 から始める
- 方針が埋まっていれば、今回は使わずに進め、手順 3 の案は方針と規約に沿って立てる
- 入れられなかったときは、そのことを利用者に伝えて使わずに進める。方針は決めずに空のまま残し、同梱のテーマのままにする

## 0. 見た目の方針を確かめる

`docs/仕様書.md` の「見た目の方針」を読む。埋まっていれば、その方針に沿って 1 へ進む。
空か節が無ければ、先に方針を決める。アプリ全体の見た目を変えたいと頼まれたときも、ここから始める。
すでに画面があるアプリで方針が空のときは、今の見た目のまま方針に書く案も示す（テーマを変えると、今ある画面の見た目も変わるため）。

1. Skill ツールで `frontend-design:frontend-design` を呼び、使う人と場面・配色（主色と、4〜6 色の役割）・書体・
   画面の骨組み・大事にすることの案を立てる。依頼には、仕様書の「目的」と「画面」も添える
2. 案を利用者に見せて確かめる（色の値と、画面のどこに使うか。書体の名前）。色は Material が渡した色から濃淡を作るので、
   出来上がる値は少し変わることも伝える
3. 確かめた内容を仕様書の「見た目の方針」に書く（節が無ければ「画面」の章の終わりに足す）。配色は、生成に渡した色を書く
4. テーマと書体を入れる（決まりは `client-styling.md` の「テーマと書体」）。案で主色のほかの色も決めたなら
   `--secondary-color` / `--tertiary-color` でも渡す。作り直すときも同じコマンドで、`--force` が上書きする。
   どちらもリポジトリのルートで実行する（`-w client` が `client` を指す）

   ```
   npm exec -w client -- ng generate @angular/material:theme-color --primary-color=<主色> --is-scss=false --directory=src/ --interactive=false --force
   npm install <書体のパッケージ> -w client
   ```

   生成した `client/src/theme.css` を `styles.css` の同梱のテーマの代わりに読み込み、書体のパッケージを読み込んで、
   書体の名前を `styles.css` の決まった場所に入れる。画面の骨組みのうちアプリ全体に関わるもの（ツールバーなど）は、
   `app.component.ts` のシェルに入れる

5. `npm run dev` で起動し、利用者に画面を開いて見た目を確かめてもらう（開発用の通行証の入れ方は `README.md` の
   「画面から API を呼ぶための通行証（開発中）」）

## 1. 受入条件と API 定義を確かめる

Issue の受入条件を読み、作る画面と要るデータを確かめる。`shared/src/api/<機能>.ts` に API 定義が無ければ、
先に `/shinnn-app:add-api` で shared と server を用意する（同じ PR）。

## 2. 置き場所とルート

`features/<機能>/` を作り、`<機能>.routes.ts` を `app.routes.ts` から `loadChildren` で繋ぐ。
置き場所の決まりは `.claude/rules/client-architecture.md` の「新規ファイルの配置判断」。

## 3. 画面の案

Skill ツールで `frontend-design:frontend-design` を呼び、この画面の配置・情報の優先度・読み込み中と 0 件のときの案内を決める。
失敗のときの文言は `describeError()` が出すので、出し方だけを決める（`client/CLAUDE.md` の「画面の決まり」）。
依頼には、仕様書の「見た目の方針」とこの画面の受入条件を添え、方針の配色と書体を使うと書く。
この画面だけで使う色や書体が要る案になったら、利用者に確かめてから、役割の名前で `styles.css` の `@theme` に足し、
「見た目の方針」の「画面だけの追加」に書く（`client-styling.md` の「テーマと書体」）。

## 4. ページのコンポーネント

`client/CLAUDE.md` の「Angular 規約」に従って作る。

## 5. 取得と表示

`client/CLAUDE.md` の「画面の決まり」（取得と 3 状態、一覧）と「API 呼び出し」に従う。

## 6. 入力

`client/CLAUDE.md` の「画面の決まり」（入力）に従う。

## 7. スタイル

手順 3 の案に沿って、`.claude/rules/client-styling.md` に従って作る。

## 8. テスト

`.claude/rules/testing.md` の「画面のテスト」に従う。画面に現れる受入条件（表示・操作）は、ここで `AC-n` のテストにする。

## 確認

```
npm run check -w client
```

画面のパッケージの型検査と lint だけを通す。まとめての `/shinnn-app:check` は、`/shinnn-app:pr` が PR を出す前に 1 回通すので、ここでは走らせない。
