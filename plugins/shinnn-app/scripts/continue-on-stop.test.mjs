/**
 * continue-on-stop が応答を続けさせる条件の回帰テスト。`node --test scripts/` で実行する。
 *
 * スクリプトが呼ぶ gh を偽物（continue-on-stop.fake-gh.mjs）に差し替え、次を確かめる。
 * - マージの方針が auto-merge で setup が済み、進められる Issue（status:next / status:doing）があれば、続けるよう伝える
 * - 続けさせた後の応答の終わり（stop_hook_active が true）でも、残りの組が変わっていれば、また続けるよう伝える
 * - 同じセッションで残りの組が変わっていなければ（進まなかった）、止まらせる。残りが 0 件になったら、残した組を消す
 * - auto-merge でない・setup が済んでいない・裏で作業が動いている・gh が使えない・SHINNN_SKIP_STOP_CHECK のときは、
 *   何も出さずに止まらせる
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('./continue-on-stop.mjs', import.meta.url));

/** gh を偽物に差し替える下準備 */
const fakeGh = pathToFileURL(fileURLToPath(new URL('./continue-on-stop.fake-gh.mjs', import.meta.url))).href;

/** setup が済んだ auto-merge のアプリの記録 */
const AUTO_MERGE = { mergePolicy: 'auto-merge', setupCompletedAt: '2026-11-08T00:00:00.000Z' };

/** 伝える文の書き出し。利用者が頼んだ言い方をそのまま使う */
const CONTINUE = /^\[shinnn-app\] マージの方針が auto-merge なので、開発がすべて完了するまで続けてください。/;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'continue-on-stop-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * アプリのリポジトリに見立てた一時フォルダを作る。git init して、残した組を置く場所（git の共通フォルダ）を用意する。
 *
 * @param setup .shinnn/setup.json の中身
 */
function createRepo(setup = AUTO_MERGE) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  mkdirSync(join(root, '.shinnn'), { recursive: true });
  writeFileSync(join(root, '.shinnn', 'setup.json'), `${JSON.stringify(setup)}\n`);
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  return root;
}

/** 残した組のファイル */
function stateFile(root) {
  return join(root, '.git', 'shinnn', 'continue-on-stop.json');
}

/** 残した組を読む。ファイルが無ければ null */
function readState(root) {
  const path = stateFile(root);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/**
 * 偽物の gh に GitHub の状態を答えさせて、hook を実行する。
 *
 * @param root アプリのリポジトリ
 * @param ghState 偽物の gh に渡す状態（continue-on-stop.fake-gh.mjs の冒頭）
 * @param input hook の入力。session_id の既定は 'session-a'
 * @param env 足す環境変数
 * @returns 終了コード・出力・出力の JSON（無ければ null）と、gh の呼び出しの記録
 */
function runHook(root, ghState, input = {}, env = {}) {
  const caseDir = mkdtempSync(join(workRoot, 'case-'));
  const statePath = join(caseDir, 'gh-state.json');
  const logPath = join(caseDir, 'gh.log');
  writeFileSync(statePath, JSON.stringify(ghState));
  writeFileSync(logPath, '');

  const result = spawnSync(process.execPath, ['--import', fakeGh, script], {
    input: JSON.stringify({ session_id: 'session-a', cwd: root, ...input }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, FAKE_GH_STATE: statePath, FAKE_GH_LOG: logPath, ...env },
  });
  const calls = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout === '' ? null : JSON.parse(result.stdout),
    calls,
  };
}

/** 続けるよう伝えたこと。伝えた文を返す */
function assertContinued(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.notEqual(result.output, null, '何も出していない');
  assert.equal(result.output.hookSpecificOutput.hookEventName, 'Stop');
  const context = result.output.hookSpecificOutput.additionalContext;
  assert.match(context, CONTINUE);
  return context;
}

/** 何もしなかったこと。止まらせたうえで、コンテキストも知らせも出していない */
function assertDidNothing(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

test('auto-merge で進められる Issue が残っている: 続けるよう伝え、残っている Issue の番号を並べる', () => {
  const root = createRepo();
  const result = runHook(root, { issues: { 'status:next': [22, 14], 'status:doing': [] } });
  const context = assertContinued(result);
  assert.match(context, /残っている Issue: #14, #22$/m);
  assert.match(result.output.systemMessage, /#14, #22/);
  assert.deepEqual(readState(root)['session-a'].issues, [14, 22]);
});

test('auto-merge で進められる Issue が残っている: そのまま止まってよい場合（止まるとき・開発の続きでない依頼）も伝える', () => {
  const root = createRepo();
  const context = assertContinued(runHook(root, { issues: { 'status:next': [14] } }));
  assert.match(
    context,
    /feature の手順 7 の「止まるとき」に当たる（.*lint-staged の退避で止まり、利用者にアプリを閉じてもらうのを待つ/,
  );
  assert.match(context, /利用者の直前の依頼が、開発の続きではない（質問・別の作業・止める指示）/);
});

test('auto-merge で status:doing の Issue だけが残っている: 続けるよう伝える', () => {
  const root = createRepo();
  const context = assertContinued(runHook(root, { issues: { 'status:doing': [7] } }));
  assert.match(context, /残っている Issue: #7$/m);
});

test('auto-merge で status:next と status:doing に同じ番号が出る: 番号を 1 回だけ並べる', () => {
  const root = createRepo();
  const context = assertContinued(runHook(root, { issues: { 'status:next': [3, 5], 'status:doing': [5] } }));
  assert.match(context, /残っている Issue: #3, #5$/m);
});

test('続けさせた後の応答の終わりで、残りの組が変わっていない: 進まなかったものとして止まらせる', () => {
  const root = createRepo();
  const ghState = { issues: { 'status:next': [14, 22] } };
  assertContinued(runHook(root, ghState));
  assertDidNothing(runHook(root, ghState, { stop_hook_active: true }));
  assert.deepEqual(readState(root)['session-a'].issues, [14, 22]);
});

test('続けさせた後の応答の終わり（stop_hook_active が true）で、残りの組が変わった: また続けるよう伝える', () => {
  const root = createRepo();
  assertContinued(runHook(root, { issues: { 'status:next': [14, 22] } }));
  const context = assertContinued(runHook(root, { issues: { 'status:next': [22] } }, { stop_hook_active: true }));
  assert.match(context, /残っている Issue: #22$/m);
  assert.deepEqual(readState(root)['session-a'].issues, [22]);
});

test('残りが 0 件になった: 止まらせ、残した組を消す', () => {
  const root = createRepo();
  assertContinued(runHook(root, { issues: { 'status:next': [22] } }));
  assertDidNothing(runHook(root, { issues: {} }, { stop_hook_active: true }));
  assert.equal(readState(root), null);
});

test('別のセッションで同じ組が残っている: そのセッションでは続けるよう伝える', () => {
  const root = createRepo();
  const ghState = { issues: { 'status:next': [14] } };
  assertContinued(runHook(root, ghState, { session_id: 'session-a' }));
  assertContinued(runHook(root, ghState, { session_id: 'session-b' }));
  assert.deepEqual(Object.keys(readState(root)).sort(), ['session-a', 'session-b']);
});

test('残した組に 7 日より古いものがある: 書くときに落とす', () => {
  const root = createRepo();
  mkdirSync(dirname(stateFile(root)), { recursive: true });
  const old = { issues: [1], at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() };
  writeFileSync(stateFile(root), `${JSON.stringify({ 'session-old': old })}\n`);
  assertContinued(runHook(root, { issues: { 'status:next': [14] } }));
  assert.deepEqual(Object.keys(readState(root)), ['session-a']);
});

test('マージの方針が human: gh を呼ばずに止まらせる', () => {
  const root = createRepo({ ...AUTO_MERGE, mergePolicy: 'human' });
  const result = runHook(root, { issues: { 'status:next': [14] } });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('setup が済んでいない（setupCompletedAt が null）: gh を呼ばずに止まらせる', () => {
  const root = createRepo({ ...AUTO_MERGE, setupCompletedAt: null });
  const result = runHook(root, { issues: { 'status:next': [14] } });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('裏で作業が動いている（background_tasks がある）: gh を呼ばずに止まらせる', () => {
  const root = createRepo();
  const tasks = [{ id: 'task-1', type: 'shell', status: 'running', command: 'gh pr checks 40 --watch' }];
  const result = runHook(root, { issues: { 'status:next': [14] } }, { background_tasks: tasks });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('起こす予約がある（session_crons がある）: gh を呼ばずに止まらせる', () => {
  const root = createRepo();
  const crons = [{ id: 'cron-1', schedule: '*/5 * * * *', recurring: true, prompt: 'CI を確かめる' }];
  const result = runHook(root, { issues: { 'status:next': [14] } }, { session_crons: crons });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('gh が無い: 何も出さずに止まらせる', () => {
  assertDidNothing(runHook(createRepo(), { missing: true }));
});

test('gh が失敗した: 何も出さずに止まらせる', () => {
  assertDidNothing(runHook(createRepo(), { failure: true }));
});

test('gh が時間内に終わらない: 何も出さずに止まらせる', () => {
  assertDidNothing(runHook(createRepo(), { timeout: true }));
});

test('SHINNN_SKIP_STOP_CHECK の指定: gh を呼ばずに止まらせる', () => {
  const result = runHook(createRepo(), { issues: { 'status:next': [14] } }, {}, { SHINNN_SKIP_STOP_CHECK: '1' });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});
