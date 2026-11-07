#!/usr/bin/env node
// 作業が詰まったところの手元の記録（record-friction.mjs が書く）を、種類ごとに多い順にまとめて出す。
// /shinnn-app:session-retro が、規約・スキル・許可の直しを出す材料にする。
//
// 実行例:
//   node <プラグイン>/scripts/friction-report.mjs          前回まとめた後の分を出し、まとめた時刻を残す
//   node <プラグイン>/scripts/friction-report.mjs --all    はじめからの分を出す（まとめた時刻は変えない）
//
// 対象のリポジトリは CLAUDE_PROJECT_DIR（無ければカレント）を含むアプリのフォルダ。記録の置き場所は lib/hook-io.mjs の stateDir()。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRICTION_FILE, readRecords, REPORTED_AT_FILE } from './lib/friction.mjs';
import { appRootOf, stateDir } from './lib/hook-io.mjs';

/** 種類ごとに出す行の上限 */
const MAX_ROWS = 15;

/** 種類ごとの見出しと、まとめる鍵と、表の列 */
const SECTIONS = [
  {
    event: 'PermissionRequest',
    title: '確認が出た操作（PermissionRequest）',
    columns: ['ツール', 'モード', '中身'],
    cells: (record) => [record.tool, record.mode ?? '', record.what],
  },
  {
    event: 'PermissionDenied',
    title: '権限の自動判定が止めた操作（PermissionDenied）',
    columns: ['ツール', '中身', '理由'],
    cells: (record) => [record.tool, record.what, record.reason ?? ''],
  },
  {
    event: 'PostToolUseFailure',
    title: 'ツールの失敗（PostToolUseFailure）',
    columns: ['ツール', '中身', 'エラー'],
    cells: (record) => [record.tool, record.what, record.error ?? ''],
  },
  {
    event: 'StopFailure',
    title: 'API のエラーでの中断（StopFailure）',
    columns: ['種類', '詳しく'],
    cells: (record) => [record.error ?? '', record.details ?? ''],
  },
];

/** 表のセルに入れられる形にする（縦棒と改行を逃がす） */
function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 同じ中身の記録をまとめ、回数の多い順に並べる */
function group(records, section) {
  const counts = new Map();
  for (const record of records) {
    // 利用者が止めた操作は、詰まったところではないので並べない
    if (record.event !== section.event || record.interrupt === true) {
      continue;
    }
    const cells = section.cells(record).map(cell);
    const key = JSON.stringify(cells);
    const entry = counts.get(key) ?? { cells, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** 1 つの種類の表 */
function sectionLines(rows, section) {
  const lines = [
    `### ${section.title}`,
    '',
    `| 回数 | ${section.columns.join(' | ')} |`,
    `|---:|${section.columns.map(() => ':--').join('|')}|`,
  ];
  for (const row of rows.slice(0, MAX_ROWS)) {
    lines.push(`| ${row.count} | ${row.cells.join(' | ')} |`);
  }
  if (rows.length > MAX_ROWS) {
    lines.push('', `ほかに ${rows.length - MAX_ROWS} 種類あります（記録のファイル: \`${FRICTION_FILE}\`）。`);
  }
  lines.push('');
  return lines;
}

const showAll = process.argv.includes('--all');
// アプリのフォルダの中の下のフォルダ（server など）で実行しても、目印のあるフォルダまでたどる
const root = appRootOf(process.env.CLAUDE_PROJECT_DIR || process.cwd());

if (root === null) {
  console.log('テンプレートから作ったアプリのリポジトリではありません（.shinnn/setup.json がありません）。');
  process.exit(0);
}

const dir = stateDir(root);
if (dir === null) {
  console.log('git のリポジトリではないので、記録はありません。');
  process.exit(0);
}

const reportedAtFile = join(dir, REPORTED_AT_FILE);
const since = !showAll && existsSync(reportedAtFile) ? readFileSync(reportedAtFile, 'utf8').trim() : '';
const records = readRecords(join(dir, FRICTION_FILE)).filter((record) => since === '' || String(record.at) > since);

const range = since === '' ? 'はじめから' : `前回まとめた ${since} の後`;
const lines = [`## 作業の記録（${range}）`, ''];

if (records.length === 0) {
  lines.push('記録はありません。');
} else {
  lines.push(`${records.length} 件。同じ中身のものをまとめ、回数の多い順に並べます。`, '');
  for (const section of SECTIONS) {
    const rows = group(records, section);
    if (rows.length > 0) {
      lines.push(...sectionLines(rows, section));
    }
  }
}
console.log(lines.join('\n'));

if (!showAll) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(reportedAtFile, `${new Date().toISOString()}\n`);
}
