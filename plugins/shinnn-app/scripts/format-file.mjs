/**
 * PostToolUse（Edit / Write）フォーマッタ。
 * 触ったファイルが属するパッケージの eslint --fix を掛け、直せなかった error だけを Claude に返す。
 * 画面（client）の .ts には、続けて prettier も掛ける（コミット時の lint-staged と CI の確認と同じ対象）。
 * prettier を掛けるのは、リポジトリのコミット時の設定（.lintstagedrc.json）が client の .ts に prettier を掛けているときだけ。
 * 標準を取り込む前のリポジトリで、触ったファイル全体の書式の差分が機能の変更に混ざらないようにするため。
 * これで「lint は最後にまとめて直す」を無くし、規約違反をその場で潰す。
 *
 * PostToolUse は操作を止められない（編集はもう済んでいる）ので、残った指摘は JSON の additionalContext で渡す。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { appRootOf, hookOutput, readHookInput, projectDir, run, toRepoPath } from './lib/hook-io.mjs';

/** 対象拡張子。HTML と CSS は eslint の対象外なので触らない */
const LINTABLE = /\.(ts|tsx|mjs|cjs|js)$/;

/**
 * prettier で整える .ts。server と shared には掛けない（改行が増えて、かえって読みにくくなることがあるため）
 */
const PRETTIER_TARGET = /^client\/.+\.ts$/;

/** コミット時の設定（.lintstagedrc.json）が、client の .ts に prettier を掛けているか。読めなければ掛けていないとみなす */
function lintStagedFormatsClient(root) {
  try {
    const config = JSON.parse(readFileSync(`${root}/.lintstagedrc.json`, 'utf8'));
    const commands = [config['client/**/*.ts']].flat();
    return commands.some((command) => typeof command === 'string' && /\bprettier\b/.test(command));
  } catch {
    return false;
  }
}

/** リポジトリルート起点の相対パスから、eslint を動かすワークスペースを決める */
function workspaceOf(repoPath) {
  const top = repoPath.split('/')[0];
  return ['client', 'server', 'shared'].includes(top) ? top : null;
}

const input = await readHookInput();
if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool_name || '')) {
  process.exit(0);
}

const filePath = input.tool_input?.file_path || '';
if (!filePath) {
  process.exit(0);
}

// 編集したファイルを含む、テンプレートから作ったアプリのリポジトリでだけ動く。
// worktree の中のファイルなら、その worktree の依存と設定で lint する
const absoluteFile = resolve(input.cwd || projectDir(input), filePath);
const root = appRootOf(dirname(absoluteFile));
if (!root) {
  process.exit(0);
}

const repoPath = toRepoPath(absoluteFile, root);
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

// 依存をまだ入れていない（npm install の前の）リポジトリでは eslint が動かない。
// 起動できない場合と違って npm は失敗の終了コードを返すので、指摘があったと誤って伝えないよう先に抜ける
if (!existsSync(`${root}/node_modules`)) {
  process.exit(0);
}

// npm exec -w <pkg> はパッケージのディレクトリで動くため、ファイルは絶対パスで渡す
const absolute = `${root}/${repoPath}`;
const eslintArgs = ['exec', '-w', workspace, '--', 'eslint', '--format', 'stylish'];
// 上限の合計（50 + 20 + 40 秒）は、hooks.json の timeout（120 秒）に収める
let result = run('npm', [...eslintArgs, '--fix', absolute], { cwd: root, timeout: 50_000 });

// 画面の .ts は、eslint --fix の後に prettier で整える（コミット時の lint-staged と同じ順番）。
// 書けない（構文の誤りなど）ときは黙って通す。構文の誤りは eslint が指摘として返す
if (PRETTIER_TARGET.test(repoPath) && lintStagedFormatsClient(root)) {
  const before = readFileSync(absolute, 'utf8');
  run('npm', ['exec', '--', 'prettier', '--write', '--log-level', 'warn', absolute], { cwd: root, timeout: 20_000 });
  // 整形で行がずれたら、返す指摘の行番号を整形後のファイルに合わせるため、eslint を掛け直す（直さずに調べるだけ）
  if (!result.failedToStart && result.status !== 0 && readFileSync(absolute, 'utf8') !== before) {
    result = run('npm', [...eslintArgs, absolute], { cwd: root, timeout: 40_000 });
  }
}

// eslint が起動しない（未導入・パッケージ名の変更など）場合は黙って通す。開発を止めない
if (result.failedToStart) {
  process.exit(0);
}
if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout}\n${result.stderr}`.trim();
console.log(
  hookOutput('PostToolUse', {
    additionalContext: [
      `[shinnn-app] ${repoPath} に eslint --fix を掛けましたが、自動で直せない指摘が残りました。`,
      'この場で直してください（後回しにすると pre-commit と CI で同じ指摘が出ます）。',
      '',
      output.slice(0, 4000),
    ].join('\n'),
    systemMessage: `[shinnn-app] ${repoPath} に eslint の指摘が残っています`,
  }),
);
process.exit(0);
