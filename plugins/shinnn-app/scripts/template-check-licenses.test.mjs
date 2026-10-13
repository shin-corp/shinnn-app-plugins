/**
 * テンプレートの scripts/check-licenses.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * テンプレートは顧客に配るものなので、テストはテンプレートに入れずにここに置く。
 * 一時フォルダをアプリのリポジトリに見立て、スクリプト・ルートの package.json・node_modules のパッケージを置いて実行し、
 * 次を確かめる。
 * - ルートと workspaces の各フォルダの node_modules のパッケージが、どれも許可リストのライセンスなら、終了コード 0 で終える
 * - workspaces のフォルダの node_modules（client/node_modules など）に許可リストの外のパッケージがあれば、
 *   終了コード 1 で終え、そのパッケージを示す
 * - ルートの node_modules に許可リストの外のパッケージがあれば、終了コード 1 で終える
 * - license の記載が無いパッケージは通さない
 * - node_modules が無ければ、終了コード 1 で終える
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるスクリプト（リポジトリルート起点） */
const SCRIPT = 'scripts/check-licenses.mjs';

/** テンプレートと同じ workspaces */
const WORKSPACES = ['shared', 'server', 'client'];

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'check-licenses-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * 一時フォルダをアプリのリポジトリに見立て、スクリプト・ルートの package.json・パッケージを置いて実行する。
 *
 * @param packages パッケージのフォルダ（リポジトリルート起点。例 `client/node_modules/foo`）→ package.json の中身
 * @param options.withNodeModules ルートの node_modules を作るか
 * @returns 終了コードと出力
 */
function runCheck(packages, { withNodeModules = true } = {}) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  const script = join(root, SCRIPT);

  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(templateDir, SCRIPT), script);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, workspaces: WORKSPACES }));
  if (withNodeModules) {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
  }
  for (const [path, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'package.json'), JSON.stringify(manifest));
  }

  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('ルートと workspaces の各フォルダの node_modules が許可リストのライセンスだけなら、終了コード 0 で終える', () => {
  const result = runCheck({
    'node_modules/root-lib': { name: 'root-lib', license: 'MIT' },
    'client/node_modules/client-lib': { name: 'client-lib', license: 'MPL-2.0' },
    'client/node_modules/@scope/scoped-lib': { name: '@scope/scoped-lib', license: '(MIT OR Apache-2.0)' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 パッケージ/);
});

test('client/node_modules に許可リストの外のパッケージがあれば、終了コード 1 で終え、そのパッケージを示す', () => {
  const result = runCheck({
    'node_modules/root-lib': { name: 'root-lib', license: 'MIT' },
    'client/node_modules/paid-lib': { name: 'paid-lib', license: 'UNLICENSED' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /client\/node_modules\/paid-lib: UNLICENSED/);
});

test('server の入れ子の node_modules に許可リストの外のパッケージがあっても、終了コード 1 で終える', () => {
  const result = runCheck({
    'server/node_modules/server-lib': { name: 'server-lib', license: 'MIT' },
    'server/node_modules/server-lib/node_modules/paid-lib': { name: 'paid-lib', license: 'SEE LICENSE IN LICENSE.txt' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/node_modules\/server-lib\/node_modules\/paid-lib/);
});

test('ルートの node_modules に許可リストの外のパッケージがあれば、終了コード 1 で終える', () => {
  const result = runCheck({
    'node_modules/paid-lib': { name: 'paid-lib', license: 'UNLICENSED' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules\/paid-lib: UNLICENSED/);
});

test('license の記載が無いパッケージは通さない', () => {
  const result = runCheck({
    'client/node_modules/no-license-lib': { name: 'no-license-lib' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /client\/node_modules\/no-license-lib: license の記載なし/);
});

test('ルートの node_modules が無ければ、終了コード 1 で終える', () => {
  const result = runCheck({}, { withNodeModules: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules がありません/);
});
