/**
 * session-start が示す標準の版の回帰テスト。`node --test scripts/` で実行する。
 *
 * 標準の版は `.claude/rules/.standards-version` の 1 か所だけに持つ。セッションの開始時に示す版が
 * このファイルだけから読まれ、`.shinnn/setup.json` の値は使われないことを確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./session-start.mjs', import.meta.url));

/** 標準の版を持つファイル（リポジトリルート起点） */
const STANDARDS_VERSION = '.claude/rules/.standards-version';

/** プラグインが配布している標準の版 */
const distributed = readFileSync(
  fileURLToPath(new URL(`../template/${STANDARDS_VERSION}`, import.meta.url)),
  'utf8',
).trim();

/** リポジトリに入っている標準の版として置く値。配布されている版とは違う値にする */
const INSTALLED = '0.0.1';

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** セットアップを終えたリポジトリを作る */
function createRepo(setup) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  const completed = { setupCompletedAt: '2026-01-01T00:00:00.000Z', profile: 'full', mergePolicy: 'human' };
  writeFile(root, '.shinnn/setup.json', `${JSON.stringify({ ...completed, ...setup })}\n`);
  return root;
}

/** session-start を実行し、終了コードと出力を返す */
function runHook(root) {
  const result = spawnSync(process.execPath, [script], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'session-start-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('標準の版: .claude/rules/.standards-version の版を示し、配布されている版と比べる', () => {
  assert.notEqual(distributed, INSTALLED);
  const root = createRepo({});
  writeFile(root, STANDARDS_VERSION, `${INSTALLED}\n`);
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`標準バージョン: ${INSTALLED}`), result.stdout);
  assert.ok(
    result.stdout.includes(`リポジトリの標準: ${INSTALLED} / 配布されている標準: ${distributed}`),
    result.stdout,
  );
});

test('標準の版: .claude/rules/.standards-version が無ければ、setup.json に版があっても使わず「不明」と示す', () => {
  const root = createRepo({ standardsVersion: INSTALLED });
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('標準バージョン: 不明'), result.stdout);
  assert.ok(result.stdout.includes(`リポジトリの標準: 不明 / 配布されている標準: ${distributed}`), result.stdout);
});
