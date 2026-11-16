---
name: mutation-check
description: 実装をわざと壊して、テストが本当に落ちるかを確かめる。壊す内容を 1 つずつ当て、狙ったテストが落ちることを見てから元に戻す。認可の条件（持ち主・役割）を足した・変えた PR、データを消す・上書きする処理を足した・変えた PR、不具合を直した PR（テストそのものの不具合を除く）では必ず使う（`pr` の手順 1 が呼ぶ）。「テストが効いているか確かめて」「変異テスト」「このテストは空振りしていない？」でも起動
---

# テストが効いているかを確かめる（変異）

テストは**落ちて初めて仕事をする**。足したテストが、直した実装を外しても緑のままなら、そのテストは何も守っていない。
実装をわざと壊して、**狙ったテストが落ちる**ことを確かめる。

## 1. 変異の一覧を作る

「このテストは、実装のどこを壊したら落ちるべきか」を 1 行ずつ書く。
必ず使う 3 つの場面（「いつ使うか」）では、この PR が足した・変えた次の箇所を壊す。
ほかの場面（頼まれたとき、レビューで指摘されたとき）では、確かめるテストが守っている箇所を壊す。

| 壊す箇所 | 1 つ以上作る変異 |
|:--|:--|
| 認可の条件（持ち主・役割） | 条件から持ち主や役割を外す |
| データを消す・上書きする処理 | 消す・上書きする範囲の条件を外す、対象を 1 件に絞る条件を外す |
| 不具合の直し | 直した箇所を、直す前の書き方に戻す |

| 変異の作り方 | 例 |
|:--|:--|
| 足した処理を丸ごと外す | レスポンスに項目を載せる行を消す、条件の 1 つを消す |
| 直す前の書き方に戻す | 条件を元の形に戻す、丸めを外す |
| 値を隣にずらす | `>=` を `>`、番号を 0 に固定、境界を ±1 |
| 呼ばない・値を変えない（画面） | 処理を呼ぶ行を消す、signal に書く値を元の値のままにする |

**やらないこと**

- 型検査が落ちる変異を当てる（テストまで到達しないので何も分からない）
- 1 回に 2 か所以上を壊す（どのテストがどれを守っているか分からなくなる）
- 画面で、`effect` の中から、その `effect` が読む signal に書く変異を当てる（無限ループになり、テストが返らない）
- 引数が使われなくなる変異を当てる（`client` と `shared` は型検査（`noUnusedParameters`）で止まる。引数を消すと呼ぶ側も変わり、2 か所を壊すことになる。別の箇所を壊す変異にする）

変異で使われなくなる変数・private のメンバー・import は、同じ変異の中で消す（下のスクリプトの `edits` の 2 つ目から）。
消さないと、`client` と `shared` では、型検査（`noUnusedLocals`）でビルドが止まり、テストが走らない（`server` のテストは型検査をせずに走るが、同じく消す）。
使われなくなった宣言を消すのは、壊す 1 か所に付いてくる変更なので、2 か所を壊すことには当たらない。
型検査の設定を緩めない。無効化のコメントや `void` で逃がさない。

## 2. 1 つずつ当てて走らせる

**必ず「当てる → 走らせる → 元に戻す」を 1 組**にする。
スクリプトは scratchpad に置き、リポジトリには置かない。名前は `mutate` を含む `.mjs`（`mutate.mjs`、`mutate2.mjs` など）にし、
`node <scratchpad>/<名前>` の形で後ろに引数を足さずに実行する（この形なら、テンプレートの権限の設定にある許可 `Bash(node *mutate*.mjs)` によって、確認なしで実行される）。

スクリプトは前面で実行する（`run_in_background` にしない）。
バックグラウンドの実行は、打ち切られると変異が残ったままになる。
Bash の時間の上限（`timeout`）は 600000（10 分）にする。
1 つのスクリプトに入れる変異は、テストの時間の上限（`timeoutMs`）の合計が 9 分に収まる数にする。
入りきらない変異は、`mutate2.mjs` のように別のスクリプトに分けて、1 つずつ実行する。

走らせるのは、**狙った受入条件のテストだけ**にする。ほかのテストの結果が混ざらず、狙ったテストが落ちたかどうかだけを読める。
受入条件のテストは、API の振る舞いなら `server`、画面に現れることなら `client` にある（`.claude/rules/testing.md`）。

| テストの場所 | 絞り方 |
|:--|:--|
| `server` | vitest の `-t 'AC-n '` |
| `client` | `ng test` の `--filter 'AC-n '`（画面のテストは Angular のビルダー越しに動く） |

`AC-n` の後ろの空白は、`AC-1` が `AC-10` や `AC-11` に当たらないようにするため。
受入条件に紐づかないテストを確かめるときは、そのテスト名の一部を渡す。
どちらの絞り込みも正規表現として読まれる。そのため、スクリプトは、テスト名の記号（`+` や括弧）を文字として渡す形に直してから渡す。

```js
// scratchpad/mutate.mjs の例。リポジトリのルートで node <scratchpad>/mutate.mjs と実行する
// （例はサンプルの items。消した後は、変えた機能のファイルと受入条件に置き換える）
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mutations = [
  {
    name: '1 件の条件から持ち主を外す',
    file: 'server/src/service/items.service.ts',
    // 1 つ目が壊す変更。変異で使われなくなる宣言（変数・private のメンバー・import）は、2 つ目から消す
    edits: [{ from: 'and(eq(items.ownerId, ownerId), eq(items.id, id))', to: 'eq(items.id, id)' }],
    test: 'AC-7 ',
    workspace: 'server',
  },
];

/** 1 つのテストにかける時間の上限（ミリ秒）。変異で無限ループになっても、ここで止める */
const timeoutMs = 240_000;

/** このスクリプトと同じフォルダ（scratchpad）のファイルのパス */
const besideScript = (name) => fileURLToPath(new URL(name, import.meta.url));

/** 当てている間の元の中身。打ち切られて変異が残ったら、次の実行の最初にこれで戻す */
const backupPath = besideScript('./mutate-backup.json');

/** テストを走らせるコマンド（workspace ごと）。どれもシェルを通さず node で起動する */
const runners = {
  server: (pattern) => ['../node_modules/vitest/vitest.mjs', 'run', '-t', pattern],
  shared: (pattern) => ['../node_modules/vitest/vitest.mjs', 'run', '-t', pattern],
  client: (pattern) => ['../node_modules/@angular/cli/bin/ng.js', 'test', '--watch=false', '--filter', pattern],
};

let running = null;

/** 絞り込みは正規表現として読まれるので、テスト名の記号を文字として扱う形にする */
function toPattern(testName) {
  return testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 控えた元の中身に戻し、shared のファイルならビルドし直す。戻したファイルを返す（控えが無ければ null）。
 * 今の中身が当てた中身とも元の中身とも違うときは、変異の後にファイルが変わっているので、上書きせずに止める
 */
function restoreFromBackup() {
  if (!existsSync(backupPath)) {
    return null;
  }
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const current = readFileSync(backup.file, 'utf8');
  if (![backup.mutated, backup.original].includes(current)) {
    console.log(`控えと今の中身が合わないので戻さない: ${backup.file}（控え: ${backupPath}）`);
    process.exit(1);
  }
  writeFileSync(backup.file, backup.original);
  // 控えは、ビルドし直してから消す。ビルドの途中で止まっても、次の実行でビルドし直せる
  if (buildShared(backup.file)) {
    rmSync(backupPath);
  }
  return backup.file;
}

/** shared の変更は、ビルドし直すまで server と画面のテストに届かない */
function buildShared(file) {
  if (!file.replaceAll('\\', '/').startsWith('shared/')) {
    return true;
  }
  const result = spawnSync(process.execPath, ['../node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
    cwd: 'shared',
    encoding: 'utf8',
  });
  return result.status === 0;
}

/** テストのプロセスを、その子（vitest の worker など）ごと止める */
function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // 既に終わっている
  }
}

function runTest(mutation, logPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, runners[mutation.workspace](toPattern(mutation.test)), {
      cwd: mutation.workspace,
      detached: process.platform !== 'win32',
    });
    running = child;
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      running = null;
      writeFileSync(logPath, output);
      resolve({ output, timedOut });
    });
  });
}

// 前の実行が打ち切られて変異が残っていたら、先に戻す
const leftover = restoreFromBackup();
if (leftover) {
  console.log(`前の実行で残った変異を戻した: ${leftover}`);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (running) {
      killTree(running);
    }
    restoreFromBackup();
    process.exit(1);
  });
}

for (const [index, mutation] of mutations.entries()) {
  const original = readFileSync(mutation.file, 'utf8');
  let mutated = original;
  let applicable = true;
  for (const edit of mutation.edits) {
    const count = mutated.split(edit.from).length - 1;
    if (count !== 1) {
      console.log(`[${mutation.name}] 変異の対象が ${count} 箇所あります。1 箇所に絞れる文字列にする`);
      applicable = false;
      break;
    }
    // 関数で渡すと、edit.to の中の `$&` などを特別な記号として読まない
    mutated = mutated.replace(edit.from, () => edit.to);
  }
  if (!applicable) {
    continue;
  }

  writeFileSync(backupPath, JSON.stringify({ file: mutation.file, original, mutated }));
  writeFileSync(mutation.file, mutated);
  try {
    if (!buildShared(mutation.file)) {
      console.log(`[${mutation.name}] shared のビルドが型検査で止まった。使われなくなった宣言を edits で消す`);
      continue;
    }
    const logPath = besideScript(`./mutate-${index + 1}.log`);
    const { output, timedOut } = await runTest(mutation, logPath);
    if (timedOut) {
      console.log(`[${mutation.name}] 時間の上限で止めた。無限ループになる変異なので、作り直す（ログ: ${logPath}）`);
      continue;
    }
    // 画面のテストの出力は色を付ける制御文字を含むので、取り除いてから読む
    const lines = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    const summary = lines.filter((line) => line.trim().startsWith('Tests ')).at(-1)?.trim();
    const failed = lines.filter((line) => line.includes('×'));
    if (!summary) {
      console.log(`[${mutation.name}] 結果を読めませんでした（ログ: ${logPath}）`);
    } else if (!/passed|failed/.test(summary)) {
      console.log(`[${mutation.name}] 絞り込みに 1 件も当たらなかった: ${summary}`);
    } else {
      console.log(`[${mutation.name}]`, summary);
    }
    for (const line of failed) {
      console.log('   ', line.trim());
    }
  } finally {
    restoreFromBackup();
    const restored = readFileSync(mutation.file, 'utf8') === original;
    console.log(restored ? '    元に戻ったことを確かめた' : `    元に戻っていない: ${mutation.file}`);
  }
}
```

テストはシェルを通さず `node` で直接起動する。Windows でシェルを通すと、絞り込みに渡す文字列の空白が落ちる。
画面の受入条件なら、`workspace` を `client` にし、変異は画面のファイル（`client/src/app/features/<機能>/`）に当てる。
`shared` に当てた変異は、`file` を `shared/` のファイルにし、`workspace` を狙ったテストのある側（`server`・`client`・`shared`）にする。スクリプトは、当てた後と戻した後に `shared` をビルドし直す。

**落とし穴**

- **同じ文字列が複数ある**と、意図した場所と別の場所を壊す。上の例は 1 箇所でなければ当てずに飛ばす。
  「1 件も落ちなかった」ときは、まず変異が当たったかを確かめる
- **改行コード**を変えない。読み込んだ文字列をそのまま書き戻す（エディタや `sed` で書き換えない）
- 実装を壊している間に**別のテスト実行（hook など）が走る**と、作業中の状態を見て失敗が報告される。
  終わったら `git status` で元に戻っていることを確かめる
- 「結果を読めませんでした」は、テストが走らずに終わったことを表す。ログ（scratchpad の `mutate-<番号>.log`）を開いて理由を見る。
  よくある理由は、型検査で止まったこと（使われなくなった宣言を `edits` で消す）
- 「絞り込みに 1 件も当たらなかった」は、`test` の名前が実際のテスト名と合っていないことを表す。テスト名を写し直す
- 時間の上限で止めたときは、変異が無限ループを起こしている。「呼ばない」「値を変えない」形の変異に作り直す
- 実行が打ち切られた（Bash の時間の上限、利用者が止めた）ときは、scratchpad に `mutate-backup.json` が残っていれば、変異が残っている。
  `mutations` を空の配列にした写し（`mutate-restore.mjs`）を実行すると、最初に元に戻す（「前の実行で残った変異を戻した」と出る。`shared` のファイルならビルドし直す）。
  同じスクリプトを実行し直すと、変異を当て直し、同じ所でまた打ち切られることがある。戻したら、`git diff` で変異が残っていないことを確かめる
- 「控えと今の中身が合わないので戻さない」と出たら、変異を当てた後にファイルが変わっている。
  まず `git diff` で中身を確かめる。変異が残っていれば、手で戻す（`shared` のファイルなら、戻した後に `npm run build -w shared`）。
  最後に `mutate-backup.json` を消す
- 打ち切られた後は、スクリプトが起動したテストのプロセスが残っていないかも確かめる。
  コマンドラインに `vitest.mjs run -t` か `ng.js test --watch=false --filter` を含む `node` のプロセスが、スクリプトの起動したものである。
  Windows では PowerShell の `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vitest.mjs run -t|ng.js test --watch=false --filter' } | Select-Object ProcessId, CommandLine` で探し、`Stop-Process -Id <番号>` で止める。
  Linux では `pgrep -af 'vitest.mjs run -t|ng.js test --watch=false --filter'`、macOS では `pgrep -lf 'vitest.mjs run -t|ng.js test --watch=false --filter'` で探し、`kill <番号>` で止める（探すコマンドを包んだシェルも出るので、`node` のプロセスだけを見る）。
  ほかのプロセス（利用者が動かしている `npm run dev` など）は止めない

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
（例: 「変異で確かめた: 1 件の条件から持ち主を外す → AC-7 のテストが落ちる」）。

## いつ使うか

- 次の PR では**必ず**使う（`pr` の手順 1 が呼ぶ）
  - 認可の条件（持ち主・役割）を足した・変えた PR
  - データを消す・上書きする処理を足した・変えた PR
  - 不具合を直した PR（直す前の実装に戻して、テストが落ちることを見る）
- まれに落ちるテストなど、テストそのものの不具合の直しには使わない（直す前に戻しても通ることが多い。確かめ方は `pr` の手順 1）
- 上の 3 つに当たらない PR では、受入条件を足した・変えたときも使わない（受入条件ごとにテストがあることは、CI が見る）
- ただし、利用者に頼まれたときと、レビューで「このテストは実装を固定できていない」と指摘されたときは使う
