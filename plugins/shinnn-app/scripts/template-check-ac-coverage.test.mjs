/**
 * テンプレートの scripts/check-ac-coverage.mjs の回帰テスト。`node --test scripts/` で実行する。
 *
 * テンプレートは顧客に配るものなので、テストはテンプレートに入れずにここに置く。
 * 一時フォルダをアプリのリポジトリに見立て、スクリプト・仕様書・テストのファイルを置いて実行し、次を確かめる。
 * - テンプレートの仕様書とテストがそろっていれば、終了コード 0 で終える
 * - 受入条件の表に同じ番号の行が 2 つ以上あれば、終了コード 1 で終え、重なった番号を示す
 * - --report なら、重なりがあっても終了コード 0 で終え、表の後に重なった番号を 1 行で示す
 * - 画面の表の「対応する受入条件」の列にある AC-n の参照は、重なりに数えない
 * - テストの無い受入条件があれば、終了コード 1 で終え、その番号を示す
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるスクリプト（リポジトリルート起点） */
const SCRIPT = 'scripts/check-ac-coverage.mjs';

/** 仕様書（リポジトリルート起点） */
const SPECIFICATION = 'docs/仕様書.md';

/** テストのファイルを探さないフォルダ（スクリプトが飛ばすものと同じ） */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.angular', 'coverage']);

/** テンプレートの仕様書 */
const templateSpecification = readFileSync(join(templateDir, SPECIFICATION), 'utf8');

/**
 * テンプレートのテストのファイルのパス（テンプレート起点）。
 *
 * @param directory 探すフォルダ
 */
function listTemplateTests(directory) {
  const paths = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        paths.push(...listTemplateTests(path));
      }
      continue;
    }
    if (entry.name.endsWith('.test.ts')) {
      paths.push(relative(templateDir, path));
    }
  }

  return paths;
}

/** テンプレートのテストのファイル（テンプレート起点のパス → 中身） */
const templateTests = Object.fromEntries(
  listTemplateTests(templateDir).map((path) => [path, readFileSync(join(templateDir, path), 'utf8')]),
);

/** 重なりの見出し。--report では、この後に重なった番号を続けて 1 行で示す */
const DUPLICATED = '仕様書の受入条件に、同じ番号の行が 2 つ以上あります';

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'check-ac-coverage-')));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * 一時フォルダをアプリのリポジトリに見立て、スクリプト・仕様書・テストのファイルを置いて実行する。
 *
 * @param specification 仕様書の中身
 * @param tests テストのファイル（リポジトリルート起点のパス → 中身）
 * @param args スクリプトの引数
 * @returns 終了コードと出力
 */
function runCoverage(specification, tests, args = []) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  const script = join(root, SCRIPT);

  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(templateDir, SCRIPT), script);
  for (const [path, content] of Object.entries({ [SPECIFICATION]: specification, ...tests })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * 仕様書の受入条件の表の最後に、指定した番号の行を足す。別のブランチで同じ番号の条件を足したときと同じ形になる。
 *
 * @param specification 仕様書の中身
 * @param id 足す行の番号
 */
function withAddedRow(specification, id) {
  const lines = specification.split('\n');
  const last = lines.findLastIndex((line) => /^\|\s*AC-\d+\s*\|/.test(line));

  assert.notEqual(last, -1, '仕様書に受入条件の表の行がありません');
  lines.splice(last + 1, 0, `| ${id} | 後から足した別の条件 | テスト |`);
  return lines.join('\n');
}

/**
 * 画面の表と受入条件の表だけを持つ仕様書。
 *
 * @param screens 画面の表の行（[画面, 何ができるか, 対応する受入条件]）
 * @param criteria 受入条件の表の行（[番号, 条件]）
 */
function specificationOf(screens, criteria) {
  return [
    '# 仕様書',
    '',
    '## 4. 画面',
    '',
    '| 画面 | 何ができるか | 対応する受入条件 |',
    '| :-- | :-- | :-- |',
    ...screens.map((cells) => `| ${cells.join(' | ')} |`),
    '',
    '## 6. 受入条件（AC-n）',
    '',
    '| ID | 条件 | 確認方法 |',
    '| :-- | :-- | :-- |',
    ...criteria.map(([id, condition]) => `| ${id} | ${condition} | テスト |`),
    '',
  ].join('\n');
}

/**
 * テスト名の先頭に受入条件の番号を書いたテストのファイル。
 *
 * @param ids テストを書く受入条件の番号
 */
function testFileOf(ids) {
  return `${ids.map((id) => `it('${id} 条件を満たす', () => {});`).join('\n')}\n`;
}

test('テンプレートの仕様書とテストがそろっていれば、終了コード 0 で終える', () => {
  const result = runCoverage(templateSpecification, templateTests);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /受入条件のカバレッジを確認しました（\d+ 件すべてにテストがあります）。/);
});

test('受入条件の表に同じ番号の行が 2 つあれば、テストがそろっていても終了コード 1 で終え、その番号を示す', () => {
  const result = runCoverage(withAddedRow(templateSpecification, 'AC-3'), templateTests);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, new RegExp(`^${DUPLICATED}。$`, 'm'));
  assert.match(result.stderr, /^ {2}何が: AC-3$/m);
});

test('--report: 番号が重なっていても終了コード 0 で終え、表の後に重なった番号を 1 行で示す', () => {
  const result = runCoverage(withAddedRow(templateSpecification, 'AC-3'), templateTests, ['--report']);
  const lines = result.stdout.trimEnd().split('\n');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lines.at(-1), `${DUPLICATED}: AC-3`);
  // 表の直後の行は表の続きとして読まれるので、表との間に空行がある
  assert.equal(lines.at(-2), '');
  assert.match(lines.at(-3), /^\| AC-\d+ \|/);
  // 表には、重なった番号も 1 行だけ出る
  assert.equal(lines.filter((line) => line.startsWith('| AC-3 |')).length, 1);
});

test('画面の表の「対応する受入条件」の列にある AC-n の参照は、重なりに数えない', () => {
  const specification = specificationOf(
    [
      ['一覧', '一覧する', 'AC-1 / AC-3'],
      ['編集', '内容を直す', 'AC-1 / AC-3'],
    ],
    [
      ['AC-1', '一覧が返る'],
      ['AC-3', '内容を直せる'],
    ],
  );
  const result = runCoverage(specification, { 'server/tests/items.test.ts': testFileOf(['AC-1', 'AC-3']) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /（2 件すべてにテストがあります）/);
});

test('テストの無い受入条件があれば、終了コード 1 で終え、その番号を示す', () => {
  const specification = specificationOf(
    [],
    [
      ['AC-1', '一覧が返る'],
      ['AC-2', '作成できる'],
    ],
  );
  const result = runCoverage(specification, { 'server/tests/items.test.ts': testFileOf(['AC-1']) });

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /^テストの無い受入条件があります。$/m);
  assert.match(result.stderr, /^ {2}何が: AC-2$/m);
});
