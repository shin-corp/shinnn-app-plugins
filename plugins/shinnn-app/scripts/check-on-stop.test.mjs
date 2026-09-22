/**
 * check-on-stop が lint と関連テストを走らせる条件の回帰テスト。`node --test scripts/` で実行する。
 *
 * git add していない新しいフォルダの中のファイルの変更は、結果を伝える対象にすることを確かめる。
 * 除外する名前のファイル（*.bench.test.ts / *.tmp.test.ts）だけが変更されているとき、
 * SHINNN_SKIP_STOP_CHECK が指定されているとき、指摘を受けて続けた応答の終わり（stop_hook_active が true）には、
 * 何も出力せずに通すことを確かめる。
 * node_modules は中身の無いダミーなので、lint とテストを走らせると npm が失敗して出力が出る。これで差が付く。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 変更が除外する名前のファイルだけのリポジトリ */
let excludedOnlyRoot;

/** 変更が通常のソースファイルのリポジトリ */
let normalRoot;

/** 変更が git add していない新しいフォルダの中の通常のソースファイルのリポジトリ */
let newFolderRoot;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * hook が動く条件（目印と node_modules）を満たすリポジトリを作り、渡したファイルを変更として見せる。
 *
 * 既定ではファイルを git add せず、未追跡のまま置く（新しいフォルダを作った直後の状態）。
 * staged を指定すると index に載せる。未追跡のファイルの拾い方に左右されずにファイル単位で並ぶので、
 * 検査しない条件のテストはこちらを使い、ファイルを拾えなかったせいで通ってしまうのを避ける。
 */
function createRepo(prefix, files, { staged = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFile(root, '.shinnn/setup.json', `${JSON.stringify({ setupCompletedAt: null })}\n`);
  writeFile(root, 'node_modules/.keep', '');
  for (const repoPath of files) {
    writeFile(root, repoPath, 'export const value = 1;\n');
  }
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  if (staged) {
    spawnSync('git', ['add', '-f', '--', ...files], { cwd: root, encoding: 'utf8' });
  }
  return root;
}

/** check-on-stop に hook の入力 JSON を渡して実行し、終了コードと出力を返す */
function runHook(root, input = {}, env = {}) {
  const script = fileURLToPath(new URL('./check-on-stop.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 何もしなかったこと。通したうえで、コンテキストも知らせも出していない */
function assertDidNothing(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

before(() => {
  excludedOnlyRoot = createRepo('check-on-stop-excluded-', ['server/src/a.bench.test.ts', 'server/src/a.tmp.test.ts'], {
    staged: true,
  });
  normalRoot = createRepo('check-on-stop-normal-', ['server/src/a.ts'], { staged: true });
  newFolderRoot = createRepo('check-on-stop-new-folder-', ['server/src/api/new-feature/index.ts']);
});

after(() => {
  rmSync(excludedOnlyRoot, { recursive: true, force: true });
  rmSync(normalRoot, { recursive: true, force: true });
  rmSync(newFolderRoot, { recursive: true, force: true });
});

test('git add していない新しいフォルダの中のファイルの変更: lint とテストの結果を伝える', () => {
  const result = runHook(newFolderRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[server\] lint/);
  assert.match(result.stdout, /\[server\] test/);
});

test('除外する名前のファイルだけの変更: lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook(excludedOnlyRoot));
});

test('SHINNN_SKIP_STOP_CHECK の指定: lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook(normalRoot, {}, { SHINNN_SKIP_STOP_CHECK: '1' }));
});

test('指摘を受けて続けた応答の終わり（stop_hook_active が true）: lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook(normalRoot, { stop_hook_active: true }));
});
