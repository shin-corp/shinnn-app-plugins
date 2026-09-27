/**
 * format-file.test.mjs の下準備。scripts/format-file.mjs が lib/hook-io.mjs 経由で起動する npm を偽物に差し替える。
 *
 * `node --import <このファイルの URL> format-file.mjs` で読み込むと、lib/hook-io.mjs が import する
 * node:child_process をこのファイルに差し替える。差し替えた spawnSync は、npm のときだけ次のように答え、
 * それ以外は本物に渡す。
 * - 受け取った引数を 1 行にして、環境変数 FAKE_NPM_LOG のファイルに書き足す
 * - prettier: 環境変数 FAKE_PRETTIER_CHANGES があれば、最後の引数のファイルに 1 行足す（書式が変わったことにする）
 * - eslint: 「fake eslint: <引数>」を出し、環境変数 FAKE_ESLINT_STATUS の終了コードで終わる
 *
 * PATH に偽の npm を置く方法を使わないのは、Windows の Node がシェルを通さない起動で拡張子 .exe / .com の
 * ファイルしか探さず、拡張子の無い偽物を飛ばして本物の npm を動かすため。
 */
import * as childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
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

/** spawnSync と同じ形の結果 */
function finished(status, stdout) {
  return { status, signal: null, stdout, stderr: '', output: [null, stdout, ''], pid: 0 };
}

/** npm だけを偽物にした spawnSync */
export function spawnSync(command, args = [], options = {}) {
  if (command !== 'npm') {
    return childProcess.spawnSync(command, args, options);
  }

  const line = args.join(' ');
  appendFileSync(process.env.FAKE_NPM_LOG, `${line}\n`);

  if (line.includes('prettier')) {
    if (process.env.FAKE_PRETTIER_CHANGES) {
      appendFileSync(args.at(-1), '// formatted\n');
    }
    return finished(0, '');
  }
  if (line.includes('eslint')) {
    return finished(Number(process.env.FAKE_ESLINT_STATUS ?? 0), `fake eslint: ${line}\n`);
  }
  return finished(0, '');
}
