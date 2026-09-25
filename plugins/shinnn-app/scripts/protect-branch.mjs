#!/usr/bin/env node
/**
 * /shinnn-app:setup が、顧客のリポジトリの main にブランチ保護を設定するスクリプト。
 *
 * ブランチ保護は GitHub のリポジトリの設定で、条件を満たさない変更を main に入れさせない。ここで課す条件は次のとおり。
 * - CI（`.github/workflows/ci.yaml`）のジョブがすべて通った PR だけをマージできる（必須のチェック）。
 *   チェックの名前は ci.yaml の各ジョブの `name:` で、ファイルから読む
 * - 管理者にも同じ条件を課す。main への直接の push もできなくなる
 * - PR の承認は必須にしない。必須にすると、マージの方針が self-review のとき /shinnn-app:pr が PR をマージできない
 * - PR のブランチが最新の main を取り込んでいることは求めない（strict: false）。履歴を一直線にすることも求めない
 *   （/shinnn-app:pr はマージコミットを作ってマージする）
 *
 * 次の場合は設定せずに、理由を示して終了コード 0 で終える（setup は止めない）。
 * - gh が無い・ログインしていない・対象のリポジトリが分からない
 * - main に直接コミットするワークフロー（progress-snapshot.yaml）がある。必須のチェックがあると、そのコミットが拒まれる
 * - 既に保護がある。人が決めた設定かもしれないので上書きせず、今の必須のチェックを示す
 * - ルールセット（新しい方式のブランチ保護。リポジトリか組織の設定）のルールが、既にそのブランチに 1 つでも効いている。
 *   従来の保護を足すと 2 つの設定が重なって分かりにくくなるので足さず、効いているルールの種類と必須のチェックを示す
 * - プランか権限のために使えない（例: 無料プランの private のリポジトリ）。CI と週次レビューで担保する
 * ci.yaml のジョブ名を読めない、GitHub が想定外の応答を返した、などは終了コード 1。
 *
 * 最後の行に 1 行の要約（例「ブランチ保護: 設定した（必須のチェック 3 つ）」）を出す。
 * README の「有効な機能」表と決定記録にそのまま書ける形にしてある。
 *
 * 実行例:
 *   node <プラグイン>/scripts/protect-branch.mjs --dry-run
 *
 * 引数:
 *   --branch <名前>  保護するブランチ（既定は main）
 *   --dry-run        設定せずに、GitHub に送る内容だけを出す（今の保護の有無は調べる）
 *
 * 対象は CLAUDE_PROJECT_DIR（無ければカレント）のリポジトリ。GitHub 上のどのリポジトリかは、
 * `gh repo view` が git の remote から決める。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCommand, run } from './lib/hook-io.mjs';

/** 必須のチェックの名前を読む CI のワークフロー（リポジトリルート起点） */
const CI_WORKFLOW = '.github/workflows/ci.yaml';

/** main に直接コミットするワークフロー。あれば保護を設定しない */
const DIRECT_COMMIT_WORKFLOWS = ['.github/workflows/progress-snapshot.yaml', '.github/workflows/progress-snapshot.yml'];

/** gh の 1 回の呼び出しを待つ上限 */
const GH_TIMEOUT_MS = 30_000;

/** gh がログインを求めて終わるときの終了コード（`gh help exit-codes`） */
const GH_EXIT_AUTH_REQUIRED = 4;

/** 保護が無いときに GitHub が返す 404 の message */
const NOT_PROTECTED = 'Branch not protected';

/** ブランチが GitHub に無いときに GitHub が返す 404 の message */
const BRANCH_NOT_FOUND = 'Branch not found';

/** ルールセットのルールを一度に読む件数（GitHub の上限） */
const RULES_PER_PAGE = 100;

/** ルールセットのルールの種類（`type`）の説明。ここに無い種類は `type` だけを示す */
const RULE_LABELS = {
  creation: 'ブランチの作成の制限',
  update: '更新の制限',
  deletion: '削除の禁止',
  non_fast_forward: '強制 push の禁止',
  required_linear_history: '履歴を一直線にする',
  required_signatures: '署名付きコミットの必須',
  pull_request: 'PR の必須',
  required_status_checks: '必須のチェック',
  merge_queue: 'マージキュー',
  required_deployments: 'デプロイの成功の必須',
};

/** ジョブの中で、GitHub 上のチェックの名前を実行時に決めるキー。使っていれば名前を読めないものとして扱う */
const NAME_CHANGING_KEYS = new Set(['strategy', 'uses']);

/** 要約の行の書き出し */
const SUMMARY = 'ブランチ保護';

/** `--branch value` と `--dry-run` を読む。読めなければ理由を投げる */
function parseArgs(argv) {
  const options = { branch: 'main', dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (key !== '--branch') {
      throw new Error(`知らない引数です: ${key}`);
    }

    const value = argv[i + 1];

    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(`${key} の値が指定されていません。`);
    }
    i += 1;
    options.branch = value;
  }

  return options;
}

/** 空行か、コメントだけの行か */
function isBlank(text) {
  return /^\s*(#.*)?$/.test(text);
}

/**
 * `name:` の値。引用符で囲んだものと囲まないものを読む。複数行の書き方・式を含む名前は読めないものとして投げる。
 *
 * @param raw `name:` より後ろの文字列
 * @param jobId エラーの文言に使うジョブのキー
 */
function nameValue(raw, jobId) {
  const text = raw.trim();
  let value;

  if (text.startsWith("'")) {
    value = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(text)?.[1].replaceAll("''", "'");
  } else if (text.startsWith('"')) {
    const inner = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(text)?.[1];
    try {
      value = inner === undefined ? undefined : JSON.parse(`"${inner}"`);
    } catch {
      value = undefined;
    }
  } else if (!/^[[{|>&*!%@`]/.test(text)) {
    value = text.replace(/\s+#.*$/, '').trim();
  }

  if (!value) {
    throw new Error(`ジョブ ${jobId} の name: を読めません（${text || '値が空'}）`);
  }
  if (value.includes('${{')) {
    throw new Error(`ジョブ ${jobId} の name: に式があり、チェックの名前が実行時に決まります（${value}）`);
  }
  return value;
}

/**
 * ci.yaml の各ジョブの、GitHub 上のチェックの名前（`name:`。無ければジョブのキー）を書かれた順に返す。
 * 読めなければ、理由を持つ Error を投げる。
 *
 * YAML のパーサーは使わない（プラグインは依存を持たない）。読むのは、ブロック形式で書いた `jobs:` の直下のキーと、
 * その直下の `name:` だけ。マトリクス（strategy）や別のワークフローを呼ぶ（uses）ジョブと、式（${{ }}）を含む名前は、
 * チェックの名前が実行時に決まるので読めないものとして扱う。
 *
 * @param text ci.yaml の中身
 */
export function readJobNames(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:/.test(line));

  if (start === -1) {
    throw new Error('トップレベルに jobs: がありません');
  }
  if (!isBlank(lines[start].slice('jobs:'.length))) {
    throw new Error('jobs: の中身が同じ行に書かれています（ブロック形式で書く）');
  }

  const jobs = [];
  let jobIndent = null;
  let keyIndent = null;

  for (const line of lines.slice(start + 1)) {
    if (isBlank(line)) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    // 次のトップレベルのキーで jobs: は終わる
    if (indent === 0) {
      break;
    }
    jobIndent ??= indent;
    if (indent < jobIndent) {
      throw new Error(`jobs: の字下げを読めません（${line.trim()}）`);
    }

    const pair = /^([\w-]+):(.*)$/.exec(line.trim());

    if (indent === jobIndent) {
      if (pair === null || !isBlank(pair[2])) {
        throw new Error(`jobs: の中のジョブを読めません（${line.trim()}）`);
      }
      jobs.push({ id: pair[1], name: pair[1] });
      keyIndent = null;
      continue;
    }

    // ジョブの直下のキーだけを見る。steps の中の name: などはもっと深い
    keyIndent ??= indent;
    if (indent !== keyIndent || pair === null) {
      continue;
    }

    const job = jobs[jobs.length - 1];

    if (NAME_CHANGING_KEYS.has(pair[1])) {
      throw new Error(`ジョブ ${job.id} は ${pair[1]}: を使っていて、チェックの名前が実行時に決まります`);
    }
    if (pair[1] === 'name') {
      job.name = nameValue(pair[2], job.id);
    }
  }

  if (jobs.length === 0) {
    throw new Error('jobs: の中にジョブがありません');
  }
  return [...new Set(jobs.map((job) => job.name))];
}

/**
 * GitHub に送る本文（PUT repos/{owner}/{repo}/branches/{branch}/protection）。
 *
 * 必須のキー 4 つ（required_status_checks / enforce_admins / required_pull_request_reviews / restrictions）は、
 * 使わないものも null で送る。チェックの名前は checks に書く。contexts は廃止予定で、checks と一緒に送ると
 * GitHub が 422（検証の失敗）を返す。app_id は付けない。付けなければ、そのチェックを最近報告したアプリ
 * （GitHub Actions）が選ばれる。
 *
 * @param checkNames 必須にするチェックの名前
 */
export function protectionBody(checkNames) {
  return {
    required_status_checks: {
      strict: false,
      checks: checkNames.map((context) => ({ context })),
    },
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null,
  };
}

/** 文字列の最初の空でない行 */
function firstLine(text) {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** チェックの名前の並びを「」で囲んで示す */
function quoteNames(names) {
  return names.length === 0 ? 'なし' : names.map((name) => `「${name}」`).join('');
}

/** 設定せずに終える（終了コード 0） */
function notApplied(reason, message, how) {
  console.log(`[shinnn-app:setup] ブランチ保護を設定しませんでした。${message}`);
  if (how) {
    console.log(`  設定するには: ${how}`);
  }
  return { code: 0, summary: `${SUMMARY}: 設定していない（${reason}）` };
}

/** プランか権限のために使えないので終える（終了コード 0） */
function unavailable(reason, response) {
  console.log(`[shinnn-app:setup] ブランチ保護は使えません（${reason}）。CI と週次レビューで担保します。`);
  if (response) {
    console.log(`  GitHub の応答: ${response}`);
  }
  return { code: 0, summary: `${SUMMARY}: 使えない（${reason}）` };
}

/** 続けられない理由を出して終える（終了コード 1） */
function failed(reason, message, how) {
  console.error(`[shinnn-app:setup] ${message}`);
  if (how) {
    console.error(`  どう直す: ${how}`);
  }
  return { code: 1, summary: `${SUMMARY}: 設定できなかった（${reason}）` };
}

/** gh を対象のリポジトリで実行する */
function gh(root, args, input) {
  const options = { cwd: root, timeout: GH_TIMEOUT_MS };
  if (input !== undefined) {
    options.input = Buffer.from(input, 'utf8');
  }
  return run('gh', args, options);
}

/**
 * gh api の失敗を、HTTP の状態コードと GitHub の応答の message に分ける。
 * gh は、GitHub の応答の本文を標準出力に、`gh: <message> (HTTP <状態コード>)` を標準エラーに出す。
 */
function apiError(result) {
  let body = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = null;
  }
  const status = Number(body?.status) || Number(/\(HTTP (\d{3})\)/.exec(result.stderr)?.[1]) || null;
  const message = typeof body?.message === 'string' ? body.message : firstLine(result.stderr);
  return { status, message: message || '応答がありません' };
}

/**
 * 403 のうち、プランか権限のために使えないと分かるものの理由。分からなければ null（回数の制限など、待てば通るもの）。
 * private のリポジトリは、個人アカウントなら GitHub Pro、組織なら GitHub Team 以上でないと使えず、
 * GitHub は「Upgrade to GitHub Pro or make this repository public to enable this feature.」などを返す。
 */
function unavailableReason(message) {
  if (/upgrade to github|make this repository public/i.test(message)) {
    return 'private の無料プラン';
  }
  if (/admin rights|resource not accessible/i.test(message)) {
    return 'リポジトリの管理者権限が無い';
  }
  return null;
}

/**
 * gh api の失敗のうち、どの場面でも同じに扱うもの（プランか権限のために使えない）を結果にする。当てはまらなければ null。
 *
 * 管理者権限の無い人が保護を読み書きしようとすると、GitHub は 403 ではなく 404（Not Found）を返すことがある。
 */
function unavailableOutcome(error, repo) {
  if (error.status === 403) {
    const reason = unavailableReason(error.message);
    return reason === null ? null : unavailable(reason, error.message);
  }
  if (error.status === 404 && repo.viewerPermission !== null && repo.viewerPermission !== 'ADMIN') {
    return unavailable('リポジトリの管理者権限が無い', `${error.message}（今の権限: ${repo.viewerPermission}）`);
  }
  return null;
}

/** 対象のリポジトリ（owner/name）と、実行している人の権限。決められなければ problem に理由 */
function resolveRepo(root) {
  const result = gh(root, ['repo', 'view', '--json', 'nameWithOwner,viewerPermission']);

  if (result.status === GH_EXIT_AUTH_REQUIRED || /gh auth login/.test(result.stderr)) {
    return { problem: 'login' };
  }
  if (result.status !== 0) {
    return { problem: 'unknown', detail: firstLine(result.stderr) || firstLine(result.stdout) };
  }
  try {
    const { nameWithOwner, viewerPermission } = JSON.parse(result.stdout);
    if (typeof nameWithOwner === 'string' && /^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)) {
      return { nameWithOwner, viewerPermission: typeof viewerPermission === 'string' ? viewerPermission : null };
    }
  } catch {
    // 下で読めなかったことにする
  }
  return { problem: 'unknown', detail: `gh repo view の結果を読めませんでした（${firstLine(result.stdout)}）` };
}

/** 既にある保護の、必須のチェックの名前 */
function currentChecks(protection) {
  const checks = protection?.required_status_checks;
  if (checks == null) {
    return [];
  }
  if (Array.isArray(checks.checks) && checks.checks.length > 0) {
    return checks.checks.map((check) => check.context);
  }
  return Array.isArray(checks.contexts) ? checks.contexts : [];
}

/**
 * 今の必須のチェックを示し、ci.yaml のジョブ名と違えばその違いも示す。
 *
 * @param current 今の必須のチェックの名前
 * @param expected ci.yaml のジョブ名
 * @param where 必須のチェックを直す GitHub の画面
 */
function showChecks(current, expected, where) {
  console.log(`  今の必須のチェック: ${quoteNames(current)}`);

  const missing = expected.filter((name) => !current.includes(name));
  const extra = current.filter((name) => !expected.includes(name));
  if (missing.length === 0 && extra.length === 0) {
    return;
  }
  console.log(`  ${CI_WORKFLOW} のジョブ名: ${quoteNames(expected)}`);
  if (extra.length > 0) {
    console.log(
      `  ci.yaml のジョブに無いチェックが必須です: ${quoteNames(extra)}（ほかのワークフローやアプリが報告しないと、PR をマージできません）`,
    );
  }
  if (missing.length > 0) {
    console.log(`  必須になっていないジョブ: ${quoteNames(missing)}`);
  }
  console.log(`  合わせるなら、GitHub の ${where} で必須のチェックを直す`);
}

/** 既に保護があるときに、今の必須のチェックを示して終える */
function alreadyProtected(stdout, target, expected) {
  let protection = null;
  try {
    protection = JSON.parse(stdout);
  } catch {
    protection = null;
  }

  console.log(`[shinnn-app:setup] ${target} には既にブランチ保護があります。上書きしません。`);
  showChecks(currentChecks(protection), expected, 'Settings → Branches');
  return { code: 0, summary: `${SUMMARY}: 既にある（上書きしない）` };
}

/** ルールの種類を、分かるものは説明を添えて示す */
function describeRule(type) {
  return Object.hasOwn(RULE_LABELS, type) ? `${type}（${RULE_LABELS[type]}）` : String(type);
}

/** ルールを決めているルールセットを示す。組織のルールセットは、組織の設定でしか直せない */
function describeRuleset(rule) {
  const level =
    { Repository: 'リポジトリ', Organization: '組織' }[rule.ruleset_source_type] ?? rule.ruleset_source_type;
  return `${rule.ruleset_source ?? '不明'}（${level ?? '不明'}、ID ${rule.ruleset_id ?? '不明'}）`;
}

/**
 * ルールセットのルールが既に効いているときに、ルールの種類と必須のチェックを示して終える。
 *
 * @param rules GET repos/{owner}/{repo}/rules/branches/{branch} の応答（1 件以上）
 */
function alreadyRuled(rules, target, expected) {
  const types = [...new Set(rules.map((rule) => rule.type))];
  const rulesets = [...new Map(rules.map((rule) => [rule.ruleset_id, rule])).values()];
  const checks = rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context);

  console.log(
    `[shinnn-app:setup] ${target} には、ルールセット（新しい方式のブランチ保護）のルールが既に効いています。` +
      '従来の方式の保護は足さず、ルールセットも変えません。',
  );
  console.log(`  効いているルール: ${types.map(describeRule).join(' / ')}`);
  console.log(`  ルールセット: ${rulesets.map(describeRuleset).join(' / ')}`);
  showChecks([...new Set(checks)], expected, 'Settings → Rules → Rulesets（組織のルールセットは組織の Settings）');
  return { code: 0, summary: `${SUMMARY}: 既にある（ルールセット）` };
}

/** gh を起動できなかったときの結果 */
function cannotRun(result) {
  return failed('gh を実行できない', `gh を実行できませんでした（${firstLine(result.stderr) || '応答なし'}）。`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    return failed('引数の誤り', error.message);
  }

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { branch } = options;

  // 1. 対象のリポジトリ
  if (!hasCommand('gh')) {
    return notApplied('gh が無い', 'gh（GitHub CLI）が見つかりません。', 'gh を入れてログインした後に実行し直す');
  }

  const repo = resolveRepo(root);

  if (repo.problem === 'login') {
    return notApplied('gh にログインしていない', 'gh にログインしていません。', '`gh auth login` の後に実行し直す');
  }
  if (repo.problem === 'unknown') {
    return notApplied(
      '対象のリポジトリが分からない',
      `${root} に対応する GitHub のリポジトリが分かりません（${repo.detail || '理由は不明'}）。`,
      'GitHub にリポジトリを作り、remote（origin）を設定した後に実行し直す',
    );
  }

  const target = `${repo.nameWithOwner} の ${branch}`;

  // 2. main に直接コミットするワークフロー
  const directCommit = DIRECT_COMMIT_WORKFLOWS.find((path) => existsSync(join(root, path)));

  if (directCommit !== undefined) {
    return notApplied(
      'main に直接コミットするワークフローがある',
      `main に直接コミットするワークフロー（${directCommit}）が残っているためです。` +
        '必須のチェックを設定すると、このワークフローのコミットが拒まれます。',
      directCommit.endsWith('.yaml')
        ? '/shinnn-app:update-rules で標準を取り込むと消えるので、取り込みの PR をマージした後に実行し直す'
        : 'テンプレートが配ったものではない（案件で置いた）ワークフローなので、消すか決めてから実行し直す',
    );
  }

  // 3. 必須のチェックの名前
  const ciPath = join(root, CI_WORKFLOW);
  let checkNames;
  try {
    if (!existsSync(ciPath)) {
      throw new Error('ファイルがありません');
    }
    checkNames = readJobNames(readFileSync(ciPath, 'utf8'));
  } catch (error) {
    return failed(
      'ci.yaml のジョブ名を読めない',
      `${CI_WORKFLOW} から必須のチェックの名前を読めません: ${error.message}`,
      'ci.yaml の jobs: をテンプレートと同じ形（ジョブごとに name: を 1 行で書く）にする',
    );
  }

  // 4. 既にある保護（従来の方式）
  const path = `repos/${repo.nameWithOwner}/branches/${encodeURIComponent(branch)}/protection`;
  const current = gh(root, ['api', path]);

  if (current.failedToStart) {
    return cannotRun(current);
  }
  if (current.status === 0) {
    return alreadyProtected(current.stdout, target, checkNames);
  }

  const readError = apiError(current);

  // 保護が無いという 404 だけが、設定に進んでよい応答
  if (readError.status !== 404 || readError.message !== NOT_PROTECTED) {
    const readUnavailable = unavailableOutcome(readError, repo);

    if (readUnavailable !== null) {
      return readUnavailable;
    }
    if (readError.status === 404 && readError.message === BRANCH_NOT_FOUND) {
      return failed(
        `${branch} が GitHub に無い`,
        `${repo.nameWithOwner} に ${branch} ブランチがありません。`,
        `${branch} を push した後に実行し直す`,
      );
    }
    return failed(
      'GitHub の応答が想定外',
      `${target} の保護を調べられませんでした（HTTP ${readError.status ?? '不明'}: ${readError.message}）。`,
    );
  }

  // 4. 既にある保護（ルールセット）。リポジトリと組織のどちらで決めたルールも返り、無ければ空の配列。
  // 「評価だけ（evaluate）」と「無効（disabled）」のルールセットのルールは返らない
  const rulesPath = `repos/${repo.nameWithOwner}/rules/branches/${encodeURIComponent(branch)}?per_page=${RULES_PER_PAGE}`;
  const rules = gh(root, ['api', rulesPath]);

  if (rules.failedToStart) {
    return cannotRun(rules);
  }
  if (rules.status !== 0) {
    const rulesError = apiError(rules);
    return (
      unavailableOutcome(rulesError, repo) ??
      failed(
        'GitHub の応答が想定外',
        `${target} に効いているルールを調べられませんでした（HTTP ${rulesError.status ?? '不明'}: ${rulesError.message}）。`,
      )
    );
  }

  let activeRules = null;
  try {
    activeRules = JSON.parse(rules.stdout);
  } catch {
    activeRules = null;
  }
  if (!Array.isArray(activeRules)) {
    return failed(
      'GitHub の応答が想定外',
      `${target} に効いているルールの一覧を読めませんでした（${firstLine(rules.stdout)}）。`,
    );
  }
  if (activeRules.length > 0) {
    return alreadyRuled(activeRules, target, checkNames);
  }

  const body = protectionBody(checkNames);

  // 5. 送る内容だけを示す
  if (options.dryRun) {
    console.log('[shinnn-app:setup] 設定する内容（--dry-run。設定していません）:');
    console.log(`  ${target} には、まだブランチ保護がありません（従来の方式・ルールセットとも）。`);
    console.log(`  PUT ${path}`);
    for (const line of JSON.stringify(body, null, 2).split('\n')) {
      console.log(`  ${line}`);
    }
    return { code: 0, summary: `${SUMMARY}: 設定していない（--dry-run）` };
  }

  // 6. 設定する。本文は標準入力で渡す（シェルのヒアドキュメントに頼らない）
  const put = gh(root, ['api', '--method', 'PUT', path, '--input', '-'], JSON.stringify(body));

  if (put.failedToStart) {
    return cannotRun(put);
  }
  if (put.status !== 0) {
    const writeError = apiError(put);
    return (
      unavailableOutcome(writeError, repo) ??
      failed(
        `HTTP ${writeError.status ?? '不明'}`,
        `${target} に保護を設定できませんでした（HTTP ${writeError.status ?? '不明'}: ${writeError.message}）。`,
      )
    );
  }

  console.log(`[shinnn-app:setup] ${target} にブランチ保護を設定しました。`);
  console.log(`  必須のチェック: ${quoteNames(checkNames)}（${CI_WORKFLOW} のジョブ名）`);
  console.log('  管理者にも適用: する / PR の承認: 必須にしない / 最新の main の取り込み: 求めない');
  return { code: 0, summary: `${SUMMARY}: 設定した（必須のチェック ${checkNames.length} つ）` };
}

/**
 * コマンドとして実行したか。テストから読み込んだときは、関数だけを使うので実行しない。
 *
 * 起動したパスとこのファイルのパスは、途中にシンボリックリンク（プラグインの入れ方によっては作られる）が
 * あると文字列としては違うので、実体にしてから比べる。
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const outcome = main();
  console.log(outcome.summary);
  process.exitCode = outcome.code;
}
