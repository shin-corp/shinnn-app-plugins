/**
 * スキル mutation-check の、使う場面と、例のスクリプトの回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 必ず使う場面は 3 つ（認可の条件、データを消す・上書きする処理、不具合の直し）。
 * スキルの説明・「いつ使うか」・`pr` の手順 1・PR テンプレートが、同じ 3 つを挙げていることを確かめる。
 * 例のスクリプトは、利用者の Claude が写して使う。そのため、取り出して、偽物のテストの道具で動かす。
 * 確かめるのは、変異が当たって元に戻ること、テスト名の記号を文字として渡すこと、
 * 時間の上限で子のプロセス（vitest の worker に当たるもの）ごと止めること、
 * 打ち切られて残った変異を次の実行の最初に戻すこと（shared のファイルならビルドし直す）、
 * 控えと今の中身が合わないときは上書きしないこと。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
const skill = readFileSync(join(pluginRoot, 'skills/mutation-check/SKILL.md'), 'utf8');
const prSkill = readFileSync(join(pluginRoot, 'skills/pr/SKILL.md'), 'utf8');
const prTemplate = readFileSync(join(pluginRoot, 'template/.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');

/** 見出しから次の `## ` の見出しの手前までの本文 */
function sectionOf(text, heading) {
  const start = text.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `見出し「${heading}」がありません`);
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** 必ず使う 3 つの場面が、それぞれ書かれていることを確かめる */
function assertThreeCases(text, where) {
  assert.match(text, /認可の条件/, `${where}に認可の条件がありません`);
  assert.match(text, /データを消す・上書きする処理/, `${where}にデータを消す・上書きする処理がありません`);
  assert.match(text, /不具合を直した/, `${where}に不具合の直しがありません`);
}

test('スキルの説明と「いつ使うか」は、必ず使う場面を 3 つに絞る', () => {
  const description = skill.match(/^description: (.*)$/m)[1];
  assertThreeCases(description, 'スキルの説明');
  assert.doesNotMatch(description, /受入条件を足した・変えた PR/);
  const when = sectionOf(skill, 'いつ使うか');
  assertThreeCases(when, '「いつ使うか」');
  assert.match(when, /受入条件を足した・変えたときも使わない/);
});

test('pr の手順 1 と PR テンプレートも、同じ 3 つの場面を挙げる', () => {
  const step1 = sectionOf(prSkill, '1. ');
  const start = step1.indexOf('**認可・データを消す処理・不具合の直しのテストが効いていること**');
  assert.notEqual(start, -1, 'pr の手順 1 に変異の項目がありません');
  const bullet = step1.slice(start, step1.indexOf('- **AI の出力'));
  assertThreeCases(bullet, 'pr の手順 1');
  const line = prTemplate.split('\n').find((text) => text.includes('/shinnn-app:mutation-check'));
  assert.ok(line, 'PR テンプレートに mutation-check の行がありません');
  assertThreeCases(line, 'PR テンプレート');
});

test('変異で使われなくなった宣言は、同じ変異の中で消す（型検査の設定を緩めない）', () => {
  const list = sectionOf(skill, '1. 変異の一覧を作る');
  assert.match(list, /使われなくなる変数・private のメンバー・import は、同じ変異の中で消す/);
  assert.match(list, /型検査の設定を緩めない/);
});

/** 例のスクリプトを取り出す。mutations と時間の上限を差し替えられる */
function sampleScript({ mutations, timeoutMs }) {
  const start = skill.indexOf('```js\n// scratchpad/mutate.mjs');
  assert.notEqual(start, -1, '例のスクリプトがありません');
  const end = skill.indexOf('\n```', start + 5);
  let code = skill.slice(start + 6, end + 1);
  // 関数で渡すと、mutations の中の `$'` などを特別な記号として読まない
  const literal = `const mutations = ${JSON.stringify(mutations)};\n`;
  const replaced = code.replace(/const mutations = \[[\s\S]*?\n\];\n/, () => literal);
  assert.notEqual(replaced, code, 'mutations の配列を差し替えられません');
  code = replaced.replace(/const timeoutMs = [\d_]+;/, `const timeoutMs = ${timeoutMs};`);
  return code;
}

/**
 * 偽物の vitest と tsc を置いた作業場所を作る。
 * 偽物の vitest は、対象のファイルに LOOP があれば、出力を受け継ぐ子のプロセス（vitest の worker に当たる）を起こして止まらない。
 * 子のプロセスを止めないと出力が閉じないので、スクリプトは子ごと止めないと先に進めない。
 * mutated があれば 1 件落ちたと出す。偽物の tsc は、shared/src/value.ts を shared/dist.txt に写す。
 */
function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'mutate-test-'));
  mkdirSync(join(root, 'node_modules/vitest'), { recursive: true });
  mkdirSync(join(root, 'node_modules/typescript/bin'), { recursive: true });
  mkdirSync(join(root, 'server/src'), { recursive: true });
  mkdirSync(join(root, 'shared/src'), { recursive: true });
  mkdirSync(join(root, 'scratch'));
  writeFileSync(
    join(root, 'node_modules/vitest/vitest.mjs'),
    [
      "import { spawn } from 'node:child_process';",
      "import { existsSync, readFileSync } from 'node:fs';",
      "const shared = existsSync('../shared/dist.txt') ? readFileSync('../shared/dist.txt', 'utf8') : '';",
      "const text = readFileSync('src/target.ts', 'utf8') + shared;",
      "if (text.includes('LOOP')) {",
      "  spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'inherit' });",
      '  for (;;) {}',
      '}',
      "console.log('pattern=' + process.argv[process.argv.indexOf('-t') + 1]);",
      "console.log('text=' + JSON.stringify(text));",
      "console.log(text.includes('mutated') ? ' Tests  1 failed | 0 passed (1)' : ' Tests  1 passed (1)');",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'node_modules/typescript/bin/tsc'),
    "require('node:fs').writeFileSync('dist.txt', require('node:fs').readFileSync('src/value.ts', 'utf8'));\n",
  );
  writeFileSync(join(root, 'server/src/target.ts'), 'const value = original;\n');
  writeFileSync(join(root, 'shared/src/value.ts'), 'export const value = original;\n');
  writeFileSync(join(root, 'shared/dist.txt'), 'export const value = original;\n');
  return root;
}

function runSample(root, options) {
  const script = join(root, 'scratch/mutate.mjs');
  writeFileSync(script, sampleScript(options));
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 60_000 });
}

test('例のスクリプトは、変異を当てて狙ったテストの結果を出し、元に戻す。テスト名の記号は文字として渡す', () => {
  const root = makeWorkspace();
  try {
    const result = runSample(root, {
      mutations: [
        {
          name: '値を変える',
          file: 'server/src/target.ts',
          edits: [{ from: 'original', to: 'mutated' }],
          test: 'AC-1 名前に (記号) + を含む',
          workspace: 'server',
        },
      ],
      timeoutMs: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[値を変える\] Tests {2}1 failed/);
    assert.match(result.stdout, /元に戻ったことを確かめた/);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = original;\n');
    assert.equal(existsSync(join(root, 'scratch/mutate-backup.json')), false);
    const log = readFileSync(join(root, 'scratch/mutate-1.log'), 'utf8');
    assert.match(log, /pattern=AC-1 名前に \\\(記号\\\) \\\+ を含む/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、止まらないテストを時間の上限で止め、元に戻す', () => {
  const root = makeWorkspace();
  try {
    const result = runSample(root, {
      mutations: [
        {
          name: '無限ループ',
          file: 'server/src/target.ts',
          edits: [{ from: 'original', to: 'LOOP' }],
          test: 'AC-1 ',
          workspace: 'server',
        },
      ],
      timeoutMs: 2_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[無限ループ\] 時間の上限で止めた/);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = original;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、打ち切られて残った変異を、次の実行の最初に戻す', () => {
  const root = makeWorkspace();
  try {
    writeFileSync(join(root, 'server/src/target.ts'), 'const value = mutated;\n');
    writeFileSync(
      join(root, 'scratch/mutate-backup.json'),
      JSON.stringify({
        file: 'server/src/target.ts',
        original: 'const value = original;\n',
        mutated: 'const value = mutated;\n',
      }),
    );
    const result = runSample(root, { mutations: [], timeoutMs: 2_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /前の実行で残った変異を戻した: server\/src\/target\.ts/);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = original;\n');
    assert.equal(existsSync(join(root, 'scratch/mutate-backup.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、残った shared の変異を戻したとき、shared をビルドし直す', () => {
  const root = makeWorkspace();
  try {
    writeFileSync(join(root, 'shared/src/value.ts'), 'export const value = mutated;\n');
    writeFileSync(join(root, 'shared/dist.txt'), 'export const value = mutated;\n');
    writeFileSync(
      join(root, 'scratch/mutate-backup.json'),
      JSON.stringify({
        file: 'shared/src/value.ts',
        original: 'export const value = original;\n',
        mutated: 'export const value = mutated;\n',
      }),
    );
    const result = runSample(root, { mutations: [], timeoutMs: 2_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /前の実行で残った変異を戻した: shared\/src\/value\.ts/);
    assert.equal(readFileSync(join(root, 'shared/dist.txt'), 'utf8'), 'export const value = original;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、控えと今の中身が合わないときは上書きせずに止める', () => {
  const root = makeWorkspace();
  try {
    writeFileSync(join(root, 'server/src/target.ts'), 'const value = changedLater;\n');
    writeFileSync(
      join(root, 'scratch/mutate-backup.json'),
      JSON.stringify({
        file: 'server/src/target.ts',
        original: 'const value = original;\n',
        mutated: 'const value = mutated;\n',
      }),
    );
    const result = runSample(root, { mutations: [], timeoutMs: 2_000 });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /控えと今の中身が合わないので戻さない: server\/src\/target\.ts/);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = changedLater;\n');
    assert.equal(existsSync(join(root, 'scratch/mutate-backup.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、shared に当てた変異をビルドしてから server のテストを走らせ、戻した後もビルドし直す', () => {
  const root = makeWorkspace();
  try {
    const result = runSample(root, {
      mutations: [
        {
          name: 'shared の値を変える',
          file: 'shared/src/value.ts',
          edits: [{ from: 'original', to: 'mutated' }],
          test: 'AC-1 ',
          workspace: 'server',
        },
      ],
      timeoutMs: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[shared の値を変える\] Tests {2}1 failed/);
    assert.equal(readFileSync(join(root, 'shared/src/value.ts'), 'utf8'), 'export const value = original;\n');
    assert.equal(readFileSync(join(root, 'shared/dist.txt'), 'utf8'), 'export const value = original;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、置き換えの文字列の $ を特別な記号として読まない', () => {
  const root = makeWorkspace();
  try {
    const result = runSample(root, {
      mutations: [
        {
          name: '$ を含む置き換え',
          file: 'server/src/target.ts',
          edits: [{ from: 'original', to: "'$' + mutated" }],
          test: 'AC-1 ',
          workspace: 'server',
        },
      ],
      timeoutMs: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[\$ を含む置き換え\] Tests {2}1 failed/);
    const log = readFileSync(join(root, 'scratch/mutate-1.log'), 'utf8');
    assert.ok(log.includes("const value = '$' + mutated;"), log);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = original;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Windows では、外から送った SIGTERM でシグナルの処理が走らない（次の実行の最初に戻す）ので、ほかの OS だけで確かめる
test('例のスクリプトは、SIGTERM を受けたら、テストのプロセスを止めて元に戻す', { skip: process.platform === 'win32' }, async () => {
  const root = makeWorkspace();
  try {
    const script = join(root, 'scratch/mutate.mjs');
    writeFileSync(
      script,
      sampleScript({
        mutations: [
          {
            name: '無限ループ',
            file: 'server/src/target.ts',
            edits: [{ from: 'original', to: 'LOOP' }],
            test: 'AC-1 ',
            workspace: 'server',
          },
        ],
        timeoutMs: 30_000,
      }),
    );
    const child = spawn(process.execPath, [script], { cwd: root });
    const exited = new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
    });
    for (let waited = 0; !existsSync(join(root, 'scratch/mutate-backup.json')); waited += 50) {
      assert.ok(waited < 10_000, '変異が当たりません');
      await setTimeout(50);
    }
    await setTimeout(500);
    child.kill('SIGTERM');
    assert.equal(await exited, 1);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const value = original;\n');
    assert.equal(existsSync(join(root, 'scratch/mutate-backup.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('例のスクリプトは、1 箇所に絞れない変異を当てずに飛ばす', () => {
  const root = makeWorkspace();
  try {
    writeFileSync(join(root, 'server/src/target.ts'), 'const a = original;\nconst b = original;\n');
    const result = runSample(root, {
      mutations: [
        {
          name: '2 箇所ある',
          file: 'server/src/target.ts',
          edits: [{ from: 'original', to: 'mutated' }],
          test: 'AC-1 ',
          workspace: 'server',
        },
      ],
      timeoutMs: 2_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /変異の対象が 2 箇所あります/);
    assert.equal(readFileSync(join(root, 'server/src/target.ts'), 'utf8'), 'const a = original;\nconst b = original;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
