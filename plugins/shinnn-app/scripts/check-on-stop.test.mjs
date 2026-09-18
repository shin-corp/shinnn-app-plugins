/**
 * check-on-stop が lint と関連テストを走らせない条件の回帰テスト。`node --test scripts/` で実行する。
 *
 * 除外する名前のファイル（*.bench.test.ts / *.tmp.test.ts）だけが変更されているときと、
 * SHINNN_SKIP_STOP_CHECK が指定されているときに、何も出力せずに通すことを確かめる。
 * どちらの判定も外れると、走らせた npm が失敗して出力が出るので差が付く。
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

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * hook が動く条件（目印と node_modules）を満たすリポジトリを作り、渡したファイルを変更として見せる。
 *
 * git status --porcelain は未追跡のディレクトリを 1 行にまとめるため、そのままでは個々のファイルが出ない。
 * index に載せると追加としてファイル単位で並ぶ。コミットは要らない。
 */
function createRepo(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFile(root, '.shinnn/setup.json', `${JSON.stringify({ setupCompletedAt: null })}\n`);
  writeFile(root, 'node_modules/.keep', '');
  for (const repoPath of files) {
    writeFile(root, repoPath, 'export const value = 1;\n');
  }
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['add', '-A', '-f'], { cwd: root, encoding: 'utf8' });
  return root;
}

/** check-on-stop を実行し、終了コードと出力を返す */
function runHook(root, env = {}) {
  const script = fileURLToPath(new URL('./check-on-stop.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: '{}',
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
  excludedOnlyRoot = createRepo('check-on-stop-excluded-', ['server/src/a.bench.test.ts', 'server/src/a.tmp.test.ts']);
  normalRoot = createRepo('check-on-stop-normal-', ['server/src/a.ts']);
});

after(() => {
  rmSync(excludedOnlyRoot, { recursive: true, force: true });
  rmSync(normalRoot, { recursive: true, force: true });
});

test('除外する名前のファイルだけの変更: lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook(excludedOnlyRoot));
});

test('SHINNN_SKIP_STOP_CHECK の指定: lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook(normalRoot, { SHINNN_SKIP_STOP_CHECK: '1' }));
});
