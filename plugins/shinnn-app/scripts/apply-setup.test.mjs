/**
 * setup の適用の回帰テスト。`node --test scripts/` で実行する。
 *
 * 適用スクリプト apply-setup.mjs と、それが扱うテンプレートの部品（`.shinnn/setup.json` の選択項目と、
 * ワークフローの雛形 `*.yaml.disabled`）を確かめる。環境の検出 `scripts/setup-env.mjs` は setup-env.test.mjs。
 * 同梱のテンプレートは書き換えず、必要なファイルを一時フォルダに写して動かす。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const applyScript = fileURLToPath(new URL('./apply-setup.mjs', import.meta.url));

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** setup の記録 */
const SETUP = '.shinnn/setup.json';

/** ワークフローの置き場所 */
const WORKFLOWS = '.github/workflows';

/** 無効にしたワークフローに付く拡張子 */
const DISABLED = '.disabled';

/** 選択項目。どれも有効にすれば何かが動くもので、記録だけで終わるものは置かない */
const OPTIONAL_KEYS = ['client-only-profile', 'health-report', 'copilot-review', 'claude-pr-review', 'claude-mention'];

/** 選択項目から外したキー。有効にしても何も起きない、または失敗するものだった */
const REMOVED_KEYS = ['health-report-ai-summary', 'playwright-e2e', 'e2e-nightly', 'github-projects-board'];

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** テンプレートの setup.json を読む */
function templateSetup() {
  return JSON.parse(readFileSync(join(templateDir, SETUP), 'utf8'));
}

/** テンプレートにあるワークフローの雛形（`.disabled` 付き）の名前 */
function disabledWorkflows(root) {
  return readdirSync(join(root, WORKFLOWS))
    .filter((name) => name.endsWith(DISABLED))
    .sort();
}

/** 適用スクリプトが書き換えるファイルだけを写した、テンプレートから作った直後のリポジトリ */
function makeRepo() {
  const repo = mkdtempSync(join(workRoot, 'repo-'));
  for (const path of [SETUP, WORKFLOWS, '.github/CODEOWNERS']) {
    cpSync(join(templateDir, path), join(repo, path), { recursive: true });
  }
  return repo;
}

/** 適用スクリプトを実行し、終了コードと出力を返す */
function runApply(repo, args) {
  const result = spawnSync(process.execPath, [applyScript, '--repo-dir', repo, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'apply-setup-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('setup.json: 選択項目は有効にすると何かが動くものだけ', () => {
  assert.deepEqual(Object.keys(templateSetup().optional), OPTIONAL_KEYS);
});

test('外した選択項目のキーを渡すと止まり、何も書き換えない', () => {
  for (const key of REMOVED_KEYS) {
    const repo = makeRepo();
    const before = readFileSync(join(repo, SETUP), 'utf8');
    const result = runApply(repo, ['--enable', key]);

    assert.equal(result.status, 1, `${key}: ${result.stdout}`);
    assert.ok(
      result.stderr.includes(`選択項目 ${key} は .shinnn/setup.json の optional にありません。`),
      result.stderr,
    );
    assert.ok(result.stderr.includes(`使えるのは ${OPTIONAL_KEYS.join(' / ')}`), result.stderr);
    assert.equal(readFileSync(join(repo, SETUP), 'utf8'), before, key);
    assert.deepEqual(disabledWorkflows(repo), disabledWorkflows(templateDir), key);
  }
});

test('選択項目をすべて有効にすると雛形の .disabled がすべて外れ、無効にすると元に戻る', () => {
  const repo = makeRepo();
  const templates = disabledWorkflows(repo);
  const keys = Object.keys(templateSetup().optional).filter((key) => key !== 'client-only-profile');

  const enabled = runApply(repo, ['--enable', keys.join(',')]);
  assert.equal(enabled.status, 0, enabled.stderr);
  // 雛形の無いワークフローを有効にしようとすると「注意」が出る。選択項目とワークフローの対応に余りが無いこと
  assert.equal(enabled.stderr, '');
  assert.deepEqual(disabledWorkflows(repo), []);
  for (const name of templates) {
    assert.ok(existsSync(join(repo, WORKFLOWS, name.slice(0, -DISABLED.length))), name);
  }
  assert.ok(keys.every((key) => JSON.parse(readFileSync(join(repo, SETUP), 'utf8')).optional[key] === true));

  const disabled = runApply(repo, ['--disable', keys.join(',')]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(disabled.stderr, '');
  assert.deepEqual(disabledWorkflows(repo), templates);
});

/** 古いテンプレートから作ったリポジトリの記録にする（今の標準に無いキー・古い説明・外した項目が残り、今の選択項目が欠ける） */
function makeOldSetup(repo) {
  const setup = templateSetup();
  setup.standardsVersion = '0.7.0';
  setup.$comment = '古い説明';
  setup.mandatory.push('progress-snapshot');
  setup.database.$comment = '古い説明';
  setup.reviewer = '@example-reviewer';
  setup.handoverIssue = 3;
  setup.optional['health-report'] = true;
  delete setup.optional['copilot-review'];
  for (const key of REMOVED_KEYS) {
    setup.optional[key] = false;
  }
  writeFileSync(join(repo, SETUP), `${JSON.stringify(setup, null, 2)}\n`);
}

test('古い記録: 選択を変えずに実行してもテンプレートの形に揃え、リポジトリで決めた値は残す', () => {
  const repo = makeRepo();
  makeOldSetup(repo);
  const result = runApply(repo, []);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /変更はありません/);
  assert.match(result.stdout, /standardsVersion: 削除/);
  assert.match(result.stdout, /mandatory: progress-snapshot を削除/);
  assert.match(result.stdout, /optional\.copilot-review: 追加（false）/);
  assert.match(result.stdout, /optional\.playwright-e2e: 削除/);

  const setup = JSON.parse(readFileSync(join(repo, SETUP), 'utf8'));
  const template = templateSetup();
  assert.equal(setup.standardsVersion, undefined);
  assert.equal(setup.$comment, template.$comment);
  assert.equal(setup.database.$comment, template.database.$comment);
  assert.deepEqual(setup.mandatory, template.mandatory);
  assert.deepEqual(Object.keys(setup.optional), OPTIONAL_KEYS);
  assert.equal(setup.optional['health-report'], true);
  assert.equal(setup.reviewer, '@example-reviewer');
  assert.equal(setup.handoverIssue, 3);

  // 揃えた後は、選択を変えなければ変更は無い
  const second = runApply(repo, []);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /変更はありません/);
});

test('古い記録: 欠けていた今の選択項目も有効にできる', () => {
  const repo = makeRepo();
  makeOldSetup(repo);
  const result = runApply(repo, ['--enable', 'copilot-review']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(repo, SETUP), 'utf8')).optional['copilot-review'], true);
});

test('古い記録: --dry-run では揃える内容を出すだけで、何も書き換えない', () => {
  const repo = makeRepo();
  makeOldSetup(repo);
  const before = readFileSync(join(repo, SETUP), 'utf8');
  const result = runApply(repo, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /テンプレートの形に揃える: standardsVersion: 削除（今の標準に無い。"0\.7\.0" だった）/);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), before);
});

test('キーの並びだけが違う記録: 揃えたことを出す（「変更はありません」にしない）', () => {
  const repo = makeRepo();
  const setup = templateSetup();
  const { mergePolicy, ...rest } = setup;
  writeFileSync(join(repo, SETUP), `${JSON.stringify({ ...rest, mergePolicy }, null, 2)}\n`);
  const result = runApply(repo, []);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /キーの並びをテンプレートに揃える/);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), `${JSON.stringify(setup, null, 2)}\n`);
});

/** リポジトリの標準の版を書く */
function writeStandardsVersion(repo, version) {
  mkdirSync(join(repo, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'rules', '.standards-version'), version);
}

test('--align-only（update-rules の使い方）: 標準を写した後の古い記録の形だけを揃え、ワークフローと CODEOWNERS は変えない', () => {
  const repo = makeRepo();
  // 記録は health-report を有効・担当者を決めた状態で、ワークフローと CODEOWNERS はそれに合っていない
  makeOldSetup(repo);
  writeStandardsVersion(repo, readFileSync(join(templateDir, '.claude', 'rules', '.standards-version'), 'utf8'));
  const codeowners = readFileSync(join(repo, '.github', 'CODEOWNERS'), 'utf8');
  const result = runApply(repo, ['--align-only']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /テンプレートの形に揃える: standardsVersion: 削除/);
  assert.doesNotMatch(result.stdout, /workflow |CODEOWNERS/);
  assert.doesNotMatch(result.stderr, /CODEOWNERS/);
  assert.deepEqual(disabledWorkflows(repo), disabledWorkflows(templateDir));
  assert.equal(readFileSync(join(repo, '.github', 'CODEOWNERS'), 'utf8'), codeowners);

  const setup = JSON.parse(readFileSync(join(repo, SETUP), 'utf8'));
  assert.deepEqual(setup.mandatory, templateSetup().mandatory);
  assert.equal(setup.optional['health-report'], true);
  assert.equal(setup.reviewer, '@example-reviewer');
});

test('--align-only: 記録の self-review を auto-merge に揃える', () => {
  const repo = makeRepo();
  const setup = { ...templateSetup(), mergePolicy: 'self-review' };
  writeFileSync(join(repo, SETUP), `${JSON.stringify(setup, null, 2)}\n`);
  writeStandardsVersion(repo, readFileSync(join(templateDir, '.claude', 'rules', '.standards-version'), 'utf8'));
  const result = runApply(repo, ['--align-only']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mergePolicy: self-review → auto-merge/);
  assert.equal(JSON.parse(readFileSync(join(repo, SETUP), 'utf8')).mergePolicy, 'auto-merge');
});

test('--merge-policy: auto-merge を受け付け、self-review は止める', () => {
  const accepted = makeRepo();
  const ok = runApply(accepted, ['--merge-policy', 'auto-merge']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(join(accepted, SETUP), 'utf8')).mergePolicy, 'auto-merge');

  const refused = makeRepo();
  const before = readFileSync(join(refused, SETUP), 'utf8');
  const ng = runApply(refused, ['--merge-policy', 'self-review']);
  assert.notEqual(ng.status, 0);
  assert.equal(readFileSync(join(refused, SETUP), 'utf8'), before);
});

test('--align-only: 選択を変える引数と一緒には使えず、何も書き換えない', () => {
  for (const args of [['--enable', 'health-report'], ['--reviewer', '@example-reviewer'], ['--complete']]) {
    const repo = makeRepo();
    const before = readFileSync(join(repo, SETUP), 'utf8');
    const result = runApply(repo, ['--align-only', ...args]);

    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /--align-only は選択を変える引数/);
    assert.equal(readFileSync(join(repo, SETUP), 'utf8'), before, args.join(' '));
  }
});

test('--align-only: 標準の版が違えば止まり、標準を先に写すよう案内する', () => {
  const repo = makeRepo();
  writeStandardsVersion(repo, '0.0.1\n');
  const result = runApply(repo, ['--align-only']);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /先に copy-standard\.mjs で標準を写してから/);
});

test('標準の版がプラグインと違うリポジトリでは止まり、何も書き換えない', () => {
  const repo = makeRepo();
  writeStandardsVersion(repo, '0.0.1\n');
  const before = readFileSync(join(repo, SETUP), 'utf8');
  const result = runApply(repo, ['--enable', 'health-report']);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /先に \/shinnn-app:update-rules/);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), before);
});

test('--dry-run: 変更内容を出すだけで、何も書き換えない', () => {
  const repo = makeRepo();
  const before = readFileSync(join(repo, SETUP), 'utf8');
  const result = runApply(repo, [
    '--dry-run',
    '--profile',
    'full',
    '--database',
    'pglite',
    '--enable',
    'health-report',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--dry-run。書き換えていません/);
  assert.match(result.stdout, /database\.mode: undecided → pglite/);
  assert.match(result.stdout, /optional\.health-report: false → true/);
  assert.match(result.stdout, /workflow health-report\.yaml: 有効化/);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), before);
  assert.deepEqual(disabledWorkflows(repo), disabledWorkflows(templateDir));
});

/** CODEOWNERS のパス */
function codeownersPath(repo) {
  return join(repo, '.github', 'CODEOWNERS');
}

/** 担当者を記録し、CODEOWNERS を指定の中身にしたリポジトリ */
function makeRepoWithReviewer(reviewer, codeowners) {
  const repo = makeRepo();
  const result = runApply(repo, ['--reviewer', reviewer]);

  assert.equal(result.status, 0, result.stderr);
  writeFileSync(codeownersPath(repo), codeowners);
  return repo;
}

test('CODEOWNERS: 担当者を決めた後に別の担当者へ変えると、規則の行が新しい担当者になり、説明の行は変わらない', () => {
  const repo = makeRepo();
  const template = readFileSync(codeownersPath(repo), 'utf8');

  const first = runApply(repo, ['--reviewer', '@first-reviewer']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /CODEOWNERS: @SHINNN_REVIEWER → @first-reviewer/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), template.replace('* @SHINNN_REVIEWER', '* @first-reviewer'));

  const second = runApply(repo, ['--reviewer', '@second-reviewer']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /reviewer: @first-reviewer → @second-reviewer/);
  assert.match(second.stdout, /CODEOWNERS: @first-reviewer → @second-reviewer/);
  assert.equal(
    readFileSync(codeownersPath(repo), 'utf8'),
    template.replace('* @SHINNN_REVIEWER', '* @second-reviewer'),
  );
  assert.equal(JSON.parse(readFileSync(join(repo, SETUP), 'utf8')).reviewer, '@second-reviewer');
});

test('CODEOWNERS: 前の担当者と全体が一致するアカウントだけを置き換え、他のレビュアーと説明は変えない', () => {
  const repo = makeRepoWithReviewer(
    '@old-reviewer',
    [
      '# @old-reviewer はシン株式会社の担当者',
      '  # @old-reviewer は字下げした説明の行',
      '* @old-reviewer @old-reviewer-2 @customer-owner',
      '/docs/ @customer-owner @old-reviewer # @old-reviewer は行の途中からの説明',
      '/design/ @old-reviewer/team @old-reviewer-2',
      '',
    ].join('\n'),
  );
  const result = runApply(repo, ['--reviewer', '@new-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(codeownersPath(repo), 'utf8'),
    [
      '# @old-reviewer はシン株式会社の担当者',
      '  # @old-reviewer は字下げした説明の行',
      '* @new-reviewer @old-reviewer-2 @customer-owner',
      '/docs/ @customer-owner @new-reviewer # @old-reviewer は行の途中からの説明',
      '/design/ @old-reviewer/team @old-reviewer-2',
      '',
    ].join('\n'),
  );
});

test('CODEOWNERS: プレースホルダと前の担当者の両方があれば、どちらも置き換えて、両方を出す', () => {
  const repo = makeRepoWithReviewer('@old-reviewer', '* @SHINNN_REVIEWER\n/docs/ @old-reviewer\n');
  const result = runApply(repo, ['--reviewer', '@new-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CODEOWNERS: @SHINNN_REVIEWER, @old-reviewer → @new-reviewer/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), '* @new-reviewer\n/docs/ @new-reviewer\n');
});

test('CODEOWNERS: 担当者を変えない実行でも、プレースホルダが残っていれば記録の担当者に置き換える', () => {
  const repo = makeRepoWithReviewer('@old-reviewer', '* @SHINNN_REVIEWER\n');
  const result = runApply(repo, ['--enable', 'copilot-review']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CODEOWNERS: @SHINNN_REVIEWER → @old-reviewer/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), '* @old-reviewer\n');
});

test('CODEOWNERS: 同じ担当者で再実行すると「変更はありません」で、書き換えない', () => {
  const codeowners = '* @old-reviewer\n';
  const repo = makeRepoWithReviewer('@old-reviewer', codeowners);
  const result = runApply(repo, ['--reviewer', '@old-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /変更はありません/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), codeowners);
});

test('CODEOWNERS: 改行が CRLF のファイルでも置き換え、改行はそのまま残す', () => {
  const repo = makeRepoWithReviewer('@old-reviewer', '# 説明\r\n* @old-reviewer\r\n');
  const result = runApply(repo, ['--reviewer', '@new-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), '# 説明\r\n* @new-reviewer\r\n');
});

test('CODEOWNERS: --dry-run で別の担当者を指定すると、置き換えの内容を出すだけで、何も書き換えない', () => {
  const codeowners = '* @old-reviewer\n';
  const repo = makeRepoWithReviewer('@old-reviewer', codeowners);
  const setupBefore = readFileSync(join(repo, SETUP), 'utf8');
  const result = runApply(repo, ['--dry-run', '--reviewer', '@new-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewer: @old-reviewer → @new-reviewer/);
  assert.match(result.stdout, /CODEOWNERS: @old-reviewer → @new-reviewer/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), codeowners);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), setupBefore);
});

test('CODEOWNERS: 記録の担当者が規則の行に無ければ注意を出し、「すでに指定どおり」と出さず、説明の中の名前は数えない', () => {
  const codeowners = '# @recorded-reviewer は説明\n* @stale-reviewer # @recorded-reviewer は説明\n';
  const repo = makeRepoWithReviewer('@recorded-reviewer', codeowners);
  const result = runApply(repo, ['--reviewer', '@recorded-reviewer']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /注意: CODEOWNERS の規則の行に @recorded-reviewer がありません/);
  assert.match(result.stdout, /変更はありません/);
  assert.doesNotMatch(result.stdout, /すでに指定どおり/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), codeowners);
});

test('CODEOWNERS: 記録と違っているときは、規則の行にある人を指定してから新しい担当者を指定すると揃う', () => {
  const repo = makeRepoWithReviewer('@recorded-reviewer', '* @stale-reviewer\n');

  const direct = runApply(repo, ['--dry-run', '--reviewer', '@new-reviewer']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.match(direct.stderr, /注意: CODEOWNERS の規則の行に @new-reviewer がありません/);
  assert.doesNotMatch(direct.stdout, /CODEOWNERS/);

  const aligned = runApply(repo, ['--reviewer', '@stale-reviewer']);
  assert.equal(aligned.status, 0, aligned.stderr);
  assert.doesNotMatch(aligned.stderr, /CODEOWNERS/);

  const changed = runApply(repo, ['--reviewer', '@new-reviewer']);
  assert.equal(changed.status, 0, changed.stderr);
  assert.doesNotMatch(changed.stderr, /CODEOWNERS/);
  assert.match(changed.stdout, /CODEOWNERS: @stale-reviewer → @new-reviewer/);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), '* @new-reviewer\n');
});

test('CODEOWNERS: 担当者が決まっていないプレースホルダのままなら注意を出さない', () => {
  const result = runApply(makeRepo(), ['--enable', 'copilot-review']);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /CODEOWNERS/);
});

test('--reviewer: 空白を含む値を渡すと止まり、何も書き換えない', () => {
  const repo = makeRepo();
  const setupBefore = readFileSync(join(repo, SETUP), 'utf8');
  const codeowners = readFileSync(codeownersPath(repo), 'utf8');
  const result = runApply(repo, ['--reviewer', '@first-reviewer @second-reviewer']);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /--reviewer にはアカウントを 1 つだけ/);
  assert.equal(readFileSync(join(repo, SETUP), 'utf8'), setupBefore);
  assert.equal(readFileSync(codeownersPath(repo), 'utf8'), codeowners);
});

test('ワークフローの雛形: 冒頭の説明が、有効にした後に読んでも正しい', () => {
  const templates = disabledWorkflows(templateDir);
  assert.ok(templates.length > 0);

  for (const name of templates) {
    const content = readFileSync(join(templateDir, WORKFLOWS, name), 'utf8');
    const workflowName = content.match(/^name: '?(.+?)'?$/m)?.[1];

    // 適用スクリプトは名前の .disabled を外すだけなので、中身は有効・無効のどちらの状態でも読まれる
    assert.equal(content.split('\n')[0], `# ${workflowName}`, name);
    assert.ok(!content.includes('【無効】'), name);
    assert.ok(content.includes('/shinnn-app:setup が有効・無効を切り替えるワークフローです。'), name);
    assert.ok(
      content.includes('ファイル名の末尾に .disabled が付いている間は、GitHub は読み込みません（無効）。'),
      name,
    );
  }
});
