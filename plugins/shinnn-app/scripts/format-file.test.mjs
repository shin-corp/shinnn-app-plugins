/**
 * scripts/format-file.mjs（保存時の hook）の回帰テスト。`node --test scripts/` で実行する。
 *
 * npm を偽物に差し替え、hook が呼んだコマンドを記録して確かめる。
 * - 画面（client）の .ts には、eslint --fix の後に prettier --write を掛ける
 * - server と shared の .ts には、prettier を掛けない（eslint --fix だけ）
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

/** アプリのリポジトリ（目印の .shinnn/setup.json と、中身の無い node_modules を持つ） */
let appRoot;

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
  appRoot = join(workRoot, 'app');
  writeFile(appRoot, '.shinnn/setup.json', '{}\n');
  writeFile(appRoot, 'node_modules/.keep', '');
  for (const path of ['client/src/a.ts', 'server/src/a.ts', 'shared/src/a.ts']) {
    writeFile(appRoot, path, 'export const a = 1;\n');
  }

  // 偽物の npm: 受け取った引数を 1 行にして記録し、成功で終わる
  binDir = join(workRoot, 'bin');
  writeFile(binDir, 'npm', '#!/bin/sh\necho "$*" >> "$FAKE_NPM_LOG"\n');
  chmodSync(join(binDir, 'npm'), 0o755);
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** 編集したファイルを渡して hook を実行し、偽物の npm が受け取ったコマンドの一覧を返す */
function runFormatFile(repoPath) {
  const log = join(workRoot, `npm-${repoPath.replaceAll('/', '-')}.log`);
  const script = fileURLToPath(new URL('./format-file.mjs', import.meta.url));
  const input = { tool_name: 'Edit', tool_input: { file_path: join(appRoot, repoPath) }, cwd: appRoot };
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: appRoot,
      FAKE_NPM_LOG: log,
      PATH: `${binDir}${delimiter}${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
}

test('format-file: 画面（client）の .ts には、eslint --fix の後に prettier を掛ける', () => {
  const calls = runFormatFile('client/src/a.ts');

  assert.equal(calls.length, 2, calls.join('\n'));
  assert.match(calls[0], /^exec -w client -- eslint --fix /);
  assert.match(calls[1], /^exec -- prettier --write .*client\/src\/a\.ts$/);
});

test('format-file: server と shared の .ts には prettier を掛けない', () => {
  for (const [workspace, path] of [
    ['server', 'server/src/a.ts'],
    ['shared', 'shared/src/a.ts'],
  ]) {
    const calls = runFormatFile(path);

    assert.equal(calls.length, 1, calls.join('\n'));
    assert.match(calls[0], new RegExp(`^exec -w ${workspace} -- eslint --fix `));
  }
});
