/**
 * hooks がテンプレートから作ったリポジトリでだけ動くことの回帰テスト。`node --test scripts/` で実行する。
 * 目印（.claude/rules/.standards-version）の無いディレクトリでは、テンプレートの中なら止まる入力を渡しても
 * 何も出力せずに通すことを確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** テンプレートから作ったリポジトリには必ず入っているファイル */
const MARKER = '.claude/rules/.standards-version';

/** hook が操作を止めたときの終了コード */
const BLOCKED = 2;

/** 目印の無いディレクトリ（テンプレート以外のリポジトリ・テンプレートを取得する前のフォルダ） */
let plainRoot;

/** 目印のあるディレクトリ（テンプレートから作ったリポジトリ） */
let templateRoot;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** hook を実行し、終了コードと出力を返す */
function runHook(scriptName, input, projectRoot) {
  const script = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 何もしなかったこと。通したうえで、ブロックの理由もコンテキストも出していない */
function assertDidNothing(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

before(() => {
  plainRoot = mkdtempSync(join(tmpdir(), 'template-only-plain-'));
  writeFile(plainRoot, 'server/src/a.ts', 'export const a = 1;\n');

  templateRoot = mkdtempSync(join(tmpdir(), 'template-only-template-'));
  writeFile(templateRoot, MARKER, '0.0.0\n');
});

after(() => {
  rmSync(plainRoot, { recursive: true, force: true });
  rmSync(templateRoot, { recursive: true, force: true });
});

test('テンプレート以外: guard-edit は .env への Write を止めない', () => {
  const input = { tool_name: 'Write', tool_input: { file_path: join(plainRoot, '.env'), content: 'KEY=1\n' } };
  assertDidNothing(runHook('guard-edit.mjs', input, plainRoot));
});

test('テンプレート以外: guard-bash は cat .env を止めない', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'cat .env' } };
  assertDidNothing(runHook('guard-bash.mjs', input, plainRoot));
});

test('テンプレート以外: format-file は eslint を掛けない', () => {
  const input = { tool_name: 'Edit', tool_input: { file_path: join(plainRoot, 'server', 'src', 'a.ts') } };
  assertDidNothing(runHook('format-file.mjs', input, plainRoot));
});

test('テンプレート以外: check-on-stop は lint とテストを走らせない', () => {
  assertDidNothing(runHook('check-on-stop.mjs', {}, plainRoot));
});

test('テンプレート以外: session-start は状況を出さない', () => {
  assertDidNothing(runHook('session-start.mjs', {}, plainRoot));
});

test('テンプレートの中: guard-edit は .env への Write を止める', () => {
  const input = { tool_name: 'Write', tool_input: { file_path: join(templateRoot, '.env'), content: 'KEY=1\n' } };
  assert.equal(runHook('guard-edit.mjs', input, templateRoot).status, BLOCKED);
});

test('テンプレートの中: guard-bash は cat .env を止める', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'cat .env' } };
  assert.equal(runHook('guard-bash.mjs', input, templateRoot).status, BLOCKED);
});
