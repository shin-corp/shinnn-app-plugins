#!/usr/bin/env node
// API 定義にある全ルートに、サーバーのテストがあるかを検査する。
//
// 実行例:
//   node scripts/check-api-coverage.mjs
//
// 判定の仕方:
//   shared/src/api/*.ts の `export const xxxApi = { ... } as const;` からルート名を集め、
//   server/tests/ の中に同じ名前が出てくるかを見る。
//   テストは `itemsApi.listItems` の形で API 定義を参照する前提。
// CI の policy job から呼ばれる。

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const apiDirectory = join(repositoryRoot, 'shared', 'src', 'api');
const testDirectory = join(repositoryRoot, 'server', 'tests');
const apiObjectPattern = /export const (\w+Api)\s*=\s*\{([^}]*)\}\s*as const/g;

/** ディレクトリ配下のファイルを再帰的に列挙する。存在しなければ空配列。 */
async function listFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
      continue;
    }

    files.push(path);
  }

  return files;
}

// client-only プロファイル（server を持たない構成）では検査しない
try {
  await stat(join(repositoryRoot, 'server'));
} catch {
  console.log('server/ がありません（client-only 構成）。API 定義の検査を飛ばします。');
  process.exit(0);
}

const apiFiles = (await listFiles(apiDirectory)).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

if (apiFiles.length === 0) {
  console.log('shared/src/api がまだありません。API 定義の検査を飛ばします。');
  process.exit(0);
}

/** ルート名（`itemsApi` の各キー）と、それが定義されたファイルの対応。 */
const routes = new Map();

for (const file of apiFiles) {
  const contents = await readFile(file, 'utf8');

  for (const [, apiName, body] of contents.matchAll(apiObjectPattern)) {
    for (const entry of body.split(',')) {
      // `listItems` と `listItems: listItemsRoute` の両方を受ける
      const name = entry.split(':')[0].trim();

      if (name.length === 0) {
        continue;
      }

      routes.set(name, { apiName, file: relative(repositoryRoot, file).split(sep).join('/') });
    }
  }
}

if (routes.size === 0) {
  console.log('API 定義（`export const xxxApi = { ... } as const`）が見つかりませんでした。検査を飛ばします。');
  process.exit(0);
}

const testFiles = (await listFiles(testDirectory)).filter((file) => file.endsWith('.test.ts'));
const testContents = await Promise.all(testFiles.map((file) => readFile(file, 'utf8')));
const allTests = testContents.join('\n');
const uncovered = [];

for (const [name, info] of routes) {
  // `itemsApi.listItems` または `listItems` 単体での参照を探す
  if (!new RegExp(String.raw`\b` + name + String.raw`\b`).test(allTests)) {
    uncovered.push({ name, ...info });
  }
}

if (uncovered.length === 0) {
  console.log(`API 定義のカバレッジを確認しました（${routes.size} ルートすべてにテストがあります）。`);
  process.exit(0);
}

console.error('テストの無い API があります。');
console.error('');
console.error('  何が: 次のルートを参照しているテストが server/tests/ にありません。');

for (const route of uncovered) {
  console.error(`    - ${route.apiName}.${route.name}（${route.file}）`);
}

console.error('');
console.error('  なぜ: API 定義に書いたということは、外から呼べる入口を増やしたということです。');
console.error('        入口ごとに、正常系・異常系の振る舞いを固定しておかないと、');
console.error('        あとから壊れても誰も気づけません。');
console.error('  どう直す: server/tests/<機能>.test.ts を作り、そのルートを実際に HTTP で叩きます。');
console.error('            使わなくなった API 定義なら、定義ごと消してください。');
console.error('  規約: .claude/rules/testing.md と .claude/rules/api-contract.md');
process.exit(1);
