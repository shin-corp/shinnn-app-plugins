/**
 * continue-on-stop が応答を続けさせる条件の回帰テスト。`node --test scripts/` で実行する。
 *
 * スクリプトが呼ぶ gh を偽物（continue-on-stop.fake-gh.mjs）に差し替え、次を確かめる。
 * - マージの方針が auto-merge で setup が済み、進められる Issue（status:next / status:doing）があれば、続けるよう伝える
 * - 計画の親・setup と update-rules の Issue・Dependabot の Issue は数えない
 * - 続けさせた後の応答の終わり（stop_hook_active が true）でも、残りの組が変わっていれば、また続けるよう伝える
 * - 同じセッションで残りの組が変わっていなければ（進まなかった）、止まらせる。残りが 0 件になったら、残した組を消す
 * - 裏で動いている shell（開発用のサーバーなど）だけなら続けるよう伝え、サブエージェントや起こす予約があれば止まらせる
 * - auto-merge でない・setup が済んでいない・gh が使えない・組を書けない・SHINNN_SKIP_STOP_CHECK のときは、
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

/** 伝える文の書き出し */
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
 * @param options.workflowRule 規約 .claude/rules/git-workflow.md の中身。null なら置かない
 */
function createRepo(setup = AUTO_MERGE, { workflowRule = null } = {}) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  mkdirSync(join(root, '.shinnn'), { recursive: true });
  writeFileSync(join(root, '.shinnn', 'setup.json'), `${JSON.stringify(setup)}\n`);
  if (workflowRule !== null) {
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(root, '.claude', 'rules', 'git-workflow.md'), workflowRule);
  }
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
  assert.equal(result.calls.length, 2);
  for (const call of result.calls) {
    assert.equal(call.cwd, root);
  }
});

test('作業している場所がセッションを始めたフォルダと違う（worktree など）: 作業している場所のリポジトリで数える', () => {
  const root = createRepo();
  const elsewhere = mkdtempSync(join(workRoot, 'elsewhere-'));
  const result = runHook(root, { issues: { 'status:next': [14] } }, {}, { CLAUDE_PROJECT_DIR: elsewhere });
  assertContinued(result);
  assert.equal(result.calls[0].cwd, root);
});

test('auto-merge で進められる Issue が残っている: 続け方と、そのまま止まってよい場合も伝える', () => {
  const root = createRepo();
  const context = assertContinued(runHook(root, { issues: { 'status:next': [14] } }));
  assert.match(context, /feature の「続きから始める」のとおりに進める（作業途中の Issue があれば、先に仕上げる）/);
  assert.match(context, /setup の実行の間、利用者の直前の依頼が開発の続きではないとき/);
  assert.match(
    context,
    /feature の手順 7 の「止まるとき」（.*lint-staged の退避で止まり、利用者にアプリを閉じてもらうのを待つ/,
  );
  assert.match(context, /feature の手順 9 で、画面を見た利用者が伝えるのを待っている/);
  assert.match(context, /バックグラウンドのサブエージェントかコマンドの結果を待っている（結果の知らせで再開する）/);
});

test('計画の親・setup と update-rules の Issue・Dependabot の Issue: 数えない', () => {
  const root = createRepo();
  const ghState = {
    issues: {
      'status:next': [
        { number: 30, title: '[依存] Bump vitest from 3.0.0 to 3.1.0', body: '- PR: …\n\n<!-- dependabot-pr: 12 -->' },
        { number: 31, title: '[依存] 依存の脆弱性の修正', body: '' },
      ],
      'status:doing': [
        { number: 1, title: '[計画] 在庫を管理したい', body: '' },
        { number: 2, title: '[設定] 初回セットアップの適用', body: '' },
        { number: 3, title: '[標準] 標準 0.9.33 の取り込み', body: '' },
      ],
    },
  };
  const context = assertContinued(runHook(root, ghState));
  assert.match(context, /残っている Issue: #31$/m);
});

test('数えない Issue だけが残っている: 止まらせる', () => {
  const root = createRepo();
  const ghState = { issues: { 'status:doing': [{ number: 1, title: '[計画] 在庫を管理したい', body: '' }] } };
  assertDidNothing(runHook(root, ghState));
  assert.equal(readState(root), null);
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

test('裏の作業の結果を待って止まるのを繰り返す: 残りの組が変わらなければ、続けるよう伝えるのは最初の 1 回だけ', () => {
  const root = createRepo();
  const ghState = { issues: { 'status:next': [14, 22] } };
  const tasks = [{ id: 'task-1', type: 'subagent', status: 'running', agent_type: 'review-scripts' }];
  assertContinued(runHook(root, ghState));
  for (let round = 0; round < 3; round += 1) {
    // 結果を待つ間の終わり: 裏で作業が動いているので、伝えない
    assertDidNothing(runHook(root, ghState, { background_tasks: tasks }));
    // 結果の知らせで再開した後の終わり: 残りの組が変わっていないので、伝えない
    assertDidNothing(runHook(root, ghState));
  }
  assert.deepEqual(readState(root)['session-a'].issues, [14, 22]);
});

test('CI などの shell の結果を待って止まるのを繰り返す: 残りの組が変わらなければ、続けるよう伝えるのは最初の 1 回だけ', () => {
  const root = createRepo();
  const ghState = { issues: { 'status:next': [14, 22] } };
  const tasks = [{ id: 'task-1', type: 'shell', status: 'running', command: 'gh pr checks 40 --watch' }];
  assertContinued(runHook(root, ghState, { background_tasks: tasks }));
  for (let round = 0; round < 3; round += 1) {
    assertDidNothing(runHook(root, ghState, { background_tasks: tasks }));
    assertDidNothing(runHook(root, ghState));
  }
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

test('setup の記録に setupCompletedAt が無い: setup が済んでいないものとして、gh を呼ばずに止まらせる', () => {
  const root = createRepo({ mergePolicy: 'auto-merge' });
  const result = runHook(root, { issues: { 'status:next': [14] } });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('記録が self-review で、規約に「auto-merge のとき」の節がある: auto-merge と同じに、続けるよう伝える', () => {
  const root = createRepo({ ...AUTO_MERGE, mergePolicy: 'self-review' }, { workflowRule: '## `auto-merge` のとき\n' });
  assertContinued(runHook(root, { issues: { 'status:next': [14] } }));
});

test('記録が self-review で、規約に「auto-merge のとき」の節が無い: gh を呼ばずに止まらせる', () => {
  const root = createRepo({ ...AUTO_MERGE, mergePolicy: 'self-review' }, { workflowRule: '# git の進め方\n' });
  const result = runHook(root, { issues: { 'status:next': [14] } });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});

test('裏で動いているのが shell（開発用のサーバー）だけ: 続けるよう伝える', () => {
  const root = createRepo();
  const tasks = [{ id: 'task-1', type: 'shell', status: 'running', command: 'npm run dev -w server' }];
  assertContinued(runHook(root, { issues: { 'status:next': [14] } }, { background_tasks: tasks }));
});

test('裏でサブエージェントが動いている: gh を呼ばずに止まらせる', () => {
  const root = createRepo();
  const tasks = [
    { id: 'task-1', type: 'shell', status: 'running', command: 'npm run dev -w server' },
    { id: 'task-2', type: 'subagent', status: 'running', agent_type: 'review-scripts' },
  ];
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

test('gh の出力が JSON でない: 0 件とは扱わず、残した組を消さずに止まらせる', () => {
  const root = createRepo();
  assertContinued(runHook(root, { issues: { 'status:next': [14] } }));
  assertDidNothing(runHook(root, { raw: 'not json\n' }));
  assert.deepEqual(readState(root)['session-a'].issues, [14]);
});

test('組を残すフォルダを作れない: 続けさせ続けないよう、何も出さずに止まらせる', () => {
  const root = createRepo();
  // git の共通フォルダの中の shinnn をファイルにして、フォルダを作れなくする
  writeFileSync(join(root, '.git', 'shinnn'), '');
  const ghState = { issues: { 'status:next': [14] } };
  assertDidNothing(runHook(root, ghState));
  assertDidNothing(runHook(root, ghState));
});

test('組のファイルを書けない: 続けさせ続けないよう、何も出さずに止まらせる', () => {
  const root = createRepo();
  // 組のファイルの場所をフォルダにして、書けなくする
  mkdirSync(stateFile(root), { recursive: true });
  assertDidNothing(runHook(root, { issues: { 'status:next': [14] } }));
});

test('SHINNN_SKIP_STOP_CHECK の指定: gh を呼ばずに止まらせる', () => {
  const result = runHook(createRepo(), { issues: { 'status:next': [14] } }, {}, { SHINNN_SKIP_STOP_CHECK: '1' });
  assertDidNothing(result);
  assert.deepEqual(result.calls, []);
});
