#!/usr/bin/env node
// コミットメッセージの形を検査する。git のフック（.husky/commit-msg）から呼ばれる。
//
// 実行例:
//   node scripts/check-commit-message.mjs .git/COMMIT_EDITMSG
//
// 判定の仕方:
//   文字列だけで判定できる範囲を見る（規約 .claude/rules/git-workflow.md の「コミットメッセージ」）。
//   見るのは、1 行目の形と <対象>、1 行目の長さ、要約の語尾、AI の帰属行、Test plan の節。
//   AI のモデルは呼ばない。呼ぶと、オフラインや未ログインの環境でコミットできなくなる。
//   テンプレートを取り込むコミット（まだコミットが無いときと、直前のコミットのファイルが GitHub の作成画面で付けられる
//   README.md・LICENSE・.gitignore だけのとき）と、git merge・git revert が作るメッセージは見ない。

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** 1 行目の長さの上限 */
const MAX_SUBJECT_LENGTH = 50;

/** テンプレートで決まっている <対象>。このほかに、最上位のフォルダの名前を受け付ける */
const FIXED_TARGETS = ['shared', 'server', 'client', 'docs', 'ci', 'deps'];

/** <対象> にしないフォルダ */
const NOT_TARGETS = ['.git', 'node_modules'];

/** 1 行目の形。<対象> と要約に分ける */
const SUBJECT_FORMAT = /^\[([^\]\s]+)\](\S.*)$/;

/** 体言止めでない語尾 */
const NOT_NOMINAL_ENDING = /(した|する|です|ます)[。.]?$/;

/** git が自分で作るメッセージの 1 行目 */
const GENERATED_SUBJECT = /^(Merge|Revert) /;

/** AI の帰属行。人の共同作者の行は止めない */
const ATTRIBUTION = /^(co-authored-by:.*(claude|anthropic)|.*generated with .*claude)/im;

/** `git commit -v` が差分の前に置く切り取り線。ここから後ろは、メッセージに入らない */
const SCISSORS = /^# -+ >8 -+$/m;

/** 定型の節。`-F` で渡した本文の `#` は消えないので、見出しの形も見る */
const TEST_PLAN = /^#*\s*test plan\s*:?\s*$/im;

/** GitHub の作成画面で付けられるファイル。直前のコミットのファイルがこれだけなら、テンプレートを取り込む前とみなす */
const REPOSITORY_FILES = new Set(['README.md', 'LICENSE', '.gitignore']);

/** 最上位のフォルダの名前 */
function listTopLevelFolders() {
  const names = [];

  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !NOT_TARGETS.includes(entry.name)) {
      names.push(entry.name);
    }
  }

  return names;
}

/**
 * テンプレートを取り込む前か。まだコミットが 1 つも無いときと、直前のコミットのファイルが作成画面の 3 つだけのとき。
 * このときのコミットはテンプレートを取り込むもので、<対象> に当たるパッケージが無い。
 * .claude/rules/.standards-version の有無では見ない。そのファイルが消えたリポジトリで、検査が飛ばされ続けないようにするため。
 */
function isBeforeTemplate() {
  const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: repositoryRoot });

  if (head.status !== 0) {
    return true;
  }

  const tree = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  // 読めなければ、空とみなさずに検査する
  if (tree.status !== 0) {
    return false;
  }

  for (const path of tree.stdout.split('\0')) {
    if (path !== '' && !REPOSITORY_FILES.has(path)) {
      return false;
    }
  }

  return true;
}

/** 1 行目の問題を「何が / どう直す」で返す。問題が無ければ空。 */
function findSubjectProblems(subject) {
  const problems = [];
  const format = subject.match(SUBJECT_FORMAT);

  if (format === null) {
    problems.push({
      what: `1 行目が \`[<対象>]<要約>\` の形ではありません: ${subject}`,
      how: '`[client]在庫の一覧の追加` のように、先頭に対象を付けます',
    });
    return problems;
  }

  const [, target, summary] = format;
  const topLevelFolders = listTopLevelFolders();

  if (!FIXED_TARGETS.includes(target) && !topLevelFolders.includes(target)) {
    problems.push({
      what: `<対象> の \`${target}\` は使えません`,
      how: `${[...new Set([...FIXED_TARGETS, ...topLevelFolders])].join(' / ')} のどれかにします`,
    });
  }

  const length = [...subject].length;

  if (length > MAX_SUBJECT_LENGTH) {
    problems.push({
      what: `1 行目が ${length} 文字あります（${MAX_SUBJECT_LENGTH} 文字まで）`,
      how: '要約を短くします。細かい内容は本文の箇条書きに書きます',
    });
  }

  if (NOT_NOMINAL_ENDING.test(summary)) {
    problems.push({
      what: `要約が体言止めではありません: ${summary}`,
      how: '「〜した」「〜する」ではなく、「〜の追加」「〜の修正」の形にします',
    });
  }

  return problems;
}

/** 本文の問題を「何が / どう直す」で返す。問題が無ければ空。 */
function findBodyProblems(message) {
  const problems = [];

  if (ATTRIBUTION.test(message)) {
    problems.push({ what: 'AI の帰属行があります', how: '`Co-Authored-By: Claude …` などの行を消します' });
  }
  if (TEST_PLAN.test(message)) {
    problems.push({ what: '`Test plan` の節があります', how: '定型の節を消します' });
  }

  return problems;
}

const messagePath = process.argv[2];

if (messagePath === undefined) {
  console.error('コミットメッセージのファイルを引数で渡してください。');
  process.exit(1);
}

const message = readFileSync(messagePath, 'utf8').split(SCISSORS)[0];
const subject = message.split('\n').find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';

// 空のメッセージは、git が自分で断る
if (subject === '' || GENERATED_SUBJECT.test(subject) || isBeforeTemplate()) {
  process.exit(0);
}

const problems = [...findSubjectProblems(subject.trimEnd()), ...findBodyProblems(message)];

if (problems.length === 0) {
  process.exit(0);
}

console.error('コミットメッセージが規約に合っていません。');
console.error('');

for (const problem of problems) {
  console.error(`  何が: ${problem.what}`);
  console.error(`  どう直す: ${problem.how}`);
  console.error('');
}

console.error('  なぜ: 履歴を読むだけで、どこを何のために変えたかが分かるようにするためです。');
console.error('  規約: .claude/rules/git-workflow.md の「コミットメッセージ」');
process.exit(1);
