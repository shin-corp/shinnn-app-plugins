/**
 * SessionStart hook。セッションの最初に「今どこにいるか」を出す。
 * exit 0 の標準出力は Claude のコンテキストに追加されるため、Issue と PR の状況をそのまま渡す。
 * gh が無い環境（GitHub を使わない顧客）では docs/progress.md にフォールバックする。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromRoot, hasCommand, projectDir, readHookInput, run } from './lib/hook-io.mjs';

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

const input = await readHookInput();
const root = projectDir(input);
const out = [];

const distributed = readVersion(fileURLToPath(new URL('../standards/.standards-version', import.meta.url)));
const installed = readVersion(fromRoot(root, '.claude', 'rules', '.standards-version'));

const setupPath = fromRoot(root, '.shinnn', 'setup.json');
if (!existsSync(setupPath)) {
  out.push(
    [
      '## セットアップが未完了',
      'このリポジトリにはまだ .shinnn/setup.json がありません。',
      '最初に `/shinnn-app:setup` を実行して、テンプレートの選択・環境の確認・必要な機能の決定を済ませてください。',
    ].join('\n'),
  );
} else {
  try {
    const setup = JSON.parse(readFileSync(setupPath, 'utf8'));
    out.push(section('セットアップ', `プロファイル: ${setup.profile ?? '不明'} / マージ方針: ${setup.mergePolicy ?? 'human'} / 標準バージョン: ${installed ?? setup.standardsVersion ?? '不明'}`));
  } catch {
    out.push(section('セットアップ', '.shinnn/setup.json を読めませんでした。/shinnn-app:setup を再実行してください。'));
  }
}

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
