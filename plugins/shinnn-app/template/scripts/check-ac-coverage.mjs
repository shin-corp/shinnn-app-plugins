#!/usr/bin/env node
// 仕様書の受入条件（AC-n）ごとに、テストが 1 つ以上あるかを検査する。
//
// 実行例:
//   node scripts/check-ac-coverage.mjs            検査する（欠けていれば異常終了）
//   node scripts/check-ac-coverage.mjs --report   結果を Markdown の表で出す（終了コードは常に 0）
//
// 判定の仕方:
//   docs/仕様書.md に出てくる AC-n を集め、テストファイル（*.test.ts）の中に
//   同じ AC-n を含む文字列があるかを見る。テスト名の先頭に識別子を書く規約が前提。
// CI の policy job から呼ばれる。

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const specificationPath = join(repositoryRoot, 'docs', '仕様書.md');
const isReportMode = process.argv.includes('--report');
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', '.angular', 'coverage']);
const acceptancePattern = /AC-\d+/g;

/** リポジトリ配下のテストファイルを列挙する。 */
async function listTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      files.push(...(await listTestFiles(path)));
      continue;
    }

    if (entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }

  return files;
}

let specification;

try {
  specification = await readFile(specificationPath, 'utf8');
} catch {
  console.log('docs/仕様書.md がまだありません。受入条件の検査を飛ばします。');
  process.exit(0);
}

// 雛形のまま（AC-1 の行に中身が書かれていない）の場合は検査しない
const acceptanceIds = [...new Set(specification.match(acceptancePattern) ?? [])].sort(
  (a, b) => Number(a.slice(3)) - Number(b.slice(3)),
);

if (acceptanceIds.length === 0) {
  console.log('docs/仕様書.md に受入条件（AC-n）がまだありません。検査を飛ばします。');
  process.exit(0);
}

const testFiles = await listTestFiles(repositoryRoot);
const coverage = new Map(acceptanceIds.map((id) => [id, []]));

for (const file of testFiles) {
  const contents = await readFile(file, 'utf8');

  for (const id of acceptanceIds) {
    // 「AC-1」が「AC-10」に部分一致しないよう、後ろに数字が続かないことを確かめる
    if (new RegExp(id + String.raw`(?!\d)`).test(contents)) {
      coverage.get(id).push(relative(repositoryRoot, file).split(sep).join('/'));
    }
  }
}

if (isReportMode) {
  console.log('| 受入条件 | テスト |');
  console.log('|:--|:--|');

  for (const [id, files] of coverage) {
    console.log(`| ${id} | ${files.length === 0 ? '（なし）' : files.join('<br>')} |`);
  }

  process.exit(0);
}

const uncovered = [...coverage].filter(([, files]) => files.length === 0).map(([id]) => id);

if (uncovered.length === 0) {
  console.log(`受入条件のカバレッジを確認しました（${acceptanceIds.length} 件すべてにテストがあります）。`);
  process.exit(0);
}

console.error('テストの無い受入条件があります。');
console.error('');
console.error(`  何が: ${uncovered.join(' / ')}`);
console.error('  なぜ: 受入条件は「これが確認できたら完成」と決めた条件です。');
console.error('        確認する手段が無いと、完成したかどうかを誰も判断できません。');
console.error('  どう直す: その条件を確かめるテストを書き、テスト名の先頭に識別子を入れます。');
console.error("            例: it('AC-1 存在しない id を指定すると 404 を返す', ...)");
console.error('            まだ着手していない条件なら、仕様書の「未決事項」へ移してください。');
console.error('  規約: .claude/rules/testing.md');
process.exit(1);
