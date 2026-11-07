/**
 * scripts/record-friction.mjs（作業が詰まったところを記録する hook）と scripts/friction-report.mjs（記録のまとめ）の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 一時フォルダに git のリポジトリと目印（.shinnn/setup.json）を作り、hook に JSON を stdin で渡して、
 * `.git/shinnn/` に書かれた記録と、Claude に添える文を確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stopFailureFile } from './lib/friction.mjs';

const hookScript = fileURLToPath(new URL('./record-friction.mjs', import.meta.url));
const reportScript = fileURLToPath(new URL('./friction-report.mjs', import.meta.url));

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'record-friction-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** git のリポジトリと目印を作る */
function createAppRepo() {
  const root = mkdtempSync(join(workRoot, 'app-'));
  const result = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  mkdirSync(join(root, '.shinnn'));
  writeFileSync(
    join(root, '.shinnn', 'setup.json'),
    `${JSON.stringify({ setupCompletedAt: '2026-01-01T00:00:00.000Z' })}\n`,
  );
  return root;
}

/** hook を実行し、終了コードと、Claude に添えた文を返す */
function runHook(root, input) {
  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({ session_id: 'session-aaaa-1111', cwd: root, ...input }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const context = result.stdout === '' ? '' : JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  return { status: result.status, stderr: result.stderr, context };
}

/** 記録の行 */
function records(root) {
  const file = join(root, '.git', 'shinnn', 'friction.jsonl');
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/** Node の EADDRINUSE の、実物の出力（Bash の失敗の error の形） */
const NODE_EADDRINUSE = [
  'Exit code 1',
  'node:events:497',
  "      throw er; // Unhandled 'error' event",
  '      ^',
  '',
  'Error: listen EADDRINUSE: address already in use :::39123',
  '    at Server.setupListenHandle [as _listen2] (node:net:1940:16)',
  "Emitted 'error' event on Server instance at:",
  "  code: 'EADDRINUSE',",
].join('\n');

/** vitest 5 の失敗の、実物の出力。failing は落ちたテストの名前、value は受け取った値、ms は所要時間 */
function vitestFailure(failing, value, ms) {
  return [
    'Exit code 1',
    '> @app/server@0.0.0 test',
    '> vitest run',
    ' RUN  v5.0.5 /work/app/server',
    ` ❯ tests/items.test.ts (3 tests | 1 failed) ${ms}ms`,
    `   × ${failing} ${ms - 2}ms`,
    '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
    ` FAIL  tests/items.test.ts > ${failing}`,
    `AssertionError: expected ${value} to be 2 // Object.is equality`,
    ' Test Files  1 failed | 1 passed (2)',
    `   Duration  ${ms * 40}ms (import 46%, transform 30%)`,
  ].join('\n');
}

/** Bash の失敗の入力 */
function bashFailure(command, error) {
  return {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command },
    error,
    permission_mode: 'auto',
  };
}

test('失敗: コマンドと、エラーの 1 行目と要点の行を記録し、何も添えない', () => {
  const root = createAppRepo();
  const result = runHook(
    root,
    bashFailure('npm test', 'Exit code 1\nError: Cannot find module\n    at a.js:1\n    at b.js:2'),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.context, '');
  const [record] = records(root);
  assert.equal(record.event, 'PostToolUseFailure');
  assert.equal(record.tool, 'Bash');
  assert.equal(record.what, 'npm test');
  assert.equal(record.error, 'Exit code 1 | Error: Cannot find module');
  assert.equal(record.mode, 'auto');
  assert.equal(record.session, 'session-');
});

test('失敗: 認証情報に見える値は伏せて記録する', () => {
  const root = createAppRepo();
  runHook(
    root,
    bashFailure(
      'GITHUB_TOKEN=ghp_abcdefghijklmnop1234 API_KEY="s3cr3t value" curl -H "Authorization: Bearer xyz.abc" https://example.com',
      'Exit code 22\nsk-abcdefghijklmnopqrstu was rejected',
    ),
  );

  const [record] = records(root);
  assert.match(record.what, /GITHUB_TOKEN=\*\*\*/);
  assert.match(record.what, /API_KEY=\*\*\*/);
  assert.ok(!record.what.includes('ghp_abcdefghijklmnop1234'), record.what);
  assert.ok(!record.what.includes('s3cr3t'), record.what);
  assert.ok(!record.what.includes('xyz.abc'), record.what);
  assert.ok(!record.error.includes('sk-abcdefghijklmnopqrstu'), record.error);
});

test('失敗: URL の中のパスワード・オプションの値・認証のヘッダーも伏せ、切り詰める前に伏せる', () => {
  const root = createAppRepo();
  runHook(
    root,
    bashFailure(
      'psql "postgresql://admin:Sup3rPw@localhost:5432/app" --password Sup3rPw -H "X-Api-Key: Sup3rPw"',
      'Exit code 2\nerror: connect ECONNREFUSED postgres://app:Sup3rPw@localhost:5432/app',
    ),
  );
  runHook(root, bashFailure(`${'x'.repeat(130)} API_KEY="abc Sup3rPw rest of a long quoted value"`, 'Exit code 1'));

  for (const record of records(root)) {
    assert.ok(!JSON.stringify(record).includes('Sup3rPw'), JSON.stringify(record));
  }
  assert.match(records(root)[0].what, /postgresql:\/\/admin:\*\*\*@localhost/);
});

test('失敗: curl の -u、JSON の値、PowerShell の代入、Cookie、mysql の -p も伏せる', () => {
  const root = createAppRepo();
  const commands = [
    'curl -u admin:Sup3rPw https://example.com/api',
    'curl -d \'{"email":"a@example.com","password":"Sup3rPw"}\' https://example.com/login',
    "$env:DB_PASSWORD = 'Sup3rPw'; npm run dev",
    'curl -H "Cookie: session=Sup3rPw" https://example.com',
    'mysql -u root -pSup3rPw app',
  ];
  for (const command of commands) {
    runHook(root, bashFailure(command, 'Exit code 1\n{"error":"denied","token":"Sup3rPw"}'));
  }

  for (const record of records(root)) {
    assert.ok(!JSON.stringify(record).includes('Sup3rPw'), JSON.stringify(record));
  }
});

test('失敗: Write と Edit は、書いた中身ではなくリポジトリからのパスを記録する', () => {
  const root = createAppRepo();
  runHook(root, {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Write',
    tool_input: { file_path: join(root, 'server', 'src', 'a.ts'), content: 'const password = "secret";' },
    error: 'File has not been read yet',
  });

  const [record] = records(root);
  assert.equal(record.what, 'server/src/a.ts');
  assert.ok(!JSON.stringify(record).includes('secret'));
});

test('失敗: 長いコマンドが引用符のエラーで落ちたら、ファイルに書いて実行するよう添える', () => {
  const root = createAppRepo();
  const error = "Exit code 2\n/usr/bin/bash: -c: line 240: unexpected EOF while looking for matching `''";

  const long = runHook(root, bashFailure(`cat > a.ts <<'E'\n${'x'.repeat(5000)}\nE`, error));
  assert.match(long.context, /Write ツールで scratchpad のファイルに書き/);

  const short = runHook(root, bashFailure("echo 'unterminated", error));
  assert.equal(short.context, '', '短いコマンドは、ただの引用符の誤りなので添えない');
});

test('失敗: ポートが使われていたら、ほかのプロセスを止めずに空いているポートで起動するよう添える', () => {
  const root = createAppRepo();
  const result = runHook(
    root,
    bashFailure('npm run dev -w server', 'Exit code 1\nError: listen EADDRINUSE: address already in use :::3000'),
  );

  assert.match(result.context, /止めません/);
  assert.match(result.context, /dev-stack-start` の「うまく行かないとき」/);

  // npm は、エラーより先にスクリプトの見出しを出す。直し方はエラーの全文で判定する
  const viaNpm = runHook(
    root,
    bashFailure(
      'npm start -w server',
      'Exit code 1\n> @app/server@0.0.0 start\n> node dist/index.js\nnode:events:497\n      throw er;\nError: listen EADDRINUSE: address already in use :::3000',
    ),
  );
  assert.match(viaNpm.context, /止めません/);
  assert.equal(records(root).at(-1).error, 'Exit code 1 | Error: listen EADDRINUSE: address already in use :::3000');
});

test('失敗: workflow スコープが無くてマージできなければ、人に頼むよう添える', () => {
  const root = createAppRepo();
  const error =
    'Exit code 1\nrefusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yaml` without `workflow` scope';
  const merge = runHook(root, bashFailure('gh pr merge 12 --merge --delete-branch', error));
  assert.match(merge.context, /`workflow` スコープがありません/);
  assert.match(merge.context, /人にマージを頼みます/);

  // git は、拒否の理由より先に送り先の行を出す
  const pushError =
    'Exit code 1\nTo github.com:example/app.git\n ! [remote rejected] feature/3-ci -> feature/3-ci (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yaml` without `workflow` scope)';
  const push = runHook(root, bashFailure('git push -u origin feature/3-ci', pushError));
  assert.match(push.context, /gh auth refresh -h github\.com -s workflow/, 'push で断られたときの足し方も添える');
});

test('失敗: 同じセッションで同じ失敗が 3 回目になったときに 1 回だけ知らせる', () => {
  const root = createAppRepo();
  const input = bashFailure('npm test -w server', 'Exit code 1\nAssertionError: expected 1 to be 2');

  assert.equal(runHook(root, input).context, '');
  assert.equal(runHook(root, input).context, '');
  assert.equal(runHook(root, { ...input, session_id: 'bbbbbbbb-2222' }).context, '', '別のセッションは別に数える');
  assert.match(runHook(root, input).context, /同じ失敗が、このセッションで 3 回目です/);
  assert.equal(runHook(root, input).context, '', '4 回目では繰り返さない');
});

test('失敗: vitest では落ちたテストの行を要点にし、所要時間が違っても同じテストの失敗は同じに数える', () => {
  const root = createAppRepo();
  const command = 'npm test -w server';

  assert.equal(runHook(root, bashFailure(command, vitestFailure('AC-2 登録する', 5, 6))).context, '');
  assert.equal(
    records(root).at(-1).error,
    'Exit code 1 | FAIL tests/items.test.ts > AC-2 登録する',
    '集計の行や所要時間ではなく、落ちたテストの名前を残す',
  );
  assert.equal(
    runHook(root, bashFailure(command, vitestFailure('AC-3 消す', 9, 5))).context,
    '',
    '別のテストは別に数える',
  );
  assert.equal(runHook(root, bashFailure(command, vitestFailure('AC-2 登録する', 7, 5))).context, '');
  assert.match(
    runHook(root, bashFailure(command, vitestFailure('AC-2 登録する', 1, 7))).context,
    /3 回目です/,
    '受け取った値と所要時間が違っても、同じテストの失敗は同じに数える',
  );
});

test('失敗: Node の例外では、前置きの行ではなく Error の行を要点にする', () => {
  const root = createAppRepo();
  const result = runHook(root, bashFailure('npm run dev -w server', NODE_EADDRINUSE));

  assert.match(result.context, /止めません/);
  assert.equal(records(root).at(-1).error, 'Exit code 1 | Error: listen EADDRINUSE: address already in use :::39123');
});

test('失敗: 直し方は、要点の行に無い語でも、エラーの全文から判定する', () => {
  const root = createAppRepo();
  const error = [
    'Exit code 1',
    'Error: Command failed: npm run dev -w server',
    '[server] listen EADDRINUSE :::3000',
  ].join('\n');
  const result = runHook(root, bashFailure('npm run dev', error));

  assert.equal(records(root).at(-1).error, 'Exit code 1 | Error: Command failed: npm run dev -w server');
  assert.match(result.context, /止めません/);
});

test('失敗: 要点に見える行が無ければ、npm の見出しと git の送り先の行を飛ばした最初の行を残す', () => {
  const root = createAppRepo();
  runHook(root, bashFailure('git push', 'Exit code 1\nTo github.com:example/app.git\nEverything up-to-date'));

  assert.equal(records(root).at(-1).error, 'Exit code 1 | Everything up-to-date');
});

test('失敗: 利用者が止めた操作は、記録するが数えず、何も添えない', () => {
  const root = createAppRepo();
  const input = {
    ...bashFailure('npm run dev -w server', 'Exit code 130\nError: listen EADDRINUSE'),
    is_interrupt: true,
  };

  for (let i = 0; i < 2; i += 1) {
    assert.equal(runHook(root, input).context, '');
  }
  assert.equal(records(root)[0].interrupt, true);

  const failure = runHook(root, { ...input, is_interrupt: false });
  assert.ok(!failure.context.includes('3 回目'), '止めた操作は、同じ失敗の回数に入れない');
});

test('確認: 確認が出た操作を、モードと一緒に記録し、何も添えない', () => {
  const root = createAppRepo();
  const result = runHook(root, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'gh secret list' },
    permission_mode: 'default',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.context, '');
  const [record] = records(root);
  assert.deepEqual(
    [record.event, record.tool, record.what, record.mode],
    ['PermissionRequest', 'Bash', 'gh secret list', 'default'],
  );
});

test('自動判定: 止められた操作を、理由と一緒に記録する', () => {
  const root = createAppRepo();
  runHook(root, {
    hook_event_name: 'PermissionDenied',
    tool_name: 'Bash',
    tool_input: { command: 'docker system prune -af' },
    reason: '[Irreversible Local Destruction]',
  });

  const [record] = records(root);
  assert.equal(record.reason, '[Irreversible Local Destruction]');
});

test('API のエラー: 記録し、別のセッションの最初に知らせるための印を、セッションと作業フォルダつきで残す', () => {
  const root = createAppRepo();
  runHook(root, { hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests' });

  const [record] = records(root);
  assert.deepEqual(
    [record.event, record.error, record.details],
    ['StopFailure', 'rate_limit', '429 Too Many Requests'],
  );
  const marker = JSON.parse(readFileSync(join(root, '.git', 'shinnn', stopFailureFile(root)), 'utf8'));
  assert.deepEqual([marker.error, marker.session, marker.root], ['rate_limit', 'session-', root]);
});

/** 応答の終わりの hook（check-on-stop.mjs）を、lint とテストを走らせずに動かす */
function runStopHook(root, sessionId) {
  const script = fileURLToPath(new URL('./check-on-stop.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ session_id: sessionId, cwd: root }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, SHINNN_SKIP_STOP_CHECK: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
}

test('API のエラー: 同じセッションの応答が終わりまで届いたら印を消し、別のセッションの印は残す', () => {
  const root = createAppRepo();
  const marker = join(root, '.git', 'shinnn', stopFailureFile(root));
  runHook(root, { hook_event_name: 'StopFailure', error: 'overloaded' });

  runStopHook(root, 'bbbbbbbb-2222');
  assert.equal(existsSync(marker), true, '別のセッションの応答の終わりでは消さない');

  runStopHook(root, 'session-aaaa-1111');
  assert.equal(existsSync(marker), false);
});

test('API のエラー: 同じリポジトリの 2 つの作業フォルダの印は、上書きせずに並んで残す', () => {
  const root = createAppRepo();
  const other = join(root, 'wt');
  mkdirSync(join(other, '.shinnn'), { recursive: true });
  writeFileSync(join(other, '.shinnn', 'setup.json'), '{}\n');

  runHook(root, { hook_event_name: 'StopFailure', error: 'rate_limit' });
  runHook(other, { hook_event_name: 'StopFailure', error: 'overloaded' });

  const dir = join(root, '.git', 'shinnn');
  assert.equal(JSON.parse(readFileSync(join(dir, stopFailureFile(root)), 'utf8')).error, 'rate_limit');
  assert.equal(JSON.parse(readFileSync(join(dir, stopFailureFile(other)), 'utf8')).error, 'overloaded');
});

test('API のエラー: error_details が無ければ、画面に出たエラーの文を詳しくとして残す', () => {
  const root = createAppRepo();
  runHook(root, {
    hook_event_name: 'StopFailure',
    error: 'model_not_found',
    last_assistant_message: 'There is an issue with the selected model',
  });

  assert.equal(records(root)[0].details, 'There is an issue with the selected model');
});

test('記録のファイルが大きくなったら、新しい行だけを残す', () => {
  const root = createAppRepo();
  mkdirSync(join(root, '.git', 'shinnn'), { recursive: true });
  const old = `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', event: 'PermissionRequest', tool: 'Bash', what: 'x'.repeat(600) })}\n`;
  writeFileSync(join(root, '.git', 'shinnn', 'friction.jsonl'), old.repeat(600));

  runHook(root, bashFailure('npm test', 'Exit code 1'));

  const lines = records(root);
  assert.equal(lines.length, 500);
  assert.equal(lines.at(-1).what, 'npm test');
});

test('アプリのリポジトリ以外では何も書かない', () => {
  const root = mkdtempSync(join(workRoot, 'plain-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const result = runHook(root, bashFailure('npm test', 'Exit code 1'));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.context, '');
  assert.equal(existsSync(join(root, '.git', 'shinnn')), false);
});

/** まとめを実行する */
function runReport(root, args = []) {
  const result = spawnSync(process.execPath, [reportScript, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('まとめ: 種類ごとに同じ中身をまとめて多い順に出し、2 回目は前回の後の分だけを出す', () => {
  const root = createAppRepo();
  const ask = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', permission_mode: 'default' };
  runHook(root, { ...ask, tool_input: { command: 'gh run view 1' } });
  runHook(root, { ...ask, tool_input: { command: 'git -C . status' } });
  runHook(root, { ...ask, tool_input: { command: 'git -C . status' } });
  runHook(root, bashFailure('npm test', 'Exit code 1\nfail | here'));

  const first = runReport(root);
  assert.match(first, /## 作業の記録（はじめから）/);
  assert.match(first, /4 件。/);
  const requests = first.slice(first.indexOf('### 確認が出た操作'), first.indexOf('### ツールの失敗'));
  assert.ok(requests.indexOf('git -C . status') < requests.indexOf('gh run view 1'), '回数の多い順');
  assert.match(requests, /\| 2 \| Bash \| default \| git -C \. status \|/);
  assert.match(first, /fail \\\| here/, '表のセルの縦棒は逃がす');

  const second = runReport(root);
  assert.match(second, /前回まとめた .+ の後/);
  assert.match(second, /記録はありません。/);

  assert.match(runReport(root, ['--all']), /4 件。/, '--all は、はじめからの分を出す');
});

test('まとめ: 利用者が止めた操作は、失敗の表に並べない', () => {
  const root = createAppRepo();
  const input = bashFailure('npm run dev -w server', 'Exit code 130');
  runHook(root, { ...input, is_interrupt: true });
  runHook(root, { ...input, is_interrupt: true });
  runHook(root, input);

  assert.match(runReport(root, ['--all']), /\| 1 \| Bash \| npm run dev -w server \|/);
});

test('まとめ: アプリのフォルダの下のフォルダで実行しても、アプリのフォルダの記録を出す', () => {
  const root = createAppRepo();
  runHook(root, bashFailure('npm test', 'Exit code 1'));
  mkdirSync(join(root, 'server'));

  const result = spawnSync(process.execPath, [reportScript], {
    cwd: join(root, 'server'),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 件。/);
});

test('まとめ: アプリのリポジトリ以外では、そう伝えて終える', () => {
  const root = mkdtempSync(join(workRoot, 'plain-report-'));
  assert.match(runReport(root), /テンプレートから作ったアプリのリポジトリではありません/);
});
