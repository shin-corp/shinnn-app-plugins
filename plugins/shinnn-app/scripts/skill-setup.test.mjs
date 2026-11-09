/**
 * スキル setup の「進め方」と手順 5 の、途中から続ける道順の回帰テスト。`node --test scripts/` で実行する。
 *
 * スキルは文書なので、動かせるのは書いてあるコマンドだけ。コマンドは SKILL.md から読み出し、
 * 一時フォルダの本物の git（送り先は bare リポジトリ）で、setup が止まった場所ごとの結果を確かめる。
 * - 手順 0 の続き: テンプレートをコミットしていないか、origin が無いか、origin の main が無いか、
 *   origin の main にテンプレートが無ければ、コマンドの結果で分かる
 * - origin の main が GitHub の作成画面のファイル（README.md・LICENSE・.gitignore）だけなら、上書きせずにその上へ重ねて送れる
 * - 手順 5 の続き: 適用のブランチが手元か origin にあれば移れる。無ければ失敗し、main の最新から切れる
 * - main の取り込み: 未コミットの変更と重なると断られ、記録の衝突は main の側を取ると解ける
 * - Claude Code を起動する前に外から展開したフォルダ: 手順 0 の git と GitHub の用意から行い、起動し直しを伝えない
 *   （fetch-template.mjs の冒頭のコメントにある、外から呼ぶ側との約束）
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

/** setup の記録 */
const SETUP = '.shinnn/setup.json';

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

/** 「進め方」の節。手順 0〜6 の見出しの手前まで */
const progress = section('## 進め方').split('\n### 0. ')[0];

/** 手順 0 の節 */
const templateStep = section('### 0. テンプレートの展開');

/** 手順 5 の節 */
const applyStep = section('### 5. 適用');

/** 失敗したときの節 */
const failures = section('## 失敗したとき');

/** 「進め方」にある、手順 0 の残りを見る 3 つのコマンド */
const [commitCheck, remoteCheck, templateOnRemoteCheck] = codeLines(progress);

/** 「進め方」の 3 にある、origin/main の標準の版が進んでいるかを見るコマンド */
const standardsAheadCheck = progress.match(/`(git log HEAD\.\.origin\/main --oneline -- [^`]+)`/)?.[1];

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

/** 別の手元から origin の main を進める。書くファイルと中身を渡す */
function advanceOriginMain(folder, path, content) {
  const other = join(dirname(folder), 'other');
  gitOk(dirname(folder), 'clone', join(dirname(folder), 'remote.git'), other);
  gitOk(other, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(dirname(join(other, path)), { recursive: true });
  writeFileSync(join(other, path), content);
  gitOk(other, 'add', '-A');
  gitOk(other, 'commit', '-m', path);
  gitOk(other, 'push', 'origin', 'main');
}

/** 手順 0 が済んだ後に、記録のファイルを main に足して、適用のブランチに移ったフォルダを作る */
function applyBranchWithSetupFile() {
  const folder = publishedFolder();
  mkdirSync(join(folder, '.shinnn'));
  writeFileSync(join(folder, SETUP), '{\n  "a": false\n}\n');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'setup');
  gitOk(folder, 'push', 'origin', 'main');
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);
  return folder;
}

test('進め方: 手順 0 の残りを見るコマンドは、テンプレートのコミットと origin の main とその中身を見る', () => {
  assert.equal(commitCheck, `git log -1 --oneline -- ${MARKER}`);
  assert.equal(remoteCheck, 'git fetch origin main');
  assert.equal(templateOnRemoteCheck, `git log -1 --oneline origin/main -- ${MARKER}`);
});

test('進め方: 手順 0 の残り、標準の版、適用の途中、手順 1〜6 の順に見る', () => {
  const order = [remoteCheck, '/shinnn-app:update-rules', APPLY_ISSUE_TITLE, '手順 1〜6 を順に行う'].map((text) =>
    progress.indexOf(text),
  );

  assert.ok(order.every((index) => index !== -1));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test('進め方: 手順 0 の残りの行き先と、起動し直しの条件を名指しする', () => {
  assert.match(progress, /手順 0 の 3。終わったら 2 つ目を見る \|/);
  assert.match(progress, /手順 0 の 4 \|/);
  assert.match(progress, /手順 0 の 4 の `git push` \|/);
  assert.match(progress, /そのほかの理由で失敗する \| 「失敗したとき」の `git fetch origin main` の項目に従う \|/);
  assert.match(progress, /3 つ目が何も出さない.* \| 「失敗したとき」の `git push -u origin main` の項目に従う \|/);
  assert.match(progress, /どれかを行ったら、手順 0 の 5 に進む。どれも行わなかったら、3 に進む/);
});

test('進め方: 標準の版は、進んだ origin/main を取り込んでから比べる', () => {
  assert.equal(standardsAheadCheck, `git log HEAD..origin/main --oneline -- ${MARKER}`);
  assert.match(progress, /`origin\/main` を取り込んでから比べる/);
});

test('進め方: update-rules を案内する前に、適用の未コミットの変更をコミットする', () => {
  const commit = progress.indexOf('`feature/<番号>-setup` の未コミットの変更をコミットする');

  assert.notEqual(commit, -1);
  assert.ok(commit < progress.indexOf('`/shinnn-app:update-rules` で標準を取り込むよう伝えて終える'));
});

test('進め方: 適用の途中では、本文の確認を 1 回だけにして手順 5 を 1 から行う', () => {
  assert.match(progress, /Issue の本文の決めた内容を示し、変えるものがあるかを 1 回だけ聞く/);
  assert.match(progress, /残りの手順 1〜4 は飛ばし、手順 5 を 1 から順に行う/);
});

test('進め方: 名指しする手順と失敗の項目が、スキルにある', () => {
  assert.match(skill, /^3\. \*\*git に記録する。\*\*/m);
  assert.match(skill, /^4\. \*\*GitHub にリポジトリを作る。\*\*/m);
  assert.match(skill, /^5\. \*\*起動し直してもらう。\*\*/m);
  assert.match(failures, /^- 「進め方」の `git fetch origin main` が接続か認証の問題で失敗する/m);
  assert.match(failures, /^- `git push -u origin main` が断られる、または `origin` の `main` にテンプレートが無い/m);
  assert.match(failures, /^- `git merge origin\/main` が衝突で止まる/m);
  assert.match(failures, /^- `gh repo create` が、同じ名前のリポジトリが既にあると言って失敗する/m);
});

test('手順 0: 手順 1 に進まないのは、展開したセッションだけ', () => {
  assert.match(templateStep, /手順 0 の 2 で展開したセッションでは手順 1 に進まない/);
  assert.match(templateStep, /このセッションで 2 の展開をしていなければ、規約は読み込まれている。/);
  assert.match(templateStep, /その場合は起動し直しを伝えず、「進め方」の 3 に進む/);
});

test('手順 0: テンプレートを取り込むコミットと push は、規約の「やらないこと」のただし書きを名指しする', () => {
  const rule = readFileSync(
    fileURLToPath(new URL('../template/.claude/rules/git-workflow.md', import.meta.url)),
    'utf8',
  );
  const doNot = rule.slice(rule.indexOf('## やらないこと'));

  assert.match(templateStep, /規約 `git-workflow\.md` の「やらないこと」のただし書きに当たる/);
  // 許すのは、決定 #100 の「空とみなす」と同じ 2 つの場合だけ
  assert.match(
    doNot,
    /^- ただし、GitHub の `main` が無いときと、`main` のファイルが GitHub の作成画面で付けた `README\.md`・`LICENSE`・`\.gitignore` だけのときは、\n {2}テンプレートを取り込むコミットを `main` に作って push してよい/m,
  );
});

test('手順 0 の 3: 今のブランチが main でなければ、名前を変えると push できる', () => {
  const folder = expandedFolder();
  gitOk(folder, 'init', '--initial-branch=master');

  assert.match(templateStep, /今のブランチが `main` でなければ `git branch -M main`/);
  gitOk(folder, 'branch', '-M', 'main');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'first');
  addEmptyOrigin(folder);

  assert.equal(git(folder, 'push', '-u', 'origin', 'main').status, 0);
  assert.equal(runLine(folder, remoteCheck).status, 0);
});

test('手順 0 の 4: origin があれば、リポジトリを作らずに push し、断られたら失敗の項目に従う', () => {
  assert.match(templateStep, /`origin` があれば、リポジトリを作らずに `git push -u origin main` だけを実行する/);
  assert.match(
    templateStep,
    /`git push -u origin main` が断られたら、「失敗したとき」の `git push -u origin main` の項目に従う/,
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

test('手順 0 の残り: origin の main にテンプレートがあれば、3 つ目のコマンドが 1 行出す', () => {
  const result = runLine(publishedFolder(), templateOnRemoteCheck);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\w+ first\n$/);
});

test('手順 0 の残り: origin の main が別の履歴なら、push は断られ、3 つ目のコマンドは何も出さない', () => {
  const folder = committedFolder();
  addEmptyOrigin(folder);
  advanceOriginMain(folder, 'README.md', 'readme\n');

  assert.notEqual(git(folder, 'push', '-u', 'origin', 'main').status, 0);
  assert.equal(runLine(folder, remoteCheck).status, 0);

  const result = runLine(folder, templateOnRemoteCheck);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

/** 失敗したときの、`git push -u origin main` の項目 */
const pushFailure = failures.slice(
  failures.indexOf('- `git push -u origin main` が断られる'),
  failures.indexOf('- `git merge origin/main` が衝突で止まる'),
);

/** その項目のコマンド。origin の main のファイルを見る 2 つと、重ね直す 4 つ */
const [fetchForStack, listOriginFiles, ...stackCommands] = codeLines(pushFailure);

/** GitHub の作成画面で付けられる 3 つ */
const REPOSITORY_FILES = ['README.md', 'LICENSE', '.gitignore'];

/** スキルの 1 行を実行する。`git commit -m "…"` の行だけは、引用符の中を 1 つの引数にする */
function runStackLine(cwd, line) {
  const message = line.match(/^git commit -m "(.+)"$/)?.[1];
  return message === undefined ? runLine(cwd, line) : git(cwd, 'commit', '-m', message);
}

/** 展開したテンプレートのつもりのフォルダ。README.md・.gitignore・LICENSE はテンプレートのもの */
function expandedFolderWithRepositoryFiles() {
  const folder = expandedFolder();
  writeFileSync(join(folder, 'README.md'), 'template readme\n');
  writeFileSync(join(folder, '.gitignore'), '.env\n');
  writeFileSync(join(folder, 'LICENSE'), 'MIT License\n');
  return folder;
}

/**
 * GitHub の作成画面で README.md と LICENSE を付けたリポジトリと同じく、main にその 2 つだけのコミットがある送り先を、
 * フォルダの隣に作る
 */
function remoteWithRepositoryFiles(folder) {
  const remote = join(dirname(folder), 'remote.git');
  gitOk(dirname(folder), 'init', '--bare', '--initial-branch=main', remote);
  const other = join(dirname(folder), 'other');
  gitOk(dirname(folder), 'clone', remote, other);
  gitOk(other, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(other, 'README.md'), '# app\n');
  writeFileSync(join(other, 'LICENSE'), 'Apache License\n');
  gitOk(other, 'add', '-A');
  gitOk(other, 'commit', '-m', 'Initial commit');
  gitOk(other, 'push', 'origin', 'main');
  return remote;
}

/** フォルダの origin に、作成画面のファイルだけの送り先を足す */
function addOriginWithRepositoryFiles(folder) {
  const remote = remoteWithRepositoryFiles(folder);
  gitOk(folder, 'remote', 'add', 'origin', remote);
  return remote;
}

test('失敗したとき: origin の main を見る 2 つと、重ね直す 4 つのコマンドがこの順にある', () => {
  assert.equal(fetchForStack, 'git fetch origin main');
  assert.equal(listOriginFiles, 'git ls-tree -r --name-only origin/main');
  assert.deepEqual(stackCommands, [
    'git reset --soft origin/main',
    'git checkout origin/main -- LICENSE',
    'git commit -m "テンプレートの取り込み"',
    'git push -u origin main',
  ]);
  assert.match(pushFailure, /上書きしない（`--force` を付けない）/);
  assert.match(pushFailure, /`origin` の `main` に `LICENSE` があるときだけ、`git checkout origin\/main -- LICENSE`/);
  assert.match(pushFailure, /ほかのファイルもあれば、`origin` は別のアプリのリポジトリを指している/);
});

test('手順 0 の 4: GitHub で作ったリポジトリを clone したフォルダでは、テンプレートのコミットがそのまま送れる', () => {
  const folder = expandedFolderWithRepositoryFiles();
  const remote = remoteWithRepositoryFiles(folder);
  // clone したフォルダに、テンプレートを展開してコミットしたのと同じ状態
  const cloned = join(dirname(folder), 'cloned');
  gitOk(dirname(folder), 'clone', remote, cloned);
  mkdirSync(dirname(join(cloned, MARKER)), { recursive: true });
  writeFileSync(join(cloned, MARKER), '0.0.0\n');
  writeFileSync(join(cloned, 'README.md'), 'template readme\n');
  gitOk(cloned, 'add', '-A');
  gitOk(cloned, 'commit', '-m', 'テンプレートの取り込み');

  assert.equal(runStackLine(cloned, stackCommands.at(-1)).status, 0);
  assert.match(runLine(cloned, templateOnRemoteCheck).stdout, /テンプレートの取り込み/);
});

test('失敗したとき: origin の main が作成画面のファイルだけなら、その上にテンプレートのコミットを重ね直して送れる', () => {
  const folder = expandedFolderWithRepositoryFiles();
  gitOk(folder, 'init', '--initial-branch=main');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'テンプレートの取り込み');
  addOriginWithRepositoryFiles(folder);
  const originMain = () => gitOk(folder, 'rev-parse', 'origin/main').stdout.trim();

  // 別の履歴なので、そのままでは断られる
  assert.notEqual(runStackLine(folder, stackCommands.at(-1)).status, 0);

  assert.equal(runLine(folder, fetchForStack).status, 0);
  const files = runLine(folder, listOriginFiles)
    .stdout.split('\n')
    .filter((line) => line !== '');
  assert.ok(
    files.every((file) => REPOSITORY_FILES.includes(file)),
    files.join(', '),
  );
  const base = originMain();

  for (const line of stackCommands) {
    const result = runStackLine(folder, line);
    assert.equal(result.status, 0, `${line}\n${result.stderr}`);
  }

  // origin の main は上書きされず、テンプレートのコミットの親になる
  assert.equal(gitOk(folder, 'rev-parse', 'HEAD~1').stdout.trim(), base);
  assert.equal(originMain(), gitOk(folder, 'rev-parse', 'HEAD').stdout.trim());
  // README.md はテンプレートのもの、LICENSE は origin のもの。テンプレートの目印も入る
  assert.equal(gitOk(folder, 'show', 'HEAD:README.md').stdout, 'template readme\n');
  assert.equal(gitOk(folder, 'show', 'HEAD:LICENSE').stdout, 'Apache License\n');
  assert.equal(gitOk(folder, 'show', 'HEAD:.gitignore').stdout, '.env\n');
  assert.match(runLine(folder, templateOnRemoteCheck).stdout, /テンプレートの取り込み/);
  assert.equal(gitOk(folder, 'status', '--porcelain').stdout, '');
});

test('進め方の 3: origin/main の標準の版が進んでいるときだけ、比べる前のコマンドにコミットが出る', () => {
  const folder = publishedFolder();
  gitOk(folder, 'switch', '-c', APPLY_BRANCH);
  advanceOriginMain(folder, 'other.txt', 'other\n');
  runLine(folder, remoteCheck);
  assert.equal(runLine(folder, standardsAheadCheck).stdout, '');

  const other = join(dirname(folder), 'other');
  writeFileSync(join(other, MARKER), '0.0.1\n');
  gitOk(other, 'add', '-A');
  gitOk(other, 'commit', '-m', 'standard');
  gitOk(other, 'push', 'origin', 'main');
  runLine(folder, remoteCheck);

  assert.match(runLine(folder, standardsAheadCheck).stdout, /standard/);
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

test('手順 5 の 2: 見つかれば新しく作らず、2 つ以上なら聞き、見つからないときと再実行では作る', () => {
  assert.match(applyStep, /1 つあれば、新しく作らずにその Issue を使う/);
  assert.match(applyStep, /2 つ以上あれば、番号を示してどれを使うかを聞く/);
  assert.match(applyStep, /見つからないときと再実行では、`gh issue create` で作る/);
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
    /`git log HEAD\.\.origin\/main --oneline` にコミットが出たら、未コミットの変更をこのブランチにコミットしてから/,
  );
  assert.match(applyStep, /`git merge origin\/main` で取り込む/);
  assert.equal(gitOk(folder, 'log', 'HEAD..origin/main', '--oneline').stdout, '');

  advanceOriginMain(folder, 'standard.txt', 'standard\n');
  runLine(folder, fetchForBranch);

  assert.match(gitOk(folder, 'log', 'HEAD..origin/main', '--oneline').stdout, /standard\.txt/);
});

test('手順 5 の 3: 未コミットの変更と重なると git merge は断るので、先にコミットすると進める', () => {
  const folder = applyBranchWithSetupFile();
  advanceOriginMain(folder, 'standard.txt', 'standard\n');
  runLine(folder, fetchForBranch);
  writeFileSync(join(folder, 'standard.txt'), 'local\n');

  const refused = git(folder, 'merge', 'origin/main');

  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /would be overwritten by merge/);

  rmSync(join(folder, 'standard.txt'));
  writeFileSync(join(folder, 'applied.txt'), 'applied\n');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'applied');

  assert.equal(git(folder, 'merge', 'origin/main', '--no-edit').status, 0);
});

test('失敗したとき: 記録の衝突は、main の側を取るとマージを終えられ、main が取り込まれる', () => {
  const folder = applyBranchWithSetupFile();
  writeFileSync(join(folder, SETUP), '{\n  "a": true\n}\n');
  gitOk(folder, 'add', '-A');
  gitOk(folder, 'commit', '-m', 'applied');
  const mainSetup = '{\n  "a": false,\n  "c": false\n}\n';
  advanceOriginMain(folder, SETUP, mainSetup);
  runLine(folder, fetchForBranch);

  assert.notEqual(git(folder, 'merge', 'origin/main').status, 0);

  for (const line of [`git checkout --theirs ${SETUP}`, `git add ${SETUP}`, 'git commit --no-edit']) {
    assert.ok(failures.includes(`\`${line}\``), `${line} が「失敗したとき」にありません`);
    assert.equal(runLine(folder, line).status, 0);
  }

  assert.equal(readFileSync(join(folder, SETUP), 'utf8'), mainSetup);
  assert.equal(gitOk(folder, 'log', 'HEAD..origin/main', '--oneline').stdout, '');
  assert.match(failures, /手順 5 の 4 を実行し直して選択を入れ直す/);
});

test('手順 5: 続きから進めても、記録と引き継ぎメモと PR を作り直さない', () => {
  assert.match(applyStep, /`<番号>-setup\.md` が既にあれば、新しく作らずにそれを書き直す/);
  assert.match(applyStep, /open な「引き継ぎメモ」Issue があれば作らず、それを pin して番号を使う/);
  assert.match(
    applyStep,
    /このブランチの open な PR が既にあれば（`gh pr view --json state` が `OPEN`）、`\/shinnn-app:pr` の手順 3 で `gh pr create` を飛ばし/,
  );
});

test('再実行のとき: 初回の PR がマージされる前は、同じ Issue とブランチで続ける', () => {
  assert.match(applyStep, /初回の PR がマージされる前は、「進め方」の 4 のとおり同じ Issue とブランチで続ける/);
});

test('再実行のとき: マージの前の再実行で困るのは、記録のファイル名のぶつかりだけ', () => {
  assert.match(applyStep, /そのため、記録のファイル名がぶつかる/);
  assert.doesNotMatch(applyStep, /「引き継ぎメモ」Issue を\s*作り直す/);
});

test('feature の続きから始める: 初回の適用の Issue のブランチなら、setup に回す', () => {
  const feature = readFileSync(fileURLToPath(new URL('../skills/feature/SKILL.md', import.meta.url)), 'utf8');

  assert.ok(
    feature.includes(
      `その Issue の題が \`${APPLY_ISSUE_TITLE}\` なら、このスキルでは進めず、\`/shinnn-app:setup\` を実行する`,
    ),
  );
});

/** 手順 6 の節 */
const nextStep = section('### 6. 次の一手');

test('進め方: args に答えがある項目は聞かず、「既定のまま」「質問せずに」では既定を採って確認も取らない', () => {
  assert.match(
    progress,
    /`args`（setup を呼んだときに `\/shinnn-app:setup` の後ろに書いた文）に答えがある項目は、質問せずにその答えを使う/,
  );
  assert.match(progress, /`args` に「既定のまま」か「質問せずに」とあれば、次のとおりに進める/);
  assert.match(progress, /^- 既定のある項目は、質問せずに既定を採る$/m);
  assert.match(progress, /^- 実行の前の確認（`--dry-run` の結果を見せて取る確認）は取らない$/m);
  assert.match(
    progress,
    /^- シン株式会社の担当者のアカウントは、`args` に無く、記録の `reviewer` が `@SHINNN_REVIEWER` のとき（初回など、既定が無いとき）は、質問せずに決まらなかったとき（手順 4）の扱いにする$/m,
  );
  // 再実行で記録に担当者があれば、それが既定になる（手順 4）。既定のある項目として扱い、未定に戻さない
  assert.match(
    skill,
    /`\.shinnn\/setup\.json` の `reviewer` が `@SHINNN_REVIEWER` 以外なら、それを既定にして「変更しますか」と聞く/,
  );
  assert.match(progress, /^- そのほかの既定の無い項目は、質問する$/m);
});

test('手順 6: args に最後の問いの答えがあれば、問わずにその答えで feature を呼ぶ', () => {
  assert.match(nextStep, /初回でも、`args` に 4 の問いの答えがあれば.*問わずにその答えを使う/);
  assert.match(
    nextStep,
    /答え（`args` にあった答えを含む）を受けたら、報告の前と同じコマンドで、setup の PR をもう一度見る/,
  );
  assert.match(nextStep, /`state` が `MERGED` なら、Skill ツールで `shinnn-app:feature` を呼ぶ/);
});

test('手順 6: 作り直しは、元のアプリのフォルダが作業フォルダに入っているときだけ、起動し直さずに feature を呼ぶ', () => {
  assert.match(
    nextStep,
    /^\| 元のアプリを作り直す（元のアプリのフォルダが、このセッションの作業フォルダに入っている） \| `<元のアプリのフォルダ>にあるアプリを作り直したい` \|$/m,
  );
  assert.match(nextStep, /起動のときの `--add-dir` と、設定の `additionalDirectories` で足したフォルダを含む/);
  assert.match(
    nextStep,
    /作り直すと答え、元のアプリのフォルダがこのセッションの作業フォルダに入っていないときも、`feature` を呼ばない/,
  );
  assert.match(
    nextStep,
    /^- `\/exit` で終了する。ターミナルでこのフォルダに移り、`claude --add-dir <元のアプリのフォルダ>` で起動する$/m,
  );
});

test('手順 0 の 5: 起動し直すときは、作業フォルダの外のフォルダを --add-dir で付け、setup の後ろに書いた同じ文を付ける', () => {
  assert.match(
    templateStep,
    /このセッションの作業フォルダの一覧に、このフォルダの外のフォルダがあれば、そのフォルダを `--add-dir` で付ける/,
  );
  assert.match(templateStep, /今回 `\/shinnn-app:setup` の後ろに文を書いていれば、同じ文を付ける/);
});

test('手順 0 の 1: GitHub の作成画面のファイルはあってよく、README.md と .gitignore は置き換わり LICENSE は残る', () => {
  assert.match(
    templateStep,
    /GitHub でリポジトリを作る画面で付けられる `README\.md`・`LICENSE`・`\.gitignore` も、あってよい/,
  );
  assert.match(templateStep, /`README\.md` と `\.gitignore` はテンプレートのものに置き換わり、`LICENSE` は残る/);
});

test('手順 0 の 4: gh repo create で作ったもののほかのリポジトリに送る前に、公開範囲を見て公開なら聞く', () => {
  assert.match(templateStep, /最初の `git push -u origin main` の前に公開範囲を見る/);
  assert.match(templateStep, /^ *gh repo view --json visibility --jq \.visibility$/m);
  assert.match(templateStep, /`args` に「質問せずに」とあっても聞く/);
  assert.match(pushFailure, /手順 0 の 4 のとおり公開範囲を見てから、`git push -u origin main` を実行する/);
});

test('手順 5 の 5: pglite なら --server-env も付けて server/.env を作る', () => {
  assert.ok(
    codeLines(applyStep).includes(
      'node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-env.mjs --write --database pglite --server-env',
    ),
  );
  assert.match(applyStep, /方式が `pglite` なら、`--server-env` も付けて、`server\/\.env` も作る/);
});

test('外から先に展開したフォルダ: テンプレートがあれば手順 0 の git と GitHub の用意から行い、起動し直しを伝えない', () => {
  // 後ろの 3 つの文は、同じファイルのテスト（「進め方: 手順 0 の残りの行き先と…」「手順 0: 手順 1 に進まないのは…」）も見ている。
  // ここでは、fetch-template.mjs の冒頭にある外から呼ぶ側との約束として、同じ文を見る
  // 手順 0 を 1 から行うのは、テンプレートが無いときだけ
  assert.match(
    progress,
    /^1\. \*\*`\.claude\/rules\/\.standards-version` が無い\*\*（テンプレートがまだ無いフォルダ）: 手順 0 を 1 から行い/m,
  );
  // テンプレートがあれば、手順 0 の git と GitHub の用意の残りを行ってから、手順 0 の 5 に進む
  assert.match(
    progress,
    /^2\. \*\*手順 0 の git と GitHub の用意が済んでいない\*\*: 次の 3 つのコマンドで順に見て、済んでいないものを行う$/m,
  );
  assert.match(progress, /どれかを行ったら、手順 0 の 5 に進む/);
  // 手順 0 の 5 は、このセッションで展開していなければ起動し直しを伝えない
  assert.match(templateStep, /このセッションで 2 の展開をしていなければ、規約は読み込まれている。/);
  assert.match(templateStep, /その場合は起動し直しを伝えず、「進め方」の 3 に進む/);
});
