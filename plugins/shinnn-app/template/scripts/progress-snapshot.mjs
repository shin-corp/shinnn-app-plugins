#!/usr/bin/env node
// open な Issue と PR、直近の CI の一覧を Markdown で標準出力に出す。ファイルには書かない。
// 進捗の正本は GitHub の Issue・PR・CI で、これはその時点の一覧。月次の健全性レポートが Issue の本文に使う。
//
// 実行例:
//   node scripts/progress-snapshot.mjs
//
// gh コマンド（GitHub CLI）が使えて認証済みなら、open な Issue / PR と、直近の CI（ci.yaml の実行）から作る。
// Issue と PR は更新の古い順に載せ、載せきれないときは「N 件中 M 件を表示」と書き添える。
// 一覧を取得できなかった欄は「取得できませんでした（理由）」と書き（0 件と見分けるため）、ほかの欄は続けて載せる。
// gh が無いときも同じ書き方になる。
// 別のリポジトリの作業ツリーに置かれていると gh が親リポジトリの Issue / PR を拾うので、その場合は gh を呼ばない。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** 表に載せる open な Issue の上限。超えた分は載せず、総件数を書き添える。 */
const ISSUE_LIMIT = 50;

/** 表に載せる open な PR の上限。超えた分は載せず、総件数を書き添える。 */
const PULL_REQUEST_LIMIT = 20;

/** 載せる CI の実行結果の件数（新しいものから）。 */
const RUN_LIMIT = 5;

/** 直近の CI として載せるワークフローのファイル（.github/workflows/ の下）。ほかのワークフローの実行は載せない。 */
const CI_WORKFLOW = 'ci.yaml';

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
 * gh を実行し、JSON の出力を読む。
 *
 * @returns 成功したら { value: 読んだ値 }、失敗したら { error: 理由の要点 }
 */
function fetchJson(args) {
  let output;

  try {
    output = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return { error: failureReason(error) };
  }

  try {
    return { value: JSON.parse(output) };
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
 * 直近の CI（ci.yaml）の実行結果を、新しいものから RUN_LIMIT 件取り出す。
 *
 * @returns 成功したら { value: 実行結果の配列 }、失敗したら { error: 理由の要点 }
 */
function fetchRuns() {
  const result = fetchJson([
    'run',
    'list',
    '--workflow',
    CI_WORKFLOW,
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
 * \ は次の 1 文字と組で読まれるので、先に \\ にする（\| と書かれた値が \\| になり、| が区切りとして効くのを防ぐ）。
 * 題名やブランチ名は誰でも付けられるので、列をずらして別の値（失敗を「成功」など）に見せかけられないようにする。
 */
function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
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

/** ラベル配列から status: で始まるものを取り出す。 */
function statusOf(labels) {
  const status = (labels ?? []).map((label) => label.name).find((name) => name.startsWith('status:'));

  return status ?? '-';
}

/**
 * 取得した一覧から Markdown を作る。
 *
 * @param issues - open な Issue の取得結果（{ value: { totalCount, nodes } } か { error }）
 * @param pullRequests - open な PR の取得結果（{ value: { totalCount, nodes } } か { error }）
 * @param runs - 直近の CI の取得結果（{ value: 配列 } か { error }）
 */
function buildReport(issues, pullRequests, runs) {
  const lines = [`${new Date().toISOString().slice(0, 10)} 時点の、open な Issue と PR、直近の CI の一覧です。`, ''];

  lines.push('## 進行中と次の一手（open な Issue）', '');

  if ('error' in issues) {
    lines.push(...unavailableLines(issues.error));
  } else if (issues.value.nodes.length === 0) {
    lines.push('open な Issue はありません。', '');
  } else {
    lines.push(...truncationNote(issues.value, 'Issue'));
    lines.push('| Issue | 題名 | 状態 | 更新 |', '|:--|:--|:--|:--|');

    for (const issue of issues.value.nodes) {
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

  lines.push(`## 直近の CI（${CI_WORKFLOW}）`, '');

  if ('error' in runs) {
    lines.push(...unavailableLines(runs.error));
  } else if (runs.value.length === 0) {
    lines.push('実行結果がありません。', '');
  } else {
    lines.push('| 実行 | 結果 | ブランチ | 日時 |', '|:--|:--|:--|:--|');

    for (const run of runs.value) {
      const result = run.conclusion === 'success' ? '成功' : escapeCell(run.conclusion || run.status);

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

/** 3 つの一覧を取得する。別のリポジトリの作業ツリーの中では gh を呼ばずに、すべて取得できなかったものとする。 */
function collect() {
  const toplevel = gitToplevel();

  if (toplevel !== null && relative(toplevel, repositoryRoot) !== '') {
    const skipped = { error: 'このフォルダが別のリポジトリの作業ツリーの中にあるため、gh を呼んでいません' };

    return { issues: skipped, pullRequests: skipped, runs: skipped };
  }

  return {
    issues: fetchOpen('issues', 'number title updatedAt labels(first: 100) { nodes { name } }', ISSUE_LIMIT),
    pullRequests: fetchOpen('pullRequests', 'number title isDraft updatedAt', PULL_REQUEST_LIMIT),
    runs: fetchRuns(),
  };
}

const { issues, pullRequests, runs } = collect();

for (const [label, result] of [
  ['Issue', issues],
  ['PR', pullRequests],
  ['直近の CI', runs],
]) {
  if ('error' in result) {
    console.error(`${label} の一覧を取得できませんでした（${result.error}）。`);
  }
}

process.stdout.write(buildReport(issues, pullRequests, runs));
