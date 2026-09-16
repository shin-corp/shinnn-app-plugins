/**
 * hook スクリプト共通のユーティリティ。
 * Claude Code の hook は標準入力に JSON を 1 件渡し、終了コードで結果を伝える。
 * exit 0 = 通す / exit 2 = ブロック（stderr が Claude に渡る）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

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

/** テンプレートから作ったリポジトリの目印になるファイル（リポジトリルート起点） */
export const TEMPLATE_MARKER = '.claude/rules/.standards-version';

/**
 * テンプレート shinnn-app-starter から作ったリポジトリか。
 *
 * テンプレートから作ったリポジトリには必ず入っているファイル（TEMPLATE_MARKER）を目印にする。
 * hooks は規約がこのテンプレートの構成を前提にしているため、テンプレート以外のリポジトリ
 * （プラグインを user スコープで入れたときの他のリポジトリ）や、テンプレートを取得する前の空のフォルダでは何もしない。
 */
export function isTemplateRepo(root) {
  return existsSync(join(root, TEMPLATE_MARKER));
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
 * glob 風パターン（`**` と `*` のみ対応）に一致するか。
 * ライブラリを足さずに済ませるため、hook で必要な範囲だけを実装する。
 * 二重アスタリスクとスラッシュの並びは 0 階層以上のディレクトリ、単独のアスタリスクは 1 階層内の任意の文字列にあたる。
 */
const REGEXP_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '?']);

export function matchPath(pattern, repoPath) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char !== '*') {
      source += REGEXP_SPECIAL.has(char) ? '\\' + char : char;
      continue;
    }
    if (pattern[i + 1] !== '*') {
      source += '[^/]*';
      continue;
    }
    if (pattern[i + 2] === '/') {
      source += '(?:[^/]+/)*';
      i += 2;
    } else {
      source += '.*';
      i += 1;
    }
  }
  return new RegExp(`^${source}$`).test(repoPath);
}

/** どのパターンにも一致しないなら false */
export function matchesAny(patterns, repoPath) {
  return patterns.some((pattern) => matchPath(pattern, repoPath));
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
 * ブロック時のメッセージ。学習の仕組みとして「何を / なぜ / どう直す / 規約」の 4 点を必ず出す。
 */
export function blockMessage({ what, why, how, rule }) {
  const lines = [
    '[shinnn-app] 操作をブロックしました。',
    `何を: ${what}`,
    `なぜ: ${why}`,
    `どう直す: ${how}`,
  ];
  if (rule) {
    lines.push(`規約: ${rule}`);
  }
  return lines.join('\n');
}
