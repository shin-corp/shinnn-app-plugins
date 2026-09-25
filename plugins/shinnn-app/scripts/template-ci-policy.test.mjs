/**
 * テンプレートの .github/workflows/ci.yaml の規約チェック（policy）の回帰テスト。`node --test scripts/` で実行する。
 *
 * ワークフローの YAML から手順のシェルを取り出し、Actions と同じく bash で動かして結果を確かめる。
 * - 「PR 本文に Closes #n があること」は、HTML のコメント（<!-- -->）の中の Closes #n では通さない
 * - 「API 定義を変えたらテストも変えていること」の git fetch は、全部取った履歴を浅くしない
 *   （浅くなると、同じジョブの後の gitleaks が一部のコミットしか調べない）
 * プラグインの CI は依存を入れずに動くので yaml パッケージは使わず、YAML の文字列を行で読む。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 同梱のテンプレートの CI */
const ciYaml = fileURLToPath(new URL('../template/.github/workflows/ci.yaml', import.meta.url));

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ci-policy-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * ci.yaml から、名前が name の手順の run: | のシェルを取り出す。
 * run: より深く字下げされた行を、その字下げを除いて集める。
 */
function stepScript(name) {
  const lines = readFileSync(ciYaml, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `手順「${name}」がありません`);
  const runIndex = lines.findIndex((line, index) => index > start && /^\s+run: \|$/.test(line));
  assert.notEqual(runIndex, -1, `手順「${name}」に run: | がありません`);
  const runIndent = lines[runIndex].indexOf('run:');
  const body = [];

  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= runIndent) {
      break;
    }

    body.push(line.slice(runIndent + 2));
  }

  return body.join('\n');
}

/** シェルを bash で動かす（Actions の既定と同じく -e を付ける） */
function runBash(script, { cwd = workRoot, env = {} } = {}) {
  const file = join(workRoot, `step-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, script);
  return spawnSync('bash', ['-e', file], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

/** git を実行する。利用者の設定（署名など）に左右されないようにする */
function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const closesStep = "'PR 本文に Closes #n があること'";

test('Closes #n: 本文に書かれていれば通す', () => {
  const result = runBash(stepScript(closesStep), { env: { PR_BODY: '## 対応 Issue\n\nCloses #12\n' } });

  assert.equal(result.status, 0, result.stderr);
});

test('Closes #n: HTML のコメントの中にしか無ければ通さない', () => {
  const body = '## 対応 Issue\n\nCloses #\n\n<!-- 例: Closes #12\n複数行のコメント -->\n<!-- fixes #3 -->\n';
  const result = runBash(stepScript(closesStep), { env: { PR_BODY: body } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Closes #<Issue 番号>/);
});

test('Closes #n: コメントの外にあれば、コメントと並んでいても通す', () => {
  const body = '<!-- 説明 -->\nResolves #7\n<!-- 説明 -->\n';
  const result = runBash(stepScript(closesStep), { env: { PR_BODY: body } });

  assert.equal(result.status, 0, result.stderr);
});

test('API 定義の確認の git fetch は、全部取った履歴を浅くしない（後の gitleaks が全履歴を調べられる）', () => {
  // 送り先: main に 60 コミット（以前の --depth=50 より多く）、作業ブランチに 1 コミット
  const origin = join(workRoot, 'origin');
  git(workRoot, 'init', '-q', '-b', 'main', origin);

  for (let index = 0; index < 60; index += 1) {
    git(origin, 'commit', '-q', '--allow-empty', '-m', `main ${index}`);
  }

  git(origin, 'switch', '-q', '-c', 'feature/1-x');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'feature');
  git(origin, 'switch', '-q', 'main');

  // Actions の checkout（fetch-depth: 0）と同じく、全履歴を取った手元。file:// にして浅い取得が効くようにする
  const clone = join(workRoot, 'clone');
  git(workRoot, 'clone', '-q', pathToFileURL(origin).href, clone);
  git(clone, 'switch', '-q', 'feature/1-x');
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository'), 'false');

  const result = runBash(stepScript('API 定義を変えたらテストも変えていること'), {
    cwd: clone,
    env: { BASE_REF: 'main', PR_BODY: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(clone, 'rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git(clone, 'rev-list', '--count', 'HEAD'), '61');
});
