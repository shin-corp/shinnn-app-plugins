/**
 * check-plugin-version の回帰テスト。`node --test scripts/` で実行する。
 *
 * - プラグインの版は、公開リポジトリの `v<版>` のタグのうち最も新しいものと比べる（`v0.10.0` は `v0.9.9` より新しい）
 * - 古いときは、新しくするコマンドを出す。スコープは `.claude/settings.json` で有効にしていれば project、無ければ local
 * - タグを取れない（オフライン、存在しないリポジトリ）ときは「確かめられない」と出し、終了コード 0 で終える
 * - ルールの版は、アプリの `.claude/rules/.standards-version` と同梱テンプレートの同じファイルを比べる
 *
 * 公開リポジトリの代わりに、一時フォルダに作った git リポジトリにタグを打ち、`--repository` で渡す。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, installScope, latestTagVersion } from './check-plugin-version.mjs';

const script = fileURLToPath(new URL('./check-plugin-version.mjs', import.meta.url));

/** 読み込み中のプラグインの版 */
const loaded = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8')).version;

/** プラグインが配布しているルールの版 */
const distributed = readFileSync(
  fileURLToPath(new URL('../template/.claude/rules/.standards-version', import.meta.url)),
  'utf8',
).trim();

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'check-plugin-version-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** git を実行する。失敗したらテストを落とす */
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

/** 指定したタグを打った git リポジトリを作り、そのパスを返す */
function createRemote(name, tags) {
  const dir = join(workRoot, name);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const tag of tags) {
    git(dir, 'tag', tag);
  }
  return dir;
}

/** アプリのフォルダを作る */
function createApp(name, files) {
  const dir = join(workRoot, name);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** スクリプトを実行し、終了コードと標準出力を返す */
function runCheck(repository, root) {
  const result = spawnSync(process.execPath, [script, '--repository', repository, '--root', root], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout };
}

/** 読み込み中の版より 1 つ新しい版 */
function nextMinor(version) {
  const [major, minor] = version.split('.').map(Number);
  return `${major}.${minor + 1}.0`;
}

const PROJECT_SETTINGS = `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true } })}\n`;

test('タグ: v<版> のうち最も新しいものを取る。数として比べ、v の付かないタグは無視する', () => {
  const output = [
    'aaa\trefs/tags/v0.9.9',
    'bbb\trefs/tags/v0.10.0',
    'ccc\trefs/tags/v0.2.0',
    'ddd\trefs/tags/release-9.9.9',
    'eee\trefs/tags/v1.0.0-rc.1',
  ].join('\n');
  assert.equal(latestTagVersion(output), '0.10.0');
  assert.equal(latestTagVersion(''), null);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('0.12.1', '0.12.1'), 0);
});

test('スコープ: .claude/settings.json で有効にしていれば project、無ければ local', () => {
  const project = createApp('scope-project', { '.claude/settings.json': PROJECT_SETTINGS });
  const local = createApp('scope-local', { '.claude/settings.json': '{}\n' });
  const none = createApp('scope-none', {});
  assert.equal(installScope(project), 'project');
  assert.equal(installScope(local), 'local');
  assert.equal(installScope(none), 'local');
});

test('プラグイン: 公開側に新しい版があれば「古い」と、新しくするコマンドを出す', () => {
  const remote = createRemote('remote-newer', ['v0.1.0', `v${loaded}`, `v${nextMinor(loaded)}`]);
  const app = createApp('app-newer', {
    '.claude/settings.json': PROJECT_SETTINGS,
    '.claude/rules/.standards-version': `${distributed}\n`,
  });

  const result = runCheck(remote, app);

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`プラグイン: 古い（読み込み中 ${loaded} / 最新 ${nextMinor(loaded)}）`));
  assert.match(result.stdout, /更新: claude plugin marketplace update shinnn/);
  assert.match(result.stdout, /更新: claude plugin update shinnn-app@shinnn --scope project/);
});

test('プラグイン: 公開側の最新と同じなら「最新」と出し、コマンドは出さない', () => {
  const remote = createRemote('remote-same', ['v0.1.0', `v${loaded}`]);
  const app = createApp('app-same', { '.claude/rules/.standards-version': `${distributed}\n` });

  const result = runCheck(remote, app);

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`プラグイン: 最新（${loaded}）`));
  assert.doesNotMatch(result.stdout, /更新:/);
});

test('プラグイン: タグを取れないときは「確かめられない」と出し、終了コード 0 で終える', () => {
  const app = createApp('app-offline', { '.claude/rules/.standards-version': `${distributed}\n` });

  const result = runCheck(join(workRoot, 'no-such-remote'), app);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /プラグイン: 確かめられない/);
  assert.match(result.stdout, new RegExp(`ルール: 最新（${distributed}）`));
});

test('ルール: アプリの版が配布より古ければ「古い」と update-rules を、無ければ「確かめられない」を出す', () => {
  const remote = createRemote('remote-rules', [`v${loaded}`]);
  const older = createApp('app-rules-older', { '.claude/rules/.standards-version': '0.0.1\n' });
  const missing = createApp('app-rules-missing', {});

  assert.match(
    runCheck(remote, older).stdout,
    new RegExp(`ルール: 古い（アプリ 0\\.0\\.1 / 配布 ${distributed.replaceAll('.', '\\.')}）。/shinnn-app:update-rules で取り込む`),
  );
  assert.match(runCheck(remote, missing).stdout, /ルール: 確かめられない（\.standards-version が無い）/);
});
