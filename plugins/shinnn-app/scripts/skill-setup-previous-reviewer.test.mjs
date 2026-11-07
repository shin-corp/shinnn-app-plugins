/**
 * シン株式会社の担当者を変えた後の、前の担当者の権限の扱いの回帰テスト。`node --test scripts/` で実行する。
 *
 * スキルは文書なので、動かせるのは書いてあるコマンドだけ。前の担当者を探すコマンドは SKILL.md から読み出し、
 * 本物の適用スクリプトと一時フォルダの本物の git（送り先は bare リポジトリ）で確かめる。
 * 権限を見るコマンドと外すコマンドは GitHub が要るので、順番と名指しだけを見る。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 確かめるスキル */
const setupSkill = readSkill('setup');
const handoverSkill = readSkill('handover-check');

const applyScript = fileURLToPath(new URL('./apply-setup.mjs', import.meta.url));

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** setup の記録 */
const SETUP = '.shinnn/setup.json';

/** テンプレートの記録の担当者 */
const PLACEHOLDER = '@SHINNN_REVIEWER';

/** 最初の担当者と次の担当者。例の名前 */
const FIRST = '@first-reviewer';
const SECOND = '@second-reviewer';

/** 引用符で囲んでいない `repos/{owner}`。PowerShell 5.1 は `{owner}` をスクリプトブロックとして読み、gh が動く前に止まる */
const UNQUOTED_OWNER_PATH = /(?<!["'])repos\/\{owner\}/;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skill-setup-previous-reviewer-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** スキルの本文を読む */
function readSkill(name) {
  return readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');
}

/** setup の手順 5 の本文 */
function applySection() {
  return between(setupSkill, '### 5. 適用', '### 6. 次の一手');
}

/** setup の手順 6 の本文 */
function nextStepSection() {
  return between(setupSkill, '### 6. 次の一手', '## 失敗したとき');
}

/** 2 つの見出しの間を返す */
function between(text, from, to) {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start !== -1 && end !== -1, `${from} から ${to} までが見つかりません`);
  return text.slice(start, end);
}

/** 手順 6 の、前の担当者を探すコマンド */
function findPreviousCommand() {
  const line = nextStepSection()
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text.startsWith('git log '));
  assert.ok(line, '手順 6 に git log のコマンドがありません');
  return line;
}

/** git を実行し、失敗したらそのときの出力でテストを落とす */
function git(cwd, ...args) {
  const config = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false'];
  const result = spawnSync('git', [...config, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/** テンプレートから作った直後のリポジトリ。送り先は bare リポジトリで、main を push 済み */
function makeRepo() {
  const base = mkdtempSync(join(workRoot, 'repo-'));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'app');
  git(base, 'init', '--bare', '-b', 'main', origin);
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', origin);
  for (const path of [SETUP, '.github/workflows', '.github/CODEOWNERS']) {
    cpSync(join(templateDir, path), join(repo, path), { recursive: true });
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'テンプレート');
  git(repo, 'push', '-u', 'origin', 'main');
  return repo;
}

/** 本物の適用スクリプトで担当者を変え、PR のブランチにコミットする */
function commitReviewer(repo, branch, reviewer) {
  git(repo, 'switch', '-c', branch);
  const result = spawnSync(process.execPath, [applyScript, '--repo-dir', repo, '--reviewer', reviewer], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', `担当者を ${reviewer} にする`);
}

/** PR のマージの代わり。`--no-ff` か `--squash` で main に入れて push する */
function mergeToMain(repo, branch, mode) {
  git(repo, 'switch', 'main');
  git(repo, 'merge', mode, branch);
  if (mode === '--squash') {
    git(repo, 'commit', '-m', `${branch} を取り込む`);
  }
  git(repo, 'push', 'origin', 'main');
}

/** 担当者を変えて main に入れる */
function changeReviewer(repo, branch, reviewer, mode = '--no-ff') {
  commitReviewer(repo, branch, reviewer);
  mergeToMain(repo, branch, mode);
}

/** スキルのコマンドの出力 */
function previousLog(repo) {
  git(repo, 'fetch', 'origin', 'main');
  return git(repo, ...findPreviousCommand().split(' ').slice(1));
}

/** スキルのコマンドで、今までの担当者（`-` から始まる `"reviewer"` の行の値）を読み取る */
function removedReviewers(repo) {
  return [...previousLog(repo).matchAll(/^-\s*"reviewer":\s*"([^"]+)"/gm)].map((match) => match[1]);
}

/** スキルのコマンドで、今の担当者（一番上の `+` から始まる `"reviewer"` の行の値）を読み取る */
function currentReviewer(repo) {
  return previousLog(repo).match(/^\+\s*"reviewer":\s*"([^"]+)"/m)[1];
}

/** 別の人が担当者を変えて origin の main に入れる。手元の main は古いまま */
function changeReviewerElsewhere(repo, branch, reviewer) {
  const other = join(repo, '..', 'other');
  git(repo, 'clone', '-q', git(repo, 'remote', 'get-url', 'origin').trim(), other);
  changeReviewer(other, branch, reviewer);
}

test('前の担当者を探すコマンドは、シェルの引用符を使わない（PowerShell でも同じに動かす）', () => {
  assert.doesNotMatch(findPreviousCommand(), /["'|]/);
});

for (const mode of ['--no-ff', '--squash']) {
  test(`担当者を 2 回決めると、前の担当者とプレースホルダが出て、今の担当者は出ない（マージは ${mode}）`, () => {
    const repo = makeRepo();
    changeReviewer(repo, 'feature/1-setup', FIRST, mode);
    changeReviewer(repo, 'feature/2-setup', SECOND, mode);

    assert.deepEqual(removedReviewers(repo), [FIRST, PLACEHOLDER]);
    assert.equal(currentReviewer(repo), SECOND);
  });
}

test('担当者を初めて決めただけなら、プレースホルダしか出ない（聞く相手がいない）', () => {
  const repo = makeRepo();
  changeReviewer(repo, 'feature/1-setup', FIRST);

  assert.deepEqual(removedReviewers(repo), [PLACEHOLDER]);
});

test('担当者を変える PR がマージされる前は、今の担当者が前の担当者として出ない', () => {
  const repo = makeRepo();
  changeReviewer(repo, 'feature/1-setup', FIRST);
  commitReviewer(repo, 'feature/2-setup', SECOND);

  assert.deepEqual(removedReviewers(repo), [PLACEHOLDER]);
});

test('同じ人に戻すと、その人も出る（今の reviewer で除くとスキルに書いてある）', () => {
  const repo = makeRepo();
  changeReviewer(repo, 'feature/1-setup', FIRST);
  changeReviewer(repo, 'feature/2-setup', SECOND);
  changeReviewer(repo, 'feature/3-setup', FIRST);

  assert.deepEqual(removedReviewers(repo), [SECOND, FIRST, PLACEHOLDER]);
  assert.equal(currentReviewer(repo), FIRST);
  assert.match(nextStepSection(), /今までの担当者から `@SHINNN_REVIEWER` と今の担当者を除く/);
});

test('手元の main が古くても、origin の main で前の担当者と今の担当者を読める', () => {
  const repo = makeRepo();
  changeReviewer(repo, 'feature/1-setup', FIRST);
  changeReviewerElsewhere(repo, 'feature/2-setup', SECOND);

  assert.equal(JSON.parse(readFileSync(join(repo, SETUP), 'utf8')).reviewer, FIRST);
  assert.deepEqual(removedReviewers(repo), [FIRST, PLACEHOLDER]);
  assert.equal(currentReviewer(repo), SECOND);
});

test('setup の手順 5 では、新しい担当者を招待するだけで、前の担当者を外さない', () => {
  assert.match(applySection(), /-X PUT "?repos\/\{owner\}\/\{repo\}\/collaborators\//);
  assert.doesNotMatch(applySection(), /-X DELETE/);
  assert.match(applySection(), /前の担当者の権限は、ここでは変えない。手順 6 で扱う/);
});

test('手順 1〜5 を飛ばせるのは、前の担当者の権限を決めるためだけの再実行に限る', () => {
  assert.match(applySection(), /前の担当者の権限を決めるためだけの再実行（.*）は、手順 1〜5 を行わず、手順 6 に進む/);
  assert.doesNotMatch(setupSkill, /変える項目が無い再実行は/);
  assert.match(nextStepSection(), /その場でマージしないときは、マージの後に「前の担当者の権限を決めたい」と伝えて/);
  assert.match(nextStepSection(), /前の担当者の権限を決めるためだけの再実行は、ここで終える/);
});

test('setup の手順 6 は、マージの後に、探す → 絞る → 確かめる → 聞く → 行うの順で進む', () => {
  const section = nextStepSection();
  const order = [
    '先にマージしてもらう',
    'git log -p',
    'gh issue view <handoverIssue>',
    'collaborators/<アカウント（@ なし）>/permission',
    '/invitations',
    '外してよいかを確かめる',
    '今の担当者の `permission`',
    'gh auth status',
    '外すか残すかを聞く',
    'gh issue list --assignee',
    'gh pr list --search review-requested:',
    '外す: `gh api -X DELETE "repos/{owner}/{repo}/collaborators/',
    'gh api -X DELETE "repos/{owner}/{repo}/invitations/',
    '2 の `permission` をもう一度見て',
    'gh pr edit <番号> --add-reviewer',
    '残す: ',
    '分からない: ',
    '外せない（',
  ];
  const positions = order.map((word) => section.indexOf(word));

  assert.ok(!positions.includes(-1), `見つからない語があります: ${positions.join(', ')}`);
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
});

test('setup の手順 6 は、外すと届かなくなるときと、自分を外すときに外さない', () => {
  const section = nextStepSection();

  assert.match(section, /今の担当者の `permission`（2 と同じコマンド）が `write` か `admin` でなければ、誰も外さず/);
  assert.match(section, /`gh auth status` でアカウントを確かめられなければ、誰も外さず/);
  assert.match(section, /`gh auth status` のアカウントと同じ人は、聞かずに 5 の「残す」にする/);
  assert.match(section, /読めない（.*）ときは、除かずに 5 の「外せない」にする/);
});

test('setup の手順 6 は、外すと起きることを、平易な言葉で示してから聞く', () => {
  assert.match(nextStepSection(), /Issue の割り当てが外れる。その人の fork（.*）が消える/);
});

test('聞き直さないのは「残す」と決めた人だけで、分からない人と外せない人にはまた聞く', () => {
  const section = nextStepSection();

  assert.match(section, /残す: 「引き継ぎの注意」に `前の担当者 @<アカウント> の権限を残している。理由: <理由>`/);
  assert.match(section, /`前の担当者 @<アカウント> の権限を残している` の行がある人も除く/);
  assert.match(section, /分からない: 権限は変えない。「シン株式会社への要望」に/);
  assert.match(section, /外せない（.*）: 止めずに、理由を報告する。行は足さない/);
  assert.match(section, /「分からない」と「外せない」の人には、次の再実行でまた聞く/);
});

test('引き継ぎメモの書き換え方を、シェルの引用符に頼らない形で名指しする', () => {
  const section = nextStepSection();

  assert.match(section, /`gh issue view <handoverIssue> --json body --jq \.body` で今の本文を読む/);
  assert.match(section, /Write ツールで scratchpad の `issue-body\.md` に書き/);
  assert.match(section, /`gh issue edit <handoverIssue> --body-file <そのファイル>` に渡す/);
});

test('gh が無いときは、前の担当者がいるときだけ画面を案内し、残す行も書いてもらう', () => {
  assert.match(nextStepSection(), /`gh` が無い・ログインできない場合は、1 で人が残ったときに/);
  assert.match(nextStepSection(), /残すなら、Issue の画面で 5 の「残す」の行を足してもらう/);
});

test('手順 6 と handover-check の 15 の gh api のパスは、二重引用符で囲む', () => {
  const row = handoverSkill.split('\n').find((line) => line.startsWith('| 15 |'));

  assert.doesNotMatch(nextStepSection(), UNQUOTED_OWNER_PATH);
  assert.doesNotMatch(row, UNQUOTED_OWNER_PATH);
});

test('前の担当者の権限の判定は `write` か `admin` で、maintain が write と出ることを書いてある', () => {
  assert.match(nextStepSection(), /`permission` が `write` か `admin`（`maintain` は `write` と出る）/);
});

test('handover-check の 15 は、今の担当者と前の担当者の両方を、setup と同じコマンドで判定する', () => {
  const row = handoverSkill.split('\n').find((line) => line.startsWith('| 15 |'));

  assert.ok(row, 'handover-check に 15 の行がありません');
  assert.match(row, /maintain 権限を持っている/);
  assert.match(row, /前の担当者は、権限も招待も残っていないか/);
  assert.match(row, /「引き継ぎの注意」に `前の担当者 @<アカウント> の権限を残している` の行がある/);
  assert.match(row, /読めなければ「確認できず」にする/);
  assert.match(row, /前の担当者で NG なら、「前の担当者の権限を決めたい」と伝えて `\/shinnn-app:setup` を実行する/);
  assert.match(handoverSkill, /ただし、15 の前の担当者は、表のとおり `\/shinnn-app:setup` で扱う/);

  // 別のスキルの本文は読めないことがあるので、15 の行だけで調べられるようにしてある。コマンドの食い違いをここで止める
  for (const command of [
    'git fetch origin main',
    findPreviousCommand(),
    'gh api "repos/{owner}/{repo}/collaborators/<アカウント（@ なし）>/permission"',
    'gh api "repos/{owner}/{repo}/invitations"',
    'gh issue view <handoverIssue>',
  ]) {
    assert.ok(nextStepSection().includes(command), `setup の手順 6 に ${command} がありません`);
    assert.ok(row.includes(command), `handover-check の 15 に ${command} がありません`);
  }
});
