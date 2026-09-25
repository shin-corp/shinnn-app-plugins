#!/usr/bin/env node
// 標準を、プラグインに同梱のテンプレートからリポジトリへ写す。/shinnn-app:update-rules が使う。
//
// 実行例:
//   node <プラグイン>/scripts/copy-standard.mjs             写す
//   node <プラグイン>/scripts/copy-standard.mjs --dry-run   書かずに、変わるファイルの一覧だけを出す
//
// 引数:
//   --repo-dir <パス>  対象のリポジトリ（既定は CLAUDE_PROJECT_DIR、無ければカレント）
//   --dry-run          書かずに、変わるファイルの一覧だけを出す
//
// 写すもの: 規約（.claude/rules/ と .standards-version）、権限の設定（.claude/settings.json）、
// アプリ作り方ガイド、git のフック（.husky/pre-commit・pre-push）、確認のスクリプト（scripts/*.mjs）、
// ワークフロー（.github/workflows/）、PR テンプレート。
// CLAUDE.md の雛形は案件固有の記述を残してマージするので、ここでは写さない（update-rules が当てる）。
//
// 上書きと追加に加えて、テンプレートから消したファイル（scripts/retired-files.json に挙げたもの）が残っていれば消す。
// 消すのは一覧にあるものだけで、テンプレートに無いファイルを片っ端から消すことはしない（案件で足したファイルは残る）。
// ワークフローの雛形（*.yaml.disabled）は、リポジトリで有効にしている（.disabled の無い名前がある）なら
// その名前に写し、そうでなければ .disabled のまま写す。有効・無効は setup で選んだまま変えない。
// サーバー側を持たないリポジトリ（server/ が無い）には、元から無かった規約を増やさない（飛ばしたものは出力に出す）。
// 標準の版（.standards-version）は最後に写す。途中で失敗したときに「取り込み済み」に見えないようにするため。
//
// .claude/ と .github/workflows/ は権限の設定の deny で守られていて、Claude の cp では書けない。
// このスクリプトはテンプレートと同じ中身を写すだけで、変更は PR にしてシン株式会社がレビューする。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 値を取る引数（`--名前 値`）を読む。引数が無ければ undefined。値が抜けていれば止める（書き込み先を取り違えないため） */
function readOption(name) {
  if (process.argv.some((arg) => arg.startsWith(`${name}=`))) {
    console.error(`${name} は「${name} <値>」の形で渡してください。`);
    process.exit(1);
  }
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value === '' || value.startsWith('--')) {
    console.error(`${name} には値が要ります。`);
    process.exit(1);
  }
  return value;
}

const templateRoot = fileURLToPath(new URL('../template/', import.meta.url));
const repositoryRoot = resolve(readOption('--repo-dir') || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const dryRun = process.argv.includes('--dry-run');

const DISABLED_SUFFIX = '.disabled';

/** 標準のバージョンの置き場所。テンプレートから作ったリポジトリかどうかの目印にも使う */
const STANDARDS_VERSION = '.claude/rules/.standards-version';

/**
 * テンプレートから消したファイル（リポジトリの中の相対パスと、消す理由）。
 * テンプレートから、ここで写すファイルを消したら 1 件足す。足さないと、既存のリポジトリに残り続ける
 */
const RETIRED_FILES = JSON.parse(readFileSync(new URL('./retired-files.json', import.meta.url), 'utf8'));

/** 1 つずつ名前で写すファイル */
const SINGLE_FILES = [
  '.claude/settings.json',
  'docs/アプリ作り方ガイド.md',
  '.husky/pre-commit',
  '.husky/pre-push',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

/** テンプレートの中のフォルダにあるファイルの名前（サブフォルダは含めない） */
function listTemplateFiles(folder) {
  const names = [];
  for (const entry of readdirSync(join(templateRoot, folder), { withFileTypes: true })) {
    if (entry.isFile()) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/**
 * 写すファイル（`from` はテンプレートの中、`to` はリポジトリの中の相対パス）と、写さずに飛ばす規約の一覧。
 * 標準の版は含めない（消すファイルを消した後に、最後に写す）
 */
function listCopies() {
  const copies = [];
  const skipped = [];
  const hasServer = existsSync(join(repositoryRoot, 'server'));

  for (const name of listTemplateFiles('.claude/rules')) {
    const path = `.claude/rules/${name}`;
    if (path === STANDARDS_VERSION) {
      continue;
    }
    const isNewRule = name.endsWith('.md') && !existsSync(join(repositoryRoot, path));
    if (!hasServer && isNewRule) {
      skipped.push(path);
      continue;
    }
    copies.push({ from: path, to: path });
  }

  for (const path of SINGLE_FILES) {
    copies.push({ from: path, to: path });
  }

  for (const name of listTemplateFiles('scripts')) {
    if (name.endsWith('.mjs')) {
      copies.push({ from: `scripts/${name}`, to: `scripts/${name}` });
    }
  }

  for (const name of listTemplateFiles('.github/workflows')) {
    const from = `.github/workflows/${name}`;
    if (!name.endsWith(DISABLED_SUFFIX)) {
      copies.push({ from, to: from });
      continue;
    }
    const enabledPath = `.github/workflows/${name.slice(0, -DISABLED_SUFFIX.length)}`;
    const isEnabled = existsSync(join(repositoryRoot, enabledPath));
    copies.push({ from, to: isEnabled ? enabledPath : from });
  }

  return { copies, skipped };
}

/** 写した結果の種類。同じ中身なら undefined */
function changeKind(source, target) {
  if (!existsSync(target)) {
    return '追加';
  }
  const isSame = readFileSync(source).equals(readFileSync(target));
  return isSame ? undefined : '更新';
}

if (!existsSync(join(templateRoot, STANDARDS_VERSION))) {
  console.error(`テンプレートが見つかりません: ${templateRoot}`);
  process.exit(1);
}
if (!existsSync(join(repositoryRoot, STANDARDS_VERSION))) {
  console.error(
    `テンプレートから作ったリポジトリではありません（${STANDARDS_VERSION} がありません）: ${repositoryRoot}`,
  );
  process.exit(1);
}

const { copies, skipped } = listCopies();
let unchangedCount = 0;
for (const { from, to } of copies) {
  const source = join(templateRoot, from);
  const target = join(repositoryRoot, to);
  const kind = changeKind(source, target);
  if (kind === undefined) {
    unchangedCount += 1;
    continue;
  }

  const note = from === to ? '' : `（テンプレートの ${from} を、有効にしている名前に写す）`;
  console.log(`${kind} ${to}${note}`);
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

for (const { path, reason } of RETIRED_FILES) {
  const target = join(repositoryRoot, path);
  if (!existsSync(target)) {
    continue;
  }

  console.log(`削除 ${path}（テンプレートから消したファイル: ${reason}）`);
  if (!dryRun) {
    unlinkSync(target);
  }
}

// 標準の版は最後に写す。途中で失敗したときに、版だけが新しくなって「取り込み済み」に見えないようにするため
const versionKind = changeKind(join(templateRoot, STANDARDS_VERSION), join(repositoryRoot, STANDARDS_VERSION));
if (versionKind === undefined) {
  unchangedCount += 1;
} else {
  console.log(`${versionKind} ${STANDARDS_VERSION}`);
  if (!dryRun) {
    copyFileSync(join(templateRoot, STANDARDS_VERSION), join(repositoryRoot, STANDARDS_VERSION));
  }
}

for (const path of skipped) {
  console.log(`飛ばした ${path}（server/ が無いリポジトリには、元から無かった規約を増やさない）`);
}
console.log(`変わらないファイル: ${unchangedCount}`);
if (dryRun) {
  console.log('--dry-run なので書いていません。');
}
