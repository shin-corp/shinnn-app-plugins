/**
 * session-start の回帰テスト。`node --test scripts/` で実行する。
 *
 * - 標準の版は `.claude/rules/.standards-version` の 1 か所だけに持つ。セッションの開始時に示す版が
 *   このファイルだけから読まれ、`.shinnn/setup.json` の値は使われないことを確かめる
 * - gh が無いときは、リポジトリの中のファイルを進捗として出さずに、GitHub の画面の URL と gh の導入・ログインの案内を出す
 * - gh の一覧の取得に失敗した欄は、0 件（「（なし）」）と書かずに、取得できなかったことと理由を書く
 * - 依存か git のフックが無い作業フォルダ（作ったばかりの worktree など）では npm install を促し、両方あれば促さない
 * - 「引き継ぎメモ」Issue に「CI で確かめていないマージ」の行があるときだけ、その節を出す
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
import { unverifiedMergeLines } from './lib/unverified-merges.mjs';

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
 * - body: `issue view` には環境変数 FAKE_GH_BODY を本文として出し、それ以外は何も出さずに成功する
 * - timeout: `--version` 以外は、時間切れ（ETIMEDOUT）で失敗する
 * - issue-view: `issue view <番号>` が FAKE_GH_ISSUE の番号のときだけ FAKE_GH_BODY を出し、それ以外は失敗する
 */
const FAKE_CHILD_PROCESS = `
import * as childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
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

// 時計を、gh を呼ぶたびに FAKE_GH_ELAPSED ミリ秒ずつ進める（待たずに、時間のかかる gh を再現する）
let offset = 0;
const realNow = Date.now;
Date.now = () => realNow() + offset;

export function spawnSync(command, args = [], options = {}) {
  if (command !== 'gh') {
    return childProcess.spawnSync(command, args, options);
  }
  if (args[0] !== '--version' && process.env.FAKE_GH_LOG) {
    appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, timeout: options.timeout, elapsed: offset }) + '\\n');
    offset += Number(process.env.FAKE_GH_ELAPSED ?? 0);
  }
  const mode = process.env.FAKE_GH;
  if (mode === 'missing') {
    const error = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
    return { error, status: null, stdout: '', stderr: '' };
  }
  if (mode === 'timeout' && args[0] !== '--version') {
    const error = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' });
    return { error, status: null, stdout: '', stderr: '' };
  }
  if (mode === 'body') {
    const isIssueView = args[0] === 'issue' && args[1] === 'view';
    return { status: 0, stdout: isIssueView ? (process.env.FAKE_GH_BODY ?? '') : '', stderr: '' };
  }
  if (mode === 'issue-view') {
    // FAKE_GH_ISSUE があれば、その番号の Issue だけを答える（番号が渡ったかを確かめる）
    const isExpected = args[2] === (process.env.FAKE_GH_ISSUE ?? args[2]);
    const isIssueView = args[0] === 'issue' && args[1] === 'view';
    if (isIssueView && isExpected) {
      return { status: 0, stdout: process.env.FAKE_GH_BODY ?? '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'not found' };
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
 * @param ghBody - body と issue-view のときに `issue view` が出す本文
 * @param ghIssue - issue-view のときに答える Issue の番号
 * @param ghLog - gh の呼び出しを JSON の行で書くファイル
 * @param ghElapsed - gh を 1 回呼ぶたびに進める時計の分（ミリ秒）
 */
function runHook(root, { gh = 'missing', ghStderr = '', ghBody = '', ghIssue = '', ghLog = '', ghElapsed = 0 } = {}) {
  const result = spawnSync(process.execPath, ['--import', fakeChildProcess, script], {
    input: '{}',
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      FAKE_GH: gh,
      FAKE_GH_STDERR: ghStderr,
      FAKE_GH_BODY: ghBody,
      FAKE_GH_ISSUE: ghIssue,
      FAKE_GH_LOG: ghLog,
      FAKE_GH_ELAPSED: String(ghElapsed),
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 偽の gh が書いた呼び出しの記録を読む */
function readCalls(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
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

test('直近の CI は ci.yaml と policy.yaml の実行を 1 回の呼び出しで取り、実行中（結果がまだ空）のときは状態を出す', () => {
  const root = createRepo({});
  const result = runHook(root, { gh: 'echo' });

  assert.equal(result.status, 0, result.stderr);
  const ci = section(result.stdout, '直近の CI');
  assert.match(ci, /^api repos\/\{owner\}\/\{repo\}\/actions\/runs\?per_page=20 --jq /m);
  assert.ok(ci.includes('startswith(".github/workflows/ci.yaml")'), ci);
  assert.ok(ci.includes('startswith(".github/workflows/policy.yaml")'), ci);
  assert.ok(ci.includes('(.conclusion // .status)'), ci);
});

/** 依存と git のフックを入れた状態にする（npm install の後と同じ場所にファイルを置く） */
function installDependencies(root) {
  writeFile(root, 'node_modules/.package-lock.json', '{}\n');
  writeFile(root, '.husky/pre-push', '# 本物のフック\n');
  writeFile(root, '.husky/_/h', '# husky が作る呼び出し役\n');
}

test('依存: node_modules と .husky/_ の両方があれば、npm install を促さない', () => {
  const root = createRepo({});
  installDependencies(root);
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('## 依存が入っていません'), result.stdout);
});

test('依存: node_modules が無ければ、npm install を促す', () => {
  const root = createRepo({});
  installDependencies(root);
  rmSync(join(root, 'node_modules'), { recursive: true });
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(section(result.stdout, '依存が入っていません'), /`npm install` を実行してください/);
});

test('依存: node_modules があっても .husky/_ が無ければ（git のフックが動かない）、npm install を促す', () => {
  const root = createRepo({});
  installDependencies(root);
  rmSync(join(root, '.husky', '_'), { recursive: true });
  const result = runHook(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(section(result.stdout, '依存が入っていません'), /main` への push の拒否/);
});

const HANDOVER_BODY = [
  '## 引き継ぎの注意',
  '- 注意の 1 行',
  '',
  '## CI で確かめていないマージ',
  '- #12（2026-10-20）',
  '- #15（2026-10-21）',
  '',
  '## シン株式会社への要望',
  '- 要望の 1 行',
  '',
].join('\n');

test('CI で確かめていないマージ: 引き継ぎメモの見出しの下の行を、確かめる手順の案内と一緒に出す', () => {
  const root = createRepo({ handoverIssue: 3 });
  const result = runHook(root, { gh: 'body', ghBody: HANDOVER_BODY });

  assert.equal(result.status, 0, result.stderr);
  const text = section(result.stdout, 'CI で確かめていないマージ');
  assert.match(text, /（#3）/);
  assert.match(text, /^- #12（2026-10-20）$/m);
  assert.match(text, /^- #15（2026-10-21）$/m);
  assert.doesNotMatch(text, /注意の 1 行|要望の 1 行/);
  assert.match(text, /\/shinnn-app:pr` の「9\. CI で確かめていないマージを確かめる」/);
});

test('CI で確かめていないマージ: 見出しの下に行が無ければ、節を出さない', () => {
  const root = createRepo({ handoverIssue: 3 });
  const result = runHook(root, { gh: 'body', ghBody: '## CI で確かめていないマージ\n\n## 次の見出し\n- #1\n' });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('## CI で確かめていないマージ'), result.stdout);
});

test('CI で確かめていないマージ: handoverIssue が無いときと gh が失敗したときは、節を出さない', () => {
  const withoutNumber = runHook(createRepo({}), { gh: 'body', ghBody: HANDOVER_BODY });
  assert.equal(withoutNumber.status, 0, withoutNumber.stderr);
  assert.ok(!withoutNumber.stdout.includes('## CI で確かめていないマージ'), withoutNumber.stdout);

  const failed = runHook(createRepo({ handoverIssue: 3 }), { gh: 'fail', ghStderr: 'HTTP 401: Bad credentials\n' });
  assert.equal(failed.status, 0, failed.stderr);
  assert.ok(!failed.stdout.includes('## CI で確かめていないマージ'), failed.stdout);
});

test('CI で確かめていないマージ: setup.json の handoverIssue の番号で issue view を呼ぶ', () => {
  const root = createRepo({ handoverIssue: 3 });
  const called = runHook(root, { gh: 'issue-view', ghBody: HANDOVER_BODY, ghIssue: '3' });
  assert.equal(called.status, 0, called.stderr);
  assert.match(section(called.stdout, 'CI で確かめていないマージ'), /^- #12（2026-10-20）$/m);

  const otherIssue = runHook(root, { gh: 'issue-view', ghBody: HANDOVER_BODY, ghIssue: '4' });
  assert.equal(otherIssue.status, 0, otherIssue.stderr);
  assert.ok(!otherIssue.stdout.includes('## CI で確かめていないマージ'), otherIssue.stdout);
});

test('CI で確かめていないマージ: 外しているブランチ保護の行も並べる', () => {
  const root = createRepo({ handoverIssue: 3 });
  const body = '## CI で確かめていないマージ\n- #12（2026-10-20）\n- ブランチ保護を外している（2026-10-20）\n';
  const result = runHook(root, { gh: 'body', ghBody: body });

  assert.equal(result.status, 0, result.stderr);
  assert.match(section(result.stdout, 'CI で確かめていないマージ'), /^- ブランチ保護を外している（2026-10-20）$/m);
});

test('unverifiedMergeLines: 見出しの下から次の見出しの手前までの `- ` の行だけを返す', () => {
  assert.deepEqual(unverifiedMergeLines(HANDOVER_BODY), ['- #12（2026-10-20）', '- #15（2026-10-21）']);
  assert.deepEqual(unverifiedMergeLines('## CI で確かめていないマージ\r\n- #7（2026-10-21）\r\n'), [
    '- #7（2026-10-21）',
  ]);
  assert.deepEqual(
    unverifiedMergeLines('## CI で確かめていないマージ\n- #7（2026-10-21）\n#tag\n- #8（2026-10-21）\n'),
    ['- #7（2026-10-21）', '- #8（2026-10-21）'],
  );
  assert.deepEqual(unverifiedMergeLines('本文に CI で確かめていないマージ と書いただけ\n- #1\n'), []);
  assert.deepEqual(unverifiedMergeLines(''), []);
  assert.deepEqual(unverifiedMergeLines(null), []);
});

/** session-start.mjs の HOOK_BUDGET（gh の呼び出しに使える時間の合計）と GH_TIMEOUT（1 回の上限） */
const HOOK_BUDGET = 50_000;
const GH_TIMEOUT = 20_000;

test('時間の枠: 前の gh が時間切れなら、引き継ぎメモの取得（issue view）を呼ばない', () => {
  const root = createRepo({ handoverIssue: 3 });
  const log = join(workRoot, 'timeout.log');
  writeFileSync(log, '');
  const result = runHook(root, { gh: 'timeout', ghBody: HANDOVER_BODY, ghLog: log });

  assert.equal(result.status, 0, result.stderr);
  const calls = readCalls(log);
  assert.equal(calls.length, 3, JSON.stringify(calls));
  assert.ok(!calls.some(({ args }) => args[0] === 'issue' && args[1] === 'view'), JSON.stringify(calls));
  assert.match(
    section(result.stdout, '直近の CI'),
    /取得できませんでした（gh が起動できないか、時間内に終わりませんでした）/,
  );
});

test('時間の枠: 各呼び出しの timeout は、HOOK_BUDGET から経った時間を引いた値以下で、残りが無ければ引き継ぎメモの取得を飛ばす', () => {
  const root = createRepo({ handoverIssue: 3 });
  const log = join(workRoot, 'slow.log');
  writeFileSync(log, '');
  // 1 回ごとに 12 秒かかる gh。4 回目の issue view を呼ぶ時点で、36 秒が経っている
  const result = runHook(root, { gh: 'body', ghBody: HANDOVER_BODY, ghLog: log, ghElapsed: 12_000 });

  assert.equal(result.status, 0, result.stderr);
  const calls = readCalls(log);
  assert.equal(calls.length, 4, JSON.stringify(calls));
  for (const { args, timeout, elapsed } of calls) {
    assert.ok(
      timeout <= Math.max(HOOK_BUDGET - elapsed, 1000),
      `${args.join(' ')}: timeout=${timeout} elapsed=${elapsed}`,
    );
    assert.ok(timeout <= GH_TIMEOUT, `${args.join(' ')}: timeout=${timeout}`);
  }
  // 実際に経った時間の分だけ、残りは 14 秒より少し短くなる
  assert.ok(
    calls[3].timeout <= HOOK_BUDGET - 36_000 && calls[3].timeout > HOOK_BUDGET - 36_000 - 5000,
    String(calls[3].timeout),
  );

  // 枠を使い切った後は、issue view を呼ばない（3 回で 51 秒が経つ）
  const exhausted = join(workRoot, 'exhausted.log');
  writeFileSync(exhausted, '');
  const skipped = runHook(root, { gh: 'body', ghBody: HANDOVER_BODY, ghLog: exhausted, ghElapsed: 17_000 });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(readCalls(exhausted).length, 3);
  assert.ok(!skipped.stdout.includes('## CI で確かめていないマージ'), skipped.stdout);

  // 枠を使い切った後の一覧の取得も、待つ時間を 1 秒に絞る（GH_TIMEOUT で待たない）
  const overrun = join(workRoot, 'overrun.log');
  writeFileSync(overrun, '');
  runHook(root, { gh: 'empty', ghLog: overrun, ghElapsed: 30_000 });
  const overrunCalls = readCalls(overrun);
  assert.equal(overrunCalls.length, 3, JSON.stringify(overrunCalls));
  assert.equal(overrunCalls[2].timeout, 1000, JSON.stringify(overrunCalls));
});
