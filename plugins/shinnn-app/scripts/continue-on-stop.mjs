/**
 * Stop hook。マージの方針が auto-merge のアプリで、進められる Issue が残っているのに応答を終えようとしたら、続けさせる。
 * 規約 git-workflow.md の「`auto-merge` のとき」は、利用者への報告を、進められる Issue が無くなったときに 1 回にまとめると決めている。
 * 途中で応答を終えると、残りの Issue は、利用者が次に頼むまで進まない。
 *
 * 動くのは、次のすべてに当たるときだけ。
 * - テンプレートから作ったアプリのリポジトリである（`.shinnn/setup.json` がある）
 * - マージの方針が auto-merge である（isAutoMerge）
 * - Claude が、裏の作業の結果を待っていない（waitingInBackground）
 * - 開いている Issue のうち、`status:next` か `status:doing` のものが 1 件以上ある
 *
 * 続けさせるときは、Stop の JSON の additionalContext で伝える。受け取った Claude は応答を続ける。
 * 続けさせたときの Issue の番号の組を、セッションごとに残す。
 * その後に応答を終えるときは、組が同じなら、進まなかったものとして止まらせる（そのセッションの間は、利用者の次の依頼の後も同じ）。
 * 組が変わっていれば（Issue が閉じた、`status:blocked` にした、など）、また続けさせる。
 * 残りが 0 件になったら、残した組を消す。組を書けなければ、続けさせない。
 * 入力の `stop_hook_active`（続けさせた後の応答の終わり）では、判定を変えない。黙ると、続けた後の 2 回目の終わりで止まる。
 *
 * gh が無い・失敗した・時間切れのときは、何も出さずに止まらせる。
 * 一時的に黙らせたいときは、環境変数 SHINNN_SKIP_STOP_CHECK に値を入れる（check-on-stop.mjs と同じ）。
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRootOf, fromRoot, hookOutput, projectDir, readHookInput, readJson, run, stateDir } from './lib/hook-io.mjs';

/** 進められる Issue に付くラベル。`status:blocked` は人の判断か前の Issue を待っているので数えない */
const WORKABLE_LABELS = ['status:next', 'status:doing'];

/**
 * 数えない Issue の題の頭。どれも、作る作業そのものではなく、スキルが進み具合を記録する Issue。
 * - `[計画]`: 計画の親（feature の plan.md）。子がすべて閉じるまで `status:doing` のまま開いている
 * - `[設定]`: setup の適用の Issue。setup の実行の間は、規約 git-workflow.md の「`auto-merge` のとき」を当てない
 * - `[標準]`: update-rules の取り込みの Issue
 */
const EXCLUDED_TITLE_PREFIXES = ['[計画]', '[設定]', '[標準]'];

/**
 * Dependabot の PR に対応する Issue の本文に、ワークフロー dependabot-issue.yaml が書く目印。
 * この Issue は bot の PR が閉じたときに閉じるので、Claude が進められる作業ではない。数えない
 */
const DEPENDABOT_MARKER = '<!-- dependabot-pr:';

/** 規約 git-workflow.md の、auto-merge での進め方の節の見出し（session-start.mjs と同じ文字列で探す） */
const AUTO_MERGE_HEADING = '## `auto-merge` のとき';

/** gh の 1 回の呼び出しを待つ時間（ミリ秒）。ラベルごとに 1 回ずつ（合わせて 2 回）呼んでも、hooks.json の timeout（60 秒）に収まる */
const GH_TIMEOUT = 20_000;

/** ラベルごとに取る Issue の数の上限 */
const ISSUE_LIMIT = 100;

/** 続けさせたときの Issue の番号の組を残すファイル（stateDir の中）。セッション ID → { issues, at } */
const STATE_FILE = 'continue-on-stop.json';

/** 残した組を消すまでの日数。残りのあるまま終わったセッションの組は消えないので、古いものを書くときに消す */
const KEEP_DAYS = 7;

/** 伝える文に並べる Issue の番号の数の上限 */
const MAX_LISTED = 20;

/**
 * マージの方針が auto-merge か。session-start.mjs と同じに扱う。
 * - `setupCompletedAt` が null の記録（setup が済んでいない）は、`mergePolicy` の値にかかわらず human として扱う
 *   （規約 git-workflow.md の「1 Issue = 1 ブランチ = 1 PR」）
 * - `self-review` は、規約 git-workflow.md に「`auto-merge` のとき」の節があれば、auto-merge と同じに扱う
 *   （標準を取り込む前の記録に残る値。節が無いうちは、確認を挟まない進め方にしない）
 *
 * @param root - アプリのリポジトリのルート
 * @param setup - `.shinnn/setup.json` の中身。読めなければ null
 */
function isAutoMerge(root, setup) {
  if (setup === null || (setup.setupCompletedAt ?? null) === null) {
    return false;
  }
  if (setup.mergePolicy === 'auto-merge') {
    return true;
  }
  if (setup.mergePolicy !== 'self-review') {
    return false;
  }
  try {
    return readFileSync(fromRoot(root, '.claude', 'rules', 'git-workflow.md'), 'utf8').includes(AUTO_MERGE_HEADING);
  } catch {
    return false;
  }
}

/**
 * Claude が、裏の作業の結果を待っているか。待っていれば、作業が終わると Claude Code が起こす。
 * そこで続けさせると、結果を待たずに次の作業へ進ませてしまう。
 * - Stop の入力の `session_crons`（起こす予約）が 1 件でもあれば、待っている
 * - `background_tasks`（裏で動いている作業）に、shell 以外（サブエージェントなど）が 1 件でもあれば、待っている
 *
 * shell の作業は数えない。開発用のサーバーのように、セッションの間ずっと動き続けるものがあるため。
 * 数えると、サーバーを起動したセッションでは、ずっと続けさせなくなる。
 * shell の結果を待って応答を終えたとき（CI の待ちなど）は、伝える文の「止まってよいとき」に当たるので、Claude が止まる。
 * その後は、残りの組が変わるまで止まらせる。
 */
function waitingInBackground(input) {
  if (Array.isArray(input.session_crons) && input.session_crons.length > 0) {
    return true;
  }
  if (!Array.isArray(input.background_tasks)) {
    return false;
  }
  for (const task of input.background_tasks) {
    if (task?.type !== 'shell') {
      return true;
    }
  }
  return false;
}

/**
 * 開いている Issue のうち、進められるものの番号（小さい順）。gh が無い・失敗した・時間切れのときは null。
 * 題が EXCLUDED_TITLE_PREFIXES で始まる Issue と、本文に DEPENDABOT_MARKER がある Issue は数えない。
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
      'number,title,body',
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
      if (!Number.isInteger(issue?.number)) {
        continue;
      }
      const title = String(issue.title ?? '');
      if (EXCLUDED_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
        continue;
      }
      if (String(issue.body ?? '').includes(DEPENDABOT_MARKER)) {
        continue;
      }
      numbers.add(issue.number);
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

/**
 * 残した組を書く。KEEP_DAYS より古い組は落とし、1 つも残らなければファイルを消す。
 *
 * @returns 書けたか（消したときと、消すファイルが無かったときも true）
 */
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
      return true;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(kept)}\n`);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT' && Object.keys(kept).length === 0;
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

if (!isAutoMerge(root, readJson(fromRoot(root, '.shinnn', 'setup.json')))) {
  process.exit(0);
}

if (waitingInBackground(input)) {
  process.exit(0);
}

// 組を残せないと、進まなかったことを見分けられず、続けさせ続ける。
// そのため、git の共通フォルダが分からないときと、組を書けなかったときは何もしない
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

// 組は、そのセッションの間は、変わるまで残す。利用者の次の依頼でも消さない
const previous = state[session]?.issues;
if (Array.isArray(previous) && sameIssues(previous, issues)) {
  process.exit(0);
}

state[session] = { issues, at: new Date().toISOString() };
if (!writeState(dir, state)) {
  process.exit(0);
}

const listed = issueList(issues);
console.log(
  hookOutput('Stop', {
    additionalContext: [
      `[shinnn-app] マージの方針が auto-merge なので、開発がすべて完了するまで続けてください。残っている Issue: ${listed}`,
      'なぜ: 利用者は、Issue の作成から PR のマージまでを任せている。利用者への報告は、進められる Issue が無くなったときに 1 回にまとめる',
      'どう続ける: /shinnn-app:feature の「続きから始める」のとおりに進める（作業途中の Issue があれば、先に仕上げる）',
      'ただし、次のどれかに当たるときは、続けずに応答を終えてよい',
      '- 規約の「`auto-merge` のとき」を当てない場面か、止まってよいとしている場面である（setup の実行の間、利用者の直前の依頼が開発の続きではないとき）',
      '- スキルの手順が、止まる・次に進まずに報告すると決めているところに当たる（feature の手順 7 の「止まるとき」（コミットが lint-staged の退避で止まり、利用者にアプリを閉じてもらうのを待つときを含む）、`git pull --ff-only` の失敗、`/reload-plugins` や起動し直しを頼むときなど）',
      '- feature の手順 9 で、画面を見た利用者が伝えるのを待っている',
      '- バックグラウンドのサブエージェントかコマンドの結果を待っている（結果の知らせで再開する）',
      '規約: .claude/rules/git-workflow.md の「`auto-merge` のとき」',
    ].join('\n'),
    systemMessage: `[shinnn-app] 進められる Issue（${listed}）が残っているので、続けるよう Claude に伝えました`,
  }),
);
process.exit(0);
