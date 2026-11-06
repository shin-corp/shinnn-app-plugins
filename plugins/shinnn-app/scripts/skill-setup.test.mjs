/**
 * スキル setup の「進め方」と手順 5 の、途中から続ける道順の回帰テスト。`node --test scripts/` で実行する。
 *
 * スキルは文書なので、動かせるのは書いてあるコマンドだけ。コマンドは SKILL.md から読み出し、
 * 一時フォルダの本物の git（送り先は bare リポジトリ）で、setup が止まった場所ごとの結果を確かめる。
 * - 手順 0 の続き: テンプレートをコミットしていないか、origin が無いか、origin に main が無ければ、コマンドの結果で分かる
 * - 手順 5 の続き: 適用のブランチが手元か origin にあれば移れる。無ければ失敗し、main の最新から切れる
 * どの状態で何をするかはスキルの文なので、順番と名指しだけを見る。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 確かめるスキル */
const skill = readFileSync(fileURLToPath(new URL('../skills/setup/SKILL.md', import.meta.url)), 'utf8');

/** テンプレートから作ったリポジトリには必ず入っているファイル */
const MARKER = '.claude/rules/.standards-version';

/** 初回の適用の Issue の題 */
const APPLY_ISSUE_TITLE = '[設定] 初回セットアップの適用';

/** 適用のブランチ。Issue の番号は例 */
const APPLY_BRANCH = 'feature/12-setup';

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skill-setup-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** 見出しから同じ深さの次の見出しまでを返す */
function section(heading) {
  const lines = skill.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `${heading} がスキルにありません`);
  const prefix = `${heading.split(' ')[0]} `;
  const end = lines.findIndex((line, index) => index > start && line.startsWith(prefix));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** 文の中のコードブロックの行を、字下げを除いて返す */
function codeLines(text) {
  const blocks = [...text.matchAll(/^ *```\n([\s\S]*?)^ *```$/gm)];
  return blocks.flatMap((block) =>
    block[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
}

/** 「進め方」の節 */
const progress = section('## 進め方');

/** 手順 5 の節 */
const applyStep = section('### 5. 適用');

/** 「進め方」にある、手順 0 の残りを見る 2 つのコマンド */
const [commitCheck, remoteCheck] = codeLines(progress);

/** 手順 5 の 3 にある、作業ブランチの元を取ってくるコマンド（`git fetch` で始まる行） */
const fetchForBranch = codeLines(applyStep).find((line) => line.startsWith('git fetch'));

/** 手順 5 の 3 にある、ブランチを新しく切るコマンド */
const createBranch = codeLines(applyStep).find((line) => line.startsWith('git switch -c'));

/** git を実行する。利用者の設定に左右されないようにし、失敗の文言を英語に揃える */
function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(workRoot, 'gitconfig'), LC_ALL: 'C', LANGUAGE: 'C' },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** スキルに書いてあるコマンドの 1 行をそのまま実行する。引用符を含まない行だけを渡す */
function runLine(cwd, line) {
  const [command, ...args] = line.split(' ');
  assert.equal(command, 'git');
  return git(cwd, ...args);
}

/** 通ることを確かめてから結果を返す */
function gitOk(cwd, ...args) {
  const result = git(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

/** テンプレートを展開した直後のフォルダを作る（`.git` は無い） */
function expandedFolder() {
  const folder = join(mkdtempSync(join(workRoot, 'case-')), 'app');
  mkdirSync(dirname(join(folder, MARKER)), { recursive: true });
  writeFileSync(join(folder, MARKER), '0.0.0\n');
  return folder;
}

/** テンプレートを最初のコミットに入れたフォルダを作る */
function committedFolder() {
  const folder = expandedFolder();
  gitOk(folder, 'init', '--initial-branch=main');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'first');
  return folder;
}

/** 空の送り先を作り、手元の origin にする */
function addEmptyOrigin(folder) {
  const remote = join(dirname(folder), 'remote.git');
  gitOk(dirname(folder), 'init', '--bare', '--initial-branch=main', remote);
  gitOk(folder, 'remote', 'add', 'origin', remote);
  return remote;
}

/** main まで push を済ませたフォルダを作る。手順 0 がすべて済んだ状態 */
function publishedFolder() {
  const folder = committedFolder();
  addEmptyOrigin(folder);
  gitOk(folder, 'push', '-u', 'origin', 'main');
  return folder;
}

/** 今のブランチの名前 */
function currentBranch(folder) {
  return gitOk(folder, 'branch', '--show-current').stdout.trim();
}

/** 空でないコミットを 1 つ足す */
function commitFile(folder, name) {
  writeFileSync(join(folder, name), `${name}\n`);
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', name);
}

test('進め方: 手順 0 の残りを見るコマンドは、テンプレートのコミットと origin の main を見る', () => {
  assert.equal(commitCheck, `git log -1 --oneline -- ${MARKER}`);
  assert.equal(remoteCheck, 'git fetch origin main');
});

test('進め方: 手順 0 の残りは、標準の版の比較より先に見る', () => {
  assert.ok(progress.indexOf(remoteCheck) < progress.indexOf('/shinnn-app:update-rules'));
});

test('進め方: 適用の途中かは、手順 1〜6 に進むより先に見る', () => {
  assert.ok(progress.indexOf(APPLY_ISSUE_TITLE) < progress.indexOf('手順 1〜6 を順に行う'));
});

test('進め方: 手順 0 の残りの行き先と、起動し直しの条件を名指しする', () => {
  assert.match(progress, /手順 0 の 3。終わったら `git fetch` を見直す \|/);
  assert.match(progress, /手順 0 の 4 \|/);
  assert.match(progress, /手順 0 の 4 の `git push` \|/);
  assert.match(progress, /どれかを行ったら、手順 0 の 5 に進む。どれも行わなかったら、3 に進む/);
});

test('進め方: 名指しする手順と失敗の項目が、スキルにある', () => {
  assert.match(skill, /^3\. \*\*git に記録する。\*\*/m);
  assert.match(skill, /^4\. \*\*GitHub にリポジトリを作る。\*\*/m);
  assert.match(skill, /^5\. \*\*起動し直してもらう。\*\*/m);
  assert.match(section('## 失敗したとき'), /^- 「進め方」の `git fetch origin main` が接続か認証の問題で失敗する/m);
});

test('手順 0: 手順 1 に進まないのは、展開したセッションだけ', () => {
  const step = section('### 0. テンプレートの展開');

  assert.match(step, /手順 0 の 2 で展開したセッションでは手順 1 に進まない/);
  assert.match(step, /このセッションで 2 の展開をしていなければ、規約は読み込まれている。/);
  assert.match(step, /その場合は起動し直しを伝えず、「進め方」の 3 に進む/);
});

test('手順 0: 最初のコミットと push が、規約の main への push の禁止に当たらないことを名指しする', () => {
  const step = section('### 0. テンプレートの展開');
  const rule = readFileSync(
    fileURLToPath(new URL('../template/.claude/rules/git-workflow.md', import.meta.url)),
    'utf8',
  );
  const quoted = '`main` へ直接コミットも push もしない';

  assert.ok(step.includes(`規約 \`git-workflow.md\` の「${quoted}」に当たらない`));
  assert.ok(rule.includes(quoted));
});

test('手順 0 の 4: origin があって main が無ければ、リポジトリを作らずに push する', () => {
  assert.match(
    section('### 0. テンプレートの展開'),
    /`origin` があって `main` をまだ push していなければ、リポジトリを作らずに `git push -u origin main`/,
  );
});

test('手順 0 の残り: .git が無ければ git log が失敗する', () => {
  const folder = expandedFolder();

  assert.notEqual(runLine(folder, commitCheck).status, 0);
});

test('手順 0 の残り: 最初のコミットが無ければ git log が失敗する', () => {
  const folder = expandedFolder();
  gitOk(folder, 'init', '--initial-branch=main');
  gitOk(folder, 'add', '-A');

  assert.notEqual(runLine(folder, commitCheck).status, 0);
});

test('手順 0 の残り: テンプレートをコミットしていなければ、別のコミットがあっても git log は何も出さない', () => {
  const folder = expandedFolder();
  gitOk(folder, 'init', '--initial-branch=main');
  gitOk(folder, 'commit', '--allow-empty', '-m', 'empty');

  const result = runLine(folder, commitCheck);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('手順 0 の残り: テンプレートをコミットしていれば git log が 1 行出す', () => {
  const result = runLine(committedFolder(), commitCheck);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\w+ first\n$/);
});

test('手順 0 の残り: 作業ブランチの上でも、テンプレートのコミットが見える', () => {
  const folder = publishedFolder();
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);
  commitFile(folder, 'applied.txt');

  assert.match(runLine(folder, commitCheck).stdout, /first/);
});

test('手順 0 の残り: origin が無ければ git fetch が origin が無いと言って失敗する', () => {
  const result = runLine(committedFolder(), remoteCheck);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /'origin' does not appear to be a git repository/);
});

test('手順 0 の残り: origin に main が無ければ git fetch が main が無いと言って失敗する', () => {
  const folder = committedFolder();
  addEmptyOrigin(folder);

  const result = runLine(folder, remoteCheck);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /couldn't find remote ref main/);
});

test('手順 0 の残り: origin に main があれば git fetch が通る', () => {
  const result = runLine(publishedFolder(), remoteCheck);

  assert.equal(result.status, 0, result.stderr);
});

test('手順 0 の 4: origin に main が無いときの push で、git fetch が通るようになる', () => {
  const folder = committedFolder();
  addEmptyOrigin(folder);

  gitOk(folder, 'push', '-u', 'origin', 'main');

  assert.equal(runLine(folder, remoteCheck).status, 0);
});

test('手順 5 の 2: 探す題と、作る題と、進め方で見る題が同じ', () => {
  const step = applyStep.slice(
    applyStep.indexOf('2. 適用の Issue を用意する'),
    applyStep.indexOf('3. 2 の Issue の番号'),
  );

  assert.ok(step.includes(`\`${APPLY_ISSUE_TITLE}\``));
  assert.ok(progress.includes(`\`${APPLY_ISSUE_TITLE}\``));
  assert.ok(step.includes('gh issue list --state open'));
  assert.ok(step.indexOf('gh issue list --state open') < step.indexOf('gh issue create'));
});

test('手順 5 の 3: ブランチを新しく切る前に、既にあるブランチへ移るのを試す', () => {
  assert.equal(createBranch, 'git switch -c feature/<Issue 番号>-setup origin/main');
  assert.match(applyStep, /`git switch -c` の前に `git switch feature\/<Issue 番号>-setup` を試す/);
});

test('手順 5 の 3: 適用のブランチが手元にあれば、未コミットの変更を持ったまま移れる', () => {
  const folder = publishedFolder();
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);
  commitFile(folder, 'applied.txt');
  gitOk(folder, 'switch', 'main');
  writeFileSync(join(folder, 'env.md'), 'env\n');

  runLine(folder, fetchForBranch);
  const result = git(folder, 'switch', APPLY_BRANCH);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentBranch(folder), APPLY_BRANCH);
  assert.ok(existsSync(join(folder, 'applied.txt')));
  assert.ok(existsSync(join(folder, 'env.md')));
});

test('手順 5 の 3: 適用のブランチに既にいても、移るコマンドは失敗しない', () => {
  const folder = publishedFolder();
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);

  assert.equal(git(folder, 'switch', APPLY_BRANCH).status, 0);
});

test('手順 5 の 3: 適用のブランチが origin だけにあれば、取ってきた後に移れる', () => {
  const folder = publishedFolder();
  const other = join(dirname(folder), 'other');
  gitOk(dirname(folder), 'clone', join(dirname(folder), 'remote.git'), other);
  gitOk(other, 'switch', '-c', APPLY_BRANCH);
  commitFile(other, 'applied.txt');
  gitOk(other, 'push', '-u', 'origin', APPLY_BRANCH);

  assert.equal(runLine(folder, fetchForBranch).status, 0);
  const result = git(folder, 'switch', APPLY_BRANCH);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentBranch(folder), APPLY_BRANCH);
  assert.ok(existsSync(join(folder, 'applied.txt')));
});

test('手順 5 の 3: 適用のブランチがどこにも無ければ、移るコマンドは失敗し、origin/main から切れる', () => {
  const folder = publishedFolder();

  runLine(folder, fetchForBranch);
  assert.notEqual(git(folder, 'switch', APPLY_BRANCH).status, 0);

  gitOk(folder, 'switch', '-c', APPLY_BRANCH, 'origin/main');
  assert.equal(currentBranch(folder), APPLY_BRANCH);
});

test('手順 5 の 3: main が進んでいれば、取り込むかを見るコマンドにコミットが出る', () => {
  const folder = publishedFolder();
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);
  assert.match(
    applyStep,
    /`git log HEAD\.\.origin\/main --oneline` にコミットが出たら、`git merge origin\/main` で取り込む/,
  );
  assert.equal(gitOk(folder, 'log', 'HEAD..origin/main', '--oneline').stdout, '');

  const other = join(dirname(folder), 'other');
  gitOk(dirname(folder), 'clone', join(dirname(folder), 'remote.git'), other);
  commitFile(other, 'standard.txt');
  gitOk(other, 'push', 'origin', 'main');
  runLine(folder, fetchForBranch);

  assert.match(gitOk(folder, 'log', 'HEAD..origin/main', '--oneline').stdout, /standard\.txt/);
});

test('手順 5: 続きから進めても、記録と引き継ぎメモと PR を作り直さない', () => {
  assert.match(applyStep, /`<番号>-setup\.md` が既にあれば、新しく作らずにそれを書き直す/);
  assert.match(applyStep, /open な「引き継ぎメモ」Issue があれば作らず、それを pin して番号を使う/);
  assert.match(
    applyStep,
    /このブランチの PR が既にあれば（`gh pr view`）、`\/shinnn-app:pr` の手順 3 で `gh pr create` を飛ばし/,
  );
});

test('再実行のとき: 初回の PR がマージされる前は、同じ Issue とブランチで続ける', () => {
  assert.match(applyStep, /初回の PR がマージされる前は、「進め方」の 4 のとおり同じ Issue とブランチで続ける/);
});
