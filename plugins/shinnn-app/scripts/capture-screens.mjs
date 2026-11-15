#!/usr/bin/env node
/**
 * 画面を撮るスクリプト。Chrome・Edge・Chromium を画面なしで起動し、DevTools プロトコル（ブラウザを外から操作する仕組み）で動かす。
 * /shinnn-app:add-screen の「9. 作った画面を見直す」と、/shinnn-app:feature の作り直しが使う。
 *
 * プラグインには package.json が無く、スクリプトは Node の標準だけで動く。
 * そのため、DevTools プロトコルは Node 24 の組み込みの WebSocket で話す（playwright などの依存を足さない）。
 *
 * 実行例:
 *   node <プラグイン>/scripts/capture-screens.mjs shot --url http://localhost:4200/items --out screenshots/items.png --token
 *   node <プラグイン>/scripts/capture-screens.mjs compare --left screenshots/original/商品一覧.png --right screenshots/items.png --out screenshots/compare/items.png
 *   node <プラグイン>/scripts/capture-screens.mjs batch --list <一覧のファイル> --out-dir screenshots --token
 *
 * サブコマンド:
 *   shot     1 つの URL を撮る
 *   compare  2 枚（画像のファイルか URL）を横に並べて 1 枚にする。左に元、右に新を置く
 *   batch    一覧のファイル（JSON）にある画面をまとめて撮る。`original` を書いた画面は、元と並べた画像も作る
 *            一覧の形: [{ "name": "items", "url": "http://localhost:4200/items", "original": "screenshots/original/商品一覧.png" }]
 *            撮った画像は <out-dir>/<name>.png、並べた画像は <out-dir>/compare/<name>.png に書く
 *
 * 引数（どのサブコマンドでも使えるもの）:
 *   --width <px> / --height <px>  画面の幅と高さ（既定は 1280 × 800）
 *   --wait-ms <ミリ秒>             読み込みが終わってから撮るまで待つ時間（既定は 1000。画面がデータを取り終えるのを待つ）
 *   --timeout-ms <ミリ秒>          ページを開くのを待つ上限（既定は 30000）
 *   --viewport-only                画面に見えている範囲だけを撮る（既定は、下まで続くページ全体）
 * shot と batch だけ:
 *   --token            アプリの `npm run token -w server` で開発用の通行証を発行し、ページの読み込みの前に localStorage の token に入れる。
 *                      batch では `url` の画面にだけ入れ、`original` の URL には入れない。通行証の値は出力に出さない
 *   --app-dir <パス>   通行証を発行するアプリのフォルダ（既定はカレント）
 * compare と batch だけ:
 *   --left-label / --right-label  並べた画像の上に出す名前（既定は「元」「新」）
 *   --column-width <px>           1 枚を置く幅（既定は 1280）。これより広い画像は縮め、狭い画像はそのままの大きさで置く
 *
 * ブラウザは、環境変数 CHROME_PATH に値があればそれを使い、無ければ OS ごとの決まった場所を順に探す（findBrowser）。
 * 出力先が git のリポジトリの中で、.gitignore で外されていなければ、ブラウザを起動せずに止まる（assertNotTracked）。
 * 終了コード: 0 は撮れた、1 は撮れなかった（理由を標準エラーに出す。batch は、撮れなかった画面が 1 つでもあれば 1）。
 * シグナル（SIGINT・SIGTERM・SIGHUP）で止められたときは、128 + シグナルの番号。
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from './lib/hook-io.mjs';

/** 画面の幅と高さの既定（ピクセル） */
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

/** 読み込みが終わってから撮るまで待つ時間の既定（ミリ秒） */
const DEFAULT_WAIT_MS = 1000;

/** ページを開くのを待つ上限の既定（ミリ秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 並べた画像で 1 枚を置く幅の既定（ピクセル） */
const DEFAULT_COLUMN_WIDTH = 1280;

/** 並べた画像の余白と、2 枚の間（ピクセル）。buildCompareHtml の CSS と、並べた画像の幅の計算で使う */
const COMPARE_PADDING = 16;
const COMPARE_GAP = 24;

/** ブラウザが DevTools の接続先を知らせるまで待つ上限（ミリ秒） */
const LAUNCH_TIMEOUT_MS = 30_000;

/** DevTools プロトコルの 1 つの命令の結果を待つ上限（ミリ秒）。大きなページの画像は作るのに時間がかかるので長めにする */
const COMMAND_TIMEOUT_MS = 60_000;

/** ブラウザを閉じた後、終わるのを待つ上限（ミリ秒） */
const CLOSE_TIMEOUT_MS = 5000;

/** ページ全体を撮るときの高さの上限（ピクセル）。これより長いページは、上からこの高さまでを撮る */
const MAX_CAPTURE_HEIGHT = 16_384;

/** 幅・高さ・待つ時間に受け付ける値の範囲 */
const SIZE_RANGE = { min: 100, max: 8000 };
const WAIT_RANGE = { min: 0, max: 120_000 };
const TIMEOUT_RANGE = { min: 1000, max: 300_000 };

/** 開いてよい URL の種類 */
const URL_PROTOCOLS = ['http:', 'https:', 'file:', 'data:'];

/** 開発用の通行証の形（JWT。英数字と `-` `_` の 3 つの組を `.` でつないだもの） */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** 文の中の、通行証に見える部分（エラーの文に通行証を出さないために使う） */
const TOKEN_IN_TEXT = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

/** 通行証を発行するコマンドを待つ上限（ミリ秒）。npm の起動と依存の読み込みに時間がかかる */
const TOKEN_TIMEOUT_MS = 60_000;

/** batch の一覧の name に使えない文字（ファイルの名前にするため） */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/**
 * ブラウザに渡す引数（Linux では `--no-sandbox` も足す。browserArgs）。
 * - `--disable-dev-shm-usage`: コンテナの /dev/shm は小さいことがあり、大きなページで落ちる
 * - `--password-store=basic` と `--use-mock-keychain`: OS の鍵の保管庫を開かない（開くと確認の画面が出ることがある）
 */
const BROWSER_ARGS = [
  '--headless=new',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-component-update',
  '--hide-scrollbars',
  '--mute-audio',
  '--force-color-profile=srgb',
  '--password-store=basic',
  '--use-mock-keychain',
  '--remote-debugging-port=0',
];

/** サブコマンドと、それぞれに要る引数 */
const REQUIRED = { shot: ['url', 'out'], compare: ['left', 'right', 'out'], batch: ['list', 'out-dir'] };

/** 引数の定義。type は node:util の parseArgs に渡す型、in は使えるサブコマンド */
const ALL_COMMANDS = Object.keys(REQUIRED);
const OPTIONS = {
  url: { type: 'string', in: ['shot'] },
  out: { type: 'string', in: ['shot', 'compare'] },
  left: { type: 'string', in: ['compare'] },
  right: { type: 'string', in: ['compare'] },
  list: { type: 'string', in: ['batch'] },
  'out-dir': { type: 'string', in: ['batch'] },
  token: { type: 'boolean', in: ['shot', 'batch'] },
  'app-dir': { type: 'string', in: ['shot', 'batch'] },
  'left-label': { type: 'string', in: ['compare', 'batch'] },
  'right-label': { type: 'string', in: ['compare', 'batch'] },
  'column-width': { type: 'string', in: ['compare', 'batch'] },
  width: { type: 'string', in: ALL_COMMANDS },
  height: { type: 'string', in: ALL_COMMANDS },
  'wait-ms': { type: 'string', in: ALL_COMMANDS },
  'timeout-ms': { type: 'string', in: ALL_COMMANDS },
  'viewport-only': { type: 'boolean', in: ALL_COMMANDS },
  help: { type: 'boolean', short: 'h', in: ALL_COMMANDS },
};

const USAGE = [
  '使い方:',
  '  node capture-screens.mjs shot --url <URL> --out <PNG のパス> [--token] [--width 1280] [--height 800] [--wait-ms 1000] [--viewport-only]',
  '  node capture-screens.mjs compare --left <画像か URL> --right <画像か URL> --out <PNG のパス> [--left-label 元] [--right-label 新]',
  '  node capture-screens.mjs batch --list <一覧の JSON> --out-dir <フォルダ> [--token]',
  '引数の説明は、このスクリプトの先頭のコメントにあります。',
].join('\n');

/** 利用者の誤りや環境で撮れなかったときのエラー。メッセージだけを出す（予期しないエラーは、スタックも出す） */
export class CaptureError extends Error {}

/**
 * ブラウザに渡す引数。
 * Linux では `--no-sandbox` を足す。コンテナ（root でない利用者・権限を落とした環境）では sandbox を作れない。付けないと起動しない。
 * Windows と macOS では付けない。作り直しでは社外のサイトを開くことがあるので、sandbox を外すのは要る環境だけにする。
 *
 * @param platform - `process.platform` と同じ値
 */
export function browserArgs(platform = process.platform) {
  return platform === 'linux' ? [...BROWSER_ARGS, '--no-sandbox'] : [...BROWSER_ARGS];
}

/**
 * 整数の引数を読む。
 *
 * @param name - 引数の名前（エラーの文に使う）
 * @param value - 文字列の値。undefined なら既定の値
 */
function readInteger(name, value, fallback, range) {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new CaptureError(`--${name} には整数を書いてください（${value}）。`);
  }
  const number = Number(value);
  if (number < range.min || number > range.max) {
    throw new CaptureError(`--${name} は ${range.min} から ${range.max} の間にしてください（${value}）。`);
  }
  return number;
}

/**
 * 開く URL を確かめる。開いてよい種類でなければ止める。
 * file の URL は、拡張子が .html か .htm のファイルだけを受け付ける。`.env` などの中身を画像に描かないため。
 */
function readUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CaptureError(
      `--${name} の URL を読めませんでした（${value}）。http:// などから始まる形で書いてください。`,
    );
  }
  if (!URL_PROTOCOLS.includes(url.protocol)) {
    throw new CaptureError(`--${name} は http・https・file・data の URL にしてください（${value}）。`);
  }
  if (url.protocol === 'file:' && !/\.html?$/i.test(url.pathname)) {
    throw new CaptureError(`--${name} の file の URL は、.html か .htm のファイルにしてください（${value}）。`);
  }
  return url.href;
}

/** 書き出す画像のパスを確かめる。PNG で書くので、拡張子は .png だけを受け付ける */
function readPngPath(name, value) {
  if (!value.toLowerCase().endsWith('.png')) {
    throw new CaptureError(`--${name} のファイルの名前は .png で終えてください（${value}）。`);
  }
  return resolve(value);
}

/** compare の入力が URL か（そうでなければ画像のファイルのパスとして扱う） */
export function isUrlInput(value) {
  return /^(https?|file|data):/i.test(value);
}

/**
 * コマンドラインの引数を読む。
 *
 * @param argv - `process.argv.slice(2)` と同じ形
 * @returns `{ help: true }` か、`{ command, options }`（数は数に、パスは絶対パスにしたもの）
 */
export function parseCommand(argv) {
  const parseOptions = {};
  for (const [name, { type, short }] of Object.entries(OPTIONS)) {
    parseOptions[name] = short === undefined ? { type } : { type, short };
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: parseOptions, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CaptureError(`引数を読めませんでした（${error.message}）。\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    return { help: true };
  }
  const [command, ...rest] = positionals;
  if (command === undefined || !Object.hasOwn(REQUIRED, command)) {
    throw new CaptureError(
      `サブコマンド（shot・compare・batch）を最初に書いてください（${command ?? 'なし'}）。\n${USAGE}`,
    );
  }
  if (rest.length > 0) {
    throw new CaptureError(`知らない引数です（${rest.join(' ')}）。\n${USAGE}`);
  }

  for (const name of Object.keys(values)) {
    if (!OPTIONS[name].in.includes(command)) {
      throw new CaptureError(`--${name} は ${command} では使えません。\n${USAGE}`);
    }
  }
  for (const name of REQUIRED[command]) {
    if (values[name] === undefined || values[name] === '') {
      throw new CaptureError(`${command} には --${name} が要ります。\n${USAGE}`);
    }
  }

  const options = {
    width: readInteger('width', values.width, DEFAULT_WIDTH, SIZE_RANGE),
    height: readInteger('height', values.height, DEFAULT_HEIGHT, SIZE_RANGE),
    waitMs: readInteger('wait-ms', values['wait-ms'], DEFAULT_WAIT_MS, WAIT_RANGE),
    timeoutMs: readInteger('timeout-ms', values['timeout-ms'], DEFAULT_TIMEOUT_MS, TIMEOUT_RANGE),
    fullPage: values['viewport-only'] !== true,
    token: values.token === true,
    appDir: resolve(values['app-dir'] ?? '.'),
    leftLabel: values['left-label'] ?? '元',
    rightLabel: values['right-label'] ?? '新',
    columnWidth: readInteger('column-width', values['column-width'], DEFAULT_COLUMN_WIDTH, SIZE_RANGE),
  };
  if (command === 'shot') {
    options.url = readUrl('url', values.url);
    options.out = readPngPath('out', values.out);
  }
  if (command === 'compare') {
    options.left = isUrlInput(values.left) ? readUrl('left', values.left) : resolve(values.left);
    options.right = isUrlInput(values.right) ? readUrl('right', values.right) : resolve(values.right);
    options.out = readPngPath('out', values.out);
  }
  if (command === 'batch') {
    options.list = resolve(values.list);
    options.outDir = resolve(values['out-dir']);
  }
  return { command, options };
}

/**
 * batch の一覧を読む。
 *
 * @param text - 一覧のファイルの中身（JSON の配列）
 * @returns `{ name, url, original }` の配列。url は確かめた URL、original は URL か絶対パスか null
 */
export function parseList(text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch (error) {
    throw new CaptureError(`一覧のファイルを JSON として読めませんでした（${error.message}）。`);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new CaptureError('一覧のファイルは、画面を 1 つ以上並べた配列にしてください。');
  }
  const names = new Set();
  const screens = [];
  for (const [index, entry] of entries.entries()) {
    const where = `一覧の ${index + 1} 番目`;
    const name = entry?.name;
    if (typeof name !== 'string' || name.trim() === '' || name === '.' || name === '..' || UNSAFE_NAME.test(name)) {
      throw new CaptureError(
        `${where}の name は、ファイルの名前に使える文字で書いてください（\\ / : * ? " < > | は使えません）。`,
      );
    }
    if (names.has(name)) {
      throw new CaptureError(`${where}の name（${name}）が、前の画面と同じです。`);
    }
    names.add(name);
    if (typeof entry.url !== 'string') {
      throw new CaptureError(`${where}（${name}）に url がありません。`);
    }
    const url = readUrl('url', entry.url);
    let original = null;
    if (entry.original !== undefined) {
      if (typeof entry.original !== 'string' || entry.original === '') {
        throw new CaptureError(`${where}（${name}）の original は、画像のファイルのパスか URL にしてください。`);
      }
      original = isUrlInput(entry.original) ? readUrl('original', entry.original) : resolve(entry.original);
    }
    screens.push({ name, url, original });
  }
  return screens;
}

/** ファイルがあるか（フォルダは数えない） */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * OS ごとの、ブラウザを探す場所（探す順）。
 * - Windows: Edge（どのパソコンにも入っている）、Chrome の順。Program Files と、利用者ごとに入れた場所（LOCALAPPDATA）
 * - macOS: Chrome・Edge・Chromium の順。/Applications と、利用者のホームの Applications
 * - Linux など: PATH の中の google-chrome・chromium・microsoft-edge などの名前
 *
 * @param env - 環境変数（テストでは偽の値を渡す）
 * @param platform - `process.platform` と同じ値
 * @param home - 利用者のホームのフォルダ
 */
export function browserCandidates({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const candidates = [];
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((root) => Boolean(root));
    for (const relative of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) {
      for (const root of roots) {
        candidates.push(win32.join(root, relative));
      }
    }
    return candidates;
  }
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const app of apps) {
      candidates.push(posix.join('/Applications', app), posix.join(home, 'Applications', app));
    }
    return candidates;
  }
  const names = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
  ];
  const dirs = [];
  for (const dir of [...String(env.PATH ?? '').split(':'), '/usr/bin', '/snap/bin']) {
    if (dir !== '' && !dirs.includes(dir)) {
      dirs.push(dir);
    }
  }
  for (const name of names) {
    for (const dir of dirs) {
      candidates.push(posix.join(dir, name));
    }
  }
  return candidates;
}

/**
 * 画面を撮るブラウザの実行ファイルを決める。
 *
 * 環境変数 CHROME_PATH に値があれば、それを使う。CHROME_PATH は、外の仕組み（ブラウザで Claude Code を動かすサービスなど）が
 * ワークスペースに置く。置いてある環境では、その値のブラウザが動くと分かっているので、決まった場所より先に見る。
 * 名前を変えると、その仕組みの上で画面を撮れなくなる。
 * CHROME_PATH の場所にブラウザが無ければ、ほかの場所を探さずに止める（置いた側の誤りを見えるようにする）。
 *
 * @param exists - パスにファイルがあるか（テストでは偽物を渡す）
 * @returns `{ path, source }`。source は 'CHROME_PATH' か 'search'
 */
export function findBrowser({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  exists = isFile,
} = {}) {
  const configured = env.CHROME_PATH;
  if (configured) {
    if (exists(configured)) {
      return { path: configured, source: 'CHROME_PATH' };
    }
    throw new CaptureError(`環境変数 CHROME_PATH の場所にブラウザがありません（${configured}）。`);
  }
  for (const candidate of browserCandidates({ env, platform, home })) {
    if (exists(candidate)) {
      return { path: candidate, source: 'search' };
    }
  }
  throw new CaptureError(
    '画面を撮るブラウザ（Chrome・Edge・Chromium）が見つかりません。' +
      'ブラウザを入れるか、環境変数 CHROME_PATH にブラウザの実行ファイルの場所を入れてください。',
  );
}

/**
 * 書き出す先が git の対象の場所なら止める。本物のデータが写りうる画面を、git に入れないため。
 * git のリポジトリの外と、.gitignore で外した場所は通す。git が無いときも通す。
 *
 * @param path - 書き出すファイルの絶対パス
 */
export function assertNotTracked(path) {
  let dir = dirname(path);
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
  // 終了コード: 0 は外されている、1 は git の対象、128 はリポジトリの外など
  const result = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd: dir, encoding: 'utf8' });
  if (result.error === undefined && result.status === 1) {
    throw new CaptureError(
      [
        `${path} は git の対象の場所なので、書かずに止めました（撮った画面には本物のデータが写りうるので、git に入れません）。`,
        'テンプレートの .gitignore は /screenshots/ を外しています。行が無ければ足して、screenshots/ の下に書いてください。',
      ].join('\n'),
    );
  }
}

/** npm の出力から、通行証の行を取り出す。無ければ null */
export function findToken(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim());
  for (const line of lines.reverse()) {
    if (TOKEN_PATTERN.test(line)) {
      return line;
    }
  }
  return null;
}

/**
 * アプリの `npm run token -w server` で、開発用の通行証を発行する。
 * 通行証は、標準出力と標準エラーの両方に出る。どちらもエラーの文にそのまま出さない。
 *
 * @param appDir - アプリのフォルダ
 * @param runCommand - コマンドを動かす関数（lib/hook-io.mjs の run と同じ形。テストでは偽物を渡す）
 */
export function issueToken(appDir, runCommand = run) {
  const result = runCommand('npm', ['run', 'token', '-w', 'server', '--silent'], {
    cwd: appDir,
    timeout: TOKEN_TIMEOUT_MS,
  });
  if (result.failedToStart) {
    throw new CaptureError('npm を起動できないか、時間内に終わりませんでした。通行証を発行できません。');
  }
  const token = findToken(result.stdout);
  if (result.status === 0 && token !== null) {
    return token;
  }
  const lines = [`通行証を発行できませんでした（npm run token -w server の終了コード ${result.status}）。`];
  for (const line of String(result.stderr ?? '').split(/\r?\n/)) {
    const text = line.trim();
    if (text !== '' && !TOKEN_IN_TEXT.test(text) && lines.length <= 5) {
      lines.push(`  ${text}`);
    }
  }
  throw new CaptureError(lines.join('\n'));
}

/** ページの読み込みの前に、通行証を localStorage の token に入れるスクリプト（アプリの api-client.ts が読む場所） */
export function tokenScript(token) {
  return `try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch {}`;
}

/** 画像の形式（data URL の種類）。分からなければ null */
export function imageMime(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

/** PNG の幅と高さ。PNG でなければ null */
export function pngSize(buffer) {
  if (imageMime(buffer) !== 'image/png' || buffer.length < 24) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** HTML の本文に入れる文字を逃がす */
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 画像を data URL にする。形式が分からなければ止める */
function dataUrl(buffer, label) {
  const mime = imageMime(buffer);
  if (mime === null) {
    throw new CaptureError(`${label} の画像の形式が分かりません（PNG と JPEG を受け付けます）。`);
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** 並べた画像の幅（ピクセル）。buildCompareHtml の CSS と同じ計算 */
export function compareWidth(columnWidth) {
  return COMPARE_PADDING * 2 + columnWidth * 2 + COMPARE_GAP;
}

/**
 * 2 枚の画像を横に並べる HTML を組む。画像は data URL で埋め込む（ファイルの場所に頼らない）。
 * 1 枚を置く幅は columnWidth で、それより広い画像は縮め、狭い画像はそのままの大きさで左上に置く。
 *
 * @param left - `{ image: Buffer, label }`（左に置く。元の画面）
 * @param right - `{ image: Buffer, label }`（右に置く。新しい画面）
 */
export function buildCompareHtml({ left, right, columnWidth = DEFAULT_COLUMN_WIDTH }) {
  const figures = [];
  for (const [side, item] of [
    ['左', left],
    ['右', right],
  ]) {
    figures.push(
      `<figure><figcaption>${escapeHtml(item.label)}</figcaption><img src="${dataUrl(item.image, side)}" alt=""></figure>`,
    );
  }
  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8"><style>',
    "body{margin:0;background:#f3f4f6;font-family:system-ui,'Segoe UI','Hiragino Sans','Noto Sans CJK JP','Yu Gothic UI',Meiryo,sans-serif}",
    `.row{display:flex;align-items:flex-start;gap:${COMPARE_GAP}px;padding:${COMPARE_PADDING}px;width:max-content}`,
    `figure{margin:0;width:${columnWidth}px}`,
    'figcaption{margin:0 0 8px;font-size:20px;font-weight:700;color:#111827}',
    'img{display:block;max-width:100%;height:auto;outline:1px solid #9ca3af}',
    '</style></head><body>',
    `<div class="row">${figures.join('')}</div>`,
    '</body></html>',
    '',
  ].join('\n');
}

/** 指定の時間だけ待つ */
function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

/** DevTools プロトコルの接続。命令を送って結果を待つ（send）と、知らせを受ける（on）だけを持つ */
class DevToolsConnection {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      this.#receive(event.data);
    });
    socket.addEventListener('close', () => {
      this.#closed = true;
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer);
        reject(new CaptureError('ブラウザとの接続が切れました。'));
      }
      this.#pending.clear();
    });
  }

  /** ブラウザの DevTools の接続先（ws://）に繋ぐ */
  static connect(url) {
    return new Promise((resolveConnect, rejectConnect) => {
      const socket = new WebSocket(url);
      socket.addEventListener(
        'open',
        () => {
          resolveConnect(new DevToolsConnection(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          rejectConnect(new CaptureError('ブラウザの DevTools に繋げませんでした。'));
        },
        { once: true },
      );
    });
  }

  #receive(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new CaptureError(`ブラウザが ${pending.method} を断りました（${message.error.message}）。`));
        return;
      }
      pending.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.#listeners) {
      if (listener.method === message.method && listener.sessionId === message.sessionId) {
        listener.handler(message.params ?? {});
      }
    }
  }

  /**
   * 命令を送り、結果を待つ。
   *
   * @param sessionId - ページに送るときは、そのページのセッション。ブラウザ全体に送るときは undefined
   */
  send(method, params = {}, sessionId = undefined, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (this.#closed) {
      return Promise.reject(new CaptureError('ブラウザとの接続が切れています。'));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const message = { id, method, params };
    if (sessionId !== undefined) {
      message.sessionId = sessionId;
    }
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectSend(new CaptureError(`ブラウザが ${method} に ${timeoutMs / 1000} 秒で答えませんでした。`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolveSend, reject: rejectSend, timer, method });
      this.#socket.send(JSON.stringify(message));
    });
  }

  /**
   * 知らせを受ける。
   *
   * @returns 受けるのをやめる関数
   */
  on(method, sessionId, handler) {
    const listener = { method, sessionId, handler };
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close() {
    if (!this.#closed) {
      this.#socket.close();
    }
  }
}

/** 子のプロセスが終わるのを待つ。時間内に終われば true */
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      resolveExit(false);
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

/**
 * 撮っている間に作ったもの（起動したブラウザと一時のフォルダ）。
 * シグナルで止められたときに片づける（cleanUpOnSignal）。片づけないと、ブラウザと一時のフォルダが残る。
 */
const leftovers = { child: null, dirs: new Set() };

/** 一時のフォルダを作り、片づける対象に入れる */
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  leftovers.dirs.add(dir);
  return dir;
}

/** 一時のフォルダを消す。Windows では、ブラウザが終わった直後はファイルを掴んでいることがあるので、数回やり直す */
function removeDirectory(dir) {
  leftovers.dirs.delete(dir);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // 一時のフォルダなので、消せなくても撮った結果には響かない
  }
}

/**
 * ブラウザを止め、一時のフォルダを消す。
 *
 * @param graceMs - ブラウザが自分で終わるのを待つ時間（ミリ秒）。過ぎたら止める（SIGKILL）
 */
async function shutdown(child, userDataDir, graceMs) {
  // 起動できなかった子（pid が無い）は、終わりの知らせが来ないので待たない
  if (child.pid !== undefined && !(await waitForExit(child, graceMs))) {
    child.kill('SIGKILL');
    await waitForExit(child, CLOSE_TIMEOUT_MS);
  }
  leftovers.child = null;
  removeDirectory(userDataDir);
}

/** シグナル（Ctrl+C や停止の指示）を受けたら、ブラウザを止めて一時のフォルダを消し、128 + シグナルの番号で終える */
function cleanUpOnSignal() {
  for (const [signal, number] of [
    ['SIGINT', 2],
    ['SIGTERM', 15],
    ['SIGHUP', 1],
  ]) {
    process.once(signal, () => {
      leftovers.child?.kill('SIGKILL');
      // 止めた直後は、ブラウザの子のプロセスがまだファイルを掴んでいる（Windows）。removeDirectory のやり直しで待つ
      for (const dir of [...leftovers.dirs]) {
        removeDirectory(dir);
      }
      process.exit(128 + number);
    });
  }
}

/**
 * ブラウザが標準エラーに出す「DevTools listening on ws://…」の行から、DevTools の接続先を読む。
 * 起動に失敗したときは、理由の文で失敗する（ブラウザの標準エラーの最後の数行を添える）。
 */
function readEndpoint(child, executable) {
  let stderr = '';
  return new Promise((resolveEndpoint, rejectEndpoint) => {
    const fail = (reason) => {
      clearTimeout(timer);
      const tail = stderr.trim().split(/\r?\n/).slice(-5).join('\n');
      rejectEndpoint(new CaptureError(`ブラウザ（${executable}）が${reason}。${tail === '' ? '' : `\n${tail}`}`));
    };
    const timer = setTimeout(() => {
      fail(`${LAUNCH_TIMEOUT_MS / 1000} 秒待っても DevTools の接続先を知らせませんでした`);
    }, LAUNCH_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (found !== null) {
        clearTimeout(timer);
        resolveEndpoint(found[1]);
      }
    });
    child.once('error', (error) => {
      fail(`起動できませんでした（${error.message}）`);
    });
    child.once('exit', (code, signal) => {
      fail(`すぐに終わりました（終了コード ${code ?? signal}）`);
    });
  });
}

/** 起動したブラウザ。ページを開いて撮る（capture）と、閉じる（close）を持つ */
class Browser {
  #child;
  #connection;
  #userDataDir;

  constructor(child, connection, userDataDir) {
    this.#child = child;
    this.#connection = connection;
    this.#userDataDir = userDataDir;
  }

  /** ブラウザを画面なしで起動し、DevTools に繋ぐ。失敗したら、ブラウザを止めて一時のフォルダを消してから止める */
  static async launch(executable) {
    const userDataDir = makeTempDir('shinnn-capture-');
    let child;
    try {
      // Windows の .cmd などと、実行ファイルでないものは、spawn がその場で投げる（error の知らせにならない）
      child = spawn(executable, [...browserArgs(), `--user-data-dir=${userDataDir}`, 'about:blank'], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      removeDirectory(userDataDir);
      throw new CaptureError(
        `ブラウザ（${executable}）を起動できませんでした（${error.code ?? error.message}）。` +
          'CHROME_PATH などが、ブラウザの実行ファイルを指しているかを確かめてください。',
      );
    }
    leftovers.child = child;
    try {
      const endpoint = await readEndpoint(child, executable);
      const connection = await DevToolsConnection.connect(endpoint);
      child.stderr.removeAllListeners('data');
      child.stderr.resume();
      return new Browser(child, connection, userDataDir);
    } catch (error) {
      await shutdown(child, userDataDir, 0);
      throw error;
    }
  }

  /**
   * 新しいページで URL を開き、PNG を撮る。
   *
   * @param options.token - 読み込みの前に localStorage に入れる通行証。入れないときは null
   * @param options.beforeCapture - 読み込みの後、撮る前にページで評価する式（Promise を返してよい）。無ければ null
   * @returns PNG の中身
   */
  async capture(url, { width, height, waitMs, timeoutMs, fullPage, token = null, beforeCapture = null }) {
    const connection = this.#connection;
    // 画面ごとに別の保存場所（localStorage・cookie）で開く。前に撮った画面の通行証が、次の画面に残らないため
    const { browserContextId } = await connection.send('Target.createBrowserContext', { disposeOnDetach: true });
    let targetId = null;
    try {
      ({ targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId }));
      const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
      await connection.send('Page.enable', {}, sessionId);
      await connection.send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      if (token !== null) {
        await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: tokenScript(token) }, sessionId);
      }
      await this.#navigate(sessionId, url, timeoutMs);
      if (beforeCapture !== null) {
        await connection.send('Runtime.evaluate', { expression: beforeCapture, awaitPromise: true }, sessionId);
      }
      await sleep(waitMs);

      const params = { format: 'png' };
      if (fullPage) {
        const metrics = await connection.send('Page.getLayoutMetrics', {}, sessionId);
        const content = metrics.cssContentSize ?? metrics.contentSize;
        params.captureBeyondViewport = true;
        params.clip = {
          x: 0,
          y: 0,
          width: Math.max(width, Math.ceil(content.width)),
          height: Math.min(MAX_CAPTURE_HEIGHT, Math.max(1, Math.ceil(content.height))),
          scale: 1,
        };
      }
      const { data } = await connection.send('Page.captureScreenshot', params, sessionId);
      return Buffer.from(data, 'base64');
    } finally {
      if (targetId !== null) {
        await connection.send('Target.closeTarget', { targetId }).catch(() => {});
      }
      await connection.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    }
  }

  /**
   * ページで URL を開き、読み込み（load）が終わるまで待つ。
   * 読み込みは、開いたときの loaderId（読み込みの番号）で見分ける。最初の about:blank の読み込みと取り違えないため。
   * 知らせは開く前から受ける（開いた結果より先に届くことがある）。
   */
  async #navigate(sessionId, url, timeoutMs) {
    const connection = this.#connection;
    const loaded = new Set();
    let onLoad = () => {};
    const stop = connection.on('Page.lifecycleEvent', sessionId, (params) => {
      if (params.name === 'load') {
        loaded.add(params.loaderId);
        onLoad();
      }
    });
    try {
      await connection.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
      const navigation = await connection.send('Page.navigate', { url }, sessionId, timeoutMs);
      if (navigation.errorText) {
        throw new CaptureError(
          `画面を開けませんでした（${shortUrl(url)}: ${navigation.errorText}）。URL が合っているかと、開く先のサーバーが動いているかを確かめてください。`,
        );
      }
      if (loaded.has(navigation.loaderId)) {
        return;
      }
      await new Promise((resolveLoad, rejectLoad) => {
        const timer = setTimeout(() => {
          rejectLoad(new CaptureError(`画面を ${timeoutMs / 1000} 秒で開ききれませんでした（${shortUrl(url)}）。`));
        }, timeoutMs);
        onLoad = () => {
          if (loaded.has(navigation.loaderId)) {
            clearTimeout(timer);
            resolveLoad();
          }
        };
      });
    } finally {
      stop();
    }
  }

  /** ブラウザを閉じ、一時のフォルダを消す */
  async close() {
    await this.#connection.send('Browser.close', {}, undefined, CLOSE_TIMEOUT_MS).catch(() => {});
    this.#connection.close();
    await shutdown(this.#child, this.#userDataDir, CLOSE_TIMEOUT_MS);
  }
}

/** エラーの文に出す URL。data URL は長いので頭だけにする */
function shortUrl(url) {
  return url.startsWith('data:') ? `${url.slice(0, 30)}…` : url;
}

/** 撮った画像を書く。フォルダが無ければ作る */
function writePng(path, png) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  const size = pngSize(png);
  return size === null ? path : `${path}（${size.width} × ${size.height}）`;
}

/** 画像のファイルを読む。無ければ止める */
function readImage(path, label) {
  if (!isFile(path)) {
    throw new CaptureError(`${label} の画像がありません（${path}）。`);
  }
  return readFileSync(path);
}

/**
 * 並べた画像の入力（画像のファイルか URL）を、画像の中身にする。URL なら撮る（通行証は入れない）。
 *
 * @param images - prepare が読んだ画像のファイルの中身（パス → 中身）
 */
async function loadInput(browser, input, images, options) {
  if (isUrlInput(input)) {
    return browser.capture(input, { ...options, token: null });
  }
  return images.get(input);
}

/** 撮った画像を待つ式。並べた画像のページで、埋め込んだ画像を描き終えるまで待つ */
const WAIT_FOR_IMAGES = 'Promise.all([...document.images].map((image) => image.decode().catch(() => null)))';

/**
 * 2 枚を横に並べた PNG を作る。
 *
 * @param workDir - 並べる HTML を置く一時のフォルダ
 */
async function compose(browser, workDir, { left, right, leftLabel, rightLabel, columnWidth, timeoutMs }) {
  const html = buildCompareHtml({
    left: { image: left, label: leftLabel },
    right: { image: right, label: rightLabel },
    columnWidth,
  });
  const htmlPath = join(workDir, `compare-${Date.now()}.html`);
  writeFileSync(htmlPath, html);
  return browser.capture(pathToFileURL(htmlPath).href, {
    width: compareWidth(columnWidth),
    height: 200,
    waitMs: 0,
    timeoutMs,
    fullPage: true,
    beforeCapture: WAIT_FOR_IMAGES,
  });
}

/**
 * ブラウザを起動する前に、書き出す先と、読む画像のファイルを確かめる（撮った後で止まらないため）。
 *
 * @returns `{ screens, images }`。screens は batch の一覧の画面（parseList の結果。ほかは空）、images は読んだ画像（パス → 中身）
 */
function prepare(command, options) {
  const outputs = [];
  const inputs = [];
  const screens = [];
  if (command === 'batch') {
    if (!isFile(options.list)) {
      throw new CaptureError(`一覧のファイルがありません（${options.list}）。`);
    }
    screens.push(...parseList(readFileSync(options.list, 'utf8')));
    for (const screen of screens) {
      outputs.push(join(options.outDir, `${screen.name}.png`));
      if (screen.original !== null) {
        outputs.push(join(options.outDir, 'compare', `${screen.name}.png`));
        inputs.push([screen.original, `${screen.name} の original`]);
      }
    }
  } else {
    outputs.push(options.out);
  }
  if (command === 'compare') {
    inputs.push([options.left, '--left'], [options.right, '--right']);
  }
  for (const output of outputs) {
    assertNotTracked(output);
  }
  const images = new Map();
  for (const [input, label] of inputs) {
    if (!isUrlInput(input)) {
      images.set(input, readImage(input, label));
    }
  }
  return { screens, images };
}

/**
 * batch の 1 画面を撮る。`original` があれば、元と並べた画像も作る。
 *
 * @param options.token - url の画面に入れる通行証（original には入れない）
 * @param options.images - prepare が読んだ画像のファイルの中身
 */
async function captureScreen(browser, workDir, screen, options) {
  const png = await browser.capture(screen.url, options);
  console.log(`撮りました: ${writePng(join(options.outDir, `${screen.name}.png`), png)}`);
  if (screen.original === null) {
    return;
  }
  const original = await loadInput(browser, screen.original, options.images, options);
  const compared = await compose(browser, workDir, { ...options, left: original, right: png });
  console.log(`並べました: ${writePng(join(options.outDir, 'compare', `${screen.name}.png`), compared)}`);
}

/** サブコマンドを実行する。書いたファイルを 1 行ずつ出す */
async function execute(command, options) {
  const { screens, images } = prepare(command, options);
  const browserPath = findBrowser().path;
  const token = options.token ? issueToken(options.appDir) : null;
  const browser = await Browser.launch(browserPath);
  let workDir = null;
  try {
    workDir = makeTempDir('shinnn-capture-work-');
    if (command === 'shot') {
      const png = await browser.capture(options.url, { ...options, token });
      console.log(`撮りました: ${writePng(options.out, png)}`);
      return;
    }
    if (command === 'compare') {
      const left = await loadInput(browser, options.left, images, options);
      const right = await loadInput(browser, options.right, images, options);
      const png = await compose(browser, workDir, { ...options, left, right });
      console.log(`並べました: ${writePng(options.out, png)}`);
      return;
    }
    // 画面ごとに成否を出し、撮れなかった画面があっても残りの画面を続ける（撮れなかった画面を、利用者が補えるように）
    const failed = [];
    for (const screen of screens) {
      try {
        await captureScreen(browser, workDir, screen, { ...options, token, images });
      } catch (error) {
        if (!(error instanceof CaptureError)) {
          throw error;
        }
        failed.push(screen.name);
        const reason = error.message.split(/\r?\n/).join(' ');
        console.error(`撮れませんでした: ${screen.name}（${reason}）`);
      }
    }
    if (failed.length > 0) {
      throw new CaptureError(
        `${screens.length} 画面のうち ${failed.length} 画面を撮れませんでした（${failed.join('、')}）。`,
      );
    }
  } finally {
    await browser.close();
    if (workDir !== null) {
      removeDirectory(workDir);
    }
  }
}

/** コマンドとして実行したか。テストから読み込んだときは、関数だけを使うので実行しない */
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
  cleanUpOnSignal();
  try {
    const parsed = parseCommand(process.argv.slice(2));
    if (parsed.help) {
      console.log(USAGE);
    } else {
      await execute(parsed.command, parsed.options);
    }
  } catch (error) {
    if (error instanceof CaptureError) {
      console.error(`[capture-screens] ${error.message}`);
    } else {
      console.error(`[capture-screens] 予期しないエラーで止まりました。\n${error?.stack ?? error}`);
    }
    process.exitCode = 1;
  }
}
