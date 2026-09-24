/**
 * Stop hook。応答を終える直前に、今回触ったファイルの lint と関連テストだけを走らせる。
 * フルの check（build + typecheck + 全テスト）は /shinnn-app:check と CI に任せ、ここは数十秒で終える範囲に留める。
 *
 * 失敗したら JSON の additionalContext で Claude に伝える。受け取った Claude は応答を終えず、その場で直しに行く。
 * 続けた応答の終わり（入力の stop_hook_active が true）では検査しない。このため伝えるのは利用者の依頼 1 回につき 1 回で、
 * 次の依頼の終わりにまた検査する。
 * 一時的に黙らせたいときは、環境変数 SHINNN_SKIP_STOP_CHECK に値を入れる（何も出さずに終える）。
 */
import { existsSync } from 'node:fs';
import { appRootOf, fromRoot, hookOutput, projectDir, readHookInput, run } from './lib/hook-io.mjs';

const LINTABLE = /\.(ts|tsx|mjs|cjs|js)$/;

// 計測用（*.bench.test.ts）と一時的な確認用（*.tmp.test.ts）は、常に緑である前提が無い。
// これらの失敗を直すべき指摘として伝えると、本来の変更から注意が逸れるので lint と関連テストの対象から外す。
const EXCLUDED = /\.(bench|tmp)\.test\.ts$/;

const WORKSPACES = ['client', 'server', 'shared'];

/**
 * 未コミットの変更（追跡済み + 未追跡）を集める。
 *
 * `-z` の出力は `XY <パス>` を '\0' 区切りで並べたもの。ただしリネームとコピー（`R` / `C`）だけは
 * 旧パスがもう 1 レコード続き、そこには `XY ` が付かない。読み飛ばさないと旧パスの先頭 3 文字が
 * 削られた別のパスに化ける。削除されたパスは実体が無いので、渡す前に除く。
 *
 * git は既定で未追跡のフォルダを `?? server/src/api/<機能>/` の 1 行にまとめ、中のファイルが対象から漏れる。
 * `--untracked-files=all` で 1 件ずつ出させる。
 */
function changedFiles(root) {
  const status = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root });
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
  return paths.filter((path) => LINTABLE.test(path) && !EXCLUDED.test(path) && existsSync(fromRoot(root, path)));
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

// 明示的に飛ばす指定があれば何も出さない。
// 標準入力を読み切ってから判定する（読まずに終えると、hook に JSON を渡す側の書き込みが失敗する）
if (process.env.SHINNN_SKIP_STOP_CHECK) {
  process.exit(0);
}

// 指摘を受けて Claude が続けた応答の終わり（stop_hook_active が true）では検査しない。
// ここでもまた伝えると、すぐには直せない指摘（テストを先に書いて落としている最中など）で応答と指摘を繰り返す
if (input.stop_hook_active === true) {
  process.exit(0);
}

// 作業している場所を含む、テンプレートから作ったアプリのリポジトリでだけ動く。
// セッションの途中で worktree に入っていれば、その worktree の変更を検査する
const root = appRootOf(input.cwd || projectDir(input));
if (!root) {
  process.exit(0);
}

// 依存をまだ入れていない（npm install の前の）リポジトリでは lint もテストも動かない。
// npm は失敗の終了コードを返すので、指摘があったと誤って伝えないよう先に抜ける
if (!existsSync(fromRoot(root, 'node_modules'))) {
  process.exit(0);
}

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

// 受け取った Claude はその場で応答を続けて直しに行く。続けた応答の終わりの Stop は、上の stop_hook_active の判定で黙る
const summary = '変更したファイルの lint または関連テストが失敗しています';

console.log(
  hookOutput('Stop', {
    additionalContext: [
      `[shinnn-app] ${summary}。`,
      'なぜ: この状態でコミットすると pre-commit と CI が落ち、PR のレビューまで進めない',
      'どう直す: 下の指摘を直す。原因が分からない場合は /shinnn-app:why で規約の意図を確認する',
      '規約: .claude/rules/testing.md',
      '',
      ...problems,
    ].join('\n'),
    systemMessage: `[shinnn-app] ${summary}`,
  }),
);
process.exit(0);
