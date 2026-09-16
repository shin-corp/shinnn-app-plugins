/**
 * PostToolUse（Edit / Write）フォーマッタ。
 * 触ったファイルが属するパッケージの eslint --fix を掛け、直せなかった error だけを Claude に返す。
 * これで「lint は最後にまとめて直す」を無くし、規約違反をその場で潰す。
 */
import { existsSync } from 'node:fs';
import { isTemplateRepo, readHookInput, projectDir, run, toRepoPath } from './lib/hook-io.mjs';

/** 対象拡張子。HTML と CSS は eslint の対象外なので触らない */
const LINTABLE = /\.(ts|tsx|mjs|cjs|js)$/;

/** リポジトリルート起点の相対パスから、eslint を動かすワークスペースを決める */
function workspaceOf(repoPath) {
  const top = repoPath.split('/')[0];
  return ['client', 'server', 'shared'].includes(top) ? top : null;
}

const input = await readHookInput();
if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool_name || '')) {
  process.exit(0);
}

// テンプレートから作ったリポジトリでだけ動く
const root = projectDir(input);
if (!isTemplateRepo(root)) {
  process.exit(0);
}

const repoPath = toRepoPath(input.tool_input?.file_path || '', root);
if (!repoPath || !LINTABLE.test(repoPath)) {
  process.exit(0);
}
if (!existsSync(`${root}/${repoPath}`)) {
  process.exit(0);
}

const workspace = workspaceOf(repoPath);
if (!workspace) {
  process.exit(0);
}

// npm exec -w <pkg> はパッケージのディレクトリで動くため、ファイルは絶対パスで渡す
const absolute = `${root}/${repoPath}`;
const result = run('npm', ['exec', '-w', workspace, '--', 'eslint', '--fix', '--format', 'stylish', absolute], {
  cwd: root,
  timeout: 90_000,
});

// eslint が起動しない（未導入・パッケージ名の変更など）場合は黙って通す。開発を止めない
if (result.failedToStart) {
  process.exit(0);
}
if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout}\n${result.stderr}`.trim();
console.error(
  [
    `[shinnn-app] ${repoPath} に eslint --fix を掛けましたが、自動で直せない指摘が残りました。`,
    'この場で直してください（後回しにすると pre-commit と CI で同じ指摘が出ます）。',
    '',
    output.slice(0, 4000),
  ].join('\n'),
);
process.exit(2);
