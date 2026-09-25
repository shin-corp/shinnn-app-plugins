/**
 * scripts/copy-standard.mjs（/shinnn-app:update-rules が標準を写す）の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 写し元はプラグインに同梱の本物のテンプレート。対象のリポジトリは一時フォルダを `--repo-dir` で渡す。
 * テンプレートから消したファイル（retired-files.json）は、残っていれば消し、一覧に無いファイルは残すことも確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 標準を写すスクリプト */
const copyStandardScript = fileURLToPath(new URL('./copy-standard.mjs', import.meta.url));

/** テンプレートから消したファイルの一覧 */
const retiredFiles = JSON.parse(readFileSync(new URL('./retired-files.json', import.meta.url), 'utf8'));

/** 写し元のテンプレート */
const templateRoot = fileURLToPath(new URL('../template/', import.meta.url));

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/** 対象のリポジトリの中にファイルを書く */
function writeRepoFile(repo, path, content) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

/**
 * 古い標準を持つリポジトリを作る。`server/` の有無と、有効にしているワークフローを選べる。
 * 規約は testing.md だけを持ち、案件で足したスクリプトと規約も置く
 */
function makeOldRepo({ hasServer = true, enabledWorkflows = [] } = {}) {
  const repo = mkdtempSync(join(workRoot, 'repo-'));
  writeRepoFile(repo, '.claude/rules/.standards-version', '0.0.1\n');
  writeRepoFile(repo, '.claude/rules/testing.md', 'old\n');
  writeRepoFile(repo, '.claude/rules/project-only.md', 'project\n');
  writeRepoFile(repo, '.claude/settings.json', '{}\n');
  writeRepoFile(repo, '.github/workflows/ci.yaml', 'old\n');
  writeRepoFile(repo, 'scripts/project-only.mjs', 'project\n');
  writeRepoFile(repo, 'CLAUDE.md', 'project\n');
  for (const name of enabledWorkflows) {
    writeRepoFile(repo, `.github/workflows/${name}`, 'old\n');
  }
  if (hasServer) {
    mkdirSync(join(repo, 'server'));
  }
  return repo;
}

/** copy-standard.mjs を実行する。カレントは対象の外に置き、書き込み先が `--repo-dir` で決まることも確かめる */
function runCopyStandard(repo, args = []) {
  const result = spawnSync(process.execPath, [copyStandardScript, '--repo-dir', repo, ...args], {
    cwd: workRoot,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** テンプレートとリポジトリの同じ中身かどうか */
function sameAsTemplate(repo, repoPath, templatePath = repoPath) {
  return readFileSync(join(repo, repoPath)).equals(readFileSync(join(templateRoot, templatePath)));
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'copy-standard-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('copy-standard: 規約・権限の設定・スクリプト・ワークフロー・PR テンプレートを写し、案件のファイルは残す', () => {
  const repo = makeOldRepo();
  const result = runCopyStandard(repo);

  assert.equal(result.status, 0, result.stderr);
  for (const path of [
    '.claude/rules/.standards-version',
    '.claude/rules/testing.md',
    '.claude/rules/api-contract.md',
    '.claude/settings.json',
    'docs/アプリ作り方ガイド.md',
    '.husky/pre-commit',
    '.husky/pre-push',
    'scripts/check-ac-coverage.mjs',
    '.github/workflows/ci.yaml',
    '.github/PULL_REQUEST_TEMPLATE.md',
  ]) {
    assert.ok(sameAsTemplate(repo, path), path);
  }
  assert.match(result.stdout, /^更新 \.github\/workflows\/ci\.yaml$/m);
  assert.match(result.stdout, /^追加 \.github\/PULL_REQUEST_TEMPLATE\.md$/m);

  // 案件で足したもの・CLAUDE.md は触らない。消すこともしない
  assert.equal(readFileSync(join(repo, '.claude/rules/project-only.md'), 'utf8'), 'project\n');
  assert.equal(readFileSync(join(repo, 'scripts/project-only.mjs'), 'utf8'), 'project\n');
  assert.equal(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), 'project\n');

  // 2 回目は変わるものが無い
  const second = runCopyStandard(repo);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /^(追加|更新) /m);
});

test('copy-standard: 有効にしているワークフローはその名前に写し、選んでいないものは .disabled のまま写す', () => {
  const repo = makeOldRepo({ enabledWorkflows: ['health-report.yaml'] });
  const result = runCopyStandard(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    sameAsTemplate(repo, '.github/workflows/health-report.yaml', '.github/workflows/health-report.yaml.disabled'),
  );
  assert.equal(existsSync(join(repo, '.github/workflows/health-report.yaml.disabled')), false);
  assert.match(
    result.stdout,
    /^更新 \.github\/workflows\/health-report\.yaml（テンプレートの \.github\/workflows\/health-report\.yaml\.disabled を、有効にしている名前に写す）$/m,
  );

  assert.ok(sameAsTemplate(repo, '.github/workflows/claude.yaml.disabled'));
  assert.equal(existsSync(join(repo, '.github/workflows/claude.yaml')), false);
});

test('copy-standard: サーバー側を持たないリポジトリには、元から無かった規約を増やさない', () => {
  const repo = makeOldRepo({ hasServer: false });
  const result = runCopyStandard(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(sameAsTemplate(repo, '.claude/rules/testing.md'));
  assert.ok(sameAsTemplate(repo, '.claude/rules/.standards-version'));
  assert.equal(existsSync(join(repo, '.claude/rules/db.md')), false);
  assert.equal(existsSync(join(repo, '.claude/rules/api-contract.md')), false);
  // 飛ばした規約は出力に出す（PR 本文に「追加された規約」として書かないように）
  assert.match(result.stdout, /^飛ばした \.claude\/rules\/db\.md（server\/ が無いリポジトリには/m);
});

test('copy-standard: 途中で失敗したときは、標準の版を新しくしない', () => {
  const repo = makeOldRepo();
  // .husky をファイルにしておくと、フックを写すところで失敗する
  writeRepoFile(repo, '.husky', 'not a folder\n');
  const result = runCopyStandard(repo);

  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(repo, '.claude/rules/.standards-version'), 'utf8'), '0.0.1\n');
});

test('copy-standard --repo-dir: 値が無い・空・「=」でつないだ形なら、何も書かずに止める', () => {
  // どれもカレントを対象にしてしまう形なので、カレントをテンプレートから作ったリポジトリにしておき、書かれないことを見る
  const cwd = mkdtempSync(join(workRoot, 'cwd-'));
  writeRepoFile(cwd, '.claude/rules/.standards-version', '0.0.1\n');
  for (const args of [['--repo-dir'], ['--repo-dir', ''], [`--repo-dir=${cwd}`]]) {
    const result = spawnSync(process.execPath, [copyStandardScript, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    });

    assert.equal(result.status, 1, args.join(' '));
    assert.match(
      result.stderr,
      /--repo-dir (には値が要ります|は「--repo-dir <値>」の形で渡してください)/,
      args.join(' '),
    );
  }
  assert.equal(existsSync(join(cwd, '.claude/settings.json')), false);
});

test('copy-standard --dry-run: 変わるファイルを示すだけで書かない', () => {
  const repo = makeOldRepo();
  const result = runCopyStandard(repo, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^更新 \.github\/workflows\/ci\.yaml$/m);
  assert.match(result.stdout, /--dry-run なので書いていません。/);
  assert.equal(readFileSync(join(repo, '.github/workflows/ci.yaml'), 'utf8'), 'old\n');
  assert.equal(existsSync(join(repo, '.github/PULL_REQUEST_TEMPLATE.md')), false);
});

test('copy-standard: テンプレートから消したファイルが残っていれば消し、一覧に無い案件のファイルは残す', () => {
  const repo = makeOldRepo();
  for (const { path } of retiredFiles) {
    writeRepoFile(repo, path, 'old\n');
  }
  const result = runCopyStandard(repo);

  assert.equal(result.status, 0, result.stderr);
  for (const { path } of retiredFiles) {
    assert.equal(existsSync(join(repo, path)), false, path);
    assert.ok(
      result.stdout.split('\n').some((line) => line.startsWith(`削除 ${path}（テンプレートから消したファイル: `)),
      path,
    );
  }
  assert.equal(readFileSync(join(repo, '.claude/rules/project-only.md'), 'utf8'), 'project\n');
  assert.equal(readFileSync(join(repo, 'scripts/project-only.mjs'), 'utf8'), 'project\n');
  assert.ok(sameAsTemplate(repo, '.claude/rules/.standards-version'));

  // 2 回目は消すものが無い
  const second = runCopyStandard(repo);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /^削除 /m);
});

test('copy-standard --dry-run: テンプレートから消したファイルを示すだけで消さない', () => {
  const repo = makeOldRepo();
  writeRepoFile(repo, '.github/workflows/progress-snapshot.yaml', 'old\n');
  const result = runCopyStandard(repo, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^削除 \.github\/workflows\/progress-snapshot\.yaml（/m);
  assert.equal(readFileSync(join(repo, '.github/workflows/progress-snapshot.yaml'), 'utf8'), 'old\n');
  assert.equal(readFileSync(join(repo, '.claude/rules/.standards-version'), 'utf8'), '0.0.1\n');
});

test('copy-standard: 一覧のパスがフォルダなら消さずに示し、取り込みは続ける', () => {
  const repo = makeOldRepo();
  mkdirSync(join(repo, 'docs/progress.md'), { recursive: true });
  const result = runCopyStandard(repo);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^消さなかった docs\/progress\.md（ファイルではない/m);
  assert.ok(existsSync(join(repo, 'docs/progress.md')));
  assert.ok(sameAsTemplate(repo, '.claude/rules/.standards-version'));
});

test('retired-files.json: 挙げたファイルはテンプレートに無く（有効・無効のどちらの名前でも）、消す理由がある', () => {
  assert.ok(retiredFiles.length > 0);
  for (const { path, reason } of retiredFiles) {
    const names = [path, path.endsWith('.disabled') ? path.slice(0, -'.disabled'.length) : `${path}.disabled`];
    for (const name of names) {
      assert.equal(existsSync(join(templateRoot, name)), false, `テンプレートにまだある: ${name}`);
    }
    // リポジトリの外を指さない（一覧を書き間違えて、関係ないファイルを消さないため）
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), path);
    assert.equal(typeof reason, 'string', path);
    assert.notEqual(reason.trim(), '', path);
  }
});

test('copy-standard: テンプレートから作ったリポジトリでなければ、何も書かずに止める', () => {
  const repo = mkdtempSync(join(workRoot, 'not-app-'));
  const result = runCopyStandard(repo);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /テンプレートから作ったリポジトリではありません/);
  assert.equal(existsSync(join(repo, '.claude')), false);
});
