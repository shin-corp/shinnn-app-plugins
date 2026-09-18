#!/usr/bin/env node
// テストファイルの名前を検査する。このリポジトリのテストは *.test.ts に統一する。
//
// 実行例:
//   node scripts/check-test-naming.mjs
//
// 失敗したとき: *.spec.ts を *.test.ts にリネームする（git mv を使うと履歴が残る）。
// CI の policy job から呼ばれる。

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', '.angular', 'coverage']);

/** リポジトリ配下のファイルを再帰的に列挙する。 */
async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      files.push(...(await listFiles(path)));
      continue;
    }

    files.push(path);
  }

  return files;
}

const files = await listFiles(repositoryRoot);
const violations = files.filter((file) => /\.spec\.(ts|tsx|js|mjs)$/.test(file));

if (violations.length === 0) {
  console.log(`テストのファイル名を確認しました（${files.length} ファイルを走査）。`);
  process.exit(0);
}

console.error('テストのファイル名が規約に合っていません。');
console.error('');
console.error('  何が: 次のファイルが .spec.* になっています。');

for (const violation of violations) {
  console.error(`    - ${relative(repositoryRoot, violation)}`);
}

console.error('');
console.error('  なぜ: テストのファイル名を .test.ts に統一しています。2 通りあると、');
console.error('        テストの実行対象から漏れたファイルに誰も気づけなくなります。');
console.error('  どう直す: git mv <対象>.spec.ts <対象>.test.ts');
console.error('  規約: .claude/rules/testing.md');
process.exit(1);
