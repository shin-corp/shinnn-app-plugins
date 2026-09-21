/**
 * SessionStart hook。セッションの最初に「今どこにいるか」を出す。
 * exit 0 の標準出力は Claude のコンテキストに追加されるため、Issue と PR の状況をそのまま渡す。
 * gh が無い環境（GitHub を使わない顧客）では docs/progress.md にフォールバックする。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromRoot, hasCommand, isAppRepo, projectDir, readHookInput, run } from './lib/hook-io.mjs';

const MAX_LINES = 10;

function section(title, body) {
  const text = body.trim();
  return text ? `## ${title}\n${text}` : `## ${title}\n（なし）`;
}

function ghLines(args, root) {
  const result = run('gh', args, { cwd: root, timeout: 20_000 });
  if (result.failedToStart || result.status !== 0) {
    return '';
  }
  return result.stdout.split('\n').filter(Boolean).slice(0, MAX_LINES).join('\n');
}

/** ファイルの中身を 1 行として読む。無ければ null。 */
function readVersion(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * セットアップの節。setupCompletedAt が空なら、まだ /shinnn-app:setup を終えていないものとして案内する。
 *
 * @param setupPath - .shinnn/setup.json の絶対パス
 * @param installed - リポジトリに入っている標準のバージョン
 */
function setupSection(setupPath, installed) {
  let setup;
  try {
    setup = JSON.parse(readFileSync(setupPath, 'utf8'));
  } catch {
    return section('セットアップ', '.shinnn/setup.json を読めませんでした。/shinnn-app:setup を再実行してください。');
  }

  const completedAt = setup.setupCompletedAt ?? null;
  if (completedAt === null) {
    return [
      '## セットアップが未完了',
      '.shinnn/setup.json の setupCompletedAt がまだ空です。',
      '最初に `/shinnn-app:setup` を実行して、テンプレートの選択・環境の確認・必要な機能の決定を済ませてください。',
    ].join('\n');
  }

  const profile = setup.profile ?? '不明';
  const mergePolicy = setup.mergePolicy ?? 'human';
  const standards = installed ?? setup.standardsVersion ?? '不明';
  return section(
    'セットアップ',
    `プロファイル: ${profile} / マージ方針: ${mergePolicy} / 標準バージョン: ${standards}`,
  );
}

const input = await readHookInput();

// テンプレートから作ったアプリのリポジトリでだけ動く
const root = projectDir(input);
if (!isAppRepo(root)) {
  process.exit(0);
}

const out = [];

const distributed = readVersion(
  fileURLToPath(new URL('../template/.claude/rules/.standards-version', import.meta.url)),
);
const installed = readVersion(fromRoot(root, '.claude', 'rules', '.standards-version'));

out.push(setupSection(fromRoot(root, '.shinnn', 'setup.json'), installed));

if (distributed !== null && installed !== distributed) {
  out.push(
    section(
      '標準の更新があります',
      [
        `リポジトリの標準: ${installed ?? '不明'} / 配布されている標準: ${distributed}`,
        '`/shinnn-app:sync-standards` を実行すると、規約の差分を取り込んで PR にします。',
      ].join('\n'),
    ),
  );
}

if (hasCommand('gh')) {
  out.push(section('次に着手する Issue（status:next）', ghLines(['issue', 'list', '--state', 'open', '--label', 'status:next', '--limit', String(MAX_LINES), '--json', 'number,title', '--template', '{{range .}}#{{.number}} {{.title}}\n{{end}}'], root)));
  out.push(section('open な PR', ghLines(['pr', 'list', '--state', 'open', '--limit', String(MAX_LINES), '--json', 'number,title,isDraft', '--template', '{{range .}}#{{.number}} {{.title}}{{if .isDraft}}（draft）{{end}}\n{{end}}'], root)));
  out.push(section('直近の CI', ghLines(['run', 'list', '--limit', '3', '--json', 'conclusion,displayTitle,workflowName', '--template', '{{range .}}{{.workflowName}}: {{.conclusion}} / {{.displayTitle}}\n{{end}}'], root)));
} else {
  const progress = fromRoot(root, 'docs', 'progress.md');
  const body = existsSync(progress) ? readFileSync(progress, 'utf8').split('\n').slice(0, 40).join('\n') : '';
  out.push(section('進捗（gh が無いため docs/progress.md を表示）', body));
}

console.log(['# shinnn-app セッション開始時の状況', ...out].join('\n\n'));
process.exit(0);
