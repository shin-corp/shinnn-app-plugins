---
name: mutation-check
description: 実装をわざと壊して、受入条件のテストが本当に落ちるかを確かめる。壊す内容を 1 つずつ当て、狙ったテストが落ちることを見てから元に戻す。受入条件を足した・変えた PR では `pr` の前に必ず使う。「テストが効いているか確かめて」「変異テスト」「このテストは空振りしていない？」でも起動
---

# テストが効いているかを確かめる（変異）

テストは**落ちて初めて仕事をする**。足したテストが、直した実装を外しても緑のままなら、そのテストは何も守っていない。
実装をわざと壊して、**狙ったテストが落ちる**ことを確かめる。

## 1. 変異の一覧を作る

「このテストは、実装のどこを壊したら落ちるべきか」を 1 行ずつ書く。
**足した・変えた受入条件（`AC-n`）1 つにつき 1 つ以上**が目安。受入条件は `docs/仕様書.md` の差分で分かる。

```
git diff origin/main...HEAD -- docs/仕様書.md
```

| 変異の作り方 | 例 |
|:--|:--|
| 足した処理を丸ごと外す | 応答に項目を載せる行を消す、条件の 1 つを消す |
| 直す前の書き方に戻す | 条件を元の形に戻す、丸めを外す |
| 値を隣にずらす | `>=` を `>`、番号を 0 に固定、境界を ±1 |

**やらないこと**

- 型検査が落ちる変異（テストまで到達しないので何も分からない）
- 1 回に 2 か所以上を壊す（どのテストがどれを守っているか分からなくなる）

## 2. 1 つずつ当てて走らせる

**必ず「当てる → 走らせる → 元に戻す」を 1 組**にする。元に戻す処理は、失敗しても必ず走る形（`try` / `finally`）で書く。
スクリプトは scratchpad に置き、リポジトリには置かない。

走らせるのは、**狙った受入条件のテストだけ**にする（`-t 'AC-n '`）。サーバーのテストは 1 件ごとに DB を作り直すので、
ファイル全体を走らせると変異の数だけ待つことになる。受入条件のテストは HTTP 経由でサーバーに置く決まりなので、
`server` で走らせれば足りる。`-t` の後ろの空白は、`AC-1` が `AC-10` や `AC-11` に当たらないようにするため。
受入条件に紐づかないテストを確かめるときは、そのテスト名の一部を `-t` に渡す。

```js
// scratchpad/mutate.mjs の例。リポジトリのルートで node <scratchpad>/mutate.mjs と実行する
// （例はサンプルの items。消した後は、変えた機能のファイルと受入条件に置き換える）
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mutations = [
  {
    name: '1 件の条件から持ち主を外す',
    file: 'server/src/service/items.service.ts',
    from: 'and(eq(items.ownerId, ownerId), eq(items.id, id))',
    to: 'eq(items.id, id)',
    test: 'AC-11 ',
  },
];

for (const mutation of mutations) {
  const original = readFileSync(mutation.file, 'utf8');
  const count = original.split(mutation.from).length - 1;
  if (count !== 1) {
    console.log(`[${mutation.name}] 変異の対象が ${count} 箇所あります。1 箇所に絞れる文字列にする`);
    continue;
  }

  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
  try {
    const result = spawnSync(process.execPath, ['../node_modules/vitest/vitest.mjs', 'run', '-t', mutation.test], {
      cwd: 'server',
      encoding: 'utf8',
      timeout: 900_000,
    });
    const lines = `${result.stdout}\n${result.stderr}`.split('\n');
    const summary = lines.filter((line) => line.trim().startsWith('Tests '));
    const failed = lines.filter((line) => line.includes('×'));
    console.log(`[${mutation.name}]`, summary.at(-1)?.trim() ?? '結果を読めませんでした');
    for (const line of failed) {
      console.log('   ', line.trim());
    }
  } finally {
    writeFileSync(mutation.file, original);
  }
}
```

vitest はシェルを通さず `node` で直接起動する。Windows でシェルを通すと、`-t` に渡す文字列の空白が落ちる。

**落とし穴**

- **同じ文字列が複数ある**と、意図した場所と別の場所を壊す。上の例は 1 箇所でなければ当てずに飛ばす。
  「1 件も落ちなかった」ときは、まず変異が当たったかを疑う
- **改行コード**を変えない。読み込んだ文字列をそのまま書き戻す（エディタや `sed` で書き換えない）
- 実装を壊している間に**別のテスト実行（hook など）が走る**と、作業中の状態を見て失敗が報告される。
  終わったら `git status` で元に戻っていることを確かめる
- 時間のかかるテスト（歯止めや早送りを外すと数十秒かかるもの）は `timeout` を長めにする

## 3. 結果を読む

| 結果 | 意味 | すること |
|:--|:--|:--|
| 狙ったテストが落ちた | そのテストは実装を守っている | 次の変異へ |
| 1 件も落ちなかった | テストが空振り、または変異が当たっていない | 変異が当たったかを先に確かめる。当たっていたら**テストを作り直す** |
| 絞らずに走らせたとき、狙っていないテストも落ちた | テストの粒度が粗い（1 つのテストが複数のことを見ている） | 記録する。分けられるなら分ける |

**テストが空振りする例**: 利用者ごとのデータを、自分のトークンだけで試すテストは、持ち主の条件を外しても落ちない。
別の利用者のトークンで試して、初めて落ちるようになる。

## 4. 報告

```
変異 N 件
- <変異の名前>（AC-n）: 落ちたテスト <テスト名>（狙いどおり / 落ちなかった）
作業ツリー: clean（元に戻っていることを確認）
```

PR を出すときは、この結果を本文の「確認した結果」に 1 行で書く
（例: 「変異で確かめた: 1 件の条件から持ち主を外す → AC-11 のテストが落ちる」）。

## いつ使うか

- **受入条件を足した・変えた PR では、`/shinnn-app:pr` の前に必ず**（`pr` の手順 1 が求める）
- それ以外でテストを足したとき、レビューで「このテストは実装を固定できていない」と指摘されたとき
- 不具合を直したとき（直す前の実装に戻して、テストが落ちることを見る）
