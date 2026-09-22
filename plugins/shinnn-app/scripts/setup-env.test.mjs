/**
 * テンプレートの scripts/setup-env.mjs（/shinnn-app:setup の手順 2 が使う環境の検出）の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 同梱のテンプレートは書き換えず、スクリプトを一時フォルダに写して動かす。`--write` は写したフォルダの
 * docs/env.md に書く。外部のコマンドが 1 つも無い環境で動かし、コマンドが無くても落ちないことと、
 * 手元に何が入っているかに結果が左右されないことを両方確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレートの環境の検出スクリプト */
const setupEnvScript = fileURLToPath(new URL('../template/scripts/setup-env.mjs', import.meta.url));

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/**
 * 外部のコマンドが 1 つも見つからない環境。PATH だけを空のフォルダにする。
 * Windows では環境変数の名前が `Path` のこともあるので、大文字小文字を問わず除いてから入れる。
 */
function envWithoutCommands(extra) {
  const emptyDir = mkdtempSync(join(workRoot, 'no-commands-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return { ...env, PATH: emptyDir, ...extra };
}

/** setup-env.mjs を写した一時フォルダ */
function makeEnvRepo() {
  const repo = mkdtempSync(join(workRoot, 'env-'));
  mkdirSync(join(repo, 'scripts'));
  cpSync(setupEnvScript, join(repo, 'scripts', 'setup-env.mjs'));
  return repo;
}

/** setup-env.mjs をコマンドの無い環境で実行する。DB の検出は DATABASE_URL で済ませ、接続も docker も試さない */
function runSetupEnv(repo, args) {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'setup-env.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: envWithoutCommands({ DATABASE_URL: 'postgres://localhost:5432/app' }),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'setup-env-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('setup-env: 開発環境を表で示し、コマンドが 1 つも無くても落ちない', () => {
  const repo = makeEnvRepo();
  const result = runSetupEnv(repo, []);

  assert.equal(result.status, 0, result.stderr);
  for (const row of ['OS', 'Node.js', 'npm', 'Git', 'GitHub CLI（gh）', 'Docker']) {
    assert.match(result.stdout, new RegExp(`^\\| ${row.replace(/[.()（）]/g, '\\$&')} \\| .+ \\|$`, 'm'), row);
  }
  assert.match(
    result.stdout,
    new RegExp(`^\\| Node\\.js \\| ${process.versions.node.replaceAll('.', '\\.')} \\|`, 'm'),
  );
  for (const row of ['npm', 'Git', 'GitHub CLI（gh）', 'Docker']) {
    assert.match(
      result.stdout,
      new RegExp(`^\\| ${row.replace(/[()（）]/g, '\\$&')} \\| 見つかりません \\|`, 'm'),
      row,
    );
  }
  // PostgreSQL の候補もこれまでどおり出す
  assert.match(result.stdout, /## ローカルの PostgreSQL/);
  assert.match(result.stdout, /採用: 環境変数 DATABASE_URL の接続先/);
  assert.equal(existsSync(join(repo, 'docs')), false);
});

test('setup-env --write: docs/env.md には PostgreSQL の節だけを追記し、2 回目は書かない', () => {
  const repo = makeEnvRepo();
  const first = runSetupEnv(repo, ['--write']);

  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /docs\/env\.md に追記しました。/);
  const written = readFileSync(join(repo, 'docs', 'env.md'), 'utf8');
  assert.match(written, /^## ローカルの PostgreSQL$/m);
  assert.match(written, /- 採用: 環境変数 DATABASE_URL の接続先/);
  // 開発環境の表は使う人のパソコンごとに違うので、リポジトリの文書には残さない
  assert.ok(!written.includes('## 開発環境'), written);

  const second = runSetupEnv(repo, ['--write']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /節が既にあります/);
  assert.equal(readFileSync(join(repo, 'docs', 'env.md'), 'utf8'), written);
});
