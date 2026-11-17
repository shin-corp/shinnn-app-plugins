#!/usr/bin/env node
// 仕様書の受入条件（AC-n）ごとに、テストが 1 つ以上あるかを検査する。
//
// 実行例:
//   node scripts/check-ac-coverage.mjs            検査する（テストの無い受入条件か、番号の重なりがあれば異常終了）
//   node scripts/check-ac-coverage.mjs --report   結果を Markdown の表で出す（終了コードは常に 0）。
//                                                 番号の重なりは、表の後に 1 行で示す
//
// 判定の仕方:
//   docs/仕様書.md に出てくる AC-n を集め、テストファイル（*.test.ts）の中に
//   同じ AC-n を含む文字列があるかを見る。テスト名の先頭に識別子を書く規約が前提。
//   あわせて、受入条件の表（`| AC-n |` で始まる行）に、同じ番号の行が 2 つ以上ないかを見る。
//   仕様書が 150KB を超えたときと、表のセルが 1,000 文字を超えたときは、注意を出す（終了コードは変えない）。
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

/** 仕様書の大きさの目安（バイト）。Claude が 1 回で読める大きさ（256KB）より小さくしておく */
const SPECIFICATION_SIZE_NOTICE = 150 * 1024;
/** 表のセル 1 つの長さの目安（文字） */
const TABLE_CELL_LENGTH_NOTICE = 1000;
/** 長いセルの注意を出す行の数の上限（出力が埋まらないように） */
const TABLE_CELL_NOTICE_LIMIT = 5;

/**
 * 注意を出す。CI（GitHub Actions）では、PR の画面にも出る形で出す。終了コードは変えない。
 * --report の出力はファイルに書いてレポートの本文にするので、--report では CI でも標準エラーに出す
 */
function notice(message, line) {
  if (process.env.GITHUB_ACTIONS === 'true' && !isReportMode) {
    const location = line === undefined ? 'file=docs/仕様書.md' : `file=docs/仕様書.md,line=${line}`;
    console.log(`::warning ${location}::${message}`);
    return;
  }
  console.error(`注意: ${message}`);
}

/** 仕様書の大きさと、表のセルの長さを見て、目安を超えていれば注意を出す（規約 spec.md） */
function noticeSpecificationSize(text) {
  const size = Buffer.byteLength(text);
  if (size > SPECIFICATION_SIZE_NOTICE) {
    notice(
      `docs/仕様書.md が ${Math.round(size / 1024)}KB あります（目安は ${SPECIFICATION_SIZE_NOTICE / 1024}KB まで）。` +
        '表のセルの細かい説明を受入条件とテストに移して、短くしてください（規約 spec.md）。',
    );
  }
  let noticed = 0;
  // 開いているコードの囲みの記号（``` か ~~~ を 3 つ以上）。同じ記号で、同じ長さ以上の行で閉じる
  let openFence = null;
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const fence = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence !== undefined) {
      if (openFence === null) {
        openFence = fence;
      } else if (fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }
    // コードの囲みの中の行は、表の行に数えない
    if (openFence !== null || !trimmed.startsWith('|') || noticed >= TABLE_CELL_NOTICE_LIMIT) {
      continue;
    }
    // セルの区切りは、`\|` と書いた縦棒を除く縦棒
    const longest = Math.max(...trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().length));
    if (longest > TABLE_CELL_LENGTH_NOTICE) {
      notice(
        `docs/仕様書.md の ${index + 1} 行目の表のセルが ${longest} 文字あります（目安は ${TABLE_CELL_LENGTH_NOTICE} 文字まで）。` +
          '1 つのことを 1〜2 文で書いてください（規約 spec.md）。',
        index + 1,
      );
      noticed += 1;
    }
  }
}

let specification;

try {
  specification = await readFile(specificationPath, 'utf8');
} catch {
  console.log('docs/仕様書.md がまだありません。受入条件の検査を飛ばします。');
  process.exit(0);
}

noticeSpecificationSize(specification);

// 雛形のまま（AC-1 の行に中身が書かれていない）の場合は検査しない
const acceptanceIds = [...new Set(specification.match(acceptancePattern) ?? [])].sort(
  (a, b) => Number(a.slice(3)) - Number(b.slice(3)),
);

if (acceptanceIds.length === 0) {
  console.log('docs/仕様書.md に受入条件（AC-n）がまだありません。検査を飛ばします。');
  process.exit(0);
}

// 受入条件の表の行（`| AC-n |` で始まる行）で、同じ番号の行が 2 つ以上あるものを集める。
// 番号が重なると、片方の条件のテストだけで両方を確かめたことになる。
const definitionCounts = new Map();

for (const [, id] of specification.matchAll(/^\|\s*(AC-\d+)\s*\|/gm)) {
  definitionCounts.set(id, (definitionCounts.get(id) ?? 0) + 1);
}

const duplicatedIds = [];

for (const [id, count] of definitionCounts) {
  if (count > 1) {
    duplicatedIds.push(id);
  }
}

if (!isReportMode && duplicatedIds.length > 0) {
  console.error('仕様書の受入条件に、同じ番号の行が 2 つ以上あります。');
  console.error('');
  console.error(`  何が: ${duplicatedIds.join(' / ')}`);
  console.error('  なぜ: AC-n はリポジトリ全体の通し番号です。番号が重なると、片方の条件のテストだけで、');
  console.error('        もう片方も確かめたことになります。そのため、テストの無い条件が CI を通ってしまいます。');
  console.error('  どう直す: 後から足した方の番号を、仕様書と open な Issue で使われている最大の番号の続きに');
  console.error('            振り直します。テスト名と Issue の本文も、同じ番号に直してください。');
  console.error('  規約: .claude/rules/testing.md');
  process.exit(1);
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

  // 表は番号ごとに 1 行なので、重なりは表の後に示す。表の直後の行は表の続きとして読まれるので、空行を挟む
  if (duplicatedIds.length > 0) {
    console.log('');
    console.log(`仕様書の受入条件に、同じ番号の行が 2 つ以上あります: ${duplicatedIds.join(' / ')}`);
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
