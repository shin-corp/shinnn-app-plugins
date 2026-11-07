/**
 * テンプレートの .husky/pre-commit（lint-staged）の回帰テスト。`node --test scripts/` で実行する。
 *
 * 一時フォルダに手元のリポジトリを作り、husky と同じ呼び方（`sh -e <フック>`）で pre-commit を動かして、
 * 本物の git commit の結果を確かめる。
 * - ステージしていないファイルの変更は、日本語の多い大きな差分でもコミットに入らず、作業ツリーに残る
 * - 一部だけステージしたファイルは、ステージした分を整形してコミットし、残りを作業ツリーに残す
 * - タスクが失敗したら、コミットせず、ステージした変更もステージしていない変更も元のまま残る
 * lint-staged と prettier は、テンプレートの node_modules のものを使う。
 * テンプレートの依存が入っていないとき（このリポジトリの CI のプラグインのジョブ）は飛ばす。CI ではテンプレートのジョブで動かす。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるフック */
const preCommit = join(templateDir, '.husky', 'pre-commit');

/** テンプレートの依存。lint-staged と prettier をここから使う */
const templateModules = join(templateDir, 'node_modules');

/** テンプレートの依存が入っていなければ、飛ばす理由 */
const skip = existsSync(join(templateModules, 'lint-staged', 'package.json'))
  ? false
  : 'テンプレートの依存が入っていない（template で npm ci を実行すると動く）';

/** 手元のリポジトリに写す、整形の設定 */
const configFiles = ['.lintstagedrc.json', '.prettierrc.json', '.prettierignore', '.gitattributes'];

/** ステージしない、日本語の多いファイル */
const specPath = 'docs/仕様書.md';

/** ステージする（整形の掛かる）ファイル */
const guidePath = 'client/CLAUDE.md';

/** ステージするファイルの、最初のコミットの中身 */
const guideInitial = '# 画面\n\n- 一覧\n';

/** ステージするファイルの変えた中身。整形で「*詳細*」が「_詳細_」に変わる */
const guideStaged = `${guideInitial}\n*詳細*\n`;

/** `guideStaged` を整形した後の中身 */
const guideFormatted = `${guideInitial}\n_詳細_\n`;

/** 仕様書の受入条件の行数。git の出力が何度も区切られて届く大きさにする */
const specRows = 2000;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pre-commit-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** git を実行し、終了コードと出力を返す。利用者の設定（署名・フックの置き場所・ファイル名の書き方）に左右されないようにする */
function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(workRoot, 'gitconfig') },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 仕様書の中身。受入条件の表を、日本語の行で `specRows` 行作る */
function specContent(label) {
  const lines = ['# 仕様書', '', '| 識別子 | 受入条件 |', '| :-- | :-- |'];
  for (let n = 1; n <= specRows; n++) {
    lines.push(`| AC-${n} | ${label}の${n}番目です。一覧を出し、絞り込みと並べ替えができ、失敗したら理由を出す。 |`);
  }
  return `${lines.join('\n')}\n`;
}

/** 手元のリポジトリを作り、最初のコミットの後に husky と同じ呼び方でフックを入れる */
function setupRepo() {
  const root = mkdtempSync(join(workRoot, 'case-'));
  const local = join(root, 'local');
  assert.equal(git(root, 'init', '--initial-branch=main', local).status, 0);
  assert.equal(git(local, 'config', 'user.name', 'test').status, 0);
  assert.equal(git(local, 'config', 'user.email', 'test@example.com').status, 0);
  assert.equal(git(local, 'config', 'commit.gpgsign', 'false').status, 0);
  for (const file of configFiles) {
    copyFileSync(join(templateDir, file), join(local, file));
  }
  // 末尾に / を付けない。付けると、リンクにした node_modules が無視されない（git はリンクをディレクトリとみなさない）
  writeFileSync(join(local, '.gitignore'), 'node_modules\n');
  writeFileSync(join(local, 'package.json'), '{ "private": true }\n');
  // Windows でも管理者の権限なしに作れるよう、ジャンクションにする（ほかの OS では種類の指定は無視される）
  symlinkSync(templateModules, join(local, 'node_modules'), 'junction');
  mkdirSync(join(local, 'docs'));
  mkdirSync(join(local, 'client'));
  writeFileSync(join(local, specPath), specContent('受入条件'));
  writeFileSync(join(local, guidePath), guideInitial);
  assert.equal(git(local, 'add', '.').status, 0);
  assert.equal(git(local, 'commit', '-m', 'テンプレートの取り込み').status, 0);
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  writeFileSync(join(hooksDir, 'pre-commit'), `#!/bin/sh\nsh -e "${preCommit}" "$@"\n`, { mode: 0o755 });
  assert.equal(git(local, 'config', 'core.hooksPath', hooksDir).status, 0);
  return local;
}

/** 直前のコミットに入ったファイルの一覧 */
function committedFiles(local) {
  const result = git(local, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

/** ステージしていない変更のあるファイルの一覧 */
function unstagedFiles(local) {
  const result = git(local, 'diff', '--name-only');
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

/** 直前のコミットのファイルの中身 */
function committedContent(local, path) {
  const result = git(local, 'show', `HEAD:${path}`);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('ステージしていない日本語の多いファイルの変更は、コミットに入らず、作業ツリーに残る', { skip }, () => {
  const local = setupRepo();
  const changedSpec = specContent('変えた受入条件');
  writeFileSync(join(local, specPath), changedSpec);
  // 整形の掛かるファイルをステージする。タスクの後の差分には、仕様書の前に、整形で変わった差分が並ぶ
  writeFileSync(join(local, guidePath), guideStaged);
  assert.equal(git(local, 'add', guidePath).status, 0);

  const result = git(local, 'commit', '-m', '[client]画面の説明の追加');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(committedFiles(local), [guidePath]);
  assert.equal(committedContent(local, guidePath), guideFormatted);
  assert.deepEqual(unstagedFiles(local), [specPath]);
  assert.equal(readFileSync(join(local, specPath), 'utf8'), changedSpec);
});

test('一部だけステージしたファイルは、ステージした分を整形してコミットし、残りを作業ツリーに残す', { skip }, () => {
  const local = setupRepo();
  writeFileSync(join(local, guidePath), guideStaged);
  assert.equal(git(local, 'add', guidePath).status, 0);
  writeFileSync(join(local, guidePath), guideStaged.replace('# 画面', '# 画面の説明'));

  const result = git(local, 'commit', '-m', '[client]画面の説明の追加');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(committedFiles(local), [guidePath]);
  assert.equal(committedContent(local, guidePath), guideFormatted);
  assert.equal(readFileSync(join(local, guidePath), 'utf8'), guideFormatted.replace('# 画面', '# 画面の説明'));
});

test('タスクが失敗したら、コミットせず、ステージした変更もステージしていない変更も元のまま残る', { skip }, () => {
  const local = setupRepo();
  const head = git(local, 'rev-parse', 'HEAD').stdout;
  const changedSpec = specContent('変えた受入条件');
  writeFileSync(join(local, specPath), changedSpec);
  writeFileSync(join(local, guidePath), guideStaged);
  // 壊れた JSON は prettier が整形できずに失敗する
  writeFileSync(join(local, 'broken.json'), '{\n');
  assert.equal(git(local, 'add', guidePath, 'broken.json').status, 0);

  const result = git(local, 'commit', '-m', '[client]画面の説明の追加');

  assert.notEqual(result.status, 0);
  assert.equal(git(local, 'rev-parse', 'HEAD').stdout, head);
  const staged = git(local, 'diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean);
  assert.deepEqual(staged, ['broken.json', guidePath]);
  assert.equal(git(local, 'show', `:${guidePath}`).stdout, guideStaged);
  assert.deepEqual(unstagedFiles(local), [specPath]);
  assert.equal(readFileSync(join(local, specPath), 'utf8'), changedSpec);
});
