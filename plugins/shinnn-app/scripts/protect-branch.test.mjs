/**
 * ブランチ保護の設定 protect-branch.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * スクリプトが呼ぶ gh を偽物（protect-branch.fake-gh.mjs）に差し替え、GitHub の状態ごとに次を確かめる。
 * - 設定しない場合（gh が無い・ログインしていない・対象が分からない・main に直接コミットするワークフローがある・
 *   既に保護かルールセットのルールがある・プランや権限のために使えない）は、終了コード 0 で終え、PUT しない
 * - 保護が無ければ、ci.yaml のジョブ名を必須のチェックにした本文を PUT する
 * - 最後の行が 1 行の要約になっている
 * 必須のチェックの名前は、テンプレートの ci.yaml を一時フォルダに写して読ませる。GitHub には何も送らない。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { protectionBody, readJobNames } from './protect-branch.mjs';

const script = fileURLToPath(new URL('./protect-branch.mjs', import.meta.url));

/** gh を偽物に差し替える下準備 */
const fakeGh = pathToFileURL(fileURLToPath(new URL('./protect-branch.fake-gh.mjs', import.meta.url))).href;

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 必須のチェックの名前を読むワークフロー（リポジトリルート起点） */
const CI = '.github/workflows/ci.yaml';

/** テンプレートの ci.yaml */
const templateCi = readFileSync(join(templateDir, CI), 'utf8');

/** テンプレートの ci.yaml のジョブ名。ブランチ保護の必須のチェックになる */
const TEMPLATE_CHECKS = ['型検査と lint', 'テスト', '規約チェック'];

/** 保護が無いときの GET の応答 */
const NOT_PROTECTED = { status: 404, message: 'Branch not protected' };

/** main に効いているルールセットのルールを調べる GET のパス */
const RULES_PATH = 'repos/owner/app/rules/branches/main?per_page=100';

/** 個人アカウントの無料プランの private のリポジトリで、GitHub が返す 403 */
const PLAN_403 = {
  status: 403,
  message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
};

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'protect-branch-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * 顧客のリポジトリに見立てた一時フォルダで、偽物の gh に state を答えさせてスクリプトを実行する。
 *
 * @param state 偽物の gh に渡す GitHub の状態（protect-branch.fake-gh.mjs の冒頭）
 * @param options.args スクリプトの引数
 * @param options.files リポジトリに置くファイル（パス → 中身。null なら置かない）。既定は ci.yaml だけ
 * @returns 終了コード・出力・最後の行（要約）と、gh の呼び出しの記録
 */
function runProtect(state, { args = [], files = {} } = {}) {
  const caseDir = mkdtempSync(join(workRoot, 'case-'));
  const root = join(caseDir, 'repo');
  for (const [path, content] of Object.entries({ [CI]: templateCi, ...files })) {
    if (content !== null) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  }
  mkdirSync(root, { recursive: true });
  const statePath = join(caseDir, 'state.json');
  const logPath = join(caseDir, 'gh.log');
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(logPath, '');

  const result = spawnSync(process.execPath, ['--import', fakeGh, script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, FAKE_GH_STATE: statePath, FAKE_GH_LOG: logPath },
  });
  const calls = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  const lines = result.stdout.trimEnd().split('\n');
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: lines[lines.length - 1],
    calls,
    root,
  };
}

/** gh api の呼び出しのうち、指定した HTTP メソッドのもの */
function apiCalls(calls, method) {
  return calls.filter(({ args }) => {
    if (args[0] !== 'api') {
      return false;
    }
    const index = args.indexOf('--method');
    return (index === -1 ? 'GET' : args[index + 1]) === method;
  });
}

/** 出力のうち、スクリプトの結果を示す部分（失敗の理由は標準エラーにも出る） */
function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

// ---- ci.yaml のジョブ名の読み取り ----

test('ci.yaml: テンプレートのジョブ名（型検査と lint・テスト・規約チェック）を書かれた順に読む', () => {
  assert.deepEqual(readJobNames(templateCi), TEMPLATE_CHECKS);
});

test('ci.yaml: 引用符・コメント・name の無いジョブ・CRLF を読み、steps の中の name は読まない', () => {
  const text = [
    'name: CI',
    'on:',
    '  pull_request:',
    'jobs:',
    '  # コメント',
    '  lint:',
    "    name: 'It''s lint' # 引用符とコメント",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: 手順の名前',
    '        run: echo 1',
    '',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    '          name: 本文の中の name',
    '  e2e:',
    '    runs-on: ubuntu-latest',
    '    name: "E2E \\"quoted\\""',
    'env:',
    '  name: トップレベルの別のキー',
    '',
  ].join('\r\n');

  assert.deepEqual(readJobNames(text), ["It's lint", 'build', 'E2E "quoted"']);
});

test('ci.yaml: チェックの名前が実行時に決まるジョブや、jobs の無いファイルは読めないものとして止まる', () => {
  const cases = [
    ['name: CI\non:\n  push:\n', /jobs: がありません/],
    ['jobs: { a: { runs-on: x } }\n', /ブロック形式/],
    ['jobs:\n  a:\n    name: ${{ matrix.os }} のテスト\n', /式があり/],
    ['jobs:\n  a:\n    name: テスト\n    strategy:\n      matrix:\n        os: [a, b]\n', /strategy: を使っていて/],
    ['jobs:\n  a:\n    uses: ./.github/workflows/other.yaml\n', /uses: を使っていて/],
    ['jobs:\n  a:\n    name: |\n      テスト\n', /name: を読めません/],
    ['jobs:\nenv:\n  A: b\n', /ジョブがありません/],
  ];

  for (const [text, message] of cases) {
    assert.throws(() => readJobNames(text), message, text);
  }
});

test('ci.yaml: 行で読んだジョブ名が、YAML として読んだものと同じ（テンプレートの依存を入れた手元だけで確かめる）', async (t) => {
  const yamlEntry = join(templateDir, 'node_modules', 'yaml', 'dist', 'index.js');
  if (!existsSync(yamlEntry)) {
    t.skip('テンプレートで npm ci をしていないため、yaml パッケージがありません');
    return;
  }
  const { parse } = await import(pathToFileURL(yamlEntry).href);
  const jobs = parse(templateCi).jobs;
  assert.deepEqual(
    readJobNames(templateCi),
    Object.entries(jobs).map(([id, job]) => job.name ?? id),
  );
});

// ---- 設定しないで終える場合 ----

test('gh が無い: 理由を示して終了コード 0 で終え、GitHub に問い合わせない', () => {
  const result = runProtect({ missing: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gh（GitHub CLI）が見つかりません/);
  assert.equal(result.summary, 'ブランチ保護: 設定していない（gh が無い）');
  assert.deepEqual(
    result.calls.map(({ args }) => args),
    [['--version']],
  );
});

test('gh にログインしていない: 理由を示して終了コード 0 で終える', () => {
  const result = runProtect({ loggedIn: false });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gh auth login/);
  assert.equal(result.summary, 'ブランチ保護: 設定していない（gh にログインしていない）');
  assert.deepEqual(apiCalls(result.calls, 'GET'), []);
});

test('対象のリポジトリが分からない（remote が無い）: 理由を示して終了コード 0 で終える', () => {
  const result = runProtect({ repo: null });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no git remotes found/);
  assert.equal(result.summary, 'ブランチ保護: 設定していない（対象のリポジトリが分からない）');
  assert.deepEqual(apiCalls(result.calls, 'GET'), []);
});

test('main に直接コミットするワークフロー（progress-snapshot.yaml）が残っている: 設定せず、保護を調べもしない', () => {
  const result = runProtect(
    { protection: NOT_PROTECTED },
    { files: { '.github/workflows/progress-snapshot.yaml': 'name: 進捗スナップショット\n' } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /main に直接コミットするワークフロー（\.github\/workflows\/progress-snapshot\.yaml）が残っている/,
  );
  // 消し方（標準の取り込み）を案内する
  assert.match(result.stdout, /設定するには: \/shinnn-app:update-rules で標準を取り込むと消える/);
  assert.equal(result.summary, 'ブランチ保護: 設定していない（main に直接コミットするワークフローがある）');
  assert.deepEqual(apiCalls(result.calls, 'GET'), []);
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('無効にした雛形（progress-snapshot.yaml.disabled）は、main に直接コミットするワークフローとして扱わない', () => {
  const result = runProtect(
    { protection: NOT_PROTECTED },
    { files: { '.github/workflows/progress-snapshot.yaml.disabled': 'name: 進捗スナップショット\n' } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(apiCalls(result.calls, 'PUT').length, 1);
});

test('既に保護がある: 上書きせず（PUT しない）、今の必須のチェックと ci.yaml のジョブ名との違いを示す', () => {
  const result = runProtect({
    protection: {
      status: 200,
      body: {
        required_status_checks: {
          strict: true,
          contexts: ['型検査と lint', 'build'],
          checks: [
            { context: '型検査と lint', app_id: 15368 },
            { context: 'build', app_id: 15368 },
          ],
        },
        enforce_admins: { enabled: false },
      },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /owner\/app の main には既にブランチ保護があります。上書きしません。/);
  assert.match(result.stdout, /今の必須のチェック: 「型検査と lint」「build」/);
  assert.match(result.stdout, /ci\.yaml のジョブに無いチェックが必須です: 「build」/);
  assert.match(result.stdout, /必須になっていないジョブ: 「テスト」「規約チェック」/);
  assert.equal(result.summary, 'ブランチ保護: 既にある（上書きしない）');
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('既に保護があり、必須のチェックが ci.yaml のジョブ名と同じ: 違いの案内を出さない', () => {
  const result = runProtect({
    protection: {
      status: 200,
      body: { required_status_checks: { strict: false, contexts: TEMPLATE_CHECKS, checks: [] } },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /今の必須のチェック: 「型検査と lint」「テスト」「規約チェック」/);
  assert.doesNotMatch(result.stdout, /必須になっていない|ジョブに無い/);
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

/** リポジトリと組織のルールセットのルールが main に効いている状態（GitHub の応答と同じ形） */
function activeRules() {
  const repository = { ruleset_source_type: 'Repository', ruleset_source: 'owner/app', ruleset_id: 42 };
  return [
    { type: 'pull_request', ...repository, parameters: { required_approving_review_count: 0 } },
    {
      type: 'required_status_checks',
      ...repository,
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: '型検査と lint', integration_id: 15368 }, { context: 'build' }],
      },
    },
    { type: 'deletion', ruleset_source_type: 'Organization', ruleset_source: 'my-org', ruleset_id: 73 },
    { type: 'copilot_code_review', ...repository, parameters: { review_on_push: false } },
  ];
}

test('ルールセットのルールが既にある: 従来の保護を足さず（PUT しない）、ルールの種類と必須のチェックを示す', () => {
  const result = runProtect({ protection: NOT_PROTECTED, rules: { status: 200, body: activeRules() } });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    apiCalls(result.calls, 'GET').map(({ args }) => args[1]),
    ['repos/owner/app/branches/main/protection', RULES_PATH],
  );
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
  assert.match(
    result.stdout,
    /owner\/app の main には、ルールセット（新しい方式のブランチ保護）のルールが既に効いています。/,
  );
  assert.match(
    result.stdout,
    /効いているルール: pull_request（PR の必須） \/ required_status_checks（必須のチェック） \/ deletion（削除の禁止） \/ copilot_code_review\n/,
  );
  assert.match(result.stdout, /ルールセット: owner\/app（リポジトリ、ID 42） \/ my-org（組織、ID 73）/);
  assert.match(result.stdout, /今の必須のチェック: 「型検査と lint」「build」/);
  assert.match(result.stdout, /必須になっていないジョブ: 「テスト」「規約チェック」/);
  assert.match(result.stdout, /Settings → Rules → Rulesets/);
  assert.equal(result.summary, 'ブランチ保護: 既にある（ルールセット）');
});

test('ルールセットのルールがあれば、--dry-run でも送る本文を示さない', () => {
  const result = runProtect(
    { protection: NOT_PROTECTED, rules: { status: 200, body: activeRules() } },
    { args: ['--dry-run'] },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /PUT repos\//);
  assert.equal(result.summary, 'ブランチ保護: 既にある（ルールセット）');
});

test('ルールセットのルールが空の配列: 従来どおり次へ進み、従来の方式の保護を PUT する', () => {
  const result = runProtect({ protection: NOT_PROTECTED, rules: { status: 200, body: [] } });

  assert.equal(result.status, 0, result.stderr);
  // 従来の方式の保護 → ルールセットのルール → PUT の順に呼ぶ
  assert.deepEqual(
    result.calls
      .filter(({ args }) => args[0] === 'api')
      .map(({ args }) => args.find((arg) => arg.startsWith('repos/'))),
    ['repos/owner/app/branches/main/protection', RULES_PATH, 'repos/owner/app/branches/main/protection'],
  );
  assert.equal(apiCalls(result.calls, 'PUT').length, 1);
  assert.equal(result.summary, 'ブランチ保護: 設定した（必須のチェック 3 つ）');
});

test('ルールセットのルールを調べると 403（プラン）: 「使えない」と示して終了コード 0 で終え、PUT しない', () => {
  const result = runProtect({ protection: NOT_PROTECTED, rules: PLAN_403 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary, 'ブランチ保護: 使えない（private の無料プラン）');
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('ルールセットのルールを調べられない（500）: 終了コード 1 で終え、PUT しない', () => {
  const result = runProtect({ protection: NOT_PROTECTED, rules: { status: 500, message: 'Server Error' } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /効いているルールを調べられませんでした（HTTP 500: Server Error）/);
  assert.equal(result.summary, 'ブランチ保護: 設定できなかった（GitHub の応答が想定外）');
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('プランで使えない（GET が 403）: 「使えない」と示して終了コード 0 で終え、PUT しない', () => {
  const result = runProtect({ protection: PLAN_403 });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ブランチ保護は使えません（private の無料プラン）。CI と週次レビューで担保します。/);
  assert.match(result.stdout, /GitHub の応答: Upgrade to GitHub Pro/);
  assert.equal(result.summary, 'ブランチ保護: 使えない（private の無料プラン）');
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('管理者権限が無い（GET が 404 Not Found）: 「使えない」と示して終了コード 0 で終え、PUT しない', () => {
  const result = runProtect({
    repo: { nameWithOwner: 'owner/app', viewerPermission: 'WRITE' },
    protection: { status: 404, message: 'Not Found' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /今の権限: WRITE/);
  assert.equal(result.summary, 'ブランチ保護: 使えない（リポジトリの管理者権限が無い）');
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

// ---- 設定する場合 ----

test('保護が無い（404 Branch not protected）: ci.yaml のジョブ名を必須のチェックにした本文を PUT する', () => {
  const result = runProtect({ protection: NOT_PROTECTED });

  assert.equal(result.status, 0, result.stderr);
  const [get] = apiCalls(result.calls, 'GET');
  assert.deepEqual(get.args, ['api', 'repos/owner/app/branches/main/protection']);

  const puts = apiCalls(result.calls, 'PUT');
  assert.equal(puts.length, 1);
  // 本文は引数ではなく標準入力で渡す
  assert.deepEqual(puts[0].args, [
    'api',
    '--method',
    'PUT',
    'repos/owner/app/branches/main/protection',
    '--input',
    '-',
  ]);
  const body = JSON.parse(puts[0].input);
  assert.deepEqual(body, {
    required_status_checks: {
      strict: false,
      checks: TEMPLATE_CHECKS.map((context) => ({ context })),
    },
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null,
  });
  // 廃止予定の contexts は checks と一緒に送らない。承認の必須と、履歴を一直線にする条件は付けない
  assert.equal(Object.hasOwn(body.required_status_checks, 'contexts'), false);
  assert.equal(Object.hasOwn(body, 'required_linear_history'), false);

  assert.match(result.stdout, /owner\/app の main にブランチ保護を設定しました。/);
  assert.equal(result.summary, 'ブランチ保護: 設定した（必須のチェック 3 つ）');
});

test('ci.yaml のジョブ名を変えると、必須のチェックもその名前になる', () => {
  const renamed = templateCi.replace(/^ {4}name: テスト$/m, '    name: 単体テスト');
  assert.notEqual(renamed, templateCi);

  const result = runProtect({ protection: NOT_PROTECTED }, { files: { [CI]: renamed } });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(apiCalls(result.calls, 'PUT')[0].input);
  assert.deepEqual(
    body.required_status_checks.checks.map(({ context }) => context),
    ['型検査と lint', '単体テスト', '規約チェック'],
  );
});

test('--branch: 指定したブランチを調べて設定する', () => {
  const result = runProtect({ protection: NOT_PROTECTED }, { args: ['--branch', 'release/v1'] });

  assert.equal(result.status, 0, result.stderr);
  const path = 'repos/owner/app/branches/release%2Fv1/protection';
  assert.equal(apiCalls(result.calls, 'GET')[0].args[1], path);
  assert.equal(apiCalls(result.calls, 'PUT')[0].args[3], path);
});

test('--dry-run: PUT する本文を示すだけで、PUT しない', () => {
  const result = runProtect({ protection: NOT_PROTECTED }, { args: ['--dry-run'] });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
  assert.match(result.stdout, /--dry-run。設定していません/);
  assert.match(result.stdout, /PUT repos\/owner\/app\/branches\/main\/protection/);
  // 示した本文が、設定するときに送る本文と同じ
  const json = result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1);
  assert.deepEqual(JSON.parse(json), protectionBody(TEMPLATE_CHECKS));
  assert.equal(result.summary, 'ブランチ保護: 設定していない（--dry-run）');
});

test('プランで使えない（PUT が 403）: 「使えない」と示して終了コード 0 で終える', () => {
  const result = runProtect({ protection: NOT_PROTECTED, put: PLAN_403 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(apiCalls(result.calls, 'PUT').length, 1);
  assert.equal(result.summary, 'ブランチ保護: 使えない（private の無料プラン）');
});

// ---- 失敗 ----

test('PUT がほかの理由で失敗する（422）: GitHub の応答を示して終了コード 1 で終える', () => {
  const result = runProtect({ protection: NOT_PROTECTED, put: { status: 422, message: 'Validation Failed' } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTP 422: Validation Failed/);
  assert.equal(result.summary, 'ブランチ保護: 設定できなかった（HTTP 422）');
});

test('PUT が回数の制限で 403 になる: 「使えない」とはせず、終了コード 1 で終える', () => {
  const result = runProtect({ protection: NOT_PROTECTED, put: { status: 403, message: 'API rate limit exceeded' } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTP 403: API rate limit exceeded/);
});

test('ci.yaml を読めない: 理由を示して終了コード 1 で終え、保護を調べも設定もしない', () => {
  for (const content of [null, 'jobs:\n  a:\n    name: ${{ matrix.os }}\n']) {
    const result = runProtect({ protection: NOT_PROTECTED }, { files: { [CI]: content } });

    assert.equal(result.status, 1, output(result));
    assert.match(result.stderr, /\.github\/workflows\/ci\.yaml から必須のチェックの名前を読めません/);
    assert.equal(result.summary, 'ブランチ保護: 設定できなかった（ci.yaml のジョブ名を読めない）');
    assert.deepEqual(apiCalls(result.calls, 'GET'), []);
    assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
  }
});

test('ブランチが GitHub に無い（404 Branch not found）: 終了コード 1 で終え、PUT しない', () => {
  const result = runProtect({ protection: { status: 404, message: 'Branch not found' } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /main を push した後に実行し直す/);
  assert.deepEqual(apiCalls(result.calls, 'PUT'), []);
});

test('知らない引数: 終了コード 1 で終え、GitHub に問い合わせない', () => {
  const result = runProtect({ protection: NOT_PROTECTED }, { args: ['--force'] });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /知らない引数です: --force/);
  assert.deepEqual(result.calls, []);
});
