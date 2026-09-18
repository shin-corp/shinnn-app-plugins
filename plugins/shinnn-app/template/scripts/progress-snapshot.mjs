#!/usr/bin/env node
// docs/progress.md を作り直す。進捗の正本は GitHub Issues で、このファイルはその写し。
//
// 実行例:
//   node scripts/progress-snapshot.mjs           docs/progress.md を作り直す
//   node scripts/progress-snapshot.mjs --check   書かずに、内容が最新かどうかだけを報告する
//
// gh コマンド（GitHub CLI）が使えて認証済みなら、open な Issue / PR / 直近の CI から生成する。
// gh が無い環境では「手動モード」の雛形を書き、人が埋める形にする。
// 別のリポジトリの作業ツリーに置かれていると gh が親リポジトリの Issue / PR を拾うので、その場合も手動モードにする。
// PR のマージ時に Action から呼ばれる。手で docs/progress.md を編集しない。

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const outputPath = join(repositoryRoot, 'docs', 'progress.md');
const isCheckMode = process.argv.includes('--check');
const header = [
  '# 進捗',
  '',
  '<!-- このファイルは scripts/progress-snapshot.mjs が生成します。手で編集しないでください。',
  '     進捗の正本は GitHub Issues です。内容を変えたいときは Issue のほうを更新してください。 -->',
  '',
];

/** 生成日時の行を除いた本文。日付だけの違いを「古い」と判定しないため。 */
function withoutGeneratedAt(text) {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('生成日時: '))
    .join('\n')
    .trim();
}

/**
 * 生成した内容を docs/progress.md に書く。
 *
 * `--check` のときは書かずに、今の内容と同じかどうかだけを報告する。
 *
 * @param content - 生成した内容
 * @param message - 書いたときに表示する文言
 * @returns 終了コード（--check で内容が古いときだけ 1）
 */
async function writeSnapshot(content, message) {
  if (isCheckMode) {
    let current = '';

    try {
      current = await readFile(outputPath, 'utf8');
    } catch {
      current = '';
    }

    if (withoutGeneratedAt(current) === withoutGeneratedAt(content)) {
      console.log('docs/progress.md は最新です。');

      return 0;
    }

    console.error('docs/progress.md が最新ではありません。');
    console.error('');
    console.error('  何が: 生成される内容と、いま置かれている docs/progress.md が違います。');
    console.error('  なぜ: 引き継ぐ人は、クローンしただけの状態でも今の状況を読める必要があります。');
    console.error('  どう直す: node scripts/progress-snapshot.mjs を実行して作り直します。');
    console.error('  規約: CLAUDE.md（進め方）');

    return 1;
  }

  await mkdir(join(repositoryRoot, 'docs'), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  console.log(message);

  return 0;
}

/** git から見たリポジトリのルート。git が無い・リポジトリの外なら null。 */
function gitToplevel() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** gh コマンドを実行して標準出力を返す。失敗したら null。 */
function runGh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** gh の JSON 出力を配列で返す。失敗したら null。 */
function fetchJson(args) {
  const output = runGh(args);

  if (output === null) {
    return null;
  }

  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/** 日付を YYYY-MM-DD にする。 */
function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '-';
}

/** Markdown の表のセルで壊れる文字を退避する。 */
function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\|')
    .replaceAll('\n', ' ');
}

/** ラベル配列から status: で始まるものを取り出す。 */
function statusOf(labels) {
  const status = (labels ?? []).map((label) => label.name).find((name) => name.startsWith('status:'));

  return status ?? '-';
}

function buildManualTemplate(reason) {
  return [
    ...header,
    `生成日時: ${new Date().toISOString().slice(0, 10)}（手動モード）`,
    '',
    `GitHub CLI（gh）から情報を取得できませんでした（${reason}）。`,
    '下の欄を人が埋めてください。gh が使える環境では、この節ごと自動で置き換わります。',
    '',
    '## 現在地',
    '',
    '<!-- どこまでできているか -->',
    '',
    '## 進行中',
    '',
    '<!-- いま手を付けていること -->',
    '',
    '## 次の一手',
    '',
    '<!-- 次に着手すること。引き継ぐ人がここだけ読んで始められるように -->',
    '',
    '## 保留',
    '',
    '<!-- 止まっていること、待っていること -->',
    '',
    '## 引き継ぎ時の注意',
    '',
    '<!-- 知らないと詰まること -->',
    '',
  ].join('\n');
}

function buildSnapshot(issues, pullRequests, runs) {
  const lines = [...header, `生成日時: ${new Date().toISOString().slice(0, 10)}`, ''];

  lines.push('## 進行中と次の一手（open な Issue）', '');

  if (issues.length === 0) {
    lines.push('open な Issue はありません。', '');
  } else {
    lines.push('| Issue | 題名 | 状態 | 更新 |', '|:--|:--|:--|:--|');

    for (const issue of issues) {
      lines.push(
        `| #${issue.number} | ${escapeCell(issue.title)} | ${escapeCell(statusOf(issue.labels))} | ${formatDate(issue.updatedAt)} |`,
      );
    }

    lines.push('');
  }

  lines.push('## レビュー待ち（open な PR）', '');

  if (pullRequests.length === 0) {
    lines.push('open な PR はありません。', '');
  } else {
    lines.push('| PR | 題名 | 下書き | 更新 |', '|:--|:--|:--|:--|');

    for (const pullRequest of pullRequests) {
      lines.push(
        `| #${pullRequest.number} | ${escapeCell(pullRequest.title)} | ${pullRequest.isDraft ? 'はい' : 'いいえ'} | ${formatDate(pullRequest.updatedAt)} |`,
      );
    }

    lines.push('');
  }

  lines.push('## 直近の CI', '');

  if (runs.length === 0) {
    lines.push('実行結果がありません。', '');
  } else {
    lines.push('| 実行 | 結果 | ブランチ | 日時 |', '|:--|:--|:--|:--|');

    for (const run of runs) {
      const result = run.conclusion === 'success' ? '成功' : escapeCell(run.conclusion ?? run.status);

      lines.push(
        `| ${escapeCell(run.displayTitle ?? run.workflowName)} | ${result} | ${escapeCell(run.headBranch)} | ${formatDate(run.createdAt)} |`,
      );
    }

    lines.push('');
  }

  lines.push(
    '## 引き継ぎ時の注意',
    '',
    'pin した「引き継ぎメモ」Issue を参照してください（`gh issue list --label handover`）。',
    '',
  );

  return lines.join('\n');
}

const toplevel = gitToplevel();

if (toplevel !== null && relative(toplevel, repositoryRoot) !== '') {
  process.exit(
    await writeSnapshot(
      buildManualTemplate('このテンプレートが別のリポジトリの作業ツリーの中にあります'),
      'このテンプレートが別のリポジトリの中にあるため、docs/progress.md を手動モードの雛形で書きました。',
    ),
  );
}

if (runGh(['--version']) === null) {
  process.exit(
    await writeSnapshot(
      buildManualTemplate('gh コマンドが見つかりません'),
      'gh が無いため、docs/progress.md を手動モードの雛形で書きました。',
    ),
  );
}

const issues = fetchJson([
  'issue',
  'list',
  '--state',
  'open',
  '--limit',
  '50',
  '--json',
  'number,title,labels,updatedAt',
]);

if (issues === null) {
  process.exit(
    await writeSnapshot(
      buildManualTemplate('gh の認証かリポジトリの設定が未了です'),
      'gh から情報を取得できないため、docs/progress.md を手動モードの雛形で書きました。',
    ),
  );
}

const pullRequests =
  fetchJson(['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,isDraft,updatedAt']) ?? [];
const runs =
  fetchJson([
    'run',
    'list',
    '--limit',
    '5',
    '--json',
    'displayTitle,workflowName,conclusion,status,headBranch,createdAt',
  ]) ?? [];

process.exit(
  await writeSnapshot(
    buildSnapshot(issues, pullRequests, runs),
    `docs/progress.md を更新しました（Issue ${issues.length} 件 / PR ${pullRequests.length} 件 / CI ${runs.length} 件）。`,
  ),
);
