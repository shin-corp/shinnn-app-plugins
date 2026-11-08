/**
 * テンプレートの .husky/commit-msg と scripts/check-commit-message.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * 一時フォルダに手元のリポジトリを作り、husky と同じ呼び方（`sh -e <フック>`）で commit-msg を動かして、
 * 本物の git commit の結果を確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるフック */
const commitMsg = join(templateDir, '.husky', 'commit-msg');

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'commit-msg-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** git を実行し、終了コードと出力を返す。利用者の設定（署名・フックの置き場所）に左右されないようにする */
function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: join(workRoot, 'gitconfig') } },
  );
  return { status: result.status, stderr: result.stderr };
}

/** 手元のリポジトリを作り、husky と同じ呼び方でフックを入れる。コミットはまだ無い */
function setupEmptyRepo() {
  const root = mkdtempSync(join(workRoot, 'case-'));
  const local = join(root, 'local');
  assert.equal(git(root, 'init', '--initial-branch=main', local).status, 0);
  mkdirSync(join(local, 'scripts'));
  copyFileSync(
    join(templateDir, 'scripts', 'check-commit-message.mjs'),
    join(local, 'scripts', 'check-commit-message.mjs'),
  );
  mkdirSync(join(local, 'deploy'));
  writeFileSync(join(local, 'deploy', 'run.sh'), 'echo run\n');
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  writeFileSync(join(hooksDir, 'commit-msg'), `#!/bin/sh\nsh -e "${commitMsg}" "$@"\n`, { mode: 0o755 });
  assert.equal(git(local, 'config', 'core.hooksPath', hooksDir).status, 0);
  return local;
}

/** 最初のコミットまで済ませたリポジトリを作る */
function setupRepo() {
  const local = setupEmptyRepo();
  assert.equal(git(local, 'add', '.').status, 0);
  assert.equal(git(local, 'commit', '-m', 'テンプレートの取り込み').status, 0);
  return local;
}

/** ファイルを 1 つ変えて、渡したメッセージでコミットする */
function commitWith(local, message) {
  const path = join(local, 'change.txt');
  writeFileSync(path, `${message}\n`);
  assert.equal(git(local, 'add', '.').status, 0);
  const file = join(local, '..', 'message.txt');
  writeFileSync(file, message);
  return git(local, 'commit', '-F', file);
}

test('リポジトリの最初のコミットは、接頭辞が無くても通す', () => {
  const local = setupEmptyRepo();
  assert.equal(git(local, 'add', '.').status, 0);
  const result = git(local, 'commit', '-m', 'テンプレートの取り込み');
  assert.equal(result.status, 0, result.stderr);
});

/** GitHub の作成画面で付けられる 3 つ */
const REPOSITORY_FILES = { 'README.md': '# app\n', LICENSE: 'MIT License\n', '.gitignore': '.env\n' };

/** 渡したファイルだけを書いて、最初のコミットにする（作業ツリーのほかのファイルは入れない） */
function commitOnly(local, files, message) {
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(local, path), content);
  }
  assert.equal(git(local, 'add', '--', ...Object.keys(files)).status, 0);
  assert.equal(git(local, 'commit', '-m', message).status, 0);
}

test('GitHub の作成画面で付けたファイルだけのコミットの上では、テンプレートを取り込むコミットを接頭辞が無くても通す', () => {
  const local = setupEmptyRepo();
  commitOnly(local, REPOSITORY_FILES, 'Initial commit');

  assert.equal(git(local, 'add', '.').status, 0);
  const result = git(local, 'commit', '-m', 'テンプレートの取り込み');
  assert.equal(result.status, 0, result.stderr);

  // 取り込んだ後のコミットは見る
  const after = commitWith(local, 'テンプレートの更新');
  assert.notEqual(after.status, 0);
  assert.match(after.stderr, /1 行目が `\[<対象>\]<要約>` の形ではありません/);
});

test('作成画面のファイルのほかにもファイルがあるコミットの上では、テンプレートの目印が無くても見る', () => {
  const local = setupEmptyRepo();
  commitOnly(local, { 'README.md': '# app\n', 'package.json': '{}\n' }, 'Initial commit');

  const result = commitWith(local, 'テンプレートの取り込み');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1 行目が `\[<対象>\]<要約>` の形ではありません/);
});

test('テンプレートの目印を消したリポジトリでも、見るのをやめない', () => {
  const local = setupRepo();
  mkdirSync(join(local, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(local, '.claude', 'rules', '.standards-version'), '0.0.0\n');
  assert.equal(commitWith(local, '[docs]標準の版の追加').status, 0);
  assert.equal(git(local, 'rm', '-q', '.claude/rules/.standards-version').status, 0);
  assert.equal(git(local, 'commit', '-m', '[docs]標準の版の削除').status, 0);

  const result = commitWith(local, '在庫の一覧の追加');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1 行目が `\[<対象>\]<要約>` の形ではありません/);
});

for (const message of [
  '[client]在庫の一覧の追加',
  '[server]AC-2 在庫チェックの追加\n\n- 出庫の前の在庫の確認の追加\n- 判定を service に置いた理由の記載\n',
  '[shared]在庫の API 定義の追加',
  '[docs]仕様書の見た目の方針の更新',
  '[ci]配置のワークフローの修正',
  '[deps]zod の更新',
  '[deploy]起動スクリプトの修正',
  "Merge branch 'main' into feature/1-x",
  'Revert "[client]在庫の一覧の追加"',
  '[client]在庫の一覧の追加\n\nCo-Authored-By: Taro Yamada <taro@example.com>\n',
  `[client]${'在'.repeat(39)}の追加`,
]) {
  test(`通す: ${message.split('\n').filter(Boolean).join(' / ')}`, () => {
    const result = commitWith(setupRepo(), message);
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const [name, message, expected] of [
  ['対象が無い', '在庫の一覧の追加', /`\[<対象>\]<要約>` の形ではありません/],
  ['対象のつづりの誤り', '[clinet]在庫の一覧の追加', /`clinet` は使えません/],
  ['対象が種類の名前', '[修正]在庫の一覧の修正', /`修正` は使えません/],
  ['括弧の後ろが空白', '[client] 在庫の一覧の追加', /`\[<対象>\]<要約>` の形ではありません/],
  ['50 文字を超える', `[client]${'在庫'.repeat(22)}の追加`, /1 行目が 55 文字あります/],
  ['51 文字', `[client]${'在'.repeat(40)}の追加`, /1 行目が 51 文字あります/],
  ['語尾が「です」', '[docs]仕様書の更新です', /体言止めではありません/],
  ['語尾が「した」', '[client]在庫の一覧を追加した', /体言止めではありません/],
  ['語尾が「する」', '[client]在庫の一覧を追加する', /体言止めではありません/],
  ['語尾が「ます」', '[client]在庫の一覧を追加します', /体言止めではありません/],
  ['帰属行', '[client]在庫の一覧の追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', /AI の帰属行/],
  [
    '生成の帰属行',
    '[client]在庫の一覧の追加\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n',
    /AI の帰属行/,
  ],
  ['Test plan の節', '[client]在庫の一覧の追加\n\n## Test plan\n- 動かした\n', /`Test plan` の節/],
]) {
  test(`止める: ${name}`, () => {
    const local = setupRepo();
    const result = commitWith(local, message);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.match(result.stderr, /規約: \.claude\/rules\/git-workflow\.md/);
    assert.equal(git(local, 'diff', '--cached', '--quiet').status, 1, 'コミットされずに、変更がステージに残る');
  });
}

test('複数の問題は、まとめて示す', () => {
  const result = commitWith(setupRepo(), `[common]${'在庫'.repeat(22)}を追加した`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /`common` は使えません/);
  assert.match(result.stderr, /文字あります/);
  assert.match(result.stderr, /体言止めではありません/);
});

test('`git commit -v` で切り取り線より後ろに入る差分は見ない', () => {
  const local = setupRepo();
  writeFileSync(
    join(local, 'change.txt'),
    'Generated with Claude Code\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
  );
  assert.equal(git(local, 'add', '.').status, 0);
  const file = join(local, '..', 'message.txt');
  writeFileSync(file, '[client]在庫の一覧の追加\n');
  const result = git(local, '-c', 'core.editor=true', 'commit', '-v', '-e', '-F', file);
  assert.equal(result.status, 0, result.stderr);
});
