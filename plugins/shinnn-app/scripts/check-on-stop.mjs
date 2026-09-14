/**
 * Stop hook。応答を終える直前に、今回触ったファイルの lint と関連テストだけを走らせる。
 * フルの check（build + typecheck + 全テスト）は /shinnn-app:check と CI に任せ、ここは数十秒で終える範囲に留める。
 */
import { existsSync } from 'node:fs';
import { blockMessage, fromRoot, projectDir, readHookInput, run } from './lib/hook-io.mjs';

const LINTABLE = /\.(ts|tsx|mjs|cjs|js)$/;
const WORKSPACES = ['client', 'server', 'shared'];

/**
 * 未コミットの変更（追跡済み + 未追跡）を集める。
 *
 * `-z` の出力は `XY <パス>` を '\0' 区切りで並べたもの。ただしリネームとコピー（`R` / `C`）だけは
 * 旧パスがもう 1 レコード続き、そこには `XY ` が付かない。読み飛ばさないと旧パスの先頭 3 文字が
 * 削られた別のパスに化ける。削除されたパスは実体が無いので、渡す前に除く。
 */
function changedFiles(root) {
  const status = run('git', ['status', '--porcelain=v1', '-z'], { cwd: root });
  if (status.status !== 0) {
    return [];
  }
  const records = status.stdout.split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length <= 3) {
      continue;
    }
    const indicator = record.slice(0, 2);
    if (indicator.startsWith('R') || indicator.startsWith('C')) {
      // 次のレコードは旧パス。新しいパスだけを対象にする。
      index += 1;
    }
    if (indicator.includes('D')) {
      continue;
    }
    paths.push(record.slice(3));
  }
  return paths.filter((path) => LINTABLE.test(path) && existsSync(fromRoot(root, path)));
}

/**
 * ワークスペースごとのテストの走らせ方。
 *
 * server / shared は vitest を直接呼び、渡したファイルを import しているテストだけを選ぶ。
 * client は Angular のビルダー越しにしか動かない（vitest を直接呼ぶとテンプレートを解釈できない）ため、
 * 絞り込みができない。数秒で終わる規模なので、まとめて走らせる。
 *
 * @param workspace - client / server / shared
 * @param targets - 変更されたファイルの絶対パス
 * @returns npm exec -w <パッケージ> -- に続けて渡す引数
 */
function testArgs(workspace, targets) {
  if (workspace === 'client') {
    return ['run', 'test', '-w', workspace];
  }

  return ['exec', '-w', workspace, '--', 'vitest', 'related', '--run', '--passWithNoTests', ...targets];
}

const input = await readHookInput();

// 自分のブロックで再び Stop が起きる無限ループを避ける
if (input.stop_hook_active === true) {
  process.exit(0);
}

const root = projectDir(input);
const files = changedFiles(root);
if (files.length === 0) {
  process.exit(0);
}

const problems = [];

for (const workspace of WORKSPACES) {
  const targets = files.filter((path) => path.startsWith(`${workspace}/`)).map((path) => `${root}/${path}`);
  if (targets.length === 0) {
    continue;
  }

  const lint = run('npm', ['exec', '-w', workspace, '--', 'eslint', '--max-warnings', '0', ...targets], {
    cwd: root,
    timeout: 120_000,
  });
  if (!lint.failedToStart && lint.status !== 0) {
    problems.push(`[${workspace}] lint\n${`${lint.stdout}\n${lint.stderr}`.trim().slice(0, 2000)}`);
  }

  const test = run('npm', testArgs(workspace, targets), {
    cwd: root,
    timeout: 240_000,
  });
  if (!test.failedToStart && test.status !== 0) {
    problems.push(`[${workspace}] test\n${`${test.stdout}\n${test.stderr}`.trim().slice(0, 2000)}`);
  }
}

if (problems.length === 0) {
  process.exit(0);
}

console.error(
  [
    blockMessage({
      what: '変更したファイルの lint または関連テストが失敗しています',
      why: 'この状態でコミットすると pre-commit と CI が落ち、PR のレビューまで進めない',
      how: '下の指摘を直してから終える。原因が分からない場合は /shinnn-app:why で規約の意図を確認する',
      rule: '.claude/rules/testing.md',
    }),
    '',
    ...problems,
  ].join('\n'),
);
process.exit(2);
