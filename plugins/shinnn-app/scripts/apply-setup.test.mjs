/**
 * setup の適用の回帰テスト。`node --test scripts/` で実行する。
 *
 * 適用スクリプト apply-setup.mjs と、それが扱うテンプレートの部品（`.shinnn/setup.json` の選択項目と、
 * ワークフローの雛形 `*.yaml.disabled`）を確かめる。環境の検出 `scripts/setup-env.mjs` は setup-env.test.mjs。
 * 同梱のテンプレートは書き換えず、必要なファイルを一時フォルダに写して動かす。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
