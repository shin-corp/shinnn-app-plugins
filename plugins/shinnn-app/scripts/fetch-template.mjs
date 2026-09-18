#!/usr/bin/env node
/**
 * /shinnn-app:setup の手順 0。プラグインに同梱されたテンプレートを、対象のフォルダに展開する。
 *
 * 取得元はいつもプラグインの中の `template`（`${CLAUDE_PLUGIN_ROOT}/template`）。ダウンロードしない理由:
 * - 版がずれない。スキルと hooks は、同じプラグインに入っているテンプレートの構成を前提にしている
 * - ネットワークが要らない。通信が制限された環境でも、入れたプラグインだけで展開できる
 *
 * 展開するのはテンプレートそのものだけで、依存や生成物（node_modules・dist など）と、
 * 手元の環境設定（.env）は含めない。開発中の手元ではこれらが同じフォルダにある。
 *
 * 展開先に既にあるファイルは上書きしない。同じパスのファイルが 1 つでもあれば、何も書かずに終わる。
 * 例外は `.claude/settings.json` で、トップレベルのキーが `enabledPlugins` と `extraKnownMarketplaces` だけなら置き換える。
 * `claude plugin install --scope project` が書いたもので、テンプレート側の同じファイルがその内容を含むため。
 *
 * 実行例:
 *   node <プラグイン>/scripts/fetch-template.mjs
 *   node <プラグイン>/scripts/fetch-template.mjs --dry-run
 *
 * 引数:
 *   --dest <パス>  展開先（既定は CLAUDE_PROJECT_DIR、無ければカレント）。無ければ作る
 *   --dry-run      何も書かずに、版・ファイル数・置き換えるファイルだけを出す
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/hook-io.mjs';

/** 同梱のテンプレート。プラグインのフォルダの中にあるので、版の指定もダウンロードも要らない */
const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

/** テンプレートから作ったリポジトリには必ず入っているファイル。取得済みかを見るのに使う */
const TEMPLATE_MARKER = '.claude/rules/.standards-version';

/** テンプレートの版を書いたファイル */
const TEMPLATE_MANIFEST = 'package.json';

/**
 * 展開しないディレクトリ。名前が一致すれば、どの階層のものでも中身ごと除く。
 * 依存と生成物・作業結果で、テンプレートの一部ではない。テンプレートを手元で動かすと作られるので、明示的に除く。
 */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.angular',
  'out-tsc',
  'coverage',
  'test-results',
  'playwright-report',
  '.e2e',
  '.git',
]);

/**
 * 展開しないファイル。個人の設定・メモと、OS が作る記録で、テンプレートの一部ではない。
 * どれもテンプレートの `.gitignore` が無視する顔ぶれで、手元で作業すると現れる。
 */
const EXCLUDED_FILES = new Set(['settings.local.json', 'CLAUDE.local.md', '.DS_Store', 'Thumbs.db']);

/** 環境設定の見本。これは展開する */
const ENV_EXAMPLE = '.env.example';

/** 手元の環境設定。接続先や認証情報を含みうるので展開しない */
const ENV_FILE = /^\.env(\..+)?$/;

/** 実行の記録。テンプレートの一部ではない */
const LOG_FILE = /\.log$/;

/** 展開先に既にあっても置き換えてよいファイルと、置き換えてよいときに持っていてよいトップレベルのキー */
const INSTALL_SETTINGS_PATH = '.claude/settings.json';
const INSTALL_SETTINGS_KEYS = new Set(['enabledPlugins', 'extraKnownMarketplaces']);

/** 続けられない理由を出して終わる。 */
function fail(message, how) {
  console.error(`[shinnn-app:setup] ${message}`);
  if (how) {
    console.error(`  どう直す: ${how}`);
  }
  process.exit(1);
}

/** `--dest value` と `--dry-run` を読む。 */
function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (key !== '--dest') {
      fail(`知らない引数です: ${key}`);
    }

    const value = argv[i + 1];

    if (value === undefined || value.startsWith('--')) {
      fail(`${key} の値が指定されていません。`);
    }
    i += 1;
    options.dest = value;
  }

  return options;
}

/**
 * 展開しないパスか。名前だけで判断するので、ディレクトリにもファイルにも使える。
 *
 * @param path テンプレートのルート起点の POSIX パス
 */
export function isExcluded(path) {
  const segments = path.split('/');

  for (const segment of segments) {
    if (EXCLUDED_DIRECTORIES.has(segment)) {
      return true;
    }
  }

  const name = segments[segments.length - 1];

  if (name === ENV_EXAMPLE) {
    return false;
  }
  return EXCLUDED_FILES.has(name) || ENV_FILE.test(name) || LOG_FILE.test(name);
}

/**
 * 同梱のテンプレートのファイルを読む。除いたディレクトリの中は見ない。
 *
 * @returns パス（POSIX 形式）→ 中身
 */
function readTemplateFiles(dir, prefix = '') {
  const files = new Map();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;

    if (isExcluded(path)) {
      continue;
    }
    if (entry.isDirectory()) {
      for (const [childPath, body] of readTemplateFiles(join(dir, entry.name), path)) {
        files.set(childPath, body);
      }
      continue;
    }
    if (entry.isFile()) {
      files.set(path, readFileSync(join(dir, entry.name)));
    }
  }

  return files;
}

/** 同梱のテンプレートの版 */
function readTemplateVersion() {
  const manifestPath = join(TEMPLATE_DIR, TEMPLATE_MANIFEST);
  const manifest = readJson(manifestPath);
  const version = typeof manifest?.version === 'string' ? manifest.version : '';

  if (version === '') {
    fail(`${manifestPath} から版を読めませんでした。`, 'プラグインを入れ直す');
  }
  return version;
}

/** `claude plugin install --scope project` が書くキーだけの settings.json か。読めない JSON なら false */
function isWrittenByPluginInstall(path) {
  const settings = readJson(path);
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return false;
  }
  return Object.keys(settings).every((key) => INSTALL_SETTINGS_KEYS.has(key));
}

/** 展開先に既にあるファイルを、置き換えてよいものと衝突に分ける */
function classifyExisting(paths, dest) {
  const conflicts = [];
  const replaced = [];
  for (const path of paths) {
    const target = join(dest, path);
    if (!existsSync(target)) {
      continue;
    }
    if (path === INSTALL_SETTINGS_PATH && isWrittenByPluginInstall(target)) {
      replaced.push(path);
      continue;
    }
    conflicts.push(path);
  }
  return { conflicts, replaced };
}

/** ファイルを展開先に書く。ディレクトリは無ければ作る */
function writeFiles(files, dest) {
  mkdirSync(dest, { recursive: true });
  for (const [path, body] of files) {
    const target = join(dest, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dest = resolve(options.dest || process.env.CLAUDE_PROJECT_DIR || process.cwd());

  if (existsSync(join(dest, TEMPLATE_MARKER))) {
    console.log(
      `[shinnn-app:setup] テンプレートは取得済みです（${dest} に ${TEMPLATE_MARKER} があります）。何もしません。`,
    );
    process.exit(0);
  }

  if (!existsSync(TEMPLATE_DIR)) {
    fail(`同梱のテンプレート ${TEMPLATE_DIR} がありません。`, 'プラグインを入れ直す');
  }

  const version = readTemplateVersion();
  const files = readTemplateFiles(TEMPLATE_DIR);

  // 目印が無いまま展開すると hooks が動かず、取り直しも衝突で止まる
  if (!files.has(TEMPLATE_MARKER)) {
    fail(`同梱のテンプレート ${TEMPLATE_DIR} に ${TEMPLATE_MARKER} がありません。`, 'プラグインを入れ直す');
  }

  const { conflicts, replaced } = classifyExisting(files.keys(), dest);

  if (conflicts.length > 0) {
    const lines = [`展開先 ${dest} に、テンプレートと同じパスのファイルがあります。何も書いていません。`];
    for (const path of conflicts) {
      lines.push(`  - ${path}`);
    }
    fail(lines.join('\n'), '空のフォルダで実行し直す');
  }

  if (options.dryRun === true) {
    console.log('[shinnn-app:setup] 展開する内容（--dry-run。何も書いていません）:');
    console.log(`  版: テンプレート v${version}`);
    console.log(`  取得元: ${TEMPLATE_DIR}`);
    console.log(`  展開先: ${dest}`);
    console.log(`  ファイル数: ${files.size}`);
    console.log(`  置き換えるファイル: ${replaced.length > 0 ? replaced.join(', ') : 'なし'}`);
    process.exit(0);
  }

  writeFiles(files, dest);

  console.log(`[shinnn-app:setup] テンプレート v${version} を ${dest} に展開しました（${files.size} ファイル）。`);
  if (replaced.length > 0) {
    console.log(`  置き換えたファイル: ${replaced.join(', ')}`);
  }
}

/**
 * コマンドとして実行したか。テストから読み込んだときは、除外の判定だけを使うので展開しない。
 *
 * 起動したパスとこのファイルのパスは、途中にシンボリックリンク（プラグインの入れ方によっては作られる）が
 * あると文字列としては違うので、実体にしてから比べる。
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
