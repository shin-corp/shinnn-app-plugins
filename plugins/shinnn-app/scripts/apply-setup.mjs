#!/usr/bin/env node
/**
 * /shinnn-app:setup の「適用」を実際に行う唯一のスクリプト。
 *
 * `.shinnn/` / `.github/workflows/` / `.github/CODEOWNERS` は settings.json の deny で守られている。
 * `.shinnn/`・`CODEOWNERS`・ワークフローの有効と無効を変えてよいのは setup だけなので、変更手段をこのスクリプト 1 つに集めて、
 * 何をどう変えたかが必ず出力に残るようにする（ワークフローの中身は、update-rules が copy-standard.mjs で写す）。
 * update-rules も、標準を写した後にこのスクリプトを選択の引数なしで実行し、記録の形だけを今の標準に揃える。
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
 * 書き換える前に、記録をプラグインに同梱のテンプレートの `.shinnn/setup.json` の形に揃える（alignWithTemplate）。
 * 選択を変えずに実行しても、古い記録が残っていれば揃えて書き換える。リポジトリの標準の版（`.claude/rules/.standards-version`）が
 * プラグインのものと違うときは、揃えずに止める（先に /shinnn-app:update-rules で標準を取り込む）。
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

/** プラグインに同梱のテンプレートの setup.json。リポジトリの記録をこの形に揃える。 */
const TEMPLATE_SETUP_PATH = new URL('../template/.shinnn/setup.json', import.meta.url);

/** プラグインに同梱のテンプレートの標準の版。 */
const TEMPLATE_STANDARDS_PATH = new URL('../template/.claude/rules/.standards-version', import.meta.url);

/** テンプレートの setup.json には無いが、setup が書き足すキー。 */
const KEYS_ADDED_BY_SETUP = ['handoverIssue'];

/**
 * 記録をテンプレートの形に揃える。古いテンプレートから作ったリポジトリには、今の標準に無いキー・古い説明・
 * 外した選択項目が残り、今の選択項目のキーが無いことがある。Claude は deny で `.shinnn/` を編集できず、書き換えるのは
 * このスクリプトだけなので、ここで揃える。
 *
 * - リポジトリで決めた値（担当者・DB の用意方法・選択項目の値など）は残す
 * - 説明（`$` で始まるキー）と必須項目（`mandatory`）は、テンプレートのものにする
 * - 選択項目（`optional`）はテンプレートのキーだけにし、無いキーはテンプレートの既定値で足す
 * - テンプレートにも `KEYS_ADDED_BY_SETUP` にも無いキーは消す
 *
 * @param current - リポジトリの記録
 * @param template - テンプレートの記録
 * @returns 揃えた記録と、変えた内容の一覧
 */
function alignWithTemplate(current, template) {
  const aligned = {};
  const notes = [];

  for (const [key, templateValue] of Object.entries(template)) {
    if (key.startsWith('$')) {
      noteComment(current, key, templateValue, key, notes);
      aligned[key] = templateValue;
      continue;
    }
    if (key === 'mandatory') {
      const had = new Set(current.mandatory ?? []);
      const wanted = new Set(templateValue);
      const removed = [...had].filter((item) => !wanted.has(item));
      const added = templateValue.filter((item) => !had.has(item));
      if (removed.length > 0) {
        notes.push(`mandatory: ${removed.join(', ')} を削除（今の標準に無い）`);
      }
      if (added.length > 0) {
        notes.push(`mandatory: ${added.join(', ')} を追加`);
      }
      aligned.mandatory = [...templateValue];
      continue;
    }
    if (key === 'optional' || key === 'database') {
      aligned[key] = alignObject(current[key] ?? {}, templateValue, key, notes);
      continue;
    }
    if (Object.hasOwn(current, key)) {
      aligned[key] = current[key];
    } else {
      aligned[key] = templateValue;
      notes.push(`${key}: 追加（${templateValue}）`);
    }
  }

  for (const key of KEYS_ADDED_BY_SETUP) {
    if (Object.hasOwn(current, key)) {
      aligned[key] = current[key];
    }
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(template, key) && !KEYS_ADDED_BY_SETUP.includes(key)) {
      notes.push(`${key}: 削除（今の標準に無い。${JSON.stringify(current[key])} だった）`);
    }
  }
  // 値は同じでもキーの並びだけが違えば、書き換えることになるので知らせる
  if (notes.length === 0 && JSON.stringify(current) !== JSON.stringify(aligned)) {
    notes.push('キーの並びをテンプレートに揃える');
  }

  return { aligned, notes };
}

/** 説明（`$` で始まるキー）を、元に無ければ「追加」、違えば「差し替え」として書き留める */
function noteComment(current, key, templateValue, path, notes) {
  if (!Object.hasOwn(current, key)) {
    notes.push(`${path}: 追加`);
    return;
  }
  if (current[key] !== templateValue) {
    notes.push(`${path}: 今の説明に差し替え`);
  }
}

/**
 * `optional` や `database` のような 1 段下のオブジェクトを揃える。
 * テンプレートのキーだけにし、値はリポジトリのものを残す（説明の `$` のキーはテンプレートのもの）。
 */
function alignObject(current, template, path, notes) {
  const aligned = {};

  for (const [key, templateValue] of Object.entries(template)) {
    if (key.startsWith('$')) {
      noteComment(current, key, templateValue, `${path}.${key}`, notes);
      aligned[key] = templateValue;
      continue;
    }
    if (Object.hasOwn(current, key)) {
      aligned[key] = current[key];
    } else {
      aligned[key] = templateValue;
      notes.push(`${path}.${key}: 追加（${templateValue}）`);
    }
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(template, key)) {
      notes.push(`${path}.${key}: 削除（今の標準に無い。${JSON.stringify(current[key])} だった）`);
    }
  }

  return aligned;
}

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

// 揃える先は、このプラグインに同梱のテンプレート。リポジトリの標準の版が違えば、別の版の記録に揃えてしまうので止める
const repoStandardsPath = join(root, '.claude', 'rules', '.standards-version');
if (existsSync(repoStandardsPath)) {
  const repoStandards = readFileSync(repoStandardsPath, 'utf8').trim();
  const templateStandards = readFileSync(TEMPLATE_STANDARDS_PATH, 'utf8').trim();
  if (repoStandards !== templateStandards) {
    fail(
      `リポジトリの標準の版 ${repoStandards} が、プラグインの標準の版 ${templateStandards} と違います。`,
      '先に /shinnn-app:update-rules で標準を取り込んでから、setup を実行する',
    );
  }
}

const { aligned: setup, notes: alignNotes } = alignWithTemplate(
  JSON.parse(readFileSync(setupPath, 'utf8')),
  JSON.parse(readFileSync(TEMPLATE_SETUP_PATH, 'utf8')),
);
const changes = alignNotes.map((note) => `テンプレートの形に揃える: ${note}`);

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
  if (setup.mergePolicy !== options.mergePolicy) {
    changes.push(`mergePolicy: ${setup.mergePolicy} → ${options.mergePolicy}`);
    setup.mergePolicy = options.mergePolicy;
  }
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

  if (!existsSync(codeownersPath)) {
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
