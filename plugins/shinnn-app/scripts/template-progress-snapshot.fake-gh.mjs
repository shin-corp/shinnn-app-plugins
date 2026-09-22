/**
 * template-progress-snapshot.test.mjs の下準備。テンプレートの scripts/progress-snapshot.mjs が呼ぶ gh を偽物に差し替える。
 *
 * `node --import <このファイルの URL> <コピーしたスクリプト>` で読み込むと、スクリプトが import する
 * node:child_process をこのファイルに差し替える。差し替えた execFileSync は次のように答える。
 * - gh: 環境変数 FAKE_GH_STATE が指す JSON（GitHub の状態）から、本物の gh と同じ形の出力を返す
 * - git rev-parse --show-toplevel: 環境変数 FAKE_GIT_TOPLEVEL を返す（一時フォルダが別のリポジトリの中にあっても結果を揃える）
 * - それ以外: 本物の child_process に渡す
 *
 * PATH に偽の gh を置く方法を使わないのは、Windows の execFileSync が拡張子 .exe / .com のファイルしか探さず、
 * スクリプトで作った偽物（gh.cmd など）を見つけないため。
 *
 * FAKE_GH_STATE の形:
 *   issues:       [{ number, title, createdAt, updatedAt, labels: [ラベル名] }]
 *   pullRequests: [{ number, title, isDraft, createdAt, updatedAt }]
 *   runs:         [{ displayTitle, workflowName, conclusion, status, headBranch, createdAt }]（新しい順）
 *   errors:       { issues?, pullRequests?, runs? }（指定した一覧の取得を、その文言を標準エラーに出して失敗させる）
 */
import * as childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

export * from 'node:child_process';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process' && context.parentURL?.endsWith('/scripts/progress-snapshot.mjs')) {
      return { url: import.meta.url, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/** 本物の execFileSync が、終了コードが 0 以外のときに投げるのと同じ形の例外 */
function commandFailed(args, stderr) {
  return Object.assign(new Error(`Command failed: gh ${args.join(' ')}\n${stderr}`), {
    status: 1,
    stdout: '',
    stderr: `${stderr}\n`,
  });
}

/** `--name value` の値。無ければ fallback */
function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

/** `-f` / `-F` で渡した `キー=値` を集める（gh api の引数） */
function fields(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (['-f', '-F', '--field', '--raw-field'].includes(args[i])) {
      const [key, ...rest] = args[i + 1].split('=');
      result[key] = rest.join('=');
      i += 1;
    }
  }
  return result;
}

/** 渡した項目だけを持つ形にする（gh の --json と同じ） */
function pick(item, names) {
  return Object.fromEntries(names.map((name) => [name, item[name]]));
}

/** 並べ替えたコピー。key は createdAt / updatedAt */
function sorted(items, key, direction) {
  const sign = direction === 'ASC' ? 1 : -1;
  return [...items].sort((a, b) => sign * a[key].localeCompare(b[key]));
}

/** gh issue list / gh pr list。本物と同じく作成の新しい順に --limit 件まで返す */
function listCommand(state, kind, args) {
  const items = sorted(state[kind] ?? [], 'createdAt', 'DESC').slice(0, Number(option(args, '--limit', '30')));
  const names = option(args, '--json', '').split(',');
  return items.map((item) => pick({ ...item, labels: (item.labels ?? []).map((name) => ({ name })) }, names));
}

/** gh api graphql。repository の issues / pullRequests を、クエリの orderBy と first に従って返す */
function graphqlCommand(state, args) {
  const { query = '', first } = fields(args);
  const kind = /\bpullRequests\s*\(/.test(query) ? 'pullRequests' : /\bissues\s*\(/.test(query) ? 'issues' : null;
  if (kind === null) {
    throw commandFailed(args, 'fake gh: 対応していないクエリです');
  }
  if (state.errors?.[kind]) {
    throw commandFailed(args, state.errors[kind]);
  }
  const order = /orderBy:\s*\{\s*field:\s*(\w+)\s*,\s*direction:\s*(\w+)\s*\}/.exec(query);
  const key = order?.[1] === 'UPDATED_AT' ? 'updatedAt' : 'createdAt';
  const all = state[kind] ?? [];
  const nodes = sorted(all, key, order?.[2] ?? 'ASC')
    .slice(0, Number(first ?? /first:\s*(\d+)/.exec(query)?.[1] ?? 0))
    .map((item) => ({ ...item, labels: { nodes: (item.labels ?? []).map((name) => ({ name })) } }));
  return { data: { repository: { [kind]: { totalCount: all.length, nodes } } } };
}

/** gh の引数に答える。標準出力に出す文字列を返すか、失敗の例外を投げる */
function fakeGh(args) {
  if (args[0] === '--version') {
    return 'gh version 0.0.0 (fake)\n';
  }
  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  const command = args.slice(0, 2).join(' ');
  const kind = { 'issue list': 'issues', 'pr list': 'pullRequests', 'run list': 'runs' }[command];
  if (kind !== undefined && state.errors?.[kind]) {
    throw commandFailed(args, state.errors[kind]);
  }
  if (command === 'issue list' || command === 'pr list') {
    return JSON.stringify(listCommand(state, kind, args));
  }
  if (command === 'run list') {
    const names = option(args, '--json', '').split(',');
    const runs = (state.runs ?? []).slice(0, Number(option(args, '--limit', '20')));
    return JSON.stringify(runs.map((run) => pick(run, names)));
  }
  if (command === 'api graphql') {
    return JSON.stringify(graphqlCommand(state, args));
  }
  throw commandFailed(args, `fake gh: 対応していないコマンドです（${command}）`);
}

export function execFileSync(file, args = [], options = {}) {
  if (file === 'gh') {
    return fakeGh(args);
  }
  if (file === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel' && process.env.FAKE_GIT_TOPLEVEL) {
    return `${process.env.FAKE_GIT_TOPLEVEL}\n`;
  }
  return childProcess.execFileSync(file, args, options);
}
