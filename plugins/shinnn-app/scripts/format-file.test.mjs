/**
 * scripts/format-file.mjs（保存時の hook）の回帰テスト。`node --test scripts/` で実行する。
 *
 * npm を偽物に差し替え、hook が呼んだコマンドを記録して確かめる。
 * - 画面（client）の .ts には、eslint --fix の後に prettier --write を掛ける
 * - server と shared の .ts、client の .ts 以外には、prettier を掛けない（eslint --fix だけ）
 * - リポジトリのコミット時の設定（.lintstagedrc.json）が client の .ts に prettier を掛けていなければ、掛けない
 *   （標準を取り込む前のリポジトリで、触ったファイル全体の書式の差分が出ないように）
 * - eslint の指摘が残り、prettier で書式が変わったときは、eslint を掛け直して整形後の行番号で返す
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** 偽物の npm を置くフォルダ */
let binDir;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'format-file-'));

  // 偽物の npm: 受け取った引数を 1 行にして記録する。
  // prettier は FAKE_PRETTIER_CHANGES があれば最後の引数のファイルに 1 行足し（書式が変わったことにする）、
  // eslint は FAKE_ESLINT_STATUS の終了コードで終わる
  binDir = join(workRoot, 'bin');
  writeFile(
    binDir,
    'npm',
    [
      '#!/bin/sh',
      'echo "$*" >> "$FAKE_NPM_LOG"',
      'for last in "$@"; do :; done',
      'case "$*" in',
      '  *prettier*) if [ -n "$FAKE_PRETTIER_CHANGES" ]; then echo "// formatted" >> "$last"; fi; exit 0 ;;',
      '  *eslint*) echo "fake eslint: $*"; exit "${FAKE_ESLINT_STATUS:-0}" ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(binDir, 'npm'), 0o755);
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * アプリのリポジトリ（目印の .shinnn/setup.json と、中身の無い node_modules を持つ）を作る。
 * `clientPrettier` が true なら、コミット時の設定で client の .ts に prettier を掛ける（テンプレートと同じ形）
 */
function makeApp({ clientPrettier = true } = {}) {
  const root = mkdtempSync(join(workRoot, 'app-'));
  writeFile(root, '.shinnn/setup.json', '{}\n');
  writeFile(root, 'node_modules/.keep', '');
  const clientCommands = clientPrettier
    ? ['npm exec -w client -- eslint --fix', 'prettier --write']
    : 'npm exec -w client -- eslint --fix';
  writeFile(root, '.lintstagedrc.json', `${JSON.stringify({ 'client/**/*.ts': clientCommands })}\n`);
  for (const path of ['client/src/a.ts', 'client/eslint.config.js', 'server/src/a.ts', 'shared/src/a.ts']) {
    writeFile(root, path, 'export const a = 1;\n');
  }
  return root;
}

/** 編集したファイルを渡して hook を実行し、出力と、偽物の npm が受け取ったコマンドの一覧を返す */
function runFormatFile(root, repoPath, env = {}) {
  const log = join(root, 'npm.log');
  rmSync(log, { force: true });
  const script = fileURLToPath(new URL('./format-file.mjs', import.meta.url));
  const input = { tool_name: 'Edit', tool_input: { file_path: join(root, repoPath) }, cwd: root };
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      FAKE_NPM_LOG: log,
      PATH: `${binDir}${delimiter}${process.env.PATH}`,
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { stdout: result.stdout, calls };
}

test('format-file: 画面（client）の .ts には、eslint --fix の後に prettier を掛ける', () => {
  const { calls } = runFormatFile(makeApp(), 'client/src/a.ts');

  assert.equal(calls.length, 2, calls.join('\n'));
  assert.match(calls[0], /^exec -w client -- eslint --format stylish --fix /);
  assert.match(calls[1], /^exec -- prettier --write .*client\/src\/a\.ts$/);
});

test('format-file: server と shared の .ts、client の .ts 以外には prettier を掛けない', () => {
  const root = makeApp();
  for (const [workspace, path] of [
    ['server', 'server/src/a.ts'],
    ['shared', 'shared/src/a.ts'],
    ['client', 'client/eslint.config.js'],
  ]) {
    const { calls } = runFormatFile(root, path);

    assert.equal(calls.length, 1, `${path}: ${calls.join('\n')}`);
    assert.match(calls[0], new RegExp(`^exec -w ${workspace} -- eslint --format stylish --fix `));
  }
});

test('format-file: コミット時の設定が client の .ts に prettier を掛けていなければ、prettier を掛けない', () => {
  const { calls } = runFormatFile(makeApp({ clientPrettier: false }), 'client/src/a.ts');

  assert.equal(calls.length, 1, calls.join('\n'));
  assert.match(calls[0], /eslint --format stylish --fix /);
});

test('format-file: 指摘が残り、prettier で書式が変わったら、eslint を掛け直して整形後の結果を返す', () => {
  const { calls, stdout } = runFormatFile(makeApp(), 'client/src/a.ts', {
    FAKE_ESLINT_STATUS: '1',
    FAKE_PRETTIER_CHANGES: '1',
  });

  assert.equal(calls.length, 3, calls.join('\n'));
  assert.match(calls[1], /prettier --write/);
  assert.match(calls[2], /^exec -w client -- eslint --format stylish \/.*client\/src\/a\.ts$/);
  // 返すのは掛け直した（--fix の無い）eslint の出力
  assert.match(stdout, /fake eslint: exec -w client -- eslint --format stylish \//);
  assert.doesNotMatch(stdout, /eslint --format stylish --fix/);
});

test('format-file: 指摘が残っても、prettier で書式が変わらなければ掛け直さない', () => {
  const { calls, stdout } = runFormatFile(makeApp(), 'client/src/a.ts', { FAKE_ESLINT_STATUS: '1' });

  assert.equal(calls.length, 2, calls.join('\n'));
  assert.match(stdout, /eslint の指摘が残っています/);
});
