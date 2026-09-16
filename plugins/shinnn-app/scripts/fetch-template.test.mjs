/**
 * fetch-template.mjs の回帰テスト。`node --test scripts/` で実行する。
 * 取得元（ディレクトリ・.tar.gz ファイル・URL）ごとに展開の結果を確かめ、失敗や衝突のときは展開先に何も書かないことを見る。
 *
 * 圧縮ファイルは GitHub の archive と同じく git archive で作る。
 * URL の取得元は同じプロセスの HTTP サーバーから返す。spawnSync はイベントループを止めてサーバーが応答できなくなるので、
 * スクリプトは非同期の spawn で起動する。
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const script = fileURLToPath(new URL('./fetch-template.mjs', import.meta.url));

/** テンプレートから作ったリポジトリには必ず入っているファイル */
const MARKER = '.claude/rules/.standards-version';

/** 圧縮ファイルの先頭の 1 階層。GitHub の archive と同じく <リポジトリ名>-<版> にする */
const ARCHIVE_TOP_DIR = 'shinnn-app-starter-0.0.0';

/**
 * 取得元に置くテンプレートのファイル（ルート起点のパス → 中身）。
 * 日本語のファイル名と、ustar の name 欄（100 バイト）に収まらないパスを含める。
 * 後者は git archive が ustar の prefix か pax 拡張ヘッダーで表す。
 */
const TEMPLATE_FILES = {
  'package.json': '{ "name": "shinnn-app-starter" }\n',
  [MARKER]: '0.0.0\n',
  '.claude/settings.json': `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true }, permissions: {} })}\n`,
  'server/src/index.ts': 'export {};\n',
  'docs/初回セッション.md': '# 初回セッション\n',
  [`server/src/${'a'.repeat(60)}/${'b'.repeat(50)}.ts`]: 'export {};\n',
  [`docs/${'c'.repeat(120)}.md`]: '# 長い名前\n',
};

const TEMPLATE_PATHS = Object.keys(TEMPLATE_FILES).sort();

/** tar のブロックの大きさ */
const BLOCK_SIZE = 512;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** git で管理しているテンプレートのディレクトリ（コミットしていない状態） */
let sourceDir;

/** テンプレートの .tar.gz ファイル */
let archivePath;

let server;
let baseUrl;

/** ファイルを親ディレクトリごと作る */
function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

/** 手元の git の設定（改行の変換・署名・利用者名）に左右されないように git を実行する */
function git(args, cwd) {
  const config = ['core.autocrlf=false', 'commit.gpgsign=false', 'user.name=test', 'user.email=test@example.com'];
  const configArgs = config.flatMap((entry) => ['-c', entry]);
  execFileSync('git', [...configArgs, ...args], { cwd, stdio: 'pipe' });
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

/** ustar 形式の通常ファイルのエントリを 1 つ組み立てる。読む側はチェックサムを見ないので埋めない */
function ustarEntry(name, content) {
  const body = Buffer.from(content);
  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'latin1');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  header.write('0', 156, 'latin1');
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263, 'latin1');
  const padding = Buffer.alloc(Math.ceil(body.length / BLOCK_SIZE) * BLOCK_SIZE - body.length);
  return Buffer.concat([header, body, padding]);
}

/** スクリプトを非同期で実行し、終了コードと出力を返す */
function runFetch(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

before(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'fetch-template-test-'));

  sourceDir = join(workRoot, 'source');
  writeFiles(sourceDir, TEMPLATE_FILES);
  writeFiles(sourceDir, { '.gitignore': 'node_modules/\n', 'node_modules/x.js': 'module.exports = 1;\n' });
  git(['init', '-q'], sourceDir);

  const archiveRepo = join(workRoot, 'archive-repo');
  writeFiles(archiveRepo, TEMPLATE_FILES);
  git(['init', '-q'], archiveRepo);
  git(['add', '.'], archiveRepo);
  git(['commit', '-q', '-m', 'template'], archiveRepo);
  archivePath = join(workRoot, 'starter.tar.gz');
  git(['archive', '--format=tar.gz', `--prefix=${ARCHIVE_TOP_DIR}/`, '-o', archivePath, 'HEAD'], archiveRepo);
  const archiveBody = readFileSync(archivePath);

  // GitHub の archive URL と同じく、別の URL へ 302 してから圧縮ファイルを返す
  server = createServer((request, response) => {
    if (request.url === '/archive') {
      response.writeHead(302, { Location: '/file.tar.gz' });
      response.end();
      return;
    }
    if (request.url === '/file.tar.gz') {
      response.writeHead(200, { 'Content-Type': 'application/gzip' });
      response.end(archiveBody);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolvePromise) => {
    server.close(resolvePromise);
  });
  rmSync(workRoot, { recursive: true, force: true });
});

test('ディレクトリ: git が管理する対象のファイルだけを、無い展開先を作って展開する', async () => {
  const dest = join(workRoot, 'new', 'app');
  const result = await runFetch(['--from', sourceDir, '--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(listFiles(dest), [...TEMPLATE_PATHS, '.gitignore'].sort());
  assert.equal(existsSync(join(dest, 'node_modules')), false);
});

test('.tar.gz: 先頭の 1 階層を外し、日本語や長いファイル名も含めて展開する', async () => {
  const dest = makeDest();
  const result = await runFetch(['--from', archivePath, '--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(listFiles(dest), TEMPLATE_PATHS);
  for (const [path, content] of Object.entries(TEMPLATE_FILES)) {
    assert.equal(readFileSync(join(dest, path), 'utf8'), content, path);
  }
});

test('.tar.gz: 圧縮ファイルの外を指すパス（..）があれば失敗し、何も書かない', async () => {
  const dest = makeDest();
  const tar = Buffer.concat([
    ustarEntry(`${ARCHIVE_TOP_DIR}/${MARKER}`, '0.0.0\n'),
    ustarEntry(`${ARCHIVE_TOP_DIR}/../escaped.txt`, 'x\n'),
    Buffer.alloc(BLOCK_SIZE * 2),
  ]);
  const unsafeArchivePath = join(workRoot, 'unsafe.tar.gz');
  writeFileSync(unsafeArchivePath, gzipSync(tar));
  const result = await runFetch(['--from', unsafeArchivePath, '--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.\.\/escaped\.txt/);
  assert.deepEqual(listFiles(dest), []);
  assert.equal(existsSync(join(workRoot, 'escaped.txt')), false);
});

test('URL: リダイレクトを追ってダウンロードし、展開する', async () => {
  const dest = makeDest();
  const result = await runFetch(['--from', `${baseUrl}/archive`, '--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(listFiles(dest), TEMPLATE_PATHS);
});

test('URL: 404 なら失敗し、展開先に何も書かない', async () => {
  const dest = makeDest();
  const result = await runFetch(['--from', `${baseUrl}/missing.tar.gz`, '--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTP 404/);
  assert.deepEqual(listFiles(dest), []);
});

test('衝突: 展開先に同じパスのファイルがあれば失敗し、何も書かない', async () => {
  const dest = makeDest();
  writeFiles(dest, { 'package.json': '{}\n' });
  const result = await runFetch(['--from', archivePath, '--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /- package\.json/);
  assert.deepEqual(listFiles(dest), ['package.json']);
  assert.equal(readFileSync(join(dest, 'package.json'), 'utf8'), '{}\n');
});

test('settings.json: plugin install が書くキーだけなら置き換える', async () => {
  const dest = makeDest();
  writeFiles(dest, {
    '.claude/settings.json': `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true } })}\n`,
  });
  const result = await runFetch(['--from', archivePath, '--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /置き換えたファイル: \.claude\/settings\.json/);
  assert.deepEqual(listFiles(dest), TEMPLATE_PATHS);
  assert.equal(readFileSync(join(dest, '.claude', 'settings.json'), 'utf8'), TEMPLATE_FILES['.claude/settings.json']);
});

test('settings.json: 他のキーもあれば衝突として失敗し、何も書かない', async () => {
  const dest = makeDest();
  const original = `${JSON.stringify({ enabledPlugins: { 'shinnn-app@shinnn': true }, permissions: { allow: [] } })}\n`;
  writeFiles(dest, { '.claude/settings.json': original });
  const result = await runFetch(['--from', archivePath, '--dest', dest]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /- \.claude\/settings\.json/);
  assert.deepEqual(listFiles(dest), ['.claude/settings.json']);
  assert.equal(readFileSync(join(dest, '.claude', 'settings.json'), 'utf8'), original);
});

test('取得済み: 目印が既にあれば何もしない', async () => {
  const dest = makeDest();
  writeFiles(dest, { [MARKER]: '0.0.0\n' });
  const result = await runFetch(['--from', archivePath, '--dest', dest]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /取得済み/);
  assert.deepEqual(listFiles(dest), [MARKER]);
});

test('--dry-run: 展開する内容だけを出し、何も書かない', async () => {
  const dest = join(workRoot, 'dry-run-app');
  const result = await runFetch(['--from', archivePath, '--dest', dest, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`ファイル数: ${TEMPLATE_PATHS.length}`));
  assert.equal(existsSync(dest), false);
});
