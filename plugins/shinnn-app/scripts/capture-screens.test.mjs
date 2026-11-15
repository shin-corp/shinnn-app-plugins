/**
 * capture-screens（画面を撮るスクリプト）の回帰テスト。`node --test scripts/` で実行する。
 *
 * ブラウザが無くても確かめられること:
 * - 引数の読み方（サブコマンドごとの要る引数・使えない引数・数の範囲）と、batch の一覧の読み方
 * - ブラウザの探し方。環境変数 CHROME_PATH を、OS ごとの決まった場所より先に見る（外の仕組みとの約束）
 * - 並べる HTML の組み方（画像の埋め込み・名前の逃がし・幅）
 * - 開発用の通行証の取り出し方と、失敗したときに通行証をエラーの文に出さないこと
 * - git の対象の場所には書かずに止まること
 * - `--no-sandbox` を Linux でだけ付けること
 * - 起動に失敗したとき（すぐに終わる・実行できない）に、分かる文で止まり、一時のフォルダを残さないこと
 *
 * 本物のブラウザで撮る試験は、ブラウザ（CHROME_PATH か決まった場所）が見つからないときに飛ばす。
 * 撮る試験は、スクリプトをコマンドとして動かし、PNG の幅と高さで結果を確かめる。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertNotTracked,
  browserArgs,
  browserCandidates,
  buildCompareHtml,
  CaptureError,
  compareWidth,
  findBrowser,
  findToken,
  imageMime,
  issueToken,
  parseCommand,
  parseList,
  pngSize,
  tokenScript,
} from './capture-screens.mjs';

const script = fileURLToPath(new URL('./capture-screens.mjs', import.meta.url));

/** 1 × 1 の PNG（透明） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** JPEG の頭（形式の判定だけに使う） */
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** 試験で使う通行証。JWT と同じ形 */
const TOKEN = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'capture-screens-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** CaptureError で止まり、メッセージが pattern に合うこと */
function assertCaptureError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof CaptureError, `CaptureError ではありません: ${error?.stack ?? error}`);
    assert.match(error.message, pattern);
    return true;
  });
}

describe('引数', () => {
  test('shot: 要る引数と既定の値を読み、パスを絶対パスにする', () => {
    const { command, options } = parseCommand(['shot', '--url', 'http://localhost:4200/items', '--out', 'a.png']);
    assert.equal(command, 'shot');
    assert.equal(options.url, 'http://localhost:4200/items');
    assert.equal(options.out, resolve('a.png'));
    assert.equal(options.width, 1280);
    assert.equal(options.height, 800);
    assert.equal(options.waitMs, 1000);
    assert.equal(options.timeoutMs, 30_000);
    assert.equal(options.fullPage, true);
    assert.equal(options.token, false);
    assert.equal(options.appDir, resolve('.'));
  });

  test('shot: 幅・高さ・待つ時間・見えている範囲だけ・通行証・アプリのフォルダを読む', () => {
    const { options } = parseCommand([
      'shot',
      '--url',
      'http://localhost:4200/',
      '--out',
      'a.png',
      '--width',
      '390',
      '--height',
      '844',
      '--wait-ms',
      '0',
      '--viewport-only',
      '--token',
      '--app-dir',
      'app',
    ]);
    assert.equal(options.width, 390);
    assert.equal(options.height, 844);
    assert.equal(options.waitMs, 0);
    assert.equal(options.fullPage, false);
    assert.equal(options.token, true);
    assert.equal(options.appDir, resolve('app'));
  });

  test('compare: URL はそのまま、それ以外は画像のファイルのパスとして読み、名前の既定は「元」「新」', () => {
    const { options } = parseCommand([
      'compare',
      '--left',
      'old.png',
      '--right',
      'http://localhost:4200/',
      '--out',
      'c.png',
    ]);
    assert.equal(options.left, resolve('old.png'));
    assert.equal(options.right, 'http://localhost:4200/');
    assert.equal(options.leftLabel, '元');
    assert.equal(options.rightLabel, '新');
    assert.equal(options.columnWidth, 1280);
  });

  test('サブコマンドが無い・知らない: 止める', () => {
    assertCaptureError(() => parseCommand(['--url', 'http://localhost/', '--out', 'a.png']), /サブコマンド/);
    assertCaptureError(() => parseCommand(['snap', '--url', 'http://localhost/', '--out', 'a.png']), /サブコマンド/);
  });

  test('要る引数が無い: 止める', () => {
    assertCaptureError(() => parseCommand(['shot', '--url', 'http://localhost/']), /shot には --out が要ります/);
    assertCaptureError(() => parseCommand(['compare', '--left', 'a.png', '--out', 'c.png']), /--right が要ります/);
    assertCaptureError(() => parseCommand(['batch', '--list', 'l.json']), /--out-dir が要ります/);
  });

  test('サブコマンドで使えない引数: 止める（compare の URL に通行証を入れない）', () => {
    assertCaptureError(
      () => parseCommand(['compare', '--left', 'a.png', '--right', 'b.png', '--out', 'c.png', '--token']),
      /--token は compare では使えません/,
    );
    assertCaptureError(
      () => parseCommand(['shot', '--url', 'http://localhost/', '--out', 'a.png', '--left-label', 'x']),
      /--left-label は shot では使えません/,
    );
  });

  test('知らない引数・余分な引数: 止める', () => {
    assertCaptureError(
      () => parseCommand(['shot', '--url', 'http://x/', '--out', 'a.png', '--full']),
      /引数を読めませんでした/,
    );
    assertCaptureError(
      () => parseCommand(['shot', 'extra', '--url', 'http://x/', '--out', 'a.png']),
      /知らない引数です/,
    );
  });

  test('数: 整数でない・範囲の外は止める', () => {
    const base = ['shot', '--url', 'http://localhost/', '--out', 'a.png'];
    assertCaptureError(() => parseCommand([...base, '--width', '12.5']), /--width には整数/);
    assertCaptureError(() => parseCommand([...base, '--width', '99']), /--width は 100 から 8000 の間/);
    assertCaptureError(() => parseCommand([...base, '--timeout-ms', '10']), /--timeout-ms は 1000 から/);
  });

  test('URL と出力のファイル: 開けない種類の URL と、.png で終わらない名前は止める', () => {
    assertCaptureError(
      () => parseCommand(['shot', '--url', 'localhost:4200', '--out', 'a.png']),
      /http・https・file・data/,
    );
    assertCaptureError(() => parseCommand(['shot', '--url', 'not a url', '--out', 'a.png']), /URL を読めませんでした/);
    assertCaptureError(() => parseCommand(['shot', '--url', 'http://localhost/', '--out', 'a.jpg']), /\.png で終えて/);
  });

  test('file の URL: .html と .htm のファイルだけを受け付け、.env などは止める', () => {
    assert.equal(
      parseCommand(['shot', '--url', 'file:///C:/app/page.HTM', '--out', 'a.png']).options.url,
      'file:///C:/app/page.HTM',
    );
    assertCaptureError(
      () => parseCommand(['shot', '--url', 'file:///C:/app/server/.env', '--out', 'a.png']),
      /file の URL は、\.html か \.htm のファイルにしてください/,
    );
    assertCaptureError(
      () => parseCommand(['compare', '--left', 'file:///C:/app/.env.local', '--right', 'b.png', '--out', 'c.png']),
      /--left の file の URL は/,
    );
    assertCaptureError(
      () => parseList(JSON.stringify([{ name: 'a', url: 'http://x/', original: 'file:///C:/old/.env' }])),
      /file の URL は/,
    );
    // 拡張子の点まで見る（名前の終わりが html なだけのファイルは通さない）
    assertCaptureError(
      () => parseCommand(['shot', '--url', 'file:///C:/app/notes-xhtml', '--out', 'a.png']),
      /file の URL は/,
    );
    // data の URL は、ファイルを読まないので通す
    assert.equal(
      parseCommand(['shot', '--url', 'data:text/html,<p>a</p>', '--out', 'a.png']).options.url,
      'data:text/html,<p>a</p>',
    );
  });

  test('--help: 使い方を出す印を返す', () => {
    assert.deepEqual(parseCommand(['--help']), { help: true });
  });
});

describe('batch の一覧', () => {
  test('name・url・original を読み、original は URL か絶対パスにする', () => {
    const screens = parseList(
      JSON.stringify([
        { name: '商品一覧', url: 'http://localhost:4200/items', original: 'screenshots/original/商品一覧.png' },
        { name: 'login', url: 'http://localhost:4200/login', original: 'https://old.example.test/login' },
        { name: 'about', url: 'http://localhost:4200/about' },
      ]),
    );
    assert.deepEqual(screens, [
      {
        name: '商品一覧',
        url: 'http://localhost:4200/items',
        original: resolve('screenshots/original/商品一覧.png'),
      },
      { name: 'login', url: 'http://localhost:4200/login', original: 'https://old.example.test/login' },
      { name: 'about', url: 'http://localhost:4200/about', original: null },
    ]);
  });

  test('ファイルの名前に使えない name・重なる name・url の無い画面・空の一覧: 止める', () => {
    assertCaptureError(
      () => parseList(JSON.stringify([{ name: '../a', url: 'http://x/' }])),
      /ファイルの名前に使える文字/,
    );
    assertCaptureError(
      () => parseList(JSON.stringify([{ name: '..', url: 'http://x/' }])),
      /ファイルの名前に使える文字/,
    );
    assertCaptureError(
      () =>
        parseList(
          JSON.stringify([
            { name: 'a', url: 'http://x/' },
            { name: 'a', url: 'http://y/' },
          ]),
        ),
      /前の画面と同じ/,
    );
    assertCaptureError(() => parseList(JSON.stringify([{ name: 'a' }])), /url がありません/);
    assertCaptureError(() => parseList('[]'), /1 つ以上/);
    assertCaptureError(() => parseList('{'), /JSON として読めませんでした/);
  });
});

describe('ブラウザの探し方', () => {
  test('外の仕組みとの約束: CHROME_PATH に値があれば、決まった場所にブラウザがあっても CHROME_PATH を使う', () => {
    const env = { CHROME_PATH: '/usr/bin/chromium', PATH: '/usr/bin' };
    const found = findBrowser({ env, platform: 'linux', home: '/home/u', exists: () => true });
    assert.deepEqual(found, { path: '/usr/bin/chromium', source: 'CHROME_PATH' });
  });

  test('CHROME_PATH の場所にブラウザが無い: ほかの場所を探さずに、CHROME_PATH の場所を示して止める', () => {
    const env = { CHROME_PATH: '/opt/missing/chrome', PATH: '/usr/bin' };
    assertCaptureError(
      () => findBrowser({ env, platform: 'linux', home: '/home/u', exists: (path) => path !== '/opt/missing/chrome' }),
      /環境変数 CHROME_PATH の場所にブラウザがありません（\/opt\/missing\/chrome）/,
    );
  });

  test('CHROME_PATH が空: 決まった場所を探す', () => {
    const env = { CHROME_PATH: '', PATH: '/usr/bin' };
    const found = findBrowser({
      env,
      platform: 'linux',
      home: '/home/u',
      exists: (path) => path === '/usr/bin/chromium',
    });
    assert.deepEqual(found, { path: '/usr/bin/chromium', source: 'search' });
  });

  test('Windows: Edge を Chrome より先に、Program Files (x86)・Program Files・LOCALAPPDATA の順に探す', () => {
    const env = {
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    };
    assert.deepEqual(browserCandidates({ env, platform: 'win32', home: 'C:\\Users\\u' }), [
      win32.join('C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      win32.join('C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
      win32.join('C:\\Users\\u\\AppData\\Local', 'Microsoft\\Edge\\Application\\msedge.exe'),
      win32.join('C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      win32.join('C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      win32.join('C:\\Users\\u\\AppData\\Local', 'Google\\Chrome\\Application\\chrome.exe'),
    ]);
    const found = findBrowser({
      env,
      platform: 'win32',
      home: 'C:\\Users\\u',
      exists: (path) => path.endsWith('chrome.exe') || path.startsWith('C:\\Program Files\\Microsoft'),
    });
    assert.equal(found.path, win32.join('C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'));
  });

  test('macOS: /Applications と、ホームの Applications の Chrome・Edge・Chromium を探す', () => {
    const candidates = browserCandidates({ env: {}, platform: 'darwin', home: '/Users/u' });
    assert.equal(candidates[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    assert.equal(candidates[1], '/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    assert.ok(candidates.includes('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'));
    assert.ok(candidates.includes('/Applications/Chromium.app/Contents/MacOS/Chromium'));
  });

  test('Linux: PATH の中の名前を、google-chrome・chromium・microsoft-edge の順に探し、同じフォルダを 2 度見ない', () => {
    const candidates = browserCandidates({
      env: { PATH: '/opt/bin:/usr/bin:/usr/bin' },
      platform: 'linux',
      home: '/home/u',
    });
    assert.equal(candidates[0], posix.join('/opt/bin', 'google-chrome'));
    assert.equal(candidates.filter((path) => path === '/usr/bin/google-chrome').length, 1);
    assert.ok(candidates.indexOf('/usr/bin/chromium') < candidates.indexOf('/usr/bin/microsoft-edge'));
    assert.ok(candidates.includes('/snap/bin/chromium'));
  });

  test('どこにも無い: ブラウザを入れるか CHROME_PATH を置くよう伝えて止める', () => {
    assertCaptureError(
      () => findBrowser({ env: { PATH: '/usr/bin' }, platform: 'linux', home: '/home/u', exists: () => false }),
      /ブラウザ（Chrome・Edge・Chromium）が見つかりません。.*CHROME_PATH/,
    );
  });
});

describe('並べる HTML', () => {
  test('2 枚を data URL で埋め込み、名前を逃がし、1 枚の幅を columnWidth にする', () => {
    const html = buildCompareHtml({
      left: { image: PNG_1X1, label: '元 <b>&' },
      right: { image: JPEG_HEAD, label: '新' },
      columnWidth: 640,
    });
    assert.ok(html.includes(`src="data:image/png;base64,${PNG_1X1.toString('base64')}"`), html);
    assert.ok(html.includes(`src="data:image/jpeg;base64,${JPEG_HEAD.toString('base64')}"`), html);
    assert.ok(html.includes('<figcaption>元 &lt;b&gt;&amp;</figcaption>'), html);
    assert.ok(html.includes('<figcaption>新</figcaption>'), html);
    assert.ok(html.indexOf('data:image/png') < html.indexOf('data:image/jpeg'), '左が元、右が新の順ではありません');
    assert.match(html, /figure\{margin:0;width:640px\}/);
    assert.match(html, /img\{display:block;max-width:100%;height:auto/);
  });

  test('並べた画像の幅: 余白 2 つと 1 枚の幅 2 つと間の和', () => {
    assert.equal(compareWidth(640), 16 * 2 + 640 * 2 + 24);
  });

  test('形式の分からない画像: 止める', () => {
    assertCaptureError(
      () =>
        buildCompareHtml({ left: { image: Buffer.from('text'), label: 'a' }, right: { image: PNG_1X1, label: 'b' } }),
      /左 の画像の形式が分かりません/,
    );
  });

  test('画像の形式と PNG の大きさを、ファイルの頭から読む', () => {
    assert.equal(imageMime(PNG_1X1), 'image/png');
    assert.equal(imageMime(JPEG_HEAD), 'image/jpeg');
    assert.equal(imageMime(Buffer.from('RIFF0000WEBPVP8 ')), null);
    assert.equal(imageMime(Buffer.from('GIF89a')), null);
    assert.equal(imageMime(Buffer.from('<svg')), null);
    assert.deepEqual(pngSize(PNG_1X1), { width: 1, height: 1 });
    assert.equal(pngSize(JPEG_HEAD), null);
  });
});

describe('開発用の通行証', () => {
  test('npm の出力から、通行証の形の最後の行を取り出す', () => {
    assert.equal(findToken(`\n> server@0.0.0 token\n> node scripts/issue-token.mjs\n\n${TOKEN}\n`), TOKEN);
    assert.equal(findToken('通行証はありません\n'), null);
  });

  test('npm run token -w server をアプリのフォルダで動かし、通行証を返す', () => {
    const calls = [];
    const fakeRun = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return {
        status: 0,
        stdout: `${TOKEN}\n`,
        stderr: `localStorage.setItem('token', '${TOKEN}')\n`,
        failedToStart: false,
      };
    };
    assert.equal(issueToken('/app', fakeRun), TOKEN);
    assert.deepEqual(calls, [{ command: 'npm', args: ['run', 'token', '-w', 'server', '--silent'], cwd: '/app' }]);
  });

  test('発行に失敗した: 理由の行を出し、通行証に見える行は出さない', () => {
    const fakeRun = () => ({
      status: 1,
      stdout: '',
      stderr: `JWT_SECRET が設定されていません。\n  localStorage.setItem('token', '${TOKEN}')\n`,
      failedToStart: false,
    });
    assertCaptureError(() => issueToken('/app', fakeRun), /終了コード 1）。\n {2}JWT_SECRET が設定されていません。$/);
    try {
      issueToken('/app', fakeRun);
    } catch (error) {
      assert.ok(!error.message.includes(TOKEN), error.message);
    }
  });

  test('npm を起動できない: 止める', () => {
    const fakeRun = () => ({ status: 1, stdout: '', stderr: '', failedToStart: true });
    assertCaptureError(() => issueToken('/app', fakeRun), /npm を起動できないか/);
  });

  test('読み込みの前に入れるスクリプト: localStorage の token に、文字列として入れる', () => {
    assert.equal(tokenScript(TOKEN), `try { localStorage.setItem('token', "${TOKEN}"); } catch {}`);
  });
});

/** git のリポジトリを作る。.gitignore に screenshots/ を書く */
function createGitRepo() {
  const root = mkdtempSync(join(workRoot, 'repo-'));
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  writeFileSync(join(root, '.gitignore'), '/screenshots/\n');
  return root;
}

describe('書き出す先', () => {
  test('.gitignore で外した場所と、リポジトリの外は通す', () => {
    const root = createGitRepo();
    assertNotTracked(join(root, 'screenshots', 'compare', 'items.png'));
    assertNotTracked(join(mkdtempSync(join(workRoot, 'outside-')), 'a.png'));
  });

  test('git の対象の場所: 書かずに止め、.gitignore の行を足すよう伝える', () => {
    const root = createGitRepo();
    assertCaptureError(
      () => assertNotTracked(join(root, 'docs', 'items.png')),
      /git の対象の場所なので、書かずに止めました[\s\S]*\/screenshots\/ を外しています。行が無ければ足して/,
    );
  });

  test('コマンド: git の対象の場所が出力なら、ブラウザを探す前に止まり、終了コード 1 で終える', () => {
    const root = createGitRepo();
    const out = join(root, 'items.png');
    const result = spawnSync(process.execPath, [script, 'shot', '--url', 'http://localhost:4200/', '--out', out], {
      encoding: 'utf8',
      env: { ...process.env, CHROME_PATH: join(root, 'no-browser') },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[capture-screens\] .*git の対象の場所なので/);
    assert.ok(!result.stderr.includes('CHROME_PATH'), result.stderr);
    assert.equal(existsSync(out), false);
  });
});

describe('ブラウザに渡す引数', () => {
  test('--no-sandbox は Linux でだけ付け、Windows と macOS では付けない', () => {
    assert.ok(browserArgs('linux').includes('--no-sandbox'));
    assert.ok(!browserArgs('win32').includes('--no-sandbox'));
    assert.ok(!browserArgs('darwin').includes('--no-sandbox'));
    assert.ok(browserArgs('win32').includes('--headless=new'));
    assert.ok(browserArgs('win32').includes('--remote-debugging-port=0'));
  });
});

/** 一時のフォルダの中に、スクリプトが作る一時のフォルダ（shinnn-capture-*）が残っているか */
function capturesLeftIn(dir) {
  return readdirSync(dir).filter((name) => name.startsWith('shinnn-capture-'));
}

/**
 * 起動に失敗するブラウザで、スクリプトをコマンドとして動かす。一時のフォルダの置き場所（TMP など）を、空のフォルダに向ける。
 *
 * @returns 終了コード・標準エラーと、一時のフォルダの置き場所
 */
function runWithBrokenBrowser(chromePath) {
  const temp = mkdtempSync(join(workRoot, 'temp-'));
  const out = join(workRoot, 'out', 'broken.png');
  const result = spawnSync(
    process.execPath,
    [script, 'shot', '--url', 'http://localhost:4200/', '--out', out, '--wait-ms', '0'],
    {
      cwd: workRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CHROME_PATH: chromePath, TMP: temp, TEMP: temp, TMPDIR: temp },
    },
  );
  return { status: result.status, stderr: result.stderr, temp, out };
}

describe('起動に失敗したとき', () => {
  test('すぐに終わるもの（node）を CHROME_PATH に置いた: 理由を出して終了コード 1 で終え、一時のフォルダを残さない', () => {
    // node は、ブラウザの引数（--headless=new）を知らないので、終了コード 9 ですぐに終わる
    const result = runWithBrokenBrowser(process.execPath);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^\[capture-screens\] ブラウザ（.+）がすぐに終わりました（終了コード 9）。/);
    assert.deepEqual(capturesLeftIn(result.temp), []);
    assert.equal(existsSync(result.out), false);
  });

  test('実行できないもの（Windows の .cmd、ほかは実行の権限の無いファイル）: 分かる文で止め、一時のフォルダを残さない', () => {
    const fake = join(mkdtempSync(join(workRoot, 'fake-')), process.platform === 'win32' ? 'browser.cmd' : 'browser');
    writeFileSync(fake, '@echo off\n', { mode: 0o644 });
    const result = runWithBrokenBrowser(fake);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^\[capture-screens\] ブラウザ（.+）(を起動できませんでした|が起動できませんでした)/);
    assert.doesNotMatch(result.stderr, /予期しないエラー/);
    assert.deepEqual(capturesLeftIn(result.temp), []);
  });
});

/** 本物のブラウザ。見つからなければ null（撮る試験を飛ばす） */
const realBrowser = (() => {
  try {
    return findBrowser().path;
  } catch {
    return null;
  }
})();

const skipWithoutBrowser = realBrowser === null ? 'ブラウザ（Chrome・Edge・Chromium）が見つからない' : false;

/** 一度 listen して閉じた番号（サーバーが動いていない番号）。Chrome が開かない番号（9 など）は ERR_UNSAFE_PORT になるので使わない */
function closedPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolvePort(port);
      });
    });
  });
}

/** スクリプトをコマンドとして動かす */
function runScript(args, { cwd = workRoot } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** 一時のフォルダに HTML を書き、file の URL を返す */
function htmlPage(name, body) {
  const path = join(workRoot, `${name}.html`);
  writeFileSync(
    path,
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${body}</body></html>\n`,
  );
  return pathToFileURL(path).href;
}

/** 書き出した PNG の幅と高さ */
function sizeOf(path) {
  return pngSize(readFileSync(path));
}

/**
 * `npm run token -w server` で通行証を出すだけのアプリのフォルダを作る。
 * 本物の issue-token.mjs と同じく、標準出力に通行証を、標準エラーに入れ方の例を出す。
 */
function createFakeApp() {
  const appDir = mkdtempSync(join(workRoot, 'app-'));
  mkdirSync(join(appDir, 'server'));
  writeFileSync(join(appDir, 'package.json'), '{"name":"fake-app","private":true,"workspaces":["server"]}\n');
  writeFileSync(
    join(appDir, 'server', 'package.json'),
    '{"name":"server","version":"0.0.0","private":true,"scripts":{"token":"node issue.mjs"}}\n',
  );
  writeFileSync(
    join(appDir, 'server', 'issue.mjs'),
    `console.log(${JSON.stringify(TOKEN)});\nconsole.error(${JSON.stringify(`localStorage.setItem('token', '${TOKEN}')`)});\n`,
  );
  return appDir;
}

/** 通行証が入っていれば高さ 777、無ければ 333 の箱を描くページ（PNG の高さで、通行証が入ったかを確かめる） */
function tokenSensitivePage(name) {
  return htmlPage(
    name,
    `<div id="box" style="width:100px;background:#c00"></div><script>document.getElementById('box').style.height = (localStorage.getItem('token') === ${JSON.stringify(TOKEN)} ? 777 : 333) + 'px';</script>`,
  );
}

describe('本物のブラウザで撮る', { skip: skipWithoutBrowser, timeout: 300_000 }, () => {
  test('shot: 見えている範囲だけなら、幅と高さは指定のとおり', () => {
    const url = htmlPage('plain', '<div style="width:100px;height:2000px;background:#c00"></div>');
    const out = join(workRoot, 'out', 'viewport.png');
    const result = runScript([
      'shot',
      '--url',
      url,
      '--out',
      out,
      '--width',
      '400',
      '--height',
      '300',
      '--wait-ms',
      '0',
      '--viewport-only',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^撮りました: .*viewport\.png（400 × 300）$/m);
    assert.deepEqual(sizeOf(out), { width: 400, height: 300 });
  });

  test('shot: 既定はページ全体で、下まで続くページは高さが伸びる', () => {
    const url = htmlPage('tall', '<div style="width:100px;height:1234px;background:#c00"></div>');
    const out = join(workRoot, 'out', 'full.png');
    const result = runScript([
      'shot',
      '--url',
      url,
      '--out',
      out,
      '--width',
      '400',
      '--height',
      '300',
      '--wait-ms',
      '0',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sizeOf(out), { width: 400, height: 1234 });
  });

  test('shot --token: 発行した通行証を、ページのスクリプトより先に localStorage の token に入れ、出力には出さない', () => {
    const appDir = createFakeApp();
    const url = tokenSensitivePage('token');
    const common = ['--width', '400', '--height', '300', '--wait-ms', '0'];

    const withToken = join(workRoot, 'out', 'with-token.png');
    const result = runScript(['shot', '--url', url, '--out', withToken, ...common, '--token', '--app-dir', appDir]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sizeOf(withToken).height, 777);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(TOKEN), `${result.stdout}${result.stderr}`);

    const withoutToken = join(workRoot, 'out', 'without-token.png');
    assert.equal(runScript(['shot', '--url', url, '--out', withoutToken, ...common]).status, 0);
    assert.equal(sizeOf(withoutToken).height, 333);
  });

  test('compare: 画像のファイルと URL を横に並べ、幅は余白 2 つと 1 枚の幅 2 つと間の和になる', () => {
    const left = join(workRoot, 'out', 'left.png');
    const leftUrl = htmlPage('left', '<div style="width:300px;height:500px;background:#1565c0"></div>');
    assert.equal(
      runScript(['shot', '--url', leftUrl, '--out', left, '--width', '300', '--height', '200', '--wait-ms', '0'])
        .status,
      0,
    );
    const rightUrl = htmlPage('right', '<div style="width:200px;height:150px;background:#3f51b5"></div>');
    const out = join(workRoot, 'out', 'compare.png');
    const result = runScript([
      'compare',
      '--left',
      left,
      '--right',
      rightUrl,
      '--out',
      out,
      '--column-width',
      '300',
      '--width',
      '200',
      '--height',
      '150',
      '--wait-ms',
      '0',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^並べました: /m);
    const size = sizeOf(out);
    assert.equal(size.width, compareWidth(300));
    assert.ok(size.height > 500, `高さが元の画像より低い: ${size.height}`);
  });

  test('batch: 一覧の画面を撮り、original を書いた画面だけ元と並べた画像も作る', () => {
    const original = join(workRoot, 'out', 'original.png');
    const originalUrl = htmlPage('original', '<div style="width:200px;height:100px;background:#090"></div>');
    assert.equal(
      runScript([
        'shot',
        '--url',
        originalUrl,
        '--out',
        original,
        '--width',
        '200',
        '--height',
        '100',
        '--wait-ms',
        '0',
      ]).status,
      0,
    );
    const list = join(workRoot, 'list.json');
    writeFileSync(
      list,
      JSON.stringify([
        { name: '商品一覧', url: htmlPage('items', '<p>一覧</p>'), original },
        { name: 'about', url: htmlPage('about', '<p>説明</p>') },
      ]),
    );
    const outDir = join(workRoot, 'batch');
    const result = runScript([
      'batch',
      '--list',
      list,
      '--out-dir',
      outDir,
      '--width',
      '320',
      '--height',
      '200',
      '--wait-ms',
      '0',
      '--column-width',
      '320',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sizeOf(join(outDir, '商品一覧.png')), { width: 320, height: 200 });
    assert.deepEqual(sizeOf(join(outDir, 'about.png')), { width: 320, height: 200 });
    assert.equal(sizeOf(join(outDir, 'compare', '商品一覧.png')).width, compareWidth(320));
    assert.equal(existsSync(join(outDir, 'compare', 'about.png')), false);
  });

  test('batch --token: 通行証は url の画面にだけ入れ、original の URL（元のアプリ）には入れない', () => {
    const appDir = createFakeApp();
    const list = join(workRoot, 'token-list.json');
    writeFileSync(
      list,
      JSON.stringify([
        { name: 'new', url: tokenSensitivePage('batch-new') },
        { name: 'plain', url: htmlPage('batch-plain', '<p>新</p>'), original: tokenSensitivePage('batch-original') },
      ]),
    );
    const outDir = join(workRoot, 'batch-token');
    const result = runScript([
      'batch',
      '--list',
      list,
      '--out-dir',
      outDir,
      '--token',
      '--app-dir',
      appDir,
      '--width',
      '300',
      '--height',
      '200',
      '--wait-ms',
      '0',
      '--column-width',
      '300',
    ]);
    assert.equal(result.status, 0, result.stderr);
    // url の画面には入る（箱の高さ 777）
    assert.equal(sizeOf(join(outDir, 'new.png')).height, 777);
    // original には入らない（箱の高さ 333）。右の新しい画面は 200 なので、並べた画像の高さは左の original で決まる
    const compared = sizeOf(join(outDir, 'compare', 'plain.png'));
    assert.ok(compared.height < 600, `original に通行証が入っている（並べた画像の高さ ${compared.height}）`);
  });

  test('開けない URL（サーバーが動いていない）: 理由を出して、終了コード 1 で終える', async () => {
    const port = await closedPort();
    const out = join(workRoot, 'out', 'refused.png');
    const result = runScript([
      'shot',
      '--url',
      `http://127.0.0.1:${port}/`,
      '--out',
      out,
      '--wait-ms',
      '0',
      '--timeout-ms',
      '15000',
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `^\\[capture-screens\\] 画面を開けませんでした（http://127\\.0\\.0\\.1:${port}/: net::ERR_CONNECTION_REFUSED`,
        'm',
      ),
    );
    assert.equal(existsSync(out), false);
  });

  test('batch で開けない画面がある: その画面に理由を出して残りの画面を撮り、最後に終了コード 1 で終える', async () => {
    const port = await closedPort();
    const list = join(workRoot, 'partial-list.json');
    writeFileSync(
      list,
      JSON.stringify([
        { name: 'bad', url: `http://127.0.0.1:${port}/` },
        { name: 'good', url: htmlPage('partial-good', '<p>撮れる</p>') },
      ]),
    );
    const outDir = join(workRoot, 'partial');
    const result = runScript(['batch', '--list', list, '--out-dir', outDir, '--wait-ms', '0', '--timeout-ms', '15000']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^撮れませんでした: bad（画面を開けませんでした（.*net::ERR_CONNECTION_REFUSED/m);
    assert.match(result.stdout, /^撮りました: .*good\.png/m);
    assert.equal(existsSync(join(outDir, 'good.png')), true);
    assert.equal(existsSync(join(outDir, 'bad.png')), false);
    assert.match(result.stderr, /^\[capture-screens\] 2 画面のうち 1 画面を撮れませんでした（bad）。$/m);
  });

  test('シグナル（SIGTERM）を受けた: ブラウザを止め、一時のフォルダを残さず、終了コード 143 で終える', async () => {
    const temp = mkdtempSync(join(workRoot, 'signal-temp-'));
    // 撮っている途中（作業のフォルダができた後）に、スクリプトの中で SIGTERM を起こす
    const preload = join(workRoot, 'emit-sigterm.mjs');
    writeFileSync(
      preload,
      [
        "import { readdirSync } from 'node:fs';",
        'const timer = setInterval(() => {',
        "  if (readdirSync(process.env.TMP).some((name) => name.startsWith('shinnn-capture-work-'))) {",
        '    clearInterval(timer);',
        "    process.emit('SIGTERM');",
        '  }',
        '}, 100);',
        'timer.unref();',
        '',
      ].join('\n'),
    );
    const url = htmlPage('signal', '<p>待つ</p>');
    const out = join(workRoot, 'out', 'signal.png');
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(preload).href, script, 'shot', '--url', url, '--out', out, '--wait-ms', '20000'],
      { cwd: workRoot, env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp } },
    );
    const status = await new Promise((resolveExit) => {
      child.on('exit', (code) => {
        resolveExit(code);
      });
    });
    assert.equal(status, 143);
    assert.deepEqual(capturesLeftIn(temp), []);
    assert.equal(existsSync(out), false);
  });
});
