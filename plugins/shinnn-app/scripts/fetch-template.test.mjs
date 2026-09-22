/**
 * fetch-template.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * 展開するのは同梱のテンプレートそのものなので、作り物の取得元は用意せず、実物を空のフォルダに展開して確かめる。
 * 展開されるべきファイルの一覧は、同じフォルダで git が挙げるファイル（無視するものを除いたもの）と同じになる。
 * どのパスを除くかは、判定の関数 isExcluded を直接呼んで確かめる。
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isExcluded } from './fetch-template.mjs';

const script = fileURLToPath(new URL('./fetch-template.mjs', import.meta.url));

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** テンプレートから作ったリポジトリには必ず入っているファイル。中身は標準の版 */
const MARKER = '.claude/rules/.standards-version';

/** setup の記録 */
const SETUP = '.shinnn/setup.json';

/** プラグインの定義 */
const pluginManifest = fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url));

/** プラグインの版。展開するテンプレートの版として出し、setup.json の templateVersion に入る */
const pluginVersion = JSON.parse(readFileSync(pluginManifest, 'utf8')).version;

/** 同梱のテンプレートの標準の版 */
const standardsVersion = readFileSync(join(templateDir, MARKER), 'utf8').trim();

/** 展開されるべきファイル（テンプレートのルート起点の POSIX パス）を、git の挙げるファイルから作る */
function templatePaths() {
  const args = ['-C', templateDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  const output = execFileSync('git', args, { encoding: 'utf8' });
  return output.split('\0').filter((path) => path !== '');
}

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** ファイルを親ディレクトリごと作る */
function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

/** ディレクトリの中のファイルを、ルート起点の POSIX パスで並べる。ディレクトリが無ければ空 */
function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const rel = relative(root, join(entry.parentPath, entry.name));
    files.push(rel.split(sep).join('/'));
  }
  return files.sort();
}

/** 展開先にする空のディレクトリ */
function makeDest() {
  return mkdtempSync(join(workRoot, 'dest-'));
}

/** スクリプトを実行し、終了コードと出力を返す */
function runFetch(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'fetch-template-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('同梱のテンプレートを、無い展開先を作って展開する', () => {
  const dest = join(workRoot, 'new', 'app');
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 0, result.stderr);

  const expected = templatePaths().sort();
  assert.deepEqual(listFiles(dest), expected);
  assert.match(result.stdout, new RegExp(`${expected.length} ファイル`));

  // 日本語のファイル名も、名前と中身がそのまま展開される
  const japanese = expected.filter((path) => /[^ -~]/.test(path));
  assert.ok(japanese.length > 0, '日本語のファイル名がテンプレートにありません');
  for (const path of japanese) {
    assert.equal(readFileSync(join(dest, path), 'utf8'), readFileSync(join(templateDir, path), 'utf8'), path);
  }
  assert.equal(readFileSync(join(dest, MARKER), 'utf8'), readFileSync(join(templateDir, MARKER), 'utf8'));
});

test('依存・生成物・手元の環境設定は展開しない', () => {
  const dest = join(workRoot, 'excluded-app');
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  for (const path of listFiles(dest)) {
    assert.equal(isExcluded(path), false, path);
  }
  for (const directory of ['node_modules', 'dist', 'server/node_modules', 'server/dist', 'client/.angular']) {
    assert.equal(existsSync(join(dest, directory)), false, directory);
  }
});

test('除外の判定: 依存と生成物のディレクトリは、どの階層でも中身ごと除く', () => {
  for (const path of [
    'node_modules/typescript/package.json',
    'server/node_modules/.bin/tsc',
    'dist/index.js',
    'client/.angular/cache/x.json',
    'client/out-tsc/a.js',
    'coverage/index.html',
    'test-results/a.png',
    'playwright-report/index.html',
    '.e2e/state.json',
    '.git/config',
  ]) {
    assert.equal(isExcluded(path), true, path);
  }
});

test('除外の判定: 手元の環境設定と記録は除き、見本は残す', () => {
  for (const path of ['.env', 'server/.env', 'server/.env.local', 'npm-debug.log', 'server/logs/app.log']) {
    assert.equal(isExcluded(path), true, path);
  }
  for (const path of ['.env.example', 'server/.env.example', 'server/src/util/log.ts', 'docs/仕様書.md']) {
    assert.equal(isExcluded(path), false, path);
  }
});

test('除外の判定: 個人の設定とメモ、OS が作る記録は除く', () => {
  for (const path of ['.claude/settings.local.json', 'CLAUDE.local.md', '.DS_Store', 'docs/Thumbs.db']) {
    assert.equal(isExcluded(path), true, path);
  }
  for (const path of ['.claude/settings.json', 'CLAUDE.md', 'client/CLAUDE.md']) {
    assert.equal(isExcluded(path), false, path);
  }
});

test('衝突: 展開先に同じパスのファイルがあれば失敗し、何も書かない', () => {
  const dest = makeDest();
  writeFiles(dest, { 'package.json': '{}\n' });
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /- package\.json/);
  assert.deepEqual(listFiles(dest), ['package.json']);
  assert.equal(readFileSync(join(dest, 'package.json'), 'utf8'), '{}\n');
});

test('settings.json: plugin install が書くキーだけなら置き換える', () => {
  const dest = makeDest();
  writeFiles(dest, {
    '.claude/settings.json': `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true } })}\n`,
  });
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /置き換えたファイル: \.claude\/settings\.json/);
  assert.deepEqual(listFiles(dest), templatePaths().sort());
  assert.equal(
    readFileSync(join(dest, '.claude', 'settings.json'), 'utf8'),
    readFileSync(join(templateDir, '.claude', 'settings.json'), 'utf8'),
  );
});

test('settings.json: 他のキーもあれば衝突として失敗し、何も書かない', () => {
  const dest = makeDest();
  const original = `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true }, permissions: { allow: [] } })}\n`;
  writeFiles(dest, { '.claude/settings.json': original });
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /- \.claude\/settings\.json/);
  assert.deepEqual(listFiles(dest), ['.claude/settings.json']);
  assert.equal(readFileSync(join(dest, '.claude', 'settings.json'), 'utf8'), original);
});

test('取得済み: 目印が既にあれば何もしない', () => {
  const dest = makeDest();
  writeFiles(dest, { [MARKER]: '0.0.0\n' });
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /取得済み/);
  assert.deepEqual(listFiles(dest), [MARKER]);
});

test('--dry-run: 展開する内容だけを出し、何も書かない', () => {
  const dest = join(workRoot, 'dry-run-app');
  const result = runFetch(['--dest', dest, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`ファイル数: ${templatePaths().length}`));
  assert.equal(existsSync(dest), false);
});

test('版: --dry-run でも展開でも、プラグインの版に標準の版を添えて出す', () => {
  const version = `プラグイン v${pluginVersion}（標準 ${standardsVersion}）`;

  const dryRun = runFetch(['--dest', join(workRoot, 'version-dry-run-app'), '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.ok(dryRun.stdout.includes(`版: ${version}`), dryRun.stdout);

  const dest = makeDest();
  const result = runFetch(['--dest', dest]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`${version}のテンプレートを ${dest} に展開しました`), result.stdout);
});

test('setup.json: templateVersion だけをプラグインの版にし、ほかのキーと値と書式はテンプレートのまま', () => {
  const dest = makeDest();
  const template = readFileSync(join(templateDir, SETUP), 'utf8');
  const result = runFetch(['--dest', dest]);

  assert.equal(result.status, 0, result.stderr);

  const written = readFileSync(join(dest, SETUP), 'utf8');
  const setup = JSON.parse(written);
  assert.equal(setup.templateVersion, pluginVersion);
  assert.equal(
    Object.hasOwn(setup, 'standardsVersion'),
    false,
    `setup.json に standardsVersion があります。標準の版は ${MARKER} だけに持ちます`,
  );

  // キーの顔ぶれと並び（$comment の位置）が同じで、値は templateVersion のほかは同じ
  assert.deepEqual(Object.keys(setup), Object.keys(JSON.parse(template)));
  assert.deepEqual(setup, { ...JSON.parse(template), templateVersion: pluginVersion });

  // 字下げと改行も同じで、違うのは templateVersion の行だけ
  assert.equal(written, template.replace(/"templateVersion": "[^"]*"/, `"templateVersion": "${pluginVersion}"`));

  // 同梱のテンプレートのファイルは書き換えない
  assert.equal(readFileSync(join(templateDir, SETUP), 'utf8'), template);
});
