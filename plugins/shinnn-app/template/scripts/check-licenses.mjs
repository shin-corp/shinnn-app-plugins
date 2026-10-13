#!/usr/bin/env node
// 依存ライブラリのライセンスを検査する。無料で使える OSS ライセンスだけを通す。
//
// 実行例:
//   node scripts/check-licenses.mjs
//
// 判定の仕方:
//   ルートの node_modules と、workspaces の各フォルダの node_modules を走査する。
//   各パッケージの package.json の license を読み、許可リストに無いものがあれば異常終了する。
//   SPDX の式は、OR を含むならどれか 1 つ、単独と AND はすべてが許可リストにあることを見る。
//   license が無い・UNLICENSED・SEE LICENSE IN … は、費用が発生するライセンスの典型なので通さない。
//   workspaces の glob（`packages/*` など）は展開しない。glob があれば異常終了する。
// CI の policy job から呼ばれる。

import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeModulesDirectory = join(repositoryRoot, 'node_modules');

/** 費用が発生しない OSS ライセンス。ここに無いものはシン株式会社が判断する。 */
const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'Unlicense',
  'Python-2.0',
  'Zlib',
  // 書体（@fontsource のパッケージ）のライセンス
  'OFL-1.1',
]);

/** SPDX の式が許可リストに収まるか。括弧は見ない（OR と AND の別だけで判定できる）。 */
function isAllowedExpression(expression) {
  const terms = expression
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const identifiers = terms.filter((term) => term !== 'OR' && term !== 'AND');

  if (identifiers.length === 0) {
    return false;
  }

  if (terms.includes('OR')) {
    return identifiers.some((identifier) => ALLOWED_LICENSES.has(identifier));
  }

  return identifiers.every((identifier) => ALLOWED_LICENSES.has(identifier));
}

/**
 * パッケージのライセンス表記を読む。
 * package.json が読めなければ undefined（パッケージではないので数えない）、記載が無ければ null。
 */
async function readLicense(packageDirectory) {
  let manifest;

  try {
    manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }

  if (typeof manifest.license === 'string') {
    return manifest.license;
  }

  // 古い package.json は license を { type, url } の形で書く
  if (typeof manifest.license?.type === 'string') {
    return manifest.license.type;
  }

  return null;
}

/** `@scope/name` の形のパッケージと、その中の入れ子の node_modules を集める。 */
async function collectScopedPackages(scopeDirectory) {
  const entries = await readdir(scopeDirectory, { withFileTypes: true });
  const directories = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDirectory = join(scopeDirectory, entry.name);
    directories.push(packageDirectory);
    directories.push(...(await collectPackageDirectories(join(packageDirectory, 'node_modules'))));
  }

  return directories;
}

/** node_modules 配下のパッケージを、入れ子の node_modules も含めて集める。 */
async function collectPackageDirectories(nodeModulesPath) {
  let entries;

  try {
    entries = await readdir(nodeModulesPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const directories = [];

  for (const entry of entries) {
    // .bin などの隠しディレクトリはパッケージではない。npm workspaces のパッケージは symlink で
    // 置かれるが、これは自分たちのコードなので検査しない（isDirectory() は symlink に false を返す）。
    if (entry.name.startsWith('.') || !entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith('@')) {
      directories.push(...(await collectScopedPackages(join(nodeModulesPath, entry.name))));
      continue;
    }

    const packageDirectory = join(nodeModulesPath, entry.name);
    directories.push(packageDirectory);
    directories.push(...(await collectPackageDirectories(join(packageDirectory, 'node_modules'))));
  }

  return directories;
}

/**
 * ルートの package.json の workspaces に並んだフォルダ。npm が受け付ける 2 つの形（配列と `{ packages: [...] }`）を読む。
 * package.json が無い・読めないときは、空の配列を返す。
 */
async function readWorkspaces() {
  let manifest;

  try {
    manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  } catch {
    return [];
  }

  if (Array.isArray(manifest.workspaces)) {
    return manifest.workspaces;
  }

  return manifest.workspaces?.packages ?? [];
}

try {
  await stat(nodeModulesDirectory);
} catch {
  console.error('依存ライブラリのライセンスを確認できません。');
  console.error('');
  console.error('  何が: node_modules がありません。');
  console.error('  なぜ: 入っているパッケージの package.json を読んでライセンスを調べるためです。');
  console.error('  どう直す: 先に npm ci / npm install を実行してください。');
  process.exit(1);
}

const workspaces = await readWorkspaces();
const globbedWorkspaces = workspaces.filter((workspace) => workspace.includes('*'));

if (globbedWorkspaces.length > 0) {
  console.error('依存ライブラリのライセンスを確認できません。');
  console.error('');
  console.error(
    `  何が: ルートの package.json の workspaces に、glob の指定があります（${globbedWorkspaces.join(' / ')}）。`,
  );
  console.error(
    '  なぜ: このスクリプトは glob を展開しません。そのまま進むと、そのフォルダの node_modules を検査せずに通します。',
  );
  console.error(
    '  どう直す: workspaces には、フォルダの名前を 1 つずつ並べてください（例: "shared", "server", "client"）。',
  );
  process.exit(1);
}

// npm は workspaces のパッケージの依存を、そのフォルダの node_modules に置くことがある（lock ファイルがそう書いているとき）。
// ルートだけを走査すると、そこに置かれた依存を検査しない。
const nodeModulesDirectories = [nodeModulesDirectory];

for (const workspace of workspaces) {
  nodeModulesDirectories.push(join(repositoryRoot, workspace, 'node_modules'));
}

const packageDirectories = [];

for (const directory of nodeModulesDirectories) {
  packageDirectories.push(...(await collectPackageDirectories(directory)));
}

const foundLicenses = new Set();
const violations = [];
let checkedCount = 0;

for (const packageDirectory of packageDirectories) {
  const license = await readLicense(packageDirectory);

  if (license === undefined) {
    continue;
  }

  checkedCount += 1;

  if (license !== null && isAllowedExpression(license)) {
    foundLicenses.add(license);
    continue;
  }

  violations.push({
    name: relative(repositoryRoot, packageDirectory).split(sep).join('/'),
    license: license ?? 'license の記載なし',
  });
}

if (violations.length === 0) {
  console.log(`ライセンスを確認しました（${checkedCount} パッケージ / 許可リスト内 ${foundLicenses.size} 種類）。`);
  process.exit(0);
}

console.error('許可リストに無いライセンスのパッケージがあります。');
console.error('');
console.error('  何が: 次のパッケージのライセンスが許可リストにありません。');

for (const violation of violations) {
  console.error(`    - ${violation.name}: ${violation.license}`);
}

console.error('');
console.error('  なぜ: 費用が発生する可能性があるライセンスです。入れる前にシン株式会社に相談してください。');
console.error('        無料の OSS ライセンスのライブラリなら、相談せずに入れて構いません。');
console.error('  どう直す: 同じことができる OSS のライブラリに置き換えるか、シン株式会社に相談してください。');
console.error(`  許可リスト: ${[...ALLOWED_LICENSES].join(' / ')}`);
process.exit(1);
