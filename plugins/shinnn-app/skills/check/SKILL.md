---
name: check
description: リポジトリ全体の型検査・lint・テストと、受入条件および API 定義のカバレッジ、依存の脆弱性を確認する。範囲を絞ったビルド・lint・テストの仕方と、落ちたときの直し方も持つ。/shinnn-app:pr が PR を出す前に 1 回呼ぶ。「チェックして」「テストを通して」「壊れていないか確認」「型エラーを見て」「lint を通して」「このテストだけ実行」でも起動
---

# まとめて確認する

PR を出す前に、CI と同じ内容を手元で通す。**ここが緑にならないうちは PR にしない。**
ただし、この PR が原因でない `npm audit` の失敗だけは、PR を出してよい（「`npm audit` で落ちたとき」の 2）。
`/shinnn-app:pr` が手順 1 で呼ぶので、`feature` で作ったものは PR 1 本につき 1 回通る（CI が始まらないときの `pr` の手順 8 の 2 では、通し直す）。実装の途中の確認は hook（触ったファイルの lint と関連テスト）が行う。

## 実行する順

1 つ落ちたら、**その場で直してから次に進む**（全部走らせてから直そうとしない）。

**ルートで `npm run check` / `npm test` を使う**（`npm run ... --workspaces` を直接呼ばない）。
ルートのスクリプトは先に `shared` をビルドする。ビルドしないと `@app/shared` が解決できず、
クローン直後の server / client が型エラーの山になる。

`--workspaces` は 1 つ落ちても残りのパッケージを走らせてから終了コード 1 を返す。
**最初のエラーで出力が終わらない**ので、ログは最後まで読んで、落ちたパッケージを取りこぼさない。

| 順 | コマンド | 見るもの |
|:--|:--|:--|
| 1 | `npm run check` | shared のビルド → 各パッケージのビルド・型検査・lint。`--max-warnings 0` なので警告も落ちる |
| 2 | `npm test` | テスト。DB を使うテストは既定で PGlite（実 PostgreSQL は不要） |
| 3 | `node scripts/check-ac-coverage.mjs` | `docs/仕様書.md` の受入条件 `AC-n` すべてに、対応するテストがあるか。受入条件の番号が重なっていないか |
| 4 | `node scripts/check-api-coverage.mjs` | `shared/src/api` の全ルートにテストがあるか |
| 5 | `node scripts/check-test-naming.mjs` | テストのファイル名が `.test.ts` か（`.spec.ts` は CI で落ちる） |
| 6 | `node scripts/check-mandatory.mjs` | 必須項目（ファイル・deny・規約）の実体が残っているか |
| 7 | `node scripts/check-licenses.mjs` | 依存のライセンスが許可リスト（OSS）に収まっているか。外れたものは費用が発生する可能性があるのでシン株式会社に相談する |
| 8 | `npx prettier --check "client/**/*.ts"` | 画面の `.ts` が prettier の書き方にそろっているか。リポジトリの `.github/workflows/ci.yaml` にこの確認が無ければ（標準を取り込む前）飛ばして「未導入」と報告し、`/shinnn-app:update-rules` を案内する。出たのがこの PR で編集したファイルだけなら `npx prettier --write <ファイル>` で直す。編集していないファイルが出たら、数によらず `/shinnn-app:update-rules` の「画面の `.ts` の整形」のとおり、整形だけの PR を別に出す |
| 9 | `npm audit --audit-level=high` | 依存（依存の依存を含む）に、重さが high 以上の脆弱性の勧告が出ていないか。勧告は、GitHub が公開する脆弱性の知らせ。落ちたら下の「`npm audit` で落ちたとき」の順で直す |

`scripts/` の確認スクリプトが無い場合は、その項目を飛ばして「未導入」と報告する（勝手に作らない）。

## 一部だけ確かめるとき

実装の途中は hook が確かめる（保存のたびに `eslint --fix` と画面の `.ts` の prettier、応答の終わりに、変えたファイルの lint と関連テスト）。
手で範囲を絞るときは次を使う。**範囲を絞るコマンドは `shared` をビルドしない**ので、`shared` を変えた直後は先に `npm run build -w shared` を通す。

| 確かめたいこと | コマンド |
|:--|:--|
| 1 つのパッケージのビルド | `npm run build -w <client\|server\|shared>` |
| テストと seed も含めた型検査 | `npm exec -w <server\|shared> -- tsc -p tsconfig.check.json --noEmit` |
| 1 つのパッケージの lint | `npm run lint -w <パッケージ>`。自動修正は `npm exec -w <パッケージ> -- eslint --fix <パス>` |
| 1 つのパッケージのテスト | `npm run test -w <パッケージ>` |
| server / shared のテストを絞る | `npm exec -w <server\|shared> -- vitest run <パス>`。変えたファイルに関係するものだけなら `npm exec -w <server\|shared> -- vitest related --run <変更ファイル>` |
| client（画面）のテストを絞る | `npm run test -w client -- --filter '<テスト名の一部>'`（画面のテストは Angular のビルダー越しにしか動かないので、`vitest` を直接呼ばない） |

## 落ちたときの読み方

| 症状 | たいていの原因 | 直し方 |
|:--|:--|:--|
| 型エラーがたくさん出る | 最初の 1 件の波及 | **最初の 1 件から読む** |
| 型エラーが client に出る | `shared` の API 定義を変えたのに画面を直していない | `shared` の定義を正として画面側を合わせる。定義の方を戻さない |
| `Cannot find module '@app/shared'` | `shared` が未ビルド | 先に `npm run build -w shared` |
| lint の指摘 | 規約違反 | 自動修正できるものは先に `eslint --fix` で直す。残りは下の表の規約に従って直す。**ルールの設定を緩めて通さない**（規約違反を規約の側で消しているだけになる）。意図が分からなければ `/shinnn-app:why <ルール名>` |
| テストが落ちる | 実装かテストのどちらかが違う | **実装が正か、テストが正かを先に決める。** 判断は `.claude/rules/testing.md` の「何をテストするか」の表に従う。テストを通すためだけの分岐を入れたくなったら、実装が間違っている合図 |
| `check-ac-coverage` が「テストの無い受入条件があります」で落ちる | 受入条件を足したがテストを書いていない | AC-n をテスト名に含めたテストを足す |
| `check-ac-coverage` が「同じ番号の行が 2 つ以上あります」で落ちる | 受入条件の番号が重なった（フォームで立てた Issue の番号をそのまま写した、など） | 後から足した方を、使われている最大の番号の続きに振り直す（`/shinnn-app:feature` の「2. 仕様書に反映する」）。テスト名と Issue の本文も直す |
| `check-api-coverage` が落ちる | API 定義を足したがテストが無い | 正常系 1 つと異常系 1 つを足す |
| DB のテストだけ落ちる | マイグレーション未適用 | `/shinnn-app:db-migrate` を実行する |

lint のルールごとの直し方の規約（`.claude/rules/` の下）:

| ルール | 規約 |
|:--|:--|
| `no-restricted-imports`、`no-restricted-syntax`（server の `src/` の動的 import） | `server-architecture.md`・`client-architecture.md` の「新規ファイルの配置判断」「import の許可関係」 |
| `no-console` | `server-coding-conventions.md` の「ログ」、`client-coding-conventions.md` の「その他」 |
| `@typescript-eslint/no-explicit-any` | `server-coding-conventions.md`・`client-coding-conventions.md` の「型」 |
| Angular の signals / 制御フロー | `client-coding-conventions.md` の「テンプレート」「状態」 |

## `npm audit` で落ちたとき

勧告は、コードを変えていなくても、ある日から出ることがある。そのときは、`main` で CI を走らせても同じ理由で落ちる。
出力に `# npm audit report` が無く、エラー（`audit endpoint returned an error` など）で終わったときは、勧告で落ちたのではない。
レジストリ（npm のパッケージの置き場）から勧告を受け取れなかったので、「依存の脆弱性: 確かめられない」と報告し、下の手順には進まない。
`--audit-level` を上げる、CI の `npm audit` の step を消す、のどちらでも通さない（勧告が見えなくなるだけで、脆弱性は残る）。

1. **この PR が原因かを見る。** `git fetch` の後に、`git diff origin/main...HEAD -- package-lock.json`（コミットした分）と
   `git diff HEAD -- package-lock.json`（まだコミットしていない分）を実行する
   - どちらも何も出ない、または勧告の出たパッケージが差分に無い: 既にある依存に新しい勧告が出た。2 に進む
   - 勧告の出たパッケージが差分にある: この PR で足した・上げた依存が原因。この PR の中で 3 の順に直す
2. **直しを元の PR に混ぜない**（規約 `git-workflow.md` の「1 Issue = 1 ブランチ = 1 PR」）。次の順に進める
   1. `main` で既に直っていないかを見る。勧告の出たパッケージが `git diff HEAD...origin/main -- package-lock.json`
      （このブランチを切った後の `main` の変更）に出たら、`main` の側で版が変わっている。先に 6 の取り込みをして
      （元の PR がまだ無ければ、PR を出してから）、`npm audit --audit-level=high` を流し直す。通れば、ここで終わる
   2. 同じ直しが既にあるかを見る。名前は `"` で囲んで探す（`@angular/build` のような `@` で始まる名前は、囲まないと当たらない）
      - 直しの Issue: `gh issue list --state open --label type:deps --search '"<パッケージの名前>" in:title'`。
        題が `[依存] <パッケージの名前> の脆弱性の修正` のものだけを使う
      - Dependabot などの PR: `gh pr list --state open --search '"<パッケージの名前>" in:title'`。題の版（`from <今の版> to <新しい版>`）が、
        勧告の直った版を入れるものだけを使う
      - 見つかったら、新しく作らない。その番号を 4 の本文の行に使い、4・6・7 に進む（3 と 5 は飛ばす）
   3. 無ければ、`[依存] <パッケージの名前> の脆弱性の修正` の Issue を作る。ラベルは `type:deps` と `status:doing` を付ける。
      本文に、出た勧告の番号（`GHSA-` で始まるもの）をすべてと、`npm explain <パッケージの名前>` の出力を書く
   4. 元の PR の本文の「確認した結果」に、`依存の脆弱性: NG（<勧告の番号>。この PR が原因でない。#<直しの番号> で直す）` の 1 行を書く。
      元の PR は、そのまま出してよい（`check` の残りの項目は通す）。元の PR の CI では、`npm audit` の step が落ちる。
      規約チェックのその後ろの step（依存のライセンス・認証情報の混入）は飛ばされ、6 で `main` を取り込んだ後の CI で確かめられる
   5. 元の PR の `/shinnn-app:pr` を手順 6 の `retro` まで進め、CI の確認で `npm audit` の step が落ちたのを見てから、直しに移る。
      - ブランチを切る前に、今のブランチで `npm audit fix --dry-run` と `npm explain <パッケージの名前>` を実行し、3 のどれで直るかを見る
        （どちらもファイルを書き換えない）。3 の 5 に当たるなら、ブランチを切らずに 3 の 5 に進む
      - `git fetch origin main` → `git switch -c feature/<Issue 番号>-audit origin/main` で直しのブランチを切り、3 の順に直して、
        `/shinnn-app:pr` で PR を出す。依存の差し替えは振る舞いを変えないので、受入条件は足さない（規約 `testing.md` の
        「何をテストするか」の、振る舞いが変わらない変更の項目）。PR 本文の「対応した受入条件」には「無し（依存の差し替え）」と書く
   6. 直しの PR がマージされたら、元のブランチに戻る（`git switch <元のブランチ>`）。`gh pr update-branch <元の PR の番号>` で
      `main` を取り込み、`git pull --ff-only` で手元にも入れる。続けて、元の PR の `/shinnn-app:pr` の手順 6 の CI の確認からやり直す
   7. 直しの PR がこのセッションでマージされないとき（`mergePolicy` が `human` のとき、直しの PR を人に渡したとき）は、
      元のブランチに戻ってから、報告に次の順を書く。「直しの PR #<番号> を先にマージする。その後に、元の PR #<番号> に `main` を取り込む
      （Claude に頼む。PR の画面に Update branch のボタンが出ていれば、それを押してもよい）」
   8. 3 の 5 でシン株式会社の判断を待つときは、直しの Issue のラベルを `status:doing` から `status:blocked` に替える
3. **直す順。** 上から試し、直ったところで止める
   1. `npm audit fix` を実行する。`--force` は付けない。`package.json` の範囲の中で直る勧告は、これで直る
   2. 残った勧告に `npm audit fix --force` しか示されないときは、その案を使わない。
      出力の `Will install <名前>@<版>, which is a breaking change` と `Will install <名前>@<版>, which is outside the stated dependency range` は、
      ライブラリの版を下げるか、メジャーの版や `package.json` の範囲の外の版に変える案を示している。
      どちらの案でも、ほかの依存との版の組み合わせが崩れる
   3. `npm explain <勧告の出たパッケージ>` で、どのライブラリが入れているかと、どの範囲を求めているかを見る。
      ライブラリが勧告の直っていない版に固定していれば（例: `"vite": "8.3.0"` のような 1 つの版）、3 の 4 に進む。
      固定していなければ、3 の 5 に進む
   4. ルートの `package.json` の `overrides` で、勧告の直った版に差し替える。`overrides` は、依存の依存の版を差し替える
      npm の指定である。書き方は次のとおり
      - 固定しているライブラリをルートの `package.json` が直接宣言しているときは、この書き方を使えない（npm が `EOVERRIDE` で止まる）。
        3 の 5 に進む
      - キーは `<固定しているライブラリ>@<その今の系統>` にする（例: `"@angular/build@22.2": { "vite": "8.3.4" }`）。
        ライブラリを次の系統に上げると、差し替えは効かなくなる。項目を消し忘れても、新しい系統のライブラリに古い版を組み合わせずに済む
      - このキーは、ライブラリ自身の範囲もその系統に絞る。ライブラリを次の系統に上げるときは、`package.json` の範囲を上げて、この項目を消す
      - 差し替える版は、今の版と同じ系統（例: `8.3.x`）の中で、勧告の直った版にする
      - 足したら、`docs/decisions/0002-package-manager.md` の「lock ファイルの作り直し方」のとおりに `package-lock.json` を作り直し、
        差分を確かめる。この節が無いリポジトリでは、`npm update <差し替えたパッケージ>` で作り直す（`npm install` だけでは作り直されない）
      - 差し替えた理由と外す条件（固定しているライブラリの新しい版が、勧告の直った版を固定したとき、など）を、同じファイルの
        「依存の中の古い版を overrides で差し替えているもの」に項目として足す。「見直す時期」にも、外す時期を 1 行足す。
        この節が無いリポジトリでは、PR 本文に書く
   5. ここまでで直らないときと、どれを選ぶか迷うときは、手を止める。「引き継ぎメモ」Issue の「シン株式会社への要望」に、
      勧告の番号・`npm explain` の出力・試したことを書き、シン株式会社の判断を待つ（直しの Issue のラベルは 2 の 8）。
      直しのブランチで止めるときは、試した変更をコミットし、`/shinnn-app:pr` で PR にする（残った勧告と試したことは、本文の
      「規約で迷った点」に書く）。そのあと、元のブランチに戻る
4. **直した後。** `npm ls --all` と `npm audit --audit-level=high` が通ることを確かめる。この PR の中で直したときは、
   続けて `check` の 1〜8 を通し直す。直しの PR（2 の 5）では、続く `/shinnn-app:pr` の手順 1 の `check` で代える

## 報告

最後に、次の形で短く報告する。

```
check: OK / NG（NG なら落ちた項目と原因）
test: 成功 N / 失敗 N
AC カバレッジ: 満たしている AC / 全体
API 定義カバレッジ: テストがあるルート / 全体
画面の書式: OK / NG / 未導入
依存の脆弱性: OK / NG / 確かめられない（NG なら勧告の番号と、この PR が原因か）
```

範囲を絞って確かめたときは、確かめた範囲と結果（成功 N / 失敗 N、失敗したものの名前）だけを短く報告する。
