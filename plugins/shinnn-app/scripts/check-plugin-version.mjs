#!/usr/bin/env node
/**
 * プラグインとルール（標準）の版が最新かを確かめる。`/shinnn-app:feature` が最初に実行する。
 *
 * 使い方:
 *   node <プラグイン>/scripts/check-plugin-version.mjs [--repository <URL>] [--root <アプリのフォルダ>]
 *
 * - プラグイン: 読み込み中の版（このスクリプトと同じプラグインの `.claude-plugin/plugin.json`）と、
 *   公開リポジトリの `v<版>` のタグのうち最も新しいものを比べる。タグは `git ls-remote` で取る
 *   （公開リポジトリなので認証は要らない）。確かめる先は `plugin.json` の `repository`
 * - ルール: アプリの `.claude/rules/.standards-version` と、プラグインに同梱したテンプレートの同じファイルを比べる
 * - 古いプラグインを新しくするコマンドも出す。`.claude/settings.json` でプラグインを有効にしていれば
 *   `--scope project`、そうでなければ（あとから参加した人の入れ方）`--scope local`
 *
 * 確かめられないとき（オフラインなど）は理由を出して終わる。作業を止めないので、終了コードは常に 0。
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, run } from './lib/hook-io.mjs';

/** 配布元（marketplace）の名前と、プラグインの ID */
const MARKETPLACE = 'shinnn';
const PLUGIN_ID = `shinnn-app@${MARKETPLACE}`;

/** git ls-remote を待つ時間（ミリ秒）。越えたら「確かめられない」として先へ進む */
const LS_REMOTE_TIMEOUT = 10_000;

/** プラグインのフォルダ（このスクリプトの 1 つ上） */
const pluginRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * `x.y.z` を数の組にする。形が違えば null。
 *
 * @param version - 版の文字列
 * @returns [x, y, z] または null
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * 2 つの版を比べる。
 *
 * @returns a が新しければ正、同じなら 0、b が新しければ負
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

/**
 * `git ls-remote --tags --refs` の出力から、`v<版>` のタグのうち最も新しい版を取り出す。
 *
 * @param output - git ls-remote の標準出力
 * @returns 最も新しい版（先頭の v を除く）。タグが無ければ null
 */
export function latestTagVersion(output) {
  let latest = null;
  for (const line of output.split(/\r?\n/)) {
    const match = /refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const version = match[1];
    if (latest === null || compareVersions(version, latest) > 0) {
      latest = version;
    }
  }
  return latest;
}

/**
 * プラグインを新しくするときのスコープ。`.claude/settings.json` で有効にしていれば project、そうでなければ local。
 *
 * @param root - アプリのフォルダ
 */
export function installScope(root) {
  const settings = readJson(join(root, '.claude', 'settings.json'));
  const enabledInProject = settings?.enabledPlugins?.[PLUGIN_ID] === true;
  return enabledInProject ? 'project' : 'local';
}

/** 1 行の版のファイルを読む。無ければ null */
function readVersionFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, 'utf8').trim();
  return text === '' ? null : text;
}

/**
 * プラグインの版を確かめた結果の行。
 *
 * @param loaded - 読み込み中の版
 * @param repository - タグを取る公開リポジトリの URL
 * @param root - アプリのフォルダ
 */
function pluginLines(loaded, repository, root) {
  if (loaded === null || repository === null) {
    return ['プラグイン: 確かめられない（plugin.json の version か repository を読めない）'];
  }

  const result = run('git', ['ls-remote', '--tags', '--refs', repository], {
    stdio: 'pipe',
    timeout: LS_REMOTE_TIMEOUT,
  });
  if (result.failedToStart || result.status !== 0) {
    return [`プラグイン: 確かめられない（${repository} のタグを取れない。オフラインか、git が無い）`];
  }

  const latest = latestTagVersion(result.stdout);
  if (latest === null) {
    return [`プラグイン: 確かめられない（${repository} に v<版> のタグが無い）`];
  }
  if (compareVersions(loaded, latest) >= 0) {
    return [`プラグイン: 最新（${loaded}）`];
  }

  const scope = installScope(root);
  return [
    `プラグイン: 古い（読み込み中 ${loaded} / 最新 ${latest}）`,
    `更新: claude plugin marketplace update ${MARKETPLACE}`,
    `更新: claude plugin update ${PLUGIN_ID} --scope ${scope}`,
  ];
}

/**
 * ルール（標準）の版を確かめた結果の行。
 *
 * @param root - アプリのフォルダ
 */
function rulesLines(root) {
  const installed = readVersionFile(join(root, '.claude', 'rules', '.standards-version'));
  const distributed = readVersionFile(join(pluginRoot, 'template', '.claude', 'rules', '.standards-version'));
  if (installed === null || distributed === null) {
    return ['ルール: 確かめられない（.standards-version が無い）'];
  }
  if (parseVersion(installed) === null || parseVersion(distributed) === null) {
    return [`ルール: 確かめられない（版の形が違う: ${installed} / ${distributed}）`];
  }
  if (compareVersions(installed, distributed) >= 0) {
    return [`ルール: 最新（${installed}）`];
  }
  return [`ルール: 古い（アプリ ${installed} / 配布 ${distributed}）。/shinnn-app:update-rules で取り込む`];
}

/** `--name value` の形の引数を読む */
function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }
  return args[index + 1];
}

/** このファイルを直接実行したか（`import` されただけなら false） */
const isDirectRun = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const manifest = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'));
  const loaded = typeof manifest?.version === 'string' && parseVersion(manifest.version) !== null ? manifest.version : null;
  const repository = readOption(args, '--repository') ?? manifest?.repository ?? null;
  const root = readOption(args, '--root') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  const lines = [...pluginLines(loaded, repository, root), ...rulesLines(root)];
  console.log(lines.join('\n'));
}
