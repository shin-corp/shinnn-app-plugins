/**
 * hook スクリプト共通のユーティリティ。
 * Claude Code の hook は標準入力に JSON を 1 件渡し、終了コードで結果を伝える。
 * 操作を止める hook は無いので、どれも exit 0 で終える。
 * Claude に伝えたいことは標準出力の JSON（hookOutput）に書く。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** 標準入力の JSON を読む。壊れていても hook 自体は落とさない（空オブジェクトを返す） */
export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** セッションを開始したリポジトリのルート。CLAUDE_PROJECT_DIR が無ければ hook 入力の cwd を使う */
export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/** setup の記録を書くファイル（リポジトリルート起点）。hooks が動く条件はこのファイルの有無だけ */
const SETUP_FILE = '.shinnn/setup.json';

/**
 * テンプレートから作ったアプリのリポジトリか。hooks はここでだけ動く。
 *
 * プラグインを user スコープで入れると hooks は開いたすべてのリポジトリで呼ばれるため、
 * 目印のファイル 1 つで判定し、それが無いリポジトリでは何もしない。
 */
export function isAppRepo(root) {
  return existsSync(join(root, SETUP_FILE));
}

/**
 * 渡したパスを含むアプリのリポジトリのルート。アプリのリポジトリの中でなければ null。
 *
 * 目印か `.git` のあるフォルダまで親をたどり、そこをリポジトリのルートとする。worktree（同じリポジトリを別のフォルダに
 * 取り出したもの。`.git` はフォルダではなくファイル）の中のパスなら、その worktree がルートになる。
 * CLAUDE_PROJECT_DIR はセッションを始めたフォルダのまま変わらないので、作業している場所の手がかりには使わない。
 */
export function appRootOf(path) {
  let dir = resolve(path);
  while (!existsSync(join(dir, SETUP_FILE)) && !existsSync(join(dir, '.git'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return isAppRepo(dir) ? dir : null;
}

/** 絶対パス・相対パスのどちらで来ても、リポジトリルート起点の POSIX 相対パスに正規化する */
export function toRepoPath(filePath, root) {
  if (!filePath) {
    return '';
  }
  const absolute = resolve(root, filePath);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..')) {
    return '';
  }
  return rel.split(sep).join('/');
}

/**
 * cmd.exe に渡す 1 引数を組み立てる。
 * 二重引用符で包んで対象プログラムの引数分割から守り、cmd 自身が解釈する記号を `^` で無効化する。
 * こうしないと、空白や `&` を含むファイル名がコマンドの区切りとして解釈される。
 */
function escapeForCmd(value, quote) {
  let escaped = value.replace(/(\\*)"/g, '$1$1\\"');
  if (quote) {
    escaped = `"${escaped.replace(/(\\*)$/, '$1$1')}"`;
  }
  return escaped.replace(/([()[\]{}%!^"`<>&|;, *?])/g, '^$1');
}

/**
 * 外部コマンドを同期実行する。
 *
 * シェルを介さない（引数は配列のまま渡るので、空白や記号を含むパスが分割・解釈されない）。
 * ただし Windows の npm などはバッチファイルで、Node はシェル無しでは起動できない（EINVAL）。
 * その場合だけ cmd.exe 経由に切り替え、引数は自前で引用してから渡す。
 */
export function run(command, args, options = {}) {
  const spawnOptions = { encoding: 'utf8', ...options };
  const result = spawnSync(command, args, spawnOptions);
  if (result.error?.code !== 'EINVAL' || process.platform !== 'win32') {
    return {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      failedToStart: result.error != null,
    };
  }

  const commandLine = [escapeForCmd(command, false), ...args.map((arg) => escapeForCmd(arg, true))].join(' ');
  const viaCmd = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
    ...spawnOptions,
    windowsVerbatimArguments: true,
  });
  return {
    status: viaCmd.status ?? 1,
    stdout: viaCmd.stdout || '',
    stderr: viaCmd.stderr || '',
    failedToStart: viaCmd.error != null,
  };
}

/** コマンドが使えるかどうか（`--version` が起動できるか）で判定する */
export function hasCommand(command) {
  return !run(command, ['--version'], { stdio: 'pipe' }).failedToStart;
}

/** JSON ファイルを読む。無ければ null */
export function readJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** リポジトリルートからの絶対パス */
export function fromRoot(root, ...parts) {
  return join(root, ...parts);
}

/**
 * 操作を止めない hook が標準出力に出す JSON を組み立てる。
 * additionalContext は Claude に渡り、systemMessage は transcript に 1 行出る。
 *
 * @param eventName - hook の種類（PostToolUse / Stop など）
 */
export function hookOutput(eventName, { additionalContext, systemMessage } = {}) {
  const hookSpecificOutput = { hookEventName: eventName };
  if (additionalContext !== undefined) {
    hookSpecificOutput.additionalContext = additionalContext;
  }

  const output = { hookSpecificOutput };
  if (systemMessage !== undefined) {
    output.systemMessage = systemMessage;
  }
  return JSON.stringify(output);
}
