/**
 * session-start の回帰テスト。`node --test scripts/` で実行する。
 *
 * - 標準の版は `.claude/rules/.standards-version` の 1 か所だけに持つ。セッションの開始時に示す版が
 *   このファイルだけから読まれ、`.shinnn/setup.json` の値は使われないことを確かめる
 * - gh が無いときは、リポジトリの中のファイルを進捗として出さずに、GitHub の画面の URL と gh の導入・ログインの案内を出す
 * - gh の一覧の取得に失敗した欄は、0 件（「（なし）」）と書かずに、取得できなかったことと理由を書く
 *
 * gh は、hook が呼ぶ node:child_process を偽物に差し替えて答えさせる。差し替えの下準備は一時フォルダに書き、
 * `--import` で読み込む。PATH に偽の gh を置かないのは、Windows の spawnSync が拡張子 .exe / .com のファイルしか
 * 探さず、スクリプトで作った偽物（gh.cmd など）を見つけないため。git は本物を使う。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('./session-start.mjs', import.meta.url));

/** 標準の版を持つファイル（リポジトリルート起点） */
const STANDARDS_VERSION = '.claude/rules/.standards-version';

/** プラグインが配布している標準の版 */
const distributed = readFileSync(
  fileURLToPath(new URL(`../template/${STANDARDS_VERSION}`, import.meta.url)),
  'utf8',
).trim();

/** リポジトリに入っている標準の版として置く値。配布されている版とは違う値にする */
const INSTALLED = '0.0.1';

/**
 * gh を偽物に差し替える下準備。scripts/lib/hook-io.mjs が import する node:child_process をこのモジュールに差し替える。
 * 差し替えた spawnSync は、gh には環境変数 FAKE_GH の指定どおりに答え、それ以外は本物に渡す。
 * - missing: gh が見つからない（起動に失敗する）
 * - fail: `--version` 以外は、FAKE_GH_STDERR を標準エラーに出して終了コード 1 で終わる
 * - empty: `--version` 以外は、何も出さずに成功する（一覧が 0 件）
 * - echo: `--version` 以外は、受け取った引数を空白でつないで出す（どう取りに行ったかを確かめる）
 */
const FAKE_CHILD_PROCESS = `
import * as childProcess from 'node:child_process';
import { registerHooks } from 'node:module';

export * from 'node:child_process';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process' && context.parentURL?.endsWith('/scripts/lib/hook-io.mjs')) {
      return { url: import.meta.url, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

export function spawnSync(command, args = [], options = {}) {
  if (command !== 'gh') {
    return childProcess.spawnSync(command, args, options);
  }
  const mode = process.env.FAKE_GH;
  if (mode === 'missing') {
    const error = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
    return { error, status: null, stdout: '', stderr: '' };
  }
  if (args[0] === '--version' || mode === 'empty') {
    return { status: 0, stdout: '', stderr: '' };
  }
  if (mode === 'echo') {
    return { status: 0, stdout: args.join(' ') + '\\n', stderr: '' };
  }
  return { status: 1, stdout: '', stderr: process.env.FAKE_GH_STDERR ?? '' };
}
`;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** 下準備のモジュールの URL */
let fakeChildProcess;

/** ファイルを親ディレクトリごと作る */
function writeFile(root, repoPath, content) {
  const path = join(root, repoPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** セットアップを終えたリポジトリを作る。remote を渡すと git のリポジトリにして origin を登録する */
function createRepo(setup, { remote } = {}) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  const completed = { setupCompletedAt: '2026-01-01T00:00:00.000Z', profile: 'full', mergePolicy: 'human' };
  writeFile(root, '.shinnn/setup.json', `${JSON.stringify({ ...completed, ...setup })}\n`);
  if (remote !== undefined) {
    for (const args of [
      ['init', '-q'],
      ['remote', 'add', 'origin', remote],
    ]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  }
  return root;
}

/**
 * session-start を実行し、終了コードと出力を返す。
 *
 * @param gh - 偽物の gh の答え方（missing / fail / empty）
 * @param ghStderr - fail のときに gh が標準エラーに出す文言
 */
function runHook(root, { gh = 'missing', ghStderr = '' } = {}) {
  const result = spawnSync(process.execPath, ['--import', fakeChildProcess, script], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, FAKE_GH: gh, FAKE_GH_STDERR: ghStderr },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** `## ` で始まる見出しの節の本文（次の見出しの手前まで） */
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  assert.notEqual(start, -1, `見出し「${heading}」がありません:\n${text}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** gh で取得する 3 つの欄の見出し */
const GH_SECTIONS = ['次に着手する Issue', 'open な PR', '直近の CI'];

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'session-start-test-'));
  const path = join(workRoot, 'fake-child-process.mjs');
  writeFileSync(path, FAKE_CHILD_PROCESS);
  fakeChildProcess = pathToFileURL(path).href;
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('標準の版: .claude/rules/.standards-version の版を示し、配布されている版と比べる', () => {
  assert.notEqual(distributed, INSTALLED);
  const root = createRepo({});
  writeFile(root, STANDARDS_VERSION, `${INSTALLED}\n`);
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`標準バージョン: ${INSTALLED}`), result.stdout);
  assert.ok(
    result.stdout.includes(`リポジトリの標準: ${INSTALLED} / 配布されている標準: ${distributed}`),
    result.stdout,
  );
});

test('標準の版: .claude/rules/.standards-version が無ければ、setup.json に版があっても使わず「不明」と示す', () => {
  const root = createRepo({ standardsVersion: INSTALLED });
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('標準バージョン: 不明'), result.stdout);
  assert.ok(result.stdout.includes(`リポジトリの標準: 不明 / 配布されている標準: ${distributed}`), result.stdout);
});

test('gh が無いとき: リポジトリの中のファイルを進捗として出さず、GitHub の画面の URL と gh auth login を案内する', () => {
  const root = createRepo({}, { remote: 'git@github.com:example/app.git' });
  writeFile(root, 'docs/progress.md', '# 進捗\n\n古い写しの本文\n');
  const result = runHook(root, { gh: 'missing' });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /古い写しの本文|docs\/progress\.md/);
  assert.match(result.stdout, /取得できません/);
  for (const path of ['issues', 'pulls', 'actions']) {
    assert.ok(result.stdout.includes(`https://github.com/example/app/${path}`), result.stdout);
  }
  assert.match(result.stdout, /gh auth login/);
});

test('gh が無いとき: remote の URL に認証情報が含まれていても、画面の URL には出さない', () => {
  const root = createRepo({}, { remote: 'https://someone:secret-token@github.com/example/app.git' });
  const result = runHook(root, { gh: 'missing' });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('https://github.com/example/app/issues'), result.stdout);
  assert.doesNotMatch(result.stdout, /secret-token|someone/);
});

test('gh が無いとき: remote が無ければ URL を作らずに、GitHub の画面と gh auth login を案内する', () => {
  const root = createRepo({});
  const result = runHook(root, { gh: 'missing' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub のリポジトリの画面/);
  assert.match(result.stdout, /gh auth login/);
  assert.doesNotMatch(result.stdout, /https:\/\//);
});

test('gh の取得に失敗した欄は「（なし）」と書かず、取得できなかったことと理由の要点を書く', () => {
  const root = createRepo({});
  const result = runHook(root, {
    gh: 'fail',
    ghStderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n',
  });

  assert.equal(result.status, 0, result.stderr);
  for (const heading of GH_SECTIONS) {
    const text = section(result.stdout, heading);
    assert.doesNotMatch(text, /（なし）/, heading);
    assert.match(text, /^取得できませんでした（HTTP 401: Bad credentials）$/m, heading);
  }
});

test('gh の一覧が 0 件の欄は「（なし）」と書き、取得できなかったとは書かない', () => {
  const root = createRepo({});
  const result = runHook(root, { gh: 'empty' });

  assert.equal(result.status, 0, result.stderr);
  for (const heading of GH_SECTIONS) {
    assert.match(section(result.stdout, heading), /（なし）/, heading);
  }
  assert.doesNotMatch(result.stdout, /取得できません/);
});

test('直近の CI は ci.yaml の実行だけを取り、実行中（結果がまだ空）のときは状態を出す', () => {
  const root = createRepo({});
  const result = runHook(root, { gh: 'echo' });

  assert.equal(result.status, 0, result.stderr);
  const ci = section(result.stdout, '直近の CI');
  assert.match(ci, /^run list --workflow ci\.yaml /m);
  assert.match(ci, /\{\{if \.conclusion\}\}\{\{\.conclusion\}\}\{\{else\}\}\{\{\.status\}\}\{\{end\}\}/);
});
