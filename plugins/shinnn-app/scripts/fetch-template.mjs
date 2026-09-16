#!/usr/bin/env node
/**
 * /shinnn-app:setup の手順 0。テンプレート shinnn-app-starter をダウンロードして、対象のフォルダに展開する。
 *
 * 取得するのは、このプラグインが対応している版（プラグインの `.starter-version`）のタグの圧縮ファイル。
 * git clone にしない理由:
 * - 版を固定して取れる。スキルと hooks は、その版のテンプレートの構成を前提にしている
 * - テンプレートの履歴を持ち込まない。アプリのリポジトリは自分の最初のコミットから始まる
 *
 * 圧縮ファイルは OS の tar コマンドを使わずに Node で読む。OS の tar は種類によって日本語のファイル名の扱いが違うため。
 *
 * 展開先に既にあるファイルは上書きしない。同じパスのファイルが 1 つでもあれば、何も書かずに終わる。
 * 例外は `.claude/settings.json` で、トップレベルのキーが `enabledPlugins` と `extraKnownMarketplaces` だけなら置き換える。
 * `claude plugin install --scope project` が書いたもので、テンプレート側の同じファイルがその内容を含むため。
 *
 * 実行例:
 *   node <プラグイン>/scripts/fetch-template.mjs
 *   node <プラグイン>/scripts/fetch-template.mjs --dry-run
 *   node <プラグイン>/scripts/fetch-template.mjs --from ./shinnn-app-starter.tar.gz
 *
 * 引数:
 *   --dest <パス>    展開先（既定は CLAUDE_PROJECT_DIR、無ければカレント）。無ければ作る
 *   --from <取得元>  ディレクトリ / .tar.gz ファイル / http(s) の URL
 *                    （既定は https://github.com/shin-corp/shinnn-app-starter/archive/refs/tags/v<版>.tar.gz）
 *   --dry-run        何も書かずに、版・取得元・ファイル数・置き換えるファイルだけを出す
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readJson, run } from './lib/hook-io.mjs';

/** テンプレートの公開リポジトリ */
const STARTER_REPOSITORY = 'shin-corp/shinnn-app-starter';

/** テンプレートから作ったリポジトリには必ず入っているファイル。取得済みかと、取得元がテンプレートかを見るのに使う */
const TEMPLATE_MARKER = '.claude/rules/.standards-version';

/** このプラグインが対応しているテンプレートの版を書いたファイル */
const STARTER_VERSION_FILE = fileURLToPath(new URL('../.starter-version', import.meta.url));

/** ダウンロードに失敗したときの直し方 */
const HOW_TO_FIX_DOWNLOAD = `公開されている版かを https://github.com/${STARTER_REPOSITORY}/tags で確認する。ネットワークが制限されている場合は、別の場所で取得した圧縮ファイルを --from で渡す`;

/** 圧縮ファイルを読めなかったときの直し方 */
const HOW_TO_FIX_ARCHIVE = `https://github.com/${STARTER_REPOSITORY}/tags からダウンロードした .tar.gz を --from に渡す`;

/** 展開先に既にあっても置き換えてよいファイルと、置き換えてよいときに持っていてよいトップレベルのキー */
const INSTALL_SETTINGS_PATH = '.claude/settings.json';
const INSTALL_SETTINGS_KEYS = new Set(['enabledPlugins', 'extraKnownMarketplaces']);

/** 取得元を URL として扱う形 */
const URL_PATTERN = /^https?:\/\//i;

/** tar のブロックの大きさ。ヘッダーも中身も、この単位で並ぶ */
const BLOCK_SIZE = 512;

/** ustar ヘッダーの欄（バイト単位の位置と長さ） */
const NAME_FIELD = { offset: 0, length: 100 };
const SIZE_FIELD = { offset: 124, length: 12 };
const TYPE_OFFSET = 156;
const MAGIC_FIELD = { offset: 257, length: 6 };
const PREFIX_FIELD = { offset: 345, length: 155 };

/** POSIX の ustar 形式の印。GNU 形式（`ustar  `）では prefix の位置に別の欄があるので、この印のときだけ prefix を読む */
const USTAR_MAGIC = 'ustar\0';

/** エントリの種類（typeflag）。通常ファイルは '0' と、古い形式の '\0' */
const FILE_TYPES = new Set(['0', '\0']);
const PAX_HEADER_TYPE = 'x';
const PAX_GLOBAL_HEADER_TYPE = 'g';
const GNU_LONG_NAME_TYPE = 'L';

/** pax 拡張ヘッダーのレコード `<長さ> <キー>=<値>\n` の区切り */
const SPACE = 0x20;

/** Windows と POSIX のどちらでも絶対パスになる形 */
const ABSOLUTE_PATH = /^(?:[\\/]|[A-Za-z]:)/;

/** 続けられない理由を出して終わる。 */
function fail(message, how) {
  console.error(`[shinnn-app:setup] ${message}`);
  if (how) {
    console.error(`  どう直す: ${how}`);
  }
  process.exit(1);
}

/** `--key value` と `--flag` の両方を読む。 */
function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];

    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (key !== '--dest' && key !== '--from') {
      fail(`知らない引数です: ${key}`);
    }

    const value = argv[i + 1];

    if (value === undefined || value.startsWith('--')) {
      fail(`${key} の値が指定されていません。`);
    }
    i += 1;
    options[key.slice(2)] = value;
  }

  return options;
}

/** このプラグインが対応しているテンプレートの版 */
function readStarterVersion() {
  const version = existsSync(STARTER_VERSION_FILE) ? readFileSync(STARTER_VERSION_FILE, 'utf8').trim() : '';
  if (version === '') {
    fail(`${STARTER_VERSION_FILE} に版が書かれていません。`, 'プラグインを入れ直す');
  }
  return version;
}

/** URL の圧縮ファイルをダウンロードする。リダイレクト（GitHub の archive から codeload へ）は fetch が追う */
async function download(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`${url} をダウンロードできませんでした（${error.cause?.message ?? error.message}）。`, HOW_TO_FIX_DOWNLOAD);
  }
  if (!response.ok) {
    fail(`${url} をダウンロードできませんでした（HTTP ${response.status}）。`, HOW_TO_FIX_DOWNLOAD);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** ヘッダーの文字列の欄を読む。欄は NUL で終わるか、長さいっぱいまで使う */
function readField(block, { offset, length }) {
  const bytes = block.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  const text = end === -1 ? bytes : bytes.subarray(0, end);
  return text.toString('utf8');
}

/** ustar ヘッダーの名前。POSIX の ustar 形式で prefix があれば `prefix/name` */
function readUstarName(header) {
  const name = readField(header, NAME_FIELD);
  const magic = header.subarray(MAGIC_FIELD.offset, MAGIC_FIELD.offset + MAGIC_FIELD.length).toString('latin1');
  if (magic !== USTAR_MAGIC) {
    return name;
  }
  const prefix = readField(header, PREFIX_FIELD);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/** pax 拡張ヘッダーから path を取り出す。レコードの長さはバイト数なので、文字列にする前に Buffer のまま区切る */
function readPaxPath(data) {
  let path;
  let position = 0;
  while (position < data.length) {
    const space = data.indexOf(SPACE, position);
    const length = space === -1 ? NaN : Number(data.subarray(position, space).toString('latin1'));
    if (!Number.isInteger(length) || length <= 0) {
      break;
    }
    // 末尾の改行を除いた `<キー>=<値>`
    const record = data.subarray(space + 1, position + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') {
      path = record.slice(equals + 1);
    }
    position += length;
  }
  return path;
}

/**
 * 先頭の 1 階層（GitHub の圧縮ファイルでは `shinnn-app-starter-<版>/`）を外す。
 * 圧縮ファイルの外に書かせないため、外した後が空・絶対パス・`..` を含むものは受け付けない。
 */
function stripTopDirectory(name) {
  const slash = name.indexOf('/');
  const path = slash === -1 ? '' : name.slice(slash + 1);
  const segments = path.split(/[\\/]/);
  if (path === '' || ABSOLUTE_PATH.test(path) || segments.includes('..')) {
    fail(`圧縮ファイルに展開できないパスがあります: ${name}`, HOW_TO_FIX_ARCHIVE);
  }
  return path;
}

/**
 * .tar.gz を読み、通常ファイルのパス（先頭の 1 階層を外したもの）と中身を返す。
 *
 * 名前は、直前の pax 拡張ヘッダーの path か GNU の長い名前があればそれを、無ければ ustar ヘッダーの名前を使う。
 * ディレクトリ・pax グローバルヘッダー・シンボリックリンクなど、通常ファイル以外は読み飛ばす。
 *
 * @returns パス（POSIX 形式）→ 中身
 */
function readTarGz(archive) {
  let tar;
  try {
    tar = gunzipSync(archive);
  } catch (error) {
    fail(`圧縮ファイルを展開できませんでした（${error.message}）。`, HOW_TO_FIX_ARCHIVE);
  }

  const files = new Map();
  let nextName;
  let offset = 0;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    // 0 埋めのブロックが終わりの印
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const size = parseInt(readField(header, SIZE_FIELD).trim() || '0', 8);
    const dataStart = offset + BLOCK_SIZE;
    if (Number.isNaN(size) || dataStart + size > tar.length) {
      fail('圧縮ファイルが壊れています（エントリの大きさが読めません）。', HOW_TO_FIX_ARCHIVE);
    }
    const data = tar.subarray(dataStart, dataStart + size);
    const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    offset = dataStart + paddedSize;

    const type = String.fromCharCode(header[TYPE_OFFSET]);
    if (type === PAX_HEADER_TYPE) {
      nextName = readPaxPath(data) ?? nextName;
      continue;
    }
    if (type === GNU_LONG_NAME_TYPE) {
      nextName = readField(data, { offset: 0, length: data.length });
      continue;
    }
    if (type === PAX_GLOBAL_HEADER_TYPE) {
      continue;
    }

    const name = nextName ?? readUstarName(header);
    nextName = undefined;
    if (!FILE_TYPES.has(type)) {
      continue;
    }
    files.set(stripTopDirectory(name), data);
  }

  return files;
}

/**
 * ディレクトリの取得元から、git が管理する対象のファイルだけを読む。
 * 公開リポジトリの圧縮ファイルに入るものと揃え、node_modules や dist などの無視されたファイルを持ち込まない。
 * コミットしていない変更と、無視されていない新しいファイルは含める。
 *
 * @returns パス（POSIX 形式）→ 中身
 */
function readGitFiles(dir) {
  const result = run('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (result.failedToStart) {
    fail(
      'git を起動できませんでした。',
      'ディレクトリを --from に渡すときは git が要る。.tar.gz ファイルか URL を渡してもよい',
    );
  }
  if (result.status !== 0) {
    fail(
      `${dir} のファイル一覧を git で取得できませんでした（${result.stderr.trim()}）。`,
      'git で管理しているテンプレートのディレクトリを --from に渡す',
    );
  }

  const files = new Map();
  for (const file of result.stdout.split('\0')) {
    if (file === '') {
      continue;
    }
    // 一覧にあってもディスクに無いもの（削除してまだコミットしていないファイル）は除く
    const absolute = join(dir, file);
    const stat = statSync(absolute, { throwIfNoEntry: false });
    if (stat?.isFile() !== true) {
      continue;
    }
    files.set(file, readFileSync(absolute));
  }
  return files;
}

/**
 * 取得元のファイルを読む。
 *
 * @returns パス（POSIX 形式）→ 中身
 */
async function readSource(from) {
  if (URL_PATTERN.test(from)) {
    const archive = await download(from);
    return readTarGz(archive);
  }

  const fromPath = resolve(from);
  const stat = statSync(fromPath, { throwIfNoEntry: false });
  if (stat === undefined) {
    fail(
      `取得元 ${fromPath} がありません。`,
      'ディレクトリ・.tar.gz ファイル・http(s) の URL のいずれかを --from に渡す',
    );
  }
  if (stat.isDirectory()) {
    return readGitFiles(fromPath);
  }
  return readTarGz(readFileSync(fromPath));
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

const options = parseArgs(process.argv.slice(2));
const version = readStarterVersion();
const dest = resolve(options.dest || process.env.CLAUDE_PROJECT_DIR || process.cwd());

if (existsSync(join(dest, TEMPLATE_MARKER))) {
  console.log(
    `[shinnn-app:setup] テンプレートは取得済みです（${dest} に ${TEMPLATE_MARKER} があります）。何もしません。`,
  );
  process.exit(0);
}

const from = options.from ?? `https://github.com/${STARTER_REPOSITORY}/archive/refs/tags/v${version}.tar.gz`;
const files = await readSource(from);

// 取得元を間違えたまま展開すると、目印が無いので hooks が動かず、取り直しも衝突で止まる
if (!files.has(TEMPLATE_MARKER)) {
  fail(
    `取得元 ${from} はテンプレート shinnn-app-starter ではありません（${TEMPLATE_MARKER} がありません）。`,
    'テンプレート shinnn-app-starter のディレクトリ・.tar.gz ファイル・URL を --from に渡す',
  );
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
  console.log(`  版: shinnn-app-starter v${version}`);
  console.log(`  取得元: ${from}`);
  console.log(`  展開先: ${dest}`);
  console.log(`  ファイル数: ${files.size}`);
  console.log(`  置き換えるファイル: ${replaced.length > 0 ? replaced.join(', ') : 'なし'}`);
  process.exit(0);
}

writeFiles(files, dest);

console.log(
  `[shinnn-app:setup] テンプレート shinnn-app-starter v${version} を ${dest} に展開しました（${files.size} ファイル）。`,
);
console.log(`  取得元: ${from}`);
if (replaced.length > 0) {
  console.log(`  置き換えたファイル: ${replaced.join(', ')}`);
}
