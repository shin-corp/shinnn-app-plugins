#!/usr/bin/env node
/**
 * /shinnn-app:setup の「適用」を実際に行う唯一のスクリプト。
 *
 * `.shinnn/` / `.github/workflows/` / `.github/CODEOWNERS` は settings.json の deny で守られている。
 * ここを変えてよいのは setup だけなので、変更手段をこのスクリプト 1 つに集めて、
 * 何をどう変えたかが必ず出力に残るようにする。
 *
 * 実行例:
 *   node <プラグイン>/scripts/apply-setup.mjs --profile full --reviewer @octocat
 *     --database docker --enable health-report --disable claude-mention --handover-issue 1 --complete
 *
 * 引数:
 *   --repo-dir <パス>     対象のリポジトリ（既定は CLAUDE_PROJECT_DIR、無ければカレント）
 *   --profile <名前>      full / client-only
 *   --reviewer <@名前>    CODEOWNERS に入れるシン株式会社の担当者のアカウント
 *   --database <方式>     database-url / local-postgres / docker / pglite / managed
 *   --merge-policy <方針> human（人がマージする）/ self-review（/shinnn-app:pr がセルフレビューと CI 通過後にマージする）
 *   --enable <キー,…>     選択項目を有効にする（.shinnn/setup.json の optional のキー）
 *   --disable <キー,…>    選択項目を無効にする
 *   --handover-issue <n>  「引き継ぎメモ」Issue の番号
 *   --complete            setupCompletedAt に現在時刻を入れる
 *   --dry-run             書き換えずに、何が変わるかだけを出す
 *
 * 選択項目のキーは `.shinnn/setup.json` の optional にあるものだけを受け付ける
 * （キーを勝手に増やさない・減らさないという取り決めを機械で守る）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 選択項目と、それが有効にする GitHub Actions のワークフロー。無いものは設定の記録だけで完結する。 */
const WORKFLOW_OF_OPTION = {
  'health-report': 'health-report.yaml',
  'claude-pr-review': 'claude-review.yaml',
  'claude-mention': 'claude.yaml',
};

/** 無効にしたワークフローに付ける拡張子。GitHub はこの拡張子のファイルを読み込まない。 */
const DISABLED_SUFFIX = '.disabled';

/** 受け付けるプロファイル。 */
const PROFILES = ['full', 'client-only'];

/** 受け付ける DB の用意方法。scripts/setup-env.mjs の検出結果と同じ語を使う。 */
const DATABASE_MODES = ['database-url', 'local-postgres', 'docker', 'pglite', 'managed'];

/** 受け付けるマージの方針。human は人がマージ、self-review は /shinnn-app:pr がセルフレビューと CI の通過後にマージする。 */
const MERGE_POLICIES = ['human', 'self-review'];

/** 続けられない理由を出して終わる。 */
function fail(message, how) {
  console.error(`[shinnn-app:setup] ${message}`);
  if (how) {
    console.error(`  どう直す: ${how}`);
  }
  process.exit(1);
}

/** `--key value` と `--flag` の両方を読む。 */
function parseArgs(argv) {
  const options = { enable: [], disable: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === '--complete') {
      options.complete = true;
      continue;
    }
    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    const value = argv[i + 1];

    if (value === undefined || value.startsWith('--')) {
      fail(`${key} の値が指定されていません。`);
    }
    i += 1;

    if (key === '--enable' || key === '--disable') {
      options[key.slice(2)] = value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      continue;
    }
    if (key === '--repo-dir') {
      options.repoDir = value;
      continue;
    }
    if (key === '--profile') {
      options.profile = value;
      continue;
    }
    if (key === '--reviewer') {
      options.reviewer = value.startsWith('@') ? value : `@${value}`;
      continue;
    }
    if (key === '--database') {
      options.database = value;
      continue;
    }
    if (key === '--handover-issue') {
      options.handoverIssue = Number(value);
      continue;
    }
    if (key === '--merge-policy') {
      options.mergePolicy = value;
      continue;
    }
    fail(`知らない引数です: ${key}`);
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const root = options.repoDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const setupPath = join(root, '.shinnn', 'setup.json');

if (!existsSync(setupPath)) {
  fail(
    `${setupPath} がありません。`,
    'テンプレート shinnn-app-starter から作ったリポジトリのルートで実行する（--repo-dir でも指定できる）',
  );
}

const setup = JSON.parse(readFileSync(setupPath, 'utf8'));
const changes = [];

if (options.profile !== undefined) {
  if (!PROFILES.includes(options.profile)) {
    fail(`プロファイル ${options.profile} は選べません。`, `${PROFILES.join(' / ')} のいずれかを指定する`);
  }
  if (setup.profile !== options.profile) {
    changes.push(`profile: ${setup.profile} → ${options.profile}`);
    setup.profile = options.profile;
  }
  setup.optional['client-only-profile'] = options.profile === 'client-only';
}

if (options.reviewer !== undefined && setup.reviewer !== options.reviewer) {
  changes.push(`reviewer: ${setup.reviewer} → ${options.reviewer}`);
  setup.reviewer = options.reviewer;
}

if (options.database !== undefined) {
  if (!DATABASE_MODES.includes(options.database)) {
    fail(`DB の用意方法 ${options.database} は選べません。`, `${DATABASE_MODES.join(' / ')} のいずれかを指定する`);
  }
  if (setup.database.mode !== options.database) {
    changes.push(`database.mode: ${setup.database.mode} → ${options.database}`);
    setup.database.mode = options.database;
  }
}

if (options.mergePolicy !== undefined) {
  if (!MERGE_POLICIES.includes(options.mergePolicy)) {
    fail(`マージの方針 ${options.mergePolicy} は選べません。`, `${MERGE_POLICIES.join(' / ')} のいずれかを指定する`);
  }
  // 古い setup.json にはキーが無い。無いときは human として扱う
  const current = setup.mergePolicy ?? 'human';
  if (current !== options.mergePolicy) {
    changes.push(`mergePolicy: ${current} → ${options.mergePolicy}`);
  }
  setup.mergePolicy = options.mergePolicy;
}

if (options.handoverIssue !== undefined) {
  if (!Number.isInteger(options.handoverIssue) || options.handoverIssue <= 0) {
    fail('--handover-issue には Issue の番号（正の整数）を指定してください。');
  }
  if (setup.handoverIssue !== options.handoverIssue) {
    changes.push(`handoverIssue: ${setup.handoverIssue ?? 'なし'} → ${options.handoverIssue}`);
    setup.handoverIssue = options.handoverIssue;
  }
}

for (const [keys, enabled] of [
  [options.enable, true],
  [options.disable, false],
]) {
  for (const key of keys) {
    if (!Object.hasOwn(setup.optional, key)) {
      fail(
        `選択項目 ${key} は .shinnn/setup.json の optional にありません。`,
        `使えるのは ${Object.keys(setup.optional).join(' / ')}。項目そのものを増やすのは標準の変更なのでシン株式会社に相談する`,
      );
    }
    if (setup.optional[key] !== enabled) {
      changes.push(`optional.${key}: ${setup.optional[key]} → ${enabled}`);
      setup.optional[key] = enabled;
    }
  }
}

/**
 * 選択項目の有無に合わせて、ワークフローの `.disabled` を外す・付ける。
 *
 * 選ばなかったものは削除せずに `.disabled` を付けたまま残す。あとから選び直したときに
 * 雛形が失われていると、setup を再実行しても戻せないため。
 */
function applyWorkflows() {
  for (const [option, fileName] of Object.entries(WORKFLOW_OF_OPTION)) {
    const enabledPath = join(root, '.github', 'workflows', fileName);
    const disabledPath = `${enabledPath}${DISABLED_SUFFIX}`;
    const wanted = setup.optional[option] === true;
    const from = wanted ? disabledPath : enabledPath;
    const to = wanted ? enabledPath : disabledPath;

    if (!existsSync(from)) {
      if (!existsSync(to)) {
        console.error(`  注意: ${fileName} の雛形がありません（${option} は設定の記録だけを行います）。`);
      }
      continue;
    }
    changes.push(`workflow ${fileName}: ${wanted ? '有効化' : '無効化'}`);
    if (options.dryRun !== true) {
      renameSync(from, to);
    }
  }
}

/**
 * CODEOWNERS のプレースホルダをシン株式会社の担当者のアカウントに置き換える。
 *
 * 置き換えるのは担当を割り当てる規則の行だけ。`#` で始まる行はプレースホルダそのものを説明する
 * コメントなので、置き換えると説明として読めなくなる。
 */
function applyCodeowners() {
  const codeownersPath = join(root, '.github', 'CODEOWNERS');

  if (setup.reviewer === undefined || !existsSync(codeownersPath)) {
    return;
  }

  const before = readFileSync(codeownersPath, 'utf8');
  const replacedLines = [];
  for (const line of before.split('\n')) {
    if (line.trimStart().startsWith('#')) {
      replacedLines.push(line);
      continue;
    }
    replacedLines.push(line.replaceAll('@SHINNN_REVIEWER', setup.reviewer));
  }
  const after = replacedLines.join('\n');

  if (before === after) {
    return;
  }
  changes.push(`CODEOWNERS: @SHINNN_REVIEWER → ${setup.reviewer}`);
  if (options.dryRun !== true) {
    writeFileSync(codeownersPath, after);
  }
}

if (options.complete === true) {
  const completedAt = new Date().toISOString();
  changes.push(`setupCompletedAt: ${setup.setupCompletedAt ?? 'なし'} → ${completedAt}`);
  setup.setupCompletedAt = completedAt;
}

applyWorkflows();
applyCodeowners();

if (options.dryRun !== true) {
  writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`);
}

if (changes.length === 0) {
  console.log('[shinnn-app:setup] 変更はありません（すでに指定どおりの状態です）。');
  process.exit(0);
}

const heading = options.dryRun === true ? '変更内容（--dry-run。書き換えていません）' : '適用しました';

console.log(`[shinnn-app:setup] ${heading}:`);
for (const change of changes) {
  console.log(`  - ${change}`);
}
