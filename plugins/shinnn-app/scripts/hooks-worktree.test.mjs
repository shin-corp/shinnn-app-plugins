/**
 * worktree（同じリポジトリを別のフォルダに取り出したもの）の中の変更を、その worktree で検査することの回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * CLAUDE_PROJECT_DIR はセッションを始めた元のフォルダを指したまま、変更は worktree の中にある状態を作る。
 * 元のフォルダには検査する変更が無いので、元のフォルダを見てしまうと何も出力されない。
 * node_modules は中身の無いダミーなので、lint とテストを走らせると npm が失敗して出力が出る。これで差が付く。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** セッションを始めた元のフォルダ */
let mainRoot;

/** 元のフォルダの `.claude/worktrees/` に作った worktree */
let worktreeRoot;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** git を実行する。コミットに要る名前とメールアドレスは、手元の設定に頼らずその場で渡す */
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

/** hook を実行し、終了コードと出力を返す */
function runHook(scriptName, input) {
  const script = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: mainRoot },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  mainRoot = mkdtempSync(join(tmpdir(), 'hooks-worktree-'));
  writeFile(mainRoot, '.shinnn/setup.json', `${JSON.stringify({ setupCompletedAt: null })}\n`);
  writeFile(mainRoot, '.gitignore', 'node_modules/\n.claude/worktrees/\n');
  writeFile(mainRoot, 'node_modules/.keep', '');
  git(mainRoot, ['init', '-q']);
  git(mainRoot, ['add', '-A']);
  git(mainRoot, ['commit', '-q', '-m', 'init']);

  worktreeRoot = join(mainRoot, '.claude', 'worktrees', 'wt');
  git(mainRoot, ['worktree', 'add', '-q', '--detach', worktreeRoot]);
  writeFile(worktreeRoot, 'node_modules/.keep', '');
  writeFile(worktreeRoot, 'server/src/a.ts', 'export const a = 1;\n');
});

after(() => {
  rmSync(mainRoot, { recursive: true, force: true });
});

test('worktree の中のファイルの編集: format-file はその worktree で eslint を掛ける', () => {
  const input = { tool_name: 'Edit', tool_input: { file_path: join(worktreeRoot, 'server', 'src', 'a.ts') } };
  const result = runHook('format-file.mjs', input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\] server\/src\/a\.ts に eslint --fix/);
});

test('worktree に入って作業した応答の終わり: check-on-stop はその worktree の変更を検査する', () => {
  const result = runHook('check-on-stop.mjs', { cwd: worktreeRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[server\] lint/);
});

test('worktree の下のフォルダに移って作業した応答の終わり: check-on-stop はその worktree の変更を検査する', () => {
  const result = runHook('check-on-stop.mjs', { cwd: join(worktreeRoot, 'server') });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[server\] lint/);
});
