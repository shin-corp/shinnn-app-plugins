---
name: check
description: リポジトリ全体の型検査・lint・テストと、受入条件および API 定義のカバレッジ、依存の脆弱性を確認する。範囲を絞ったビルド・lint・テストの仕方と、落ちたときの直し方も持つ。依存の脆弱性の勧告の直し方（直しの Issue とブランチの決め方を含む）も持つ。/shinnn-app:pr が PR を出す前に 1 回呼ぶ。CI の「依存の脆弱性」の失敗や注記を貼り付けて直すよう頼まれたときも、main の上でも、このスキルの「npm audit で勧告が出たとき」で進める。「チェックして」「テストを通して」「壊れていないか確認」「型エラーを見て」「lint を通して」「このテストだけ実行」「脆弱性を直して」「npm audit の勧告を直して」でも起動
---

# まとめて確認する

PR を出す前に、CI と同じ内容を手元で通す。**ここが緑にならないうちは PR にしない。**
ただし、`npm audit` で落ちたときのうち、「`npm audit` で勧告が出たとき」の冒頭に挙げた 3 つのときだけは、PR を出してよい。
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
| 9 | `npm audit --omit=dev --audit-level=high` | 実行時の依存（各 `package.json` の `dependencies`。依存の依存を含む）に、重さが high 以上の脆弱性の勧告（GitHub が公開する脆弱性の知らせ）が出ていないか。CI の規約チェックの「依存の脆弱性」と同じ。落ちたら、下の「`npm audit` で勧告が出たとき」の冒頭から進める |
| 10 | `npm audit --audit-level=high` | 開発用の依存（`devDependencies`）も含めて、high 以上の勧告が出ていないか。CI はこれで落ちず、注記（警告の知らせ）を出す。ここも落ちた扱いにしない。勧告が出たら、「`npm audit` で勧告が出たとき」の冒頭から進める（1 の後は 3） |

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

## `npm audit` で勧告が出たとき

`npm audit` は、依存（依存の依存を含む）に出た脆弱性の勧告を調べる。勧告は、GitHub が公開する脆弱性の知らせ。
実行時の依存は、各 `package.json` の `dependencies` から入るもの。開発用の依存は、`devDependencies` から入るもの。
実行時の依存の勧告（9）では、CI の規約チェックの「依存の脆弱性」も落ちる。
開発用の依存の勧告（10 だけで出たもの）では、CI は落ちない。代わりに、CI の結果の画面に注記（警告の知らせ）が出る。
勧告は、コードを変えていなくても、ある日から出ることがある。

次の 3 つのときだけは、`check` が緑でなくても PR を出してよい。PR 本文の「確認した結果」に、`check` の報告の「依存の脆弱性」の行を書く。

- この PR が原因でない、実行時の依存の勧告があるとき（2）
- 直しきれずに、人に渡す PR に勧告が残るとき（4 の 5。直しの Issue がシン株式会社の判断待ちのときを含む）
- レジストリ（npm のパッケージの置き場）から、勧告を受け取れなかったとき（すぐ下）

出力に `# npm audit report` が無く、エラー（`audit endpoint returned an error` など）で終わったときは、勧告を受け取れなかったということ。
「依存の脆弱性: 確かめられない」と報告する。CI の「依存の脆弱性」が同じエラーで落ちたときは、時間をおいて
`gh run rerun <実行の番号> --failed` で走らせ直す。

`--audit-level` を上げる、CI の `npm audit` の step を消すか書き換える、のどれでも通さない（勧告が見えなくなるだけで、脆弱性は残る）。

`.github/workflows/` の「依存の脆弱性」の行に `--omit=dev` が無ければ、標準を取り込む前のリポジトリ。開発用の依存の勧告でも CI が落ちる。
このリポジトリでは、開発用の依存の勧告も 2 と同じに扱う。あわせて、`/shinnn-app:update-rules` で標準を取り込むよう案内する
（取り込むと、開発用の依存の勧告では CI が落ちなくなる。取り込みの PR の CI は、取り込んだ規約チェックで動く）。

直しのブランチ（`feature/<直しの Issue の番号>-audit`）にいるときは、1〜3 を飛ばして 4 の順に直す。直しきれなければ 4 の 5 に進む。

元の PR が無いとき（`main` の上で、CI の「依存の脆弱性」の失敗や注記を貼り付けて直すよう頼まれたときなど）は、次の順で進める。
元の PR に関わる 2 の 1・2 の 3・2 の 4・2 の 6 は当てない。ほかの手順の「元のブランチ」は、`main` と読む。

- `git switch main && git pull --ff-only` の後に、`check` の 9 と 10 を流して、勧告の出たパッケージを見る（1〜8 は流さない）。
  どちらにも勧告が出なければ、1 の最後の箇条のとおりにして終わる
- 1 で、直しの Issue と PR を探す
- 2 の 2 で、直しの Issue を決める。実行時の依存の勧告も、開発用の依存の勧告も、同じに扱う
- 直しの PR が無く、直しの Issue が `status:next` なら、2 の 5 で直す。元の PR を待たずに、すぐ進める。
  2 の 5 の `git status --porcelain` が空でなければ、先に `/shinnn-app:feature` の「続きから始める」の 0 で、その変更を流れに乗せる
- それ以外のときは、直しに移らない。新しい Issue・ブランチ・PR は作らない。直しの Issue と PR の番号と、状態
  （直しの PR のマージ待ち、`status:doing` で直している途中、`status:blocked` でシン株式会社の判断待ち）を報告して終わる

Issue と PR の本文を書き換えるときは、`gh issue view <番号> --json body --jq .body`（PR は `gh pr view <番号> --json body --jq .body`）で
今の本文を読む。それに足した本文を、Write ツールで scratchpad の `issue-body.md`（PR は `pr-body.md`）に書き、`--body-file` に渡す
（リダイレクトでファイルに書くと、確認が出るか、リポジトリの中にファイルが残る）。

1. **直しの Issue と PR を探す。** どの入り口から来ても、最初にここを通る。ここでは探すだけで、作らない
   - `main` の側: `git fetch` の後に、勧告の出たパッケージが `git diff HEAD...origin/main -- package-lock.json`
     （このブランチを切った後の `main` の変更）に出たら、`main` の側で版が変わっている。既に直っていることがある。
     PR があれば、`gh pr update-branch <番号>` と `git pull --ff-only` で `main` を取り込んでから、`npm audit` を流し直す。
     PR がまだ無ければ、2・3 のとおりに進め、PR を出した後に取り込んで流し直す
   - 直しの Issue: `gh issue list --state open --label type:deps --limit 200 --json number,title,labels --jq '.[] | select(.title == "[依存] 依存の脆弱性の修正") | "\(.number) \([.labels[].name] | join(","))"'`。
     ラベルに `status:blocked` があれば、シン株式会社の判断待ち。2 の 5 には進まない
   - 直しの PR: 直しの Issue があれば、`gh pr list --state open --head feature/<Issue 番号>-audit --json number --jq '.[].number'`
   - 流し直して勧告が出なくなったときは、ここで終わる。直しの Issue に書いたパッケージのどれにも勧告が出なくなったら、
     `gh issue close <番号> --comment "<理由>"` で閉じる。直しの PR があれば、`gh pr close <番号> --comment "<理由>"` で閉じる
2. **実行時の依存の勧告（9 で落ちた）**
   1. この PR が原因かを見る。`git diff origin/main...HEAD -- package-lock.json`（コミットした分）と
      `git diff HEAD -- package-lock.json`（まだコミットしていない分）に、勧告の出たパッケージが出たら、この PR で足した・上げた依存が原因。
      この PR の中で 4 の順に直す（直しの Issue は作らない）。出なければ、2 の 2 に進む
   2. 直しを元の PR に混ぜない（規約 `git-workflow.md` の「1 Issue = 1 ブランチ = 1 PR」）。1 で見つけた直しの Issue を使う
      - 見つからなければ、題を `[依存] 依存の脆弱性の修正` にして作る。ラベルは `type:deps` と `status:next` を付ける。
        本文には、勧告の出たパッケージごとに、勧告の番号（`GHSA-` で始まるもの）をすべて・実行時の依存か開発用の依存か・
        `npm explain <パッケージの名前>` の出力を書く。直し方は、この節の 4 だと書き添える
      - 見つかった Issue の本文に無いパッケージは、本文に足す（`status:blocked` のときも足すだけ）。ただし、直しの PR が既にあれば、
        足さずにその PR のマージを待つ。マージの後にも勧告が残っていれば、そのときに 1 からやり直す
   3. 元の PR の本文の「確認した結果」に、`依存の脆弱性: NG（<勧告の番号>。この PR が原因でない。#<直しの Issue の番号> で直す）` の 1 行を書く。
      元の PR は、そのまま出してよい。元の PR が既にあれば、本文を書き換える（上の書き換え方）
   4. 元の PR の CI は、「依存の脆弱性」で落ちたままになる。規約チェックのその後ろの step（開発用を含む依存の脆弱性・依存のライセンス・
      認証情報の混入）は飛ばされ、`main` を取り込んだ後の CI で確かめられる。直しの PR がマージされたら（直しの Issue が閉じたら）、
      元のブランチに戻る（`git switch <元のブランチ>`）。`gh pr update-branch <元の PR の番号>` で `main` を取り込み、
      `git pull --ff-only` で手元にも入れる。そのあと、元の PR の `/shinnn-app:pr` の手順 6 の CI の確認からやり直す。
      `gh pr update-branch` が衝突で失敗したら、そこで止めて報告する
   5. 直しの PR がまだ無く、直しの Issue が `status:next` なら、元の PR の `/shinnn-app:pr` が終わった後に、ほかの Issue より先に進める
      - ブランチを切る前に、`npm audit fix --dry-run` と、勧告の出たパッケージごとの `npm explain <パッケージの名前>` で、
        4 のどれで直るかを見る（どちらもファイルを書き換えない）。どれも 4 の 5 に当たるなら、ブランチを切らずに 4 の 5 に進む
      - `git status --porcelain` が空であることを確かめる（空でなければ、元のブランチで先にコミットする）
      - `feature` の手順 3 のとおりに、`origin/main` から `feature/<Issue 番号>-audit` を切り、ラベルを `status:doing` に替える
      - 直しの Issue に書いたパッケージを、4 の順にすべて直す。
        `/shinnn-app:pr` で、題を `[依存] 依存の脆弱性の修正` にして PR を出す。依存の差し替えは振る舞いを変えないので、
        受入条件は足さない（規約 `testing.md` の「何をテストするか」の、振る舞いが変わらない変更の項目）。
        PR 本文の「対応した受入条件」には「無し（依存の差し替え）」と書く
      - 直しの PR がこのセッションでマージされたら（`mergePolicy` が `self-review` のとき）、2 の 4 に進む
   6. 直しの PR がこのセッションでマージされないとき（`mergePolicy` が `human` のとき、直しの PR を人に渡したとき）は、
      元のブランチに戻ってから、報告に次の順を書く
      - 直しの PR があるとき: 「直しの PR #<番号> を先にマージする。その後に、元の PR #<番号> に `main` を取り込む
        （Claude に頼む。PR の画面に Update branch のボタンが出ていれば、それを押してもよい）」
      - 直しの Issue が `status:blocked` のとき: 「#<番号> で、シン株式会社の判断を待っている。決まって直しがマージされるまで、
        元の PR の CI は「依存の脆弱性」で落ちたまま」
3. **開発用の依存の勧告（10 で出た）**。9 も落ちたときは、10 にだけ出た勧告をここで扱う
   - 2 の 1 と同じ見方で、この PR が原因なら、この PR の中で 4 の順に直す（直しの Issue は作らない）
   - 原因でなければ、PR は止めない（標準を取り込む前のリポジトリでは、2 と同じに扱う）。2 の 2 のとおりに直しの Issue を決める。
     PR 本文の「確認した結果」に、`依存の脆弱性（開発用）: 勧告あり（<勧告の番号>。#<直しの Issue の番号> で直す）` の 1 行を書く。
     直しは、2 の 5 と同じ形で、元の PR の後に進める
4. **直す順。** パッケージごとに、上から試し、直ったところで止める
   1. `npm audit fix` を実行する。`--force` は付けない。`package.json` の範囲の中で直る勧告は、これで直る
   2. 残った勧告に `npm audit fix --force` しか示されないときは、その案を使わない。
      出力の `Will install <名前>@<版>, which is a breaking change` は、メジャーの版を変える案を示している。
      `Will install <名前>@<版>, which is outside the stated dependency range` は、`package.json` の範囲の外の版（下げる版を含む）に
      変える案を示している。どちらの案でも、ほかの依存との版の組み合わせが崩れる
   3. `npm explain <勧告の出たパッケージ>` で、どのライブラリが入れているかと、どの範囲を求めているかを見る。
      ライブラリが勧告の直っていない版に固定していれば（例: `"vite": "8.3.0"` のような 1 つの版）、4 の 4 に進む。
      固定していなければ、4 の 5 に進む
   4. ルートの `package.json` の `overrides` で、勧告の直った版に差し替える。`overrides` は、依存の依存の版を差し替える
      npm の指定である。書き方は次のとおり
      - 固定しているライブラリをルートの `package.json` が直接宣言しているときは、この書き方を使えない（npm が `EOVERRIDE` で止まる）。
        4 の 5 に進む
      - キーは `<固定しているライブラリ>@<その今の系統>` にする（例: `"@angular/build@22.2": { "vite": "8.3.4" }`）。
        ライブラリを次の系統に上げると、差し替えは効かなくなる。項目を消し忘れても、新しい系統のライブラリに古い版を組み合わせずに済む
      - このキーは、ライブラリ自身の範囲もその系統に絞る。ライブラリを次の系統に上げるときは、`package.json` の範囲を上げて、この項目を消す
      - 差し替える版は、今の版と同じ系統（例: `8.3.x`）の中で、勧告の直った版にする
      - 足したら、`docs/decisions/0002-package-manager.md` の「lock ファイルの作り直し方」のとおりに `package-lock.json` を作り直し、
        差分を確かめる（この節が無いリポジトリでは、`npm update <差し替えたパッケージ>` で作り直す。`npm install` だけでは作り直されない）
      - 差し替えた理由と外す条件（固定しているライブラリの新しい版が、勧告の直った版を固定したとき、など）を、同じファイルの
        「依存の中の古い版を overrides で差し替えているもの」に項目として足す。「見直す時期」にも、外す時期を 1 行足す。
        この節が無いリポジトリでは、PR 本文に書く
   5. ここまでで直らないときと、どれを選ぶか迷うときは、手を止める。「引き継ぎメモ」Issue の「シン株式会社への要望」に、
      勧告の番号・`npm explain` の出力・試したことを書き、シン株式会社の判断を待つ。そのうえで、次のとおりにする
      - 直しの Issue のラベルを `status:blocked` に替える（この PR が原因のときは、元の Issue のラベルは変えない）
      - 試した変更があれば、コミットする。いま `/shinnn-app:pr` の中にいれば、その続きで PR を出す。いなければ、`/shinnn-app:pr` で
        PR にする。残った勧告と試したことは、本文の「規約で迷った点」に書く
      - 直しのブランチにいるときは、そのあと元のブランチに戻る
5. **直した後。** `npm ls --all` と、`check` の 9（開発用の依存の勧告を直したときは 10 も）が通ることを確かめる。
   `package-lock.json` の差分は、ADR 0002 の「lock ファイルの作り直し方」の差分の確かめ方のとおりに確かめる（通す監査は、ここに書いた
   9 と 10 にする。この節が無いリポジトリでは、直したパッケージとその依存だけに収まっていることを確かめる）。この PR の中で直したときは、続けて `check` の 1〜8 を通し直す。
   直しの PR では、続く `/shinnn-app:pr` の手順 1 の `check` で代える

## 報告

最後に、次の形で短く報告する。

```
check: OK / NG（NG なら落ちた項目と原因）
test: 成功 N / 失敗 N
AC カバレッジ: 満たしている AC / 全体
API 定義カバレッジ: テストがあるルート / 全体
画面の書式: OK / NG / 未導入
依存の脆弱性: OK / NG / 確かめられない（NG なら、勧告の番号・この PR が原因か・直しの Issue の番号。2 の 3 の形）
依存の脆弱性（開発用）: OK / 勧告あり / 確かめられない（勧告ありなら、勧告の番号と直しの Issue の番号。3 の形）
```

範囲を絞って確かめたときは、確かめた範囲と結果（成功 N / 失敗 N、失敗したものの名前）だけを短く報告する。
