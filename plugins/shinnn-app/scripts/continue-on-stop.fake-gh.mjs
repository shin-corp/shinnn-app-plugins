/**
 * continue-on-stop.test.mjs の下準備。continue-on-stop.mjs が lib/hook-io.mjs の run() を通して呼ぶ gh を偽物に差し替える。
 *
 * `node --import <このファイルの URL> continue-on-stop.mjs` で読み込むと、lib/hook-io.mjs が import する
 * node:child_process をこのファイルに差し替える。差し替えた spawnSync は次のように答える。
 * - gh: 環境変数 FAKE_GH_STATE が指す JSON（GitHub の状態）から、本物の gh と同じ形の結果を返す。
 *   呼ばれた引数は、環境変数 FAKE_GH_LOG が指すファイルに 1 行 1 件の JSON で書き足す
 * - それ以外（git など）: 本物の child_process に渡す
 *
 * PATH に偽の gh を置く方法を使わないのは、Windows の spawnSync が拡張子 .exe / .com のファイルしか探さず、
 * スクリプトで作った偽物（gh.cmd など）を見つけないため。
 *
 * FAKE_GH_STATE の形:
 *   missing: true なら gh が無い（起動できない）
 *   failure: true なら、remote が無いときと同じく終了コード 1 で終わる
 *   timeout: true なら、gh が時間内に終わらず、spawnSync が止めたときと同じ結果を返す。
 *            ただし、呼ぶ側が spawnSync に数値の timeout を渡していなければ、例外を投げてテストを落とす
 *   raw:     文字列なら、`gh issue list` の標準出力としてそのまま返す（JSON でない出力の試し）
 *   issues:  ラベル → 開いている Issue の配列（例: { "status:next": [14, 22] }）。書いていないラベルは 0 件。
 *            要素は番号か { number, title, body }。番号だけなら、題は `[機能] #<番号>`、本文は空にする
 * `gh issue list` には、`--json` で頼まれた欄だけを返す。
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

/** spawnSync が起動に失敗したか、時間切れで止めたときの結果 */
function spawnError(code, extra = {}) {
  const error = Object.assign(new Error(`spawnSync gh ${code}`), { code, syscall: 'spawnSync gh', path: 'gh' });
  return { ...result(null), ...extra, error };
}

/**
 * gh の引数に答える。
 *
 * @param options 呼ぶ側が spawnSync に渡したオプション
 */
function fakeGh(state, args, options) {
  if (state.missing === true) {
    return spawnError('ENOENT');
  }
  if (state.timeout === true) {
    if (typeof options.timeout !== 'number') {
      throw new Error(
        'fake gh: spawnSync に数値の timeout が渡されていないので、時間切れを答えられません。' +
          '本物の gh なら、終わるまで待ち続けます。',
      );
    }
    return spawnError('ETIMEDOUT', { signal: 'SIGTERM' });
  }
  if (state.failure === true) {
    return result(1, '', 'no git remotes found\n');
  }
  if (args[0] === 'issue' && args[1] === 'list') {
    if (typeof state.raw === 'string') {
      return result(0, state.raw);
    }
    const labelIndex = args.indexOf('--label');
    const label = labelIndex === -1 ? null : args[labelIndex + 1];
    const jsonIndex = args.indexOf('--json');
    const fields = jsonIndex === -1 ? [] : args[jsonIndex + 1].split(',');
    const issues = [];
    for (const entry of state.issues?.[label] ?? []) {
      const issue = typeof entry === 'number' ? { number: entry, title: `[機能] #${entry}`, body: '' } : entry;
      issues.push(Object.fromEntries(fields.map((field) => [field, issue[field]])));
    }
    return result(0, `${JSON.stringify(issues)}\n`);
  }
  return result(1, '', `fake gh: 対応していないコマンドです（${args.join(' ')}）\n`);
}

export function spawnSync(command, args = [], options = {}) {
  if (command !== 'gh') {
    return childProcess.spawnSync(command, args, options);
  }

  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ args, cwd: options.cwd ?? null })}\n`);
  return fakeGh(state, args, options);
}
