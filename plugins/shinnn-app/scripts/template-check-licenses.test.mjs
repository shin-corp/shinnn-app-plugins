/**
 * テンプレートの scripts/check-licenses.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * テンプレートは顧客に配るものなので、テストはテンプレートに入れずにここに置く。
 * 一時フォルダをアプリのリポジトリに見立て、スクリプト・ルートの package.json・node_modules のパッケージを置く。
 * そのうえでスクリプトを実行し、次を確かめる。
 * - ルートと workspaces の各フォルダの node_modules のパッケージが、どれも許可リストのライセンスなら、終了コード 0 で終える
 * - workspaces のフォルダの node_modules（client/node_modules など）に許可リストの外のパッケージがあれば、
 *   終了コード 1 で終え、そのパッケージを示す
 * - workspaces のフォルダは、ルートの package.json の workspaces から読む（配列の形と `{ packages: [...] }` の形）
 * - workspaces のパッケージを指すリンク（node_modules/@app/client など）はたどらない
 * - ルートの node_modules に許可リストの外のパッケージがあれば、終了コード 1 で終える
 * - license の記載が無いパッケージは通さない
 * - workspaces に glob があれば、終了コード 1 で終える
 * - ルートの node_modules が無ければ、終了コード 1 で終える
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
 * @param options.workspaces ルートの package.json の workspaces
 * @param options.links リンクの置き場所（リポジトリルート起点）→ 指す先（リポジトリルート起点）
 * @param options.withNodeModules ルートの node_modules を作るか
 * @returns 終了コードと出力
 */
function runCheck(packages, { workspaces = WORKSPACES, links = {}, withNodeModules = true } = {}) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  const script = join(root, SCRIPT);

  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(templateDir, SCRIPT), script);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, workspaces }));
  if (withNodeModules) {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
  }
  for (const [path, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'package.json'), JSON.stringify(manifest));
  }
  // npm は workspaces のパッケージをリンクで置く。junction は Windows でも管理者の権限なしで作れる（Linux では symlink）
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link), 'junction');
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

test('server の入れ子の node_modules に許可リストの外のパッケージがあれば、終了コード 1 で終える', () => {
  const result = runCheck({
    'server/node_modules/server-lib': { name: 'server-lib', license: 'MIT' },
    'server/node_modules/server-lib/node_modules/paid-lib': { name: 'paid-lib', license: 'SEE LICENSE IN LICENSE.txt' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/node_modules\/server-lib\/node_modules\/paid-lib/);
});

test('テンプレートに無い名前のフォルダも、ルートの package.json の workspaces に並んでいれば検査する', () => {
  const result = runCheck(
    { 'admin/node_modules/paid-lib': { name: 'paid-lib', license: 'UNLICENSED' } },
    { workspaces: ['shared', 'client', 'admin'] },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /admin\/node_modules\/paid-lib: UNLICENSED/);
});

test('workspaces が { packages: [...] } の形でも、並んだフォルダの node_modules を検査する', () => {
  const result = runCheck(
    { 'client/node_modules/paid-lib': { name: 'paid-lib', license: 'UNLICENSED' } },
    { workspaces: { packages: ['client'] } },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /client\/node_modules\/paid-lib: UNLICENSED/);
});

test('workspaces のパッケージを指すリンクはたどらず、そのパッケージ自身は検査しない', () => {
  const result = runCheck(
    {
      'node_modules/root-lib': { name: 'root-lib', license: 'MIT' },
      client: { name: '@app/client', private: true },
      server: { name: 'server-app', private: true },
    },
    { links: { 'node_modules/@app/client': 'client', 'node_modules/server-app': 'server' } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 パッケージ/);
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

test('workspaces に glob があれば、検査せずに終了コード 1 で終える', () => {
  const result = runCheck(
    { 'packages/a/node_modules/paid-lib': { name: 'paid-lib', license: 'UNLICENSED' } },
    { workspaces: ['packages/*'] },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /glob の指定があります（packages\/\*）/);
});

test('ルートの node_modules が無ければ、終了コード 1 で終える', () => {
  const result = runCheck({}, { withNodeModules: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules がありません/);
});
