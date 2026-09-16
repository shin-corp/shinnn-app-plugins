/**
 * hooks がテンプレートから作ったアプリのリポジトリでだけ動くことの回帰テスト。`node --test scripts/` で実行する。
 *
 * 目印（.shinnn/setup.json）の無いディレクトリでは、アプリのリポジトリなら反応する入力を渡しても
 * 何も出力せずに通すことを確かめる。プラグインを user スコープで入れた人の他のリポジトリを邪魔しないため。
 * 依存を入れていないリポジトリ（npm install の前）でも、動かせない lint の結果を伝えないことを確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 目印の無いディレクトリ */
let plainRoot;

/** 目印はあるが依存を入れていないディレクトリ（テンプレートを取得した直後の状態） */
let appRoot;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** hook を実行し、終了コードと出力を返す */
function runHook(scriptName, input, root) {
  const script = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
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
  plainRoot = mkdtempSync(join(tmpdir(), 'hooks-app-only-'));
  writeFile(plainRoot, 'server/src/a.ts', 'export const a = 1;\n');

  appRoot = mkdtempSync(join(tmpdir(), 'hooks-no-deps-'));
  writeFile(appRoot, '.shinnn/setup.json', `${JSON.stringify({ setupCompletedAt: null })}\n`);
  writeFile(appRoot, 'server/src/a.ts', 'export const a = 1;\n');
});

after(() => {
  rmSync(plainRoot, { recursive: true, force: true });
  rmSync(appRoot, { recursive: true, force: true });
});

test('アプリのリポジトリ以外: format-file は eslint を掛けない', () => {
  const input = { tool_name: 'Edit', tool_input: { file_path: join(plainRoot, 'server', 'src', 'a.ts') } };
  assertDidNothing(runHook('format-file.mjs', input, plainRoot));
});

test('アプリのリポジトリ以外: check-on-stop は lint とテストを走らせない', () => {
  assertDidNothing(runHook('check-on-stop.mjs', {}, plainRoot));
});

test('アプリのリポジトリ以外: session-start は状況を出さない', () => {
  assertDidNothing(runHook('session-start.mjs', {}, plainRoot));
});

test('依存を入れていないリポジトリ: format-file は lint の結果を伝えない', () => {
  const input = { tool_name: 'Edit', tool_input: { file_path: join(appRoot, 'server', 'src', 'a.ts') } };
  assertDidNothing(runHook('format-file.mjs', input, appRoot));
});

test('依存を入れていないリポジトリ: check-on-stop は lint とテストの結果を伝えない', () => {
  assertDidNothing(runHook('check-on-stop.mjs', {}, appRoot));
});
