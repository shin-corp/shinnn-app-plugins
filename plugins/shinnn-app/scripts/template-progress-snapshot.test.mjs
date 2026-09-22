/**
 * テンプレートの scripts/progress-snapshot.mjs と、テンプレートのワークフローの回帰テスト。`node --test scripts/` で実行する。
 *
 * テンプレートは顧客に配るものなので、テストはテンプレートに入れずにここに置く。
 * スクリプトは一時フォルダにコピーし、呼ぶ gh を偽物（template-progress-snapshot.fake-gh.mjs）に差し替えて実行する。
 * 偽物の gh は、渡した GitHub の状態から本物と同じ形の出力を返す。スクリプトが標準出力に出した Markdown を確かめる。
 * - ファイルには書かない
 * - 一覧を取得できなかった欄は、0 件（「ありません」）と書かずに、取得できなかったことと理由を書き、ほかの欄は続けて載せる
 * - 別のリポジトリの作業ツリーの中では gh を呼ばない（親のリポジトリの一覧を拾わない）
 * - 直近の CI は ci.yaml の実行だけを載せる
 * - 一覧を載せきれないときは総件数を添え、更新の古いもの（滞っているもの）を残す
 * - 題名などに | を含んでも、表の列がずれない
 * ワークフローは YAML の文字列を行で読み、権限・手順の並び・資格情報の扱いを確かめる。
 * プラグインの CI は依存を入れずに動くので yaml パッケージは使わない。テンプレートで npm ci をした手元では、
 * YAML として読めることと、行で読んだ権限が YAML として読んだものと同じことも確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 同梱のテンプレート */
const templateDir = fileURLToPath(new URL('../template', import.meta.url));

/** 確かめるスクリプト */
const snapshotScript = join(templateDir, 'scripts', 'progress-snapshot.mjs');

/** gh を偽物に差し替える下準備 */
const fakeGh = pathToFileURL(fileURLToPath(new URL('./template-progress-snapshot.fake-gh.mjs', import.meta.url))).href;

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'progress-snapshot-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/**
 * スクリプトを一時フォルダにコピーし、偽物の gh に state を答えさせて実行する。
 *
 * @param nested - true なら、コピー先が別のリポジトリの作業ツリーの中にあるものとして git に答えさせる
 * @returns 終了コード・出力と、コピー先のフォルダ
 */
function runSnapshot(state, { nested = false } = {}) {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  mkdirSync(join(root, 'scripts'));
  const script = join(root, 'scripts', 'progress-snapshot.mjs');
  copyFileSync(snapshotScript, script);
  // コピー先に何も書かれないことを確かめるので、状態のファイルはコピー先の外に置く
  const statePath = join(workRoot, `${basename(root)}.json`);
  writeFileSync(statePath, JSON.stringify(state));
  const result = spawnSync(process.execPath, ['--import', fakeGh, script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FAKE_GH_STATE: statePath, FAKE_GIT_TOPLEVEL: nested ? dirname(root) : root },
  });
  return { status: result.status, report: result.stdout, stderr: result.stderr, root };
}

/** `## ` で始まる見出しの節の本文（次の見出しの手前まで） */
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  assert.notEqual(start, -1, `見出し「${heading}」がありません:\n${markdown}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** 節の中の表の行（見出し行と区切り行を除く） */
function tableRows(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2);
}

/** 表の行のセル。\ の付いていない | で区切る（GitHub の Markdown と同じ読み方） */
function cells(row) {
  return row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** 2026-01-01 から n 日後の日時 */
function day(n) {
  return new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
}

/** 取得に成功する、各一覧 1 件ずつの状態 */
function baseState() {
  return {
    issues: [{ number: 1, title: '一覧画面', createdAt: day(0), updatedAt: day(1), labels: ['status:doing'] }],
    pullRequests: [{ number: 2, title: '一覧画面の追加', isDraft: false, createdAt: day(1), updatedAt: day(2) }],
    runs: [
      {
        workflow: 'ci.yaml',
        displayTitle: '一覧画面の追加',
        workflowName: 'CI',
        conclusion: 'success',
        status: 'completed',
        headBranch: 'feature/list',
        createdAt: day(2),
      },
    ],
  };
}

/** 取得できなかった欄に書く文。理由を括弧に入れて 1 行で書く */
const UNAVAILABLE = /^取得できませんでした（.+）。$/m;

test('Markdown を標準出力に出し、ファイルには書かない', () => {
  const result = runSnapshot(baseState());

  assert.equal(result.status, 0, result.stderr);
  assert.equal(tableRows(section(result.report, '進行中と次の一手')).length, 1);
  assert.deepEqual(readdirSync(result.root), ['scripts']);
  assert.deepEqual(readdirSync(join(result.root, 'scripts')), ['progress-snapshot.mjs']);
});

test('Issue の一覧を取得できなかったときも、その欄に取得できなかったことと理由を書き、PR と CI は続けて載せる', () => {
  const result = runSnapshot({ ...baseState(), errors: { issues: 'HTTP 502: Bad Gateway' } });

  assert.equal(result.status, 0, result.stderr);
  const issues = section(result.report, '進行中と次の一手');
  assert.match(issues, UNAVAILABLE);
  assert.match(issues, /HTTP 502: Bad Gateway/);
  assert.equal(tableRows(section(result.report, 'レビュー待ち')).length, 1);
  assert.equal(tableRows(section(result.report, '直近の CI')).length, 1);
  assert.doesNotMatch(result.report, /埋めてください|手動モード/);
});

test('gh が無いときは、どの欄にも gh が見つからないため取得できなかったと書く', () => {
  const result = runSnapshot({ ...baseState(), missing: true });

  assert.equal(result.status, 0, result.stderr);
  for (const heading of ['進行中と次の一手', 'レビュー待ち', '直近の CI']) {
    const text = section(result.report, heading);
    assert.match(text, UNAVAILABLE, heading);
    assert.match(text, /gh コマンドが見つかりません/, heading);
  }
  assert.doesNotMatch(result.report, /埋めてください|手動モード/);
});

test('別のリポジトリの作業ツリーの中では gh の一覧を載せず、どの欄にも取得できなかったと書く', () => {
  const result = runSnapshot(baseState(), { nested: true });

  assert.equal(result.status, 0, result.stderr);
  for (const heading of ['進行中と次の一手', 'レビュー待ち', '直近の CI']) {
    const text = section(result.report, heading);
    assert.match(text, UNAVAILABLE, heading);
    assert.match(text, /別のリポジトリ/, heading);
    assert.equal(tableRows(text).length, 0, heading);
  }
});

test('直近の CI には ci.yaml の実行だけを載せ、ほかのワークフローの実行は載せない', () => {
  const state = baseState();
  state.runs.unshift({
    workflow: 'dependabot-issue.yaml',
    displayTitle: '依存の更新',
    workflowName: 'Dependabot の PR に Issue を対応づける',
    conclusion: 'success',
    status: 'completed',
    headBranch: 'dependabot/npm_and_yarn/example-1.0.0',
    createdAt: day(3),
  });

  const result = runSnapshot(state);

  assert.equal(result.status, 0, result.stderr);
  const rows = tableRows(section(result.report, '直近の CI')).map(cells);
  // ブランチの列で見分ける。ci.yaml の実行（feature/list）だけが載る
  const branches = rows.map((row) => row[2]);
  assert.deepEqual(branches, ['feature/list']);
});

test('実行中の CI は、結果がまだ空なので状態を載せる', () => {
  const state = baseState();
  state.runs[0].conclusion = '';
  state.runs[0].status = 'in_progress';

  const result = runSnapshot(state);

  assert.equal(result.status, 0, result.stderr);
  const rows = tableRows(section(result.report, '直近の CI')).map(cells);
  assert.equal(rows[0][1], 'in_progress');
});

test('PR と CI の一覧を取得できなかったときは、0 件とは書かずに取得できなかったことと理由を書く', () => {
  const result = runSnapshot({
    ...baseState(),
    errors: {
      pullRequests: 'gh: Resource not accessible by integration',
      runs: 'failed to get runs: HTTP 403: Resource not accessible by integration (https://api.github.com/repos/o/r/actions/runs?per_page=5)',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const pullRequests = section(result.report, 'レビュー待ち');
  assert.doesNotMatch(pullRequests, /ありません/);
  assert.match(pullRequests, /取得できませんでした（.*Resource not accessible by integration.*）/);
  const runs = section(result.report, '直近の CI');
  assert.doesNotMatch(runs, /ありません/);
  assert.match(runs, /取得できませんでした（.*HTTP 403: Resource not accessible by integration.*）/);
  // 取得できた Issue の欄はそのまま載る
  assert.equal(tableRows(section(result.report, '進行中と次の一手')).length, 1);
});

test('PR と CI が 0 件のときは「ありません」と書き、取得できなかったとは書かない', () => {
  const result = runSnapshot({ ...baseState(), pullRequests: [], runs: [] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(section(result.report, 'レビュー待ち'), /open な PR はありません。/);
  assert.match(section(result.report, '直近の CI'), /実行結果がありません。/);
  assert.doesNotMatch(result.report, /取得できませんでした/);
});

test('Issue と PR を載せきれないときは総件数を添え、更新の古いものから載せる', () => {
  // 番号の小さいものほど古く作られている。#1〜#10（PR は #101〜#105）は作られてから更新が無く、滞っている。
  // 残りは作られた順と逆に、最近のものほど前に更新されている（作成順と更新順が食い違うようにする）。
  const item = (number, index, count, stale) => ({
    number,
    title: `題名 ${number}`,
    createdAt: day(index),
    updatedAt: stale ? day(index) : day(200 + count - index),
  });
  const issues = Array.from({ length: 60 }, (_, i) => ({ ...item(i + 1, i, 60, i < 10), labels: ['status:next'] }));
  const pullRequests = Array.from({ length: 25 }, (_, i) => ({ ...item(i + 101, i, 25, i < 5), isDraft: false }));

  const result = runSnapshot({ ...baseState(), issues, pullRequests });

  assert.equal(result.status, 0, result.stderr);
  for (const [heading, total, limit, stale] of [
    ['進行中と次の一手', 60, 50, issues.slice(0, 10)],
    ['レビュー待ち', 25, 20, pullRequests.slice(0, 5)],
  ]) {
    const text = section(result.report, heading);
    assert.match(text, new RegExp(`${total} 件中 ${limit} 件を表示`), `${heading}: 件数の注記がありません`);
    const rows = tableRows(text).map(cells);
    assert.equal(rows.length, limit, heading);
    const numbers = rows.map((row) => row[0]);
    for (const { number } of stale) {
      assert.ok(numbers.includes(`#${number}`), `${heading}: 滞っている #${number} が載っていません`);
    }
    const dates = rows.map((row) => row[3]);
    assert.deepEqual(dates, [...dates].sort(), `${heading}: 更新の古い順に並んでいません`);
  }
});

test('Issue と PR が上限ちょうどのときは、件数の注記を出さない', () => {
  const issues = Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    title: `題名 ${i + 1}`,
    createdAt: day(i),
    updatedAt: day(i),
    labels: [],
  }));
  const pullRequests = Array.from({ length: 20 }, (_, i) => ({
    number: i + 101,
    title: `題名 ${i + 101}`,
    isDraft: true,
    createdAt: day(i),
    updatedAt: day(i),
  }));

  const result = runSnapshot({ ...baseState(), issues, pullRequests });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(tableRows(section(result.report, '進行中と次の一手')).length, 50);
  assert.equal(tableRows(section(result.report, 'レビュー待ち')).length, 20);
  assert.doesNotMatch(result.report, /件中/);
});

test('題名・ラベル・ブランチ名に | や改行を含んでも、表の列がずれない', () => {
  const state = baseState();
  state.issues[0].title = 'A | B';
  state.issues[0].labels = ['status:a|b'];
  state.pullRequests[0].title = 'C|D';
  state.runs[0].displayTitle = 'E | F\r\n2 行目';
  state.runs[0].headBranch = 'feature/x|y';
  state.runs[0].conclusion = 'fail|ure';

  const result = runSnapshot(state);

  assert.equal(result.status, 0, result.stderr);
  const issueRow = tableRows(section(result.report, '進行中と次の一手'));
  assert.deepEqual(issueRow.map(cells), [['#1', 'A \\| B', 'status:a\\|b', day(1).slice(0, 10)]]);
  const pullRequestRow = tableRows(section(result.report, 'レビュー待ち'));
  assert.deepEqual(pullRequestRow.map(cells), [['#2', 'C\\|D', 'いいえ', day(2).slice(0, 10)]]);
  const runRow = tableRows(section(result.report, '直近の CI'));
  assert.deepEqual(runRow.map(cells), [['E \\| F 2 行目', 'fail\\|ure', 'feature/x\\|y', day(2).slice(0, 10)]]);
});

/** ワークフローのファイル */
function workflow(name) {
  return readFileSync(join(templateDir, '.github', 'workflows', name), 'utf8');
}

/** トップレベルのキーの下の `  キー: 値` を読む（permissions 用） */
function mapping(text, key) {
  const lines = text.split('\n');
  const start = lines.indexOf(`${key}:`);
  assert.notEqual(start, -1, `${key}: がありません`);
  const result = {};
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !line.startsWith(' ')) {
      break;
    }
    const match = /^ {2}([\w-]+):\s*(\S+)/.exec(line);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

/** job の steps を 1 つずつの文字列に分ける（job が 1 つのワークフロー用）。手順の前に書いたコメントは含めない */
function steps(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  assert.notEqual(start, -1, 'steps: がありません');
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}#/.test(line)) {
      continue;
    }
    if (line.startsWith('      - ')) {
      result.push(line);
    } else if (result.length > 0 && (line === '' || line.startsWith('        '))) {
      result[result.length - 1] += `\n${line}`;
    } else if (line !== '' && !line.startsWith('      ')) {
      break;
    }
  }
  return result;
}

/** コメントを除いた、gh を呼ぶ手順が GH_TOKEN を渡していること */
function assertGhStepsHaveToken(stepList) {
  const ghSteps = stepList.filter((step) => /(^|\s)gh\s|progress-snapshot\.mjs/m.test(step.replace(/#.*$/gm, '')));
  assert.ok(ghSteps.length > 0, 'gh を呼ぶ手順がありません');
  for (const step of ghSteps) {
    assert.match(step, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, `GH_TOKEN を渡していません:\n${step}`);
  }
}

test('月次の健全性レポート: スクリプトが PR と CI の実行結果を読む権限を持ち、ほかの権限は持たない', () => {
  assert.deepEqual(mapping(workflow('health-report.yaml.disabled'), 'permissions'), {
    contents: 'read',
    issues: 'write',
    'pull-requests': 'read',
    actions: 'read',
  });
});

test('月次の健全性レポート: 依存を入れず、checkout の資格情報を残さず、gh には GH_TOKEN で認証させる', () => {
  const text = workflow('health-report.yaml.disabled');

  assert.doesNotMatch(text, /npm (ci|install)/);
  assert.doesNotMatch(text, /cache: npm/);
  const stepList = steps(text);
  assert.match(
    stepList.find((step) => step.includes('actions/checkout@')),
    /persist-credentials: false/,
  );
  assertGhStepsHaveToken(stepList);
});

test('月次の健全性レポート: Issue を作る前に report ラベルを用意する', () => {
  const stepList = steps(workflow('health-report.yaml.disabled'));
  const labelIndex = stepList.findIndex((step) => step.includes('gh label create'));
  const issueIndex = stepList.findIndex((step) => step.includes('gh issue create'));

  assert.notEqual(labelIndex, -1, 'ラベルを用意する手順がありません');
  assert.ok(labelIndex < issueIndex, 'ラベルを用意する手順が Issue の作成より後にあります');
  assert.match(stepList[labelIndex], /ensure_label 'report' /);
  assert.match(stepList[issueIndex], /--label 'report'/);
});

test('月次の健全性レポート: スクリプトの標準出力をそのまま Issue の本文に使い、リポジトリのファイルを読まない', () => {
  const text = workflow('health-report.yaml.disabled');
  const stepList = steps(text);
  const snapshot = stepList.find((step) => step.includes('progress-snapshot.mjs')) ?? '';
  const output = /node scripts\/progress-snapshot\.mjs > (\S+)$/m.exec(snapshot);

  assert.ok(output, `スクリプトの標準出力をファイルに受けていません:\n${snapshot}`);
  const post = stepList.find((step) => step.includes('gh issue create')) ?? '';
  assert.ok(post.includes(`cat ${output[1]}`), `スクリプトの出力を Issue の本文に使っていません:\n${post}`);
  assert.doesNotMatch(text, /docs\//);
});

/** テンプレートに同梱するワークフローのファイル名（無効にしてあるものも含む） */
function workflowNames() {
  return readdirSync(join(templateDir, '.github', 'workflows')).filter((name) => /\.ya?ml(\.disabled)?$/.test(name));
}

test('どのワークフローも、リポジトリの内容を書き換える権限を持たず、push しない（ブランチ保護と両立させる）', () => {
  const names = workflowNames();

  assert.ok(names.includes('ci.yaml'), names.join(', '));
  for (const name of names) {
    const text = workflow(name).replace(/#.*$/gm, '');
    assert.doesNotMatch(text, /contents:\s*write|write-all/, name);
    assert.doesNotMatch(text, /\bgit push\b/, name);
  }
});

test('ワークフローが YAML として読める（テンプレートの依存を入れた手元だけで確かめる）', async (t) => {
  const yamlEntry = join(templateDir, 'node_modules', 'yaml', 'dist', 'index.js');
  if (!existsSync(yamlEntry)) {
    t.skip('テンプレートで npm ci をしていないため、yaml パッケージがありません');
    return;
  }
  const { parse } = await import(pathToFileURL(yamlEntry).href);
  for (const name of workflowNames()) {
    const text = workflow(name);
    const parsed = parse(text);
    assert.equal(typeof parsed.name, 'string', name);
    // 行で読んだ権限が、YAML として読んだものと同じであること（ほかのテストの読み方の確かめ）
    assert.deepEqual(parsed.permissions, mapping(text, 'permissions'), name);
  }
});
