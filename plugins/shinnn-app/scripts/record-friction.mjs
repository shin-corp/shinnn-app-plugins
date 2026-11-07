/**
 * PostToolUseFailure・PermissionRequest・PermissionDenied・StopFailure の hook。
 * 作業が詰まったところを、手元の記録（`<git の共通フォルダ>/shinnn/friction.jsonl`）に 1 行ずつ書く。
 * 記録するのは、ツールの失敗、確認が出た操作、権限の自動判定（auto mode）が止めた操作、API のエラーでの中断の 4 つ。
 * 記録は /shinnn-app:session-retro が `friction-report.mjs` で読み、規約・スキル・許可の直しを出す材料にする。
 *
 * 記録には、コマンドの先頭 160 文字、エラーの 1 行目と要点の行、ファイルのパスなどを残す。書いた中身は残さない。
 * 認証情報に見える値は、切り詰める前に伏せる。
 * PostToolUseFailure では、決まった失敗に直し方を添え、同じ失敗がこのセッションで 3 回目になったら知らせる（additionalContext）。
 * 直し方の判定にはエラーの全文を使い、記録と回数の判定にはエラーの 1 行目と要点の行を使う。
 * StopFailure では、同じ作業フォルダで始めた別のセッションの最初に知らせるための印を残す（session-start.mjs が読む）。
 * どの hook も操作を止めない。
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRICTION_FILE, readRecords, stopFailureFile } from './lib/friction.mjs';
import { hookOutput, isAppRepo, projectDir, readHookInput, stateDir, toRepoPath } from './lib/hook-io.mjs';

/** 記録に残すコマンドの長さの上限（文字） */
const MAX_WHAT = 160;

/** 記録に残すエラーの長さの上限（文字） */
const MAX_ERROR = 200;

/** 記録のファイルがこの大きさを超えたら、新しい行だけを残す */
const TRIM_AT_BYTES = 256 * 1024;

/** 縮めるときに残す行の数 */
const KEEP_LINES = 500;

/** 同じ失敗がこの回数に達したら知らせる */
const REPEAT_THRESHOLD = 3;

/** このくらい長いコマンドは、引用符が正しくても途中で切れて失敗することがある（Windows の Bash ツールで起きる） */
const LONG_COMMAND = 4000;

/** 中身にコマンドを持つツール */
const COMMAND_TOOLS = ['Bash', 'PowerShell'];

/** 中身にファイルのパスを持つツール */
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/**
 * エラーの要点に見える行の形。上から順に探し、最初に当たった形の最初の行を要点にする。
 * 強い形を先に置くのは、`throw er; // Unhandled 'error' event` や vitest の集計の行のような、
 * 弱い語を含むだけの行を選ばないためである。
 */
const SIGNIFICANT_LINES = [
  // vitest などの、落ちたテストの名前の行（FAIL  tests/a.test.ts > AC-2 …）
  /^FAIL\s/,
  // Node などの例外の行（Error: listen EADDRINUSE …、AssertionError: …）
  /^[A-Za-z]*Error\b/,
  // git や GitHub が断った理由の行
  /\b(?:rejected|refusing|denied)\b/i,
  // npm・git のエラーの行
  /^(?:npm (?:ERR!|error)|fatal:|error:)/i,
  // そのほかのエラーに見える行
  /error|fail|not found|No such file|EADDRINUSE/i,
];

/**
 * エラーの要点に選ばない行。npm が先に出すスクリプトの見出し（`> …`）、git の送り先の行（`To …`）、
 * vitest の開始の行（`RUN …`）、Node の例外の前置き（`throw er; …`・`^`）
 */
const NOISE_LINE = /^(?:>\s|To\s|RUN\s|throw\s|\^$)/;

/** 回数を比べる前に除く、所要時間（`6ms`・`1.2s`） */
const DURATION = /\s*\b\d+(?:\.\d+)?\s?m?s\b/g;

/** 認証情報に見える値と、伏せた後の形。上から順に当てる */
const SECRET_PATTERNS = [
  // URL の中のパスワード（postgres://user:pass@host の pass。利用者名は残す）
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1***@'],
  // JSON のキーの値（"password": "…"、"token": "…" など）
  [
    /("(?:password|passwd|pass|pwd|token|access_?token|refresh_?token|id_?token|secret|client_?secret|api_?key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    '$1"***"',
  ],
  // 名前に KEY・TOKEN・SECRET・PASSWORD などを含む環境変数の代入（PowerShell の `$env:X = '…'` も含む）
  [
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi,
    '$1***',
  ],
  // --password などのオプションの値
  [/(--(?:password|passwd|token|secret|api-?key)[=\s])("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  // curl の -u / --user の「名前:パスワード」のパスワード
  [/((?:^|\s)(?:-u|--user)[=\s]+["']?)([^\s:'"]+):([^\s'"]+)/g, '$1$2:***'],
  // mysql などの -p に続けて書いたパスワード
  [/(\b(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(?!\s)(\S+)/g, '$1***'],
  // 認証の HTTP ヘッダーの値（Authorization は方式の語も含めて伏せる）
  [/(\bauthorization\s*:\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s"']+/gi, '$1***'],
  [/(\b(?:x-)?(?:api-?key|auth-token)\s*:\s*)[^\s"']+/gi, '$1***'],
  [/(\bcookie\s*:\s*)[^"'\n]+/gi, '$1***'],
  // よく使われるトークンの形
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '***'],
  [/\bsk-[A-Za-z0-9_-]{10,}/g, '***'],
  [/\bBearer\s+\S+/gi, 'Bearer ***'],
];

/** 決まった失敗と、添える直し方。matches にはエラーの全文とコマンドを渡す */
const HINTS = [
  {
    matches: (error, command) =>
      /unexpected EOF while looking for matching/.test(error) && command.length > LONG_COMMAND,
    text:
      'このくらい長いコマンドは、引用符が正しくても、この形のエラーで失敗することがあります。' +
      '中身を Write ツールで scratchpad のファイルに書き、そのファイルを実行してください。',
  },
  {
    matches: (error) => /EADDRINUSE|address already in use/i.test(error),
    text:
      'ポートが使われています。' +
      'このセッションで起動したプロセスでなければ、止めません。' +
      'その場合は、`/shinnn-app:dev-stack-start` の「うまく行かないとき」のとおり、空いているポートで起動してください。',
  },
  {
    matches: (error) => /without `?workflow`? scope/i.test(error),
    text:
      'GitHub のトークンに `workflow` スコープがありません。' +
      'ワークフローを変える変更の push とマージには、このスコープが要ります。' +
      '`gh auth refresh -h github.com -s workflow` で足せることを、利用者に伝えてください。' +
      'マージで断られたときは、人にマージを頼みます（`/shinnn-app:pr` の「7. マージする」）。',
  },
];

/** 同じ失敗が REPEAT_THRESHOLD 回目になったときに添える文 */
const REPEAT_TEXT =
  `同じ操作の同じ失敗が、このセッションで ${REPEAT_THRESHOLD} 回目です。` +
  '同じやり方を繰り返さず、原因を調べ直すか、やり方を変えてください。' +
  '`auto-merge` では、規約 `git-workflow.md` の「`auto-merge` のとき」の、`status:blocked` にする条件に当たるかも見直してください。';

/** 認証情報に見える値を伏せる */
function mask(text) {
  let masked = String(text ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

/** 改行を空白にし、上限の長さで切る */
function oneLine(text, max) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, max)}…`;
}

/** 要点の行を選ぶ。SIGNIFICANT_LINES の形を上から順に探し、どれにも当たらなければ NOISE_LINE を飛ばした最初の行 */
function pickDetail(lines) {
  const candidates = lines.filter((line) => !NOISE_LINE.test(line));
  for (const pattern of SIGNIFICANT_LINES) {
    const found = candidates.find((line) => pattern.test(line));
    if (found !== undefined) {
      return found;
    }
  }
  return candidates[0];
}

/**
 * エラーの要点を 1 行にする。1 行目（Bash なら `Exit code N`）と、要点の行（pickDetail）をつなぐ。
 * 同じ失敗を同じ文字列にするため、所要時間は除く。
 */
function errorHead(error) {
  const lines = mask(error)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) {
    return '';
  }
  const detail = pickDetail(lines.slice(1));
  const head = detail === undefined ? lines[0] : `${lines[0]} | ${detail.replace(DURATION, '')}`;
  return oneLine(head, MAX_ERROR);
}

/** ツールの中身を、記録に残す前の 1 つの文字列にする。中身そのもの（書いた文章など）は残さない */
function describe(toolName, toolInput, root) {
  const input = toolInput ?? {};
  if (COMMAND_TOOLS.includes(toolName)) {
    return String(input.command ?? '');
  }
  if (FILE_TOOLS.includes(toolName)) {
    const path = input.file_path ?? input.notebook_path ?? '';
    return toRepoPath(path, root) || String(path);
  }
  if (toolName === 'Glob' || toolName === 'Grep') {
    return String(input.pattern ?? '');
  }
  if (toolName === 'WebFetch' && typeof input.url === 'string') {
    try {
      const url = new URL(input.url);
      return `${url.origin}${url.pathname}`;
    } catch {
      return '';
    }
  }
  return '';
}

/** hook の入力から、記録の 1 行を作る */
function toRecord(input, root) {
  const event = input.hook_event_name ?? '';
  const record = {
    at: new Date().toISOString(),
    event,
    session: String(input.session_id ?? '').slice(0, 8),
  };
  if (event === 'StopFailure') {
    record.error = oneLine(input.error, MAX_ERROR);
    // error_details が無いことがあるので、画面に出たエラーの文（last_assistant_message）で代える
    record.details = oneLine(mask(input.error_details ?? input.last_assistant_message), MAX_ERROR);
    return record;
  }
  record.tool = input.tool_name ?? '';
  record.what = oneLine(mask(describe(record.tool, input.tool_input, root)), MAX_WHAT);
  if (input.permission_mode !== undefined) {
    record.mode = input.permission_mode;
  }
  if (event === 'PostToolUseFailure') {
    record.error = errorHead(input.error);
    if (input.is_interrupt === true) {
      record.interrupt = true;
    }
  }
  if (event === 'PermissionDenied') {
    record.reason = oneLine(mask(input.reason), MAX_ERROR);
  }
  return record;
}

/** 1 行を書き足す。大きくなりすぎたら、新しい行だけを残す */
function append(file, record) {
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  if (statSync(file).size <= TRIM_AT_BYTES) {
    return;
  }
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  writeFileSync(file, `${lines.slice(-KEEP_LINES).join('\n')}\n`);
}

/** このセッションで、同じツール・同じ中身・同じエラーの失敗が何回あったか（今回を含む。利用者が止めたものは数えない） */
function countSameFailures(file, record) {
  let count = 0;
  for (const other of readRecords(file)) {
    const same =
      other.event === 'PostToolUseFailure' &&
      other.interrupt !== true &&
      other.session === record.session &&
      other.tool === record.tool &&
      other.what === record.what &&
      other.error === record.error;
    if (same) {
      count += 1;
    }
  }
  return count;
}

/** 失敗に添える文。添えるものが無ければ空。利用者が止めた操作には添えない */
function adviceFor(record, input, file) {
  if (record.interrupt === true) {
    return '';
  }
  const error = String(input.error ?? '');
  const command = String(input.tool_input?.command ?? '');
  const advice = [];
  if (COMMAND_TOOLS.includes(record.tool)) {
    for (const hint of HINTS) {
      if (hint.matches(error, command)) {
        advice.push(hint.text);
      }
    }
  }
  if (countSameFailures(file, record) === REPEAT_THRESHOLD) {
    advice.push(REPEAT_TEXT);
  }
  return advice.join('\n');
}

const input = await readHookInput();
const root = projectDir(input);
if (!isAppRepo(root)) {
  process.exit(0);
}

const dir = stateDir(root);
if (dir === null) {
  process.exit(0);
}

try {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, FRICTION_FILE);
  const record = toRecord(input, root);
  append(file, record);

  if (record.event === 'StopFailure') {
    const marker = { at: record.at, error: record.error, details: record.details, session: record.session, root };
    writeFileSync(join(dir, stopFailureFile(root)), `${JSON.stringify(marker)}\n`);
  }
  if (record.event === 'PostToolUseFailure') {
    const advice = adviceFor(record, input, file);
    if (advice !== '') {
      process.stdout.write(hookOutput('PostToolUseFailure', { additionalContext: advice }));
    }
  }
} catch {
  // 記録できなくても、作業は止めない
}
