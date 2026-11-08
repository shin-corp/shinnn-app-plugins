/**
 * Stop hook。マージの方針が auto-merge のアプリで、進められる Issue が残っているのに応答を終えようとしたら、続けさせる。
 * 規約 git-workflow.md の「`auto-merge` のとき」は、利用者への報告を、進められる Issue が無くなったときに 1 回にまとめる。
 * 途中で応答を終えると、残りの Issue は、利用者が次に頼むまで進まない。
 *
 * 動くのは、次のすべてに当たるときだけ。
 * - テンプレートから作ったアプリのリポジトリである（`.shinnn/setup.json` がある）
 * - `.shinnn/setup.json` の `mergePolicy` が `auto-merge` で、`setupCompletedAt` が null でない
 * - Stop の入力の `background_tasks`（裏で動いている作業）と `session_crons`（予約した起こし）が、どちらも空である
 * - 開いている Issue のうち、`status:next` か `status:doing` のものが 1 件以上ある
 * 裏の作業を待って応答を終えたときは、作業が終わると Claude Code が起こす。そこで続けさせると、待たずに次の作業へ進ませてしまう。
 *
 * 続けさせるときは、Stop の JSON の additionalContext で伝える。受け取った Claude は応答を続ける。
 * 続けさせたときの Issue の番号の組を、セッションごとに残す。
 * 次に応答を終えるときに組が同じなら、進まなかったものとして止まらせる。
 * 組が変わっていれば（Issue が閉じた、`status:blocked` にした、など）、また続けさせる。
 * 残りが 0 件になったら、残した組を消す。
 * 入力の `stop_hook_active`（続けさせた後の応答の終わり）では、判定を変えない。黙ると、続けた後の 2 回目の終わりで止まる。
 *
 * gh が無い・失敗した・時間切れのときは、何も出さずに止まらせる。
 * 一時的に黙らせたいときは、環境変数 SHINNN_SKIP_STOP_CHECK に値を入れる（check-on-stop.mjs と同じ）。
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRootOf, fromRoot, hookOutput, projectDir, readHookInput, readJson, run, stateDir } from './lib/hook-io.mjs';

/** 進められる Issue に付くラベル。`status:blocked` は人の判断か前の Issue を待っているので数えない */
const WORKABLE_LABELS = ['status:next', 'status:doing'];

/** gh の 1 回の呼び出しを待つ時間（ミリ秒）。ラベルごとに 2 回呼んでも、hooks.json の timeout（60 秒）に収まる */
const GH_TIMEOUT = 20_000;

/** ラベルごとに取る Issue の数の上限 */
const ISSUE_LIMIT = 100;

/** 続けさせたときの Issue の番号の組を残すファイル（stateDir の中）。セッション ID → { issues, at } */
const STATE_FILE = 'continue-on-stop.json';

/** 残した組を消すまでの日数。残りのあるまま終わったセッションの組は消えないので、古いものを書くときに消す */
const KEEP_DAYS = 7;

/** 伝える文に並べる Issue の番号の数の上限 */
const MAX_LISTED = 20;

/** 配列で、1 件以上あるか */
function hasEntries(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * 開いている Issue のうち、進められるものの番号（小さい順）。gh が無い・失敗した・時間切れのときは null。
 *
 * @param root - アプリのリポジトリのルート
 */
function workableIssues(root) {
  const numbers = new Set();
  for (const label of WORKABLE_LABELS) {
    const args = [
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      label,
      '--json',
      'number',
      '--limit',
      String(ISSUE_LIMIT),
    ];
    const result = run('gh', args, { cwd: root, timeout: GH_TIMEOUT });
    if (result.failedToStart || result.status !== 0) {
      return null;
    }
    let issues;
    try {
      issues = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    if (!Array.isArray(issues)) {
      return null;
    }
    for (const issue of issues) {
      if (Number.isInteger(issue?.number)) {
        numbers.add(issue.number);
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/** 残した組を読む。無いか壊れていれば空 */
function readState(path) {
  const state = readJson(path);
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return {};
  }
  return state;
}

/** 残した組を書く。KEEP_DAYS より古い組は落とし、1 つも残らなければファイルを消す。書けなくても止めない */
function writeState(dir, state) {
  const oldest = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const kept = {};
  for (const [session, entry] of Object.entries(state)) {
    if (Date.parse(entry?.at) >= oldest) {
      kept[session] = entry;
    }
  }

  const path = join(dir, STATE_FILE);
  try {
    if (Object.keys(kept).length === 0) {
      unlinkSync(path);
      return;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(kept)}\n`);
  } catch {
    // 無いファイルを消そうとしたとき・書けないときは何もしない
  }
}

/** 2 つの番号の組が同じか。どちらも小さい順に並んでいる */
function sameIssues(left, right) {
  return left.length === right.length && left.every((number, index) => number === right[index]);
}

/** 伝える文に並べる番号。多ければ先頭の MAX_LISTED 件と残りの件数にする */
function issueList(issues) {
  const listed = issues
    .slice(0, MAX_LISTED)
    .map((number) => `#${number}`)
    .join(', ');
  const rest = issues.length - MAX_LISTED;
  return rest > 0 ? `${listed} ほか ${rest} 件` : listed;
}

const input = await readHookInput();

// 標準入力を読み切ってから判定する（読まずに終えると、hook に JSON を渡す側の書き込みが失敗する）
if (process.env.SHINNN_SKIP_STOP_CHECK) {
  process.exit(0);
}

// 作業している場所を含む、テンプレートから作ったアプリのリポジトリでだけ動く
const root = appRootOf(input.cwd || projectDir(input));
if (!root) {
  process.exit(0);
}

// setup が済んでいない記録は、mergePolicy の値にかかわらず human として扱う（規約 git-workflow.md の「1 Issue = 1 ブランチ = 1 PR」）
const setup = readJson(fromRoot(root, '.shinnn', 'setup.json'));
if (setup?.mergePolicy !== 'auto-merge' || (setup.setupCompletedAt ?? null) === null) {
  process.exit(0);
}

if (hasEntries(input.background_tasks) || hasEntries(input.session_crons)) {
  process.exit(0);
}

// 組を残せないと、進まなかったことを見分けられず、続けさせ続ける。そのときは何もしない
const dir = stateDir(root);
if (dir === null) {
  process.exit(0);
}

const issues = workableIssues(root);
if (issues === null) {
  process.exit(0);
}

const state = readState(join(dir, STATE_FILE));
const session = String(input.session_id ?? '');

if (issues.length === 0) {
  if (Object.hasOwn(state, session)) {
    delete state[session];
    writeState(dir, state);
  }
  process.exit(0);
}

const previous = state[session]?.issues;
if (Array.isArray(previous) && sameIssues(previous, issues)) {
  process.exit(0);
}

state[session] = { issues, at: new Date().toISOString() };
writeState(dir, state);

const listed = issueList(issues);
console.log(
  hookOutput('Stop', {
    additionalContext: [
      `[shinnn-app] マージの方針が auto-merge なので、開発がすべて完了するまで続けてください。残っている Issue: ${listed}`,
      'なぜ: 利用者は、Issue の作成から PR のマージまでを任せている。利用者への報告は、進められる Issue が無くなったときに 1 回にまとめる',
      'どう続ける: /shinnn-app:feature の手順 7 のとおりに、次の Issue を選んで進める',
      'ただし、次のどちらかに当たるときは、続けずに応答を終えてよい',
      '- feature の手順 7 の「止まるとき」に当たる（コミットが lint-staged の退避で止まり、利用者にアプリを閉じてもらうのを待つときなど）',
      '- 利用者の直前の依頼が、開発の続きではない（質問・別の作業・止める指示）',
      '規約: .claude/rules/git-workflow.md の「`auto-merge` のとき」',
    ].join('\n'),
    systemMessage: `[shinnn-app] 進められる Issue（${listed}）が残っているので、続けるよう Claude に伝えました`,
  }),
);
process.exit(0);
