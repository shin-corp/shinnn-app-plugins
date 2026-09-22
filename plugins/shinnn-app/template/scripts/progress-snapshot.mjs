#!/usr/bin/env node
// docs/progress.md を作り直す。進捗の正本は GitHub Issues で、このファイルはその写し。
//
// 実行例:
//   node scripts/progress-snapshot.mjs           docs/progress.md を作り直す
//   node scripts/progress-snapshot.mjs --check   書かずに、内容が最新かどうかだけを報告する
//
// gh コマンド（GitHub CLI）が使えて認証済みなら、open な Issue / PR / 直近の CI から生成する。
// Issue と PR は更新の古い順に載せ、載せきれないときは「N 件中 M 件を表示」と書き添える。
// PR や CI の一覧を取得できなかったときは、その欄に「取得できませんでした（理由）」と書く（0 件と見分けるため）。
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

/** 表に載せる open な Issue の上限。超えた分は載せず、総件数を書き添える。 */
const ISSUE_LIMIT = 50;

/** 表に載せる open な PR の上限。超えた分は載せず、総件数を書き添える。 */
const PULL_REQUEST_LIMIT = 20;

/** 載せる CI の実行結果の件数（新しいものから）。 */
const RUN_LIMIT = 5;

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

/**
 * gh が失敗した理由の要点。標準エラー出力の最初の行を使い、末尾に付く API の URL は長いので除く。
 *
 * 例: 「failed to get runs: HTTP 403: Resource not accessible by integration」
 */
function failureReason(error) {
  if (error.code === 'ENOENT') {
    return 'gh コマンドが見つかりません';
  }

  const firstLine = String(error.stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');

  if (firstLine === undefined) {
    return `gh が終了コード ${error.status ?? '不明'} で終わりました`;
  }

  return firstLine
    .replace(/^gh: /, '')
    .replace(/\s*\(https?:\/\/[^)]*\)$/, '')
    .slice(0, 200);
}

/**
 * gh コマンドを実行する。
 *
 * @returns 成功したら { output: 標準出力 }、失敗したら { error: 理由の要点 }
 */
function runGh(args) {
  try {
    return { output: execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { error: failureReason(error) };
  }
}

/**
 * gh を実行し、JSON の出力を読む。
 *
 * @returns 成功したら { value: 読んだ値 }、失敗したら { error: 理由の要点 }
 */
function fetchJson(args) {
  const result = runGh(args);

  if ('error' in result) {
    return result;
  }

  try {
    return { value: JSON.parse(result.output) };
  } catch {
    return { error: 'gh の出力を JSON として読めませんでした' };
  }
}

/**
 * open な Issue か PR を、更新の古い順に先頭から limit 件と、総件数を取り出す。
 *
 * 更新の古い順にするのは、載せきれないときに外れるものを、最近動いたものにするため。
 * 長く動いていないもの（滞っているもの）ほど見落とされやすいので残す。最近動いたものは GitHub の一覧の先頭に出るので、
 * ここに載らなくても見つけやすい。
 * gh issue list / gh pr list は並びが作成の新しい順に決まっていて、総件数も返さないので、GraphQL の API を直接呼ぶ。
 * gh issue list --search の並べ替えは検索の索引を引くため、閉じた直後の Issue がまだ open として返ることがあり、使わない。
 *
 * @param connection - issues か pullRequests
 * @param fields - 1 件ごとに取り出す項目（GraphQL の書き方）
 * @param limit - 取り出す件数の上限
 * @returns 成功したら { value: { totalCount, nodes } }、失敗したら { error: 理由の要点 }
 */
function fetchOpen(connection, fields, limit) {
  const query = [
    'query ($owner: String!, $name: String!, $first: Int!) {',
    'repository(owner: $owner, name: $name) {',
    `${connection}(states: OPEN, first: $first, orderBy: { field: UPDATED_AT, direction: ASC }) {`,
    `totalCount nodes { ${fields} }`,
    '} } }',
  ].join(' ');
  const result = fetchJson([
    'api',
    'graphql',
    '-F',
    'owner={owner}',
    '-F',
    'name={repo}',
    '-F',
    `first=${limit}`,
    '-f',
    `query=${query}`,
  ]);

  if ('error' in result) {
    return result;
  }

  const list = result.value?.data?.repository?.[connection];

  if (typeof list?.totalCount !== 'number' || !Array.isArray(list.nodes)) {
    return { error: 'gh の出力が想定した形ではありません' };
  }

  return { value: list };
}

/**
 * 直近の CI の実行結果を、新しいものから RUN_LIMIT 件取り出す。
 *
 * @returns 成功したら { value: 実行結果の配列 }、失敗したら { error: 理由の要点 }
 */
function fetchRuns() {
  const result = fetchJson([
    'run',
    'list',
    '--limit',
    String(RUN_LIMIT),
    '--json',
    'displayTitle,workflowName,conclusion,status,headBranch,createdAt',
  ]);

  if ('value' in result && !Array.isArray(result.value)) {
    return { error: 'gh の出力が想定した形ではありません' };
  }

  return result;
}

/** 日付を YYYY-MM-DD にする。 */
function formatDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '-';
}

/**
 * Markdown の表のセルで壊れる文字を退避する。
 *
 * | はそのままだと列の区切りになるので \| にする。改行は行の終わりになるので空白にする。
 */
function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\r\n|\r|\n/g, ' ');
}

/** 載せきれなかったときに表の前に書く注記。すべて載せたときは何も書かない。 */
function truncationNote(list, kind) {
  if (list.totalCount <= list.nodes.length) {
    return [];
  }

  return [
    `${list.totalCount} 件中 ${list.nodes.length} 件を表示しています（更新の古い順）。` +
      `残りの最近更新された ${kind} は GitHub の一覧で確認してください。`,
    '',
  ];
}

/** 一覧を取得できなかった欄に書く文。0 件（「ありません」）と見分けられるよう、理由の要点を添える。 */
function unavailableLines(error) {
  return [`取得できませんでした（${error}）。`, ''];
}

/** 取得した件数の要約（完了の表示用）。 */
function countSummary(label, result) {
  if ('error' in result) {
    return `${label} 取得できず`;
  }

  if (Array.isArray(result.value)) {
    return `${label} ${result.value.length} 件`;
  }

  const { totalCount, nodes } = result.value;

  return totalCount === nodes.length ? `${label} ${totalCount} 件` : `${label} ${totalCount} 件中 ${nodes.length} 件`;
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

/**
 * 取得した一覧から docs/progress.md の内容を作る。
 *
 * @param issues - open な Issue（{ totalCount, nodes }）。取得できていることが前提
 * @param pullRequests - open な PR の取得結果（{ value: { totalCount, nodes } } か { error }）
 * @param runs - 直近の CI の取得結果（{ value: 配列 } か { error }）
 */
function buildSnapshot(issues, pullRequests, runs) {
  const lines = [...header, `生成日時: ${new Date().toISOString().slice(0, 10)}`, ''];

  lines.push('## 進行中と次の一手（open な Issue）', '');

  if (issues.nodes.length === 0) {
    lines.push('open な Issue はありません。', '');
  } else {
    lines.push(...truncationNote(issues, 'Issue'));
    lines.push('| Issue | 題名 | 状態 | 更新 |', '|:--|:--|:--|:--|');

    for (const issue of issues.nodes) {
      lines.push(
        `| #${issue.number} | ${escapeCell(issue.title)} | ${escapeCell(statusOf(issue.labels?.nodes))} | ${formatDate(issue.updatedAt)} |`,
      );
    }

    lines.push('');
  }

  lines.push('## レビュー待ち（open な PR）', '');

  if ('error' in pullRequests) {
    lines.push(...unavailableLines(pullRequests.error));
  } else if (pullRequests.value.nodes.length === 0) {
    lines.push('open な PR はありません。', '');
  } else {
    lines.push(...truncationNote(pullRequests.value, 'PR'));
    lines.push('| PR | 題名 | 下書き | 更新 |', '|:--|:--|:--|:--|');

    for (const pullRequest of pullRequests.value.nodes) {
      lines.push(
        `| #${pullRequest.number} | ${escapeCell(pullRequest.title)} | ${pullRequest.isDraft ? 'はい' : 'いいえ'} | ${formatDate(pullRequest.updatedAt)} |`,
      );
    }

    lines.push('');
  }

  lines.push('## 直近の CI', '');

  if ('error' in runs) {
    lines.push(...unavailableLines(runs.error));
  } else if (runs.value.length === 0) {
    lines.push('実行結果がありません。', '');
  } else {
    lines.push('| 実行 | 結果 | ブランチ | 日時 |', '|:--|:--|:--|:--|');

    for (const run of runs.value) {
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
    'pin した「引き継ぎメモ」Issue を参照してください（番号は `.shinnn/setup.json` の `handoverIssue`）。',
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

const version = runGh(['--version']);

if ('error' in version) {
  process.exit(
    await writeSnapshot(
      buildManualTemplate(version.error),
      'gh が無いため、docs/progress.md を手動モードの雛形で書きました。',
    ),
  );
}

const issues = fetchOpen('issues', 'number title updatedAt labels(first: 100) { nodes { name } }', ISSUE_LIMIT);

if ('error' in issues) {
  process.exit(
    await writeSnapshot(
      buildManualTemplate(`gh の認証かリポジトリの設定が未了です: ${issues.error}`),
      `gh から Issue の一覧を取得できないため（${issues.error}）、docs/progress.md を手動モードの雛形で書きました。`,
    ),
  );
}

const pullRequests = fetchOpen('pullRequests', 'number title isDraft updatedAt', PULL_REQUEST_LIMIT);
const runs = fetchRuns();

for (const [label, result] of [
  ['PR', pullRequests],
  ['CI の実行結果', runs],
]) {
  if ('error' in result) {
    console.error(`${label} の一覧を取得できませんでした（${result.error}）。`);
  }
}

process.exit(
  await writeSnapshot(
    buildSnapshot(issues.value, pullRequests, runs),
    `docs/progress.md を更新しました（${[
      countSummary('Issue', issues),
      countSummary('PR', pullRequests),
      countSummary('CI', runs),
    ].join(' / ')}）。`,
  ),
);
