/**
 * protect-branch.test.mjs の下準備。protect-branch.mjs が lib/hook-io.mjs の run() を通して呼ぶ gh を偽物に差し替える。
 *
 * `node --import <このファイルの URL> protect-branch.mjs` で読み込むと、lib/hook-io.mjs が import する
 * node:child_process をこのファイルに差し替える。差し替えた spawnSync は次のように答える。
 * - gh: 環境変数 FAKE_GH_STATE が指す JSON（GitHub の状態）から、本物の gh と同じ形の結果を返す。
 *   呼ばれた引数と標準入力は、環境変数 FAKE_GH_LOG が指すファイルに 1 行 1 件の JSON で書き足す
 * - それ以外: 本物の child_process に渡す
 *
 * PATH に偽の gh を置く方法を使わないのは、Windows の spawnSync が拡張子 .exe / .com のファイルしか探さず、
 * スクリプトで作った偽物（gh.cmd など）を見つけないため。
 *
 * FAKE_GH_STATE の形:
 *   missing:    true なら gh が無い（起動できない）
 *   loggedIn:   false なら、本物と同じくログインを求めて終了コード 4 で終わる
 *   repo:       { nameWithOwner, viewerPermission }。null なら remote が無いときと同じく失敗する
 *   protection: 従来の方式の保護の GET の応答。{ status: 200, body } か { status: 404 / 403 など, message }。
 *               既定は 404（Branch not protected）
 *   rules:      ルールセットのルールの GET（repos/{o}/{r}/rules/branches/{b}）の応答。{ status: 200, body: [ルール] } か
 *               { status: 403 など, message }。既定は空の配列（ルールが無い）
 *   put:        PUT の応答。{ status: 200 } か { status: 403 / 422 など, message }
 */
import * as childProcess from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

export * from 'node:child_process';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process' && context.parentURL?.endsWith('/scripts/lib/hook-io.mjs')) {
      return { url: import.meta.url, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/** spawnSync の結果の形 */
function result(status, stdout = '', stderr = '') {
  return { pid: 0, output: [null, stdout, stderr], stdout, stderr, status, signal: null };
}

/** 本物の gh api が HTTP のエラーで終わるときの結果。応答の本文を標準出力に、要約を標準エラーに出す */
function httpError(status, message) {
  const body = JSON.stringify({
    message,
    documentation_url: 'https://docs.github.com/rest/branches/branch-protection',
    status: String(status),
  });
  return result(1, body, `gh: ${message} (HTTP ${status})\n`);
}

/** 応答の定義（{ status, body } か { status, message }）を結果にする */
function respond(response) {
  if (response.status === 200) {
    return result(0, JSON.stringify(response.body ?? {}));
  }
  return httpError(response.status, response.message);
}

/** gh の引数に答える */
function fakeGh(state, args) {
  if (args[0] === '--version') {
    return result(0, 'gh version 0.0.0 (fake)\n');
  }
  if (state.loggedIn === false) {
    return result(
      4,
      '',
      'To get started with GitHub CLI, please run:  gh auth login\n' +
        'Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n',
    );
  }
  if (args[0] === 'repo' && args[1] === 'view') {
    if (state.repo === null) {
      return result(1, '', 'no git remotes found\n');
    }
    return result(0, JSON.stringify(state.repo ?? { nameWithOwner: 'owner/app', viewerPermission: 'ADMIN' }));
  }
  if (args[0] === 'api') {
    const methodIndex = args.findIndex((arg) => arg === '--method' || arg === '-X');
    const method = methodIndex === -1 ? 'GET' : args[methodIndex + 1];
    const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
    if (method === 'GET' && /\/rules\/branches\//.test(path)) {
      return respond(state.rules ?? { status: 200, body: [] });
    }
    if (method === 'GET' && /\/protection$/.test(path)) {
      return respond(state.protection ?? { status: 404, message: 'Branch not protected' });
    }
    if (method === 'PUT') {
      return respond(state.put ?? { status: 200, body: {} });
    }
  }
  return result(1, '', `fake gh: 対応していないコマンドです（${args.join(' ')}）\n`);
}

export function spawnSync(command, args = [], options = {}) {
  if (command !== 'gh') {
    return childProcess.spawnSync(command, args, options);
  }

  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  const input = options.input === undefined ? null : Buffer.from(options.input).toString('utf8');
  appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ args, input, cwd: options.cwd ?? null })}\n`);

  if (state.missing === true) {
    const error = Object.assign(new Error('spawnSync gh ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawnSync gh',
      path: 'gh',
    });
    return { ...result(null), error };
  }
  return fakeGh(state, args);
}
