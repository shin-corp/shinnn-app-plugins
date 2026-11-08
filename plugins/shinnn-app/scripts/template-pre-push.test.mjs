/**
 * テンプレートの .husky/pre-push と、push の権限の回帰テスト。`node --test scripts/` で実行する。
 *
 * 一時フォルダに送り先（bare リポジトリ）と手元のリポジトリを作り、husky と同じ呼び方（`sh -e <フック>`）で
 * pre-push を動かして、本物の git push の結果を確かめる。
 * - GitHub にまだ main が無いとき（リポジトリを作った直後の最初の push）は通す
 * - 送り先の main にテンプレートがまだ無いとき（作成画面で付けた README.md などだけ）は、テンプレートを取り込む push だけを通す
 * - テンプレートの入った main への push（更新・別名での送り込み・削除）と、送り先のコミットが手元に無い push は断る
 * - 作業ブランチへの push は通す
 * あわせて .claude/settings.json で、push が確認なしで、フックを飛ばす指定が deny されていることを確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるフック */
const prePush = join(templateDir, '.husky', 'pre-push');

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pre-push-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** git を実行し、終了コードと出力を返す。利用者の設定（署名・フックの置き場所）に左右されないようにする */
function git(cwd, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: join(workRoot, 'gitconfig') } },
  );
  return { status: result.status, stderr: result.stderr };
}

/** テンプレートから作ったリポジトリには必ず入っているファイル */
const MARKER = '.claude/rules/.standards-version';

/** テンプレートの目印を足したコミットを作る */
function commitMarker(local) {
  mkdirSync(join(local, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(local, MARKER), '0.0.0\n');
  assert.equal(git(local, 'add', '.').status, 0);
  assert.equal(git(local, 'commit', '-m', 'template').status, 0);
}

/**
 * 送り先と手元のリポジトリを作り、手元に husky と同じ呼び方でフックを入れる。最初のコミットは main にある。
 * 最初のコミットにはテンプレートの目印を入れる（`withMarker: false` なら入れない）
 */
function setupRepos({ withMarker = true } = {}) {
  const root = mkdtempSync(join(workRoot, 'case-'));
  const remote = join(root, 'remote.git');
  const local = join(root, 'local');
  assert.equal(git(root, 'init', '--bare', '--initial-branch=main', remote).status, 0);
  assert.equal(git(root, 'init', '--initial-branch=main', local).status, 0);
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir);
  writeFileSync(join(hooksDir, 'pre-push'), `#!/bin/sh\nsh -e "${prePush}" "$@"\n`, { mode: 0o755 });
  assert.equal(git(local, 'config', 'core.hooksPath', hooksDir).status, 0);
  assert.equal(git(local, 'remote', 'add', 'origin', remote).status, 0);
  if (withMarker) {
    commitMarker(local);
  } else {
    commit(local, 'first');
  }
  return { root, local, remote };
}

/** 空でないコミットを 1 つ足す */
function commit(local, name) {
  writeFileSync(join(local, `${name}.txt`), `${name}\n`);
  assert.equal(git(local, 'add', '.').status, 0);
  assert.equal(git(local, 'commit', '-m', name).status, 0);
}

/** 送り先の ref が指すコミット。無ければ null */
function remoteHead(remote, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: remote, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

test('送り先にまだ main が無いときは、main への最初の push を通す', () => {
  const { local, remote } = setupRepos();
  const result = git(local, 'push', '-u', 'origin', 'main');
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(remoteHead(remote, 'refs/heads/main'), null);
});

test('送り先の main にテンプレートがまだ無いときは、テンプレートを取り込む push を通し、取り込んだ後は断る', () => {
  // GitHub の作成画面で README.md などを付けたリポジトリと同じく、送り先の main にはテンプレートの無いコミットがある
  const { local, remote } = setupRepos({ withMarker: false });
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);

  commitMarker(local);
  const result = git(local, 'push', 'origin', 'main');
  assert.equal(result.status, 0, result.stderr);
  const imported = remoteHead(remote, 'refs/heads/main');

  commit(local, 'second');
  const after = git(local, 'push', 'origin', 'main');
  assert.notEqual(after.status, 0);
  assert.match(after.stderr, /main には直接 push できません/);
  assert.equal(remoteHead(remote, 'refs/heads/main'), imported);
});

test('送り先の main にテンプレートが無くても、テンプレートを含まない push は断る', () => {
  const { local, remote } = setupRepos({ withMarker: false });
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);
  const mainBefore = remoteHead(remote, 'refs/heads/main');

  commit(local, 'second');
  const result = git(local, 'push', 'origin', 'main');
  assert.notEqual(result.status, 0);
  assert.equal(remoteHead(remote, 'refs/heads/main'), mainBefore);
});

test('送り先の main のコミットが手元に無いときは、中身を確かめられないので断る', () => {
  const { root, local, remote } = setupRepos();
  // 別の手元から、テンプレートの無いコミットを送り先の main に置く（こちらの手元には取ってこない）
  const other = join(root, 'other');
  assert.equal(git(root, 'init', '--initial-branch=main', other).status, 0);
  commit(other, 'readme');
  assert.equal(git(other, 'push', remote, 'main').status, 0);
  const mainBefore = remoteHead(remote, 'refs/heads/main');

  const result = git(local, 'push', 'origin', 'main');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /main には直接 push できません/);
  // PR にできない別の履歴のこともあるので、取ってきてから setup の手順に従う道も示す
  assert.match(result.stderr, /git fetch origin main の後に \/shinnn-app:setup の手順に従ってください/);
  assert.equal(remoteHead(remote, 'refs/heads/main'), mainBefore);
});

test('既にある main への push は断り、送り先の main は変わらない', () => {
  const { local, remote } = setupRepos();
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);
  const mainBefore = remoteHead(remote, 'refs/heads/main');
  commit(local, 'second');
  const result = git(local, 'push', 'origin', 'main');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /main には直接 push できません/);
  // 送り先のコミットは手元にあるので、取ってくる案内は出さない
  assert.doesNotMatch(result.stderr, /git fetch origin main/);
  assert.equal(remoteHead(remote, 'refs/heads/main'), mainBefore);
});

test('作業ブランチへの push は通す', () => {
  const { local, remote } = setupRepos();
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);
  assert.equal(git(local, 'switch', '-c', 'feature/1-item-list').status, 0);
  commit(local, 'feature');
  const result = git(local, 'push', '-u', 'origin', 'feature/1-item-list');
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(remoteHead(remote, 'refs/heads/feature/1-item-list'), null);
});

test('作業ブランチから別名で main に送る push も断る', () => {
  const { local, remote } = setupRepos();
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);
  const mainBefore = remoteHead(remote, 'refs/heads/main');
  assert.equal(git(local, 'switch', '-c', 'feature/1-item-list').status, 0);
  commit(local, 'feature');
  const result = git(local, 'push', 'origin', 'HEAD:main');
  assert.notEqual(result.status, 0);
  assert.equal(remoteHead(remote, 'refs/heads/main'), mainBefore);
});

test('送り先の main を消す push も断る', () => {
  const { local, remote } = setupRepos();
  assert.equal(git(local, 'push', '-u', 'origin', 'main').status, 0);
  // bare リポジトリは既定のブランチの削除をもともと断るので、それを外してフックだけで止まることを確かめる
  assert.equal(git(remote, 'config', 'receive.denyDeleteCurrent', 'ignore').status, 0);
  const result = git(local, 'push', 'origin', ':main');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /main には直接 push できません/);
  assert.notEqual(remoteHead(remote, 'refs/heads/main'), null);
});

test('settings.json では push を確認なしにし、フックを飛ばす指定と force push を deny する', () => {
  const settings = JSON.parse(readFileSync(join(templateDir, '.claude', 'settings.json'), 'utf8'));
  const { allow, ask = [], deny } = settings.permissions;
  assert.ok(allow.includes('Bash(git push *)'));
  assert.ok(!ask.some((rule) => rule.startsWith('Bash(git push')));
  for (const rule of [
    'Bash(git push --force*)',
    'Bash(git push * --force*)',
    'Bash(git push -f*)',
    'Bash(git push * -f)',
    'Bash(git push * -f *)',
    'Bash(git push * +*)',
    'Bash(git push *--no-verify*)',
    'Bash(HUSKY=0 *)',
  ]) {
    assert.ok(deny.includes(rule), rule);
  }
});
