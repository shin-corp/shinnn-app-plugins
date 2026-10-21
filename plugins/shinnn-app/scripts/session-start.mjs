/**
 * SessionStart hook。セッションの最初に「今どこにいるか」を出す。
 * exit 0 の標準出力は Claude のコンテキストに追加されるため、Issue と PR の状況をそのまま渡す。
 * 進捗は GitHub の Issue・PR・CI で管理し、リポジトリの中に写しは持たない。
 * gh が無い環境では、GitHub の画面の URL と、gh の導入・ログインの案内を出す。
 * 一覧を取得できなかった欄は、0 件（「（なし）」）と見分けられるよう、取得できなかったことと理由の要点を出す。
 * 依存か git のフックが入っていない作業フォルダ（作ったばかりの worktree など）では、先に npm install を促す。
 * 「引き継ぎメモ」Issue に CI で確かめていないマージ（手元の確かめで進めた PR と、外しているブランチ保護）が残っていれば、
 * 確かめる手順を案内する。
 * gh の呼び出しは最大 4 回（次に着手する Issue・open な PR・直近の CI・引き継ぎメモ）。hooks.json の timeout（60 秒）に収まるよう、
 * 呼び出しに使える時間の合計を HOOK_BUDGET に絞る。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromRoot, hasCommand, isAppRepo, projectDir, readHookInput, run } from './lib/hook-io.mjs';
import { UNVERIFIED_MERGES_HEADING, unverifiedMergeLines } from './lib/unverified-merges.mjs';

const MAX_LINES = 10;

/** gh の 1 回の呼び出しを待つ時間（ミリ秒） */
const GH_TIMEOUT = 20_000;

/**
 * gh の呼び出しに使える時間の合計（ミリ秒）。hooks.json の SessionStart の timeout（60 秒）より短くする。
 * gh は最大 4 回呼ぶので、1 回ごとに GH_TIMEOUT で待つと合計が 60 秒を超えうる。残りの時間が短い呼び出しは、待つ時間を残りに絞る。
 */
const HOOK_BUDGET = 50_000;

const startedAt = Date.now();

/** gh の呼び出しに残っている時間（ミリ秒）。使い切っていれば 0 */
function remainingBudget() {
  return Math.max(0, HOOK_BUDGET - (Date.now() - startedAt));
}

/**
 * 一覧の取得（ghSection）の gh が、時間切れ（または起動できず）になったか。
 * これを見るのは、引き継ぎメモの取得（unverifiedMergesSection）だけで、なっていれば取得を飛ばす。
 * 一覧の取得どうしは、前が時間切れでも飛ばさず、待つ時間を残りに絞って呼ぶ。
 */
let ghFailedToStart = false;

function section(title, body) {
  const text = body.trim();
  return text ? `## ${title}\n${text}` : `## ${title}\n（なし）`;
}

/**
 * gh が失敗した理由の要点。標準エラー出力の最初の行を使い、末尾に付く API の URL は長いので除く。
 *
 * 例: 「HTTP 401: Bad credentials」
 */
function failureReason(result) {
  if (result.failedToStart) {
    return 'gh が起動できないか、時間内に終わりませんでした';
  }
  const firstLine = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine === undefined) {
    return `gh が終了コード ${result.status} で終わりました`;
  }
  return firstLine
    .replace(/^gh: /, '')
    .replace(/\s*\(https?:\/\/[^)]*\)$/, '')
    .slice(0, 200);
}

/** gh の一覧を 1 つの節にする。取得できなければ「（なし）」ではなく、取得できなかったことと理由を書く */
function ghSection(title, args, root) {
  const result = run('gh', args, { cwd: root, timeout: Math.min(GH_TIMEOUT, Math.max(remainingBudget(), 1000)) });
  ghFailedToStart ||= result.failedToStart;
  if (result.failedToStart || result.status !== 0) {
    return `## ${title}\n取得できませんでした（${failureReason(result)}）`;
  }
  return section(title, result.stdout.split('\n').filter(Boolean).slice(0, MAX_LINES).join('\n'));
}

/**
 * git の remote の URL から、GitHub の画面の URL（https://<ホスト>/<owner>/<repo>）を作る。作れなければ null。
 *
 * `git@github.com:owner/repo.git` / `ssh://git@github.com/owner/repo.git` / `https://github.com/owner/repo.git`
 * の形を受け付ける。URL に含まれる認証情報（`https://user:token@...`）とポートは出さない。
 */
function webUrl(remote) {
  const text = remote.trim();
  const scp = /^[\w.-]+@([\w.-]+):\/?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(text);
  if (scp) {
    return `https://${scp[1]}/${scp[2]}`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) {
    return null;
  }
  const path = url.pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(path) ? `https://${url.hostname}/${path}` : null;
}

/** gh が無いときの節。一覧の代わりに、GitHub の画面の URL と gh の導入・ログインの案内を出す */
function withoutGhSection(root) {
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  const base = remote.failedToStart || remote.status !== 0 ? null : webUrl(remote.stdout);
  const where =
    base === null
      ? [
          'GitHub のリポジトリの画面（Issues / Pull requests / Actions）で見てください' +
            '（git の remote の origin から URL を作れませんでした）。',
        ]
      : ['GitHub の画面で見てください。', `- Issue: ${base}/issues`, `- PR: ${base}/pulls`, `- CI: ${base}/actions`];
  return [
    '## Issue と PR',
    'gh（GitHub CLI）が無いため、open な Issue と PR、直近の CI を取得できません。',
    ...where,
    'gh を入れて `gh auth login` でログインすると、次のセッションからここに一覧が出ます。',
    '引き継ぎの注意は、pin した「引き継ぎメモ」Issue にあります。',
  ].join('\n');
}

/** ファイルの中身を 1 行として読む。無ければ null。 */
function readVersion(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * セットアップの節。setupCompletedAt が空なら、まだ /shinnn-app:setup を終えていないものとして案内する。
 *
 * @param setupPath - .shinnn/setup.json の絶対パス
 * @param installed - リポジトリに入っている標準のバージョン（.claude/rules/.standards-version の中身。無ければ null）
 */
function setupSection(setupPath, installed) {
  let setup;
  try {
    setup = JSON.parse(readFileSync(setupPath, 'utf8'));
  } catch {
    return section('セットアップ', '.shinnn/setup.json を読めませんでした。/shinnn-app:setup を再実行してください。');
  }

  const completedAt = setup.setupCompletedAt ?? null;
  if (completedAt === null) {
    return [
      '## セットアップが未完了',
      '.shinnn/setup.json の setupCompletedAt がまだ空です。',
      '最初に `/shinnn-app:setup` を実行して、テンプレートの選択・環境の確認・必要な機能の決定を済ませてください。',
    ].join('\n');
  }

  const profile = setup.profile ?? '不明';
  const mergePolicy = setup.mergePolicy ?? 'human';
  const standards = installed ?? '不明';
  return section(
    'セットアップ',
    `プロファイル: ${profile} / マージ方針: ${mergePolicy} / 標準バージョン: ${standards}`,
  );
}

/**
 * 依存と git のフックの節。どちらかが無ければ npm install を促す。両方あれば null（節を出さない）。
 *
 * husky は git にフックの置き場所を `.husky/_` という相対パスで登録する。`.husky/_` は npm install のときに作られ、
 * git の管理外なので、作ったばかりの worktree には無い。その間は main への push の拒否とコミット前の lint が動かない。
 */
function dependencySection(root) {
  const hasModules = existsSync(fromRoot(root, 'node_modules'));
  const hasHooks = !existsSync(fromRoot(root, '.husky')) || existsSync(fromRoot(root, '.husky', '_', 'h'));
  if (hasModules && hasHooks) {
    return null;
  }
  return [
    '## 依存が入っていません',
    'この作業フォルダには、依存（node_modules）か git のフック（.husky/_）がありません（作ったばかりの worktree など）。',
    '作業を始める前に `npm install` を実行してください。入れるまでは、`main` への push の拒否とコミット前の lint が動かず、',
    '`npm run dev` や `npm test` も動きません。',
  ].join('\n');
}

/**
 * 「CI で確かめていないマージ」の節。「引き継ぎメモ」Issue（setup.json の handoverIssue）の見出しの下に行があるときだけ出す。
 * 行は、手元の確かめで進めた PR と、外しているブランチ保護。
 * 番号が無い・前の gh の呼び出しが時間切れだった・この gh の呼び出しが失敗した・行が無いときは null（節を出さない）。
 * gh の失敗は、前の 3 つの節が示す。この呼び出しだけが失敗したときは、示さずに節を出さない。
 *
 * @param setupPath - .shinnn/setup.json の絶対パス
 * @param root - リポジトリのルート
 */
function unverifiedMergesSection(setupPath, root) {
  let handover;
  try {
    handover = JSON.parse(readFileSync(setupPath, 'utf8')).handoverIssue;
  } catch {
    return null;
  }
  const remaining = remainingBudget();
  if (!Number.isInteger(handover) || handover <= 0 || ghFailedToStart || remaining === 0) {
    return null;
  }
  const result = run('gh', ['issue', 'view', String(handover), '--json', 'body', '--jq', '.body'], {
    cwd: root,
    timeout: Math.min(GH_TIMEOUT, remaining),
  });
  if (result.failedToStart || result.status !== 0) {
    return null;
  }
  const lines = unverifiedMergeLines(result.stdout);
  if (lines.length === 0) {
    return null;
  }
  return section(
    UNVERIFIED_MERGES_HEADING,
    [
      `「引き継ぎメモ」Issue（#${handover}）に、CI が始まらないまま手元の確かめで進めた PR か、外しているブランチ保護の行が残っています。`,
      ...lines,
      'Actions が動くなら、`/shinnn-app:pr` の「9. CI で確かめていないマージを確かめる」で `main` の CI を走らせてください。',
    ].join('\n'),
  );
}

const input = await readHookInput();

// テンプレートから作ったアプリのリポジトリでだけ動く
const root = projectDir(input);
if (!isAppRepo(root)) {
  process.exit(0);
}

const out = [];

const distributed = readVersion(
  fileURLToPath(new URL('../template/.claude/rules/.standards-version', import.meta.url)),
);
const installed = readVersion(fromRoot(root, '.claude', 'rules', '.standards-version'));

out.push(setupSection(fromRoot(root, '.shinnn', 'setup.json'), installed));

const dependencies = dependencySection(root);
if (dependencies !== null) {
  out.push(dependencies);
}

if (distributed !== null && installed !== distributed) {
  out.push(
    section(
      '標準の更新があります',
      [
        `リポジトリの標準: ${installed ?? '不明'} / 配布されている標準: ${distributed}`,
        '`/shinnn-app:update-rules` を実行すると、規約・CLAUDE.md 雛形・アプリ作り方ガイド・権限の設定・git のフック・コミット時の整形の設定・確認のスクリプト・ワークフロー・PR テンプレート・Dependabot の設定の差分を取り込み、setup の記録の形も揃えて PR にします。',
      ].join('\n'),
    ),
  );
}

if (hasCommand('gh')) {
  out.push(
    ghSection(
      '次に着手する Issue（status:next）',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        'status:next',
        '--limit',
        String(MAX_LINES),
        '--json',
        'number,title',
        '--template',
        '{{range .}}#{{.number}} {{.title}}\n{{end}}',
      ],
      root,
    ),
  );
  out.push(
    ghSection(
      'open な PR',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        String(MAX_LINES),
        '--json',
        'number,title,isDraft',
        '--template',
        '{{range .}}#{{.number}} {{.title}}{{if .isDraft}}（draft）{{end}}\n{{end}}',
      ],
      root,
    ),
  );
  out.push(
    ghSection(
      '直近の CI',
      [
        'api',
        // 品質の判断に使う CI（ci.yaml と policy.yaml）だけを、1 回の呼び出しで取る。
        // ほかのワークフロー（Dependabot の対応づけなど）の実行は混ぜない。実行中は結果（conclusion）がまだ空なので、状態（status）を出す
        'repos/{owner}/{repo}/actions/runs?per_page=20',
        '--jq',
        'limit(6; .workflow_runs[] | select(.path | startswith(".github/workflows/ci.yaml") or startswith(".github/workflows/policy.yaml")) | .name + ": " + (.conclusion // .status) + " / " + .display_title)',
      ],
      root,
    ),
  );
  const unverified = unverifiedMergesSection(fromRoot(root, '.shinnn', 'setup.json'), root);
  if (unverified !== null) {
    out.push(unverified);
  }
} else {
  out.push(withoutGhSection(root));
}

console.log(['# shinnn-app セッション開始時の状況', ...out].join('\n\n'));
process.exit(0);
