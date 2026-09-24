#!/usr/bin/env node
// 開発環境を調べ、ローカルの PostgreSQL をどう用意するかを決める。検出だけを行う。
//
// 実行例:
//   node <プラグイン>/scripts/setup-env.mjs             検出して結果を表示する
//   node <プラグイン>/scripts/setup-env.mjs --write      PostgreSQL の検出結果を docs/env.md に追記する
//
// 引数:
//   --repo-dir <パス>  対象のリポジトリ（既定は CLAUDE_PROJECT_DIR、無ければカレント）。docs/env.md はこの下
//   --write            PostgreSQL の検出結果を docs/env.md に追記する
//   --database <方式>  検出の結果に関わらず、この方式の手順を出す（setup で利用者が選んだ方式を書くため）。
//                      database-url / local-postgres / docker / pglite / managed
//
// 開発環境として、OS / Node.js / npm / Git / GitHub CLI（gh。ログインの状態とスコープ）/ Docker を表で示す。
// 使う人のパソコンごとに違うので、この表は docs/env.md に書かない。
// 外部のコマンドはシェルを介さずに呼び、見つからないものは「見つかりません」として続ける。
//
// PostgreSQL の検出の順番（先に見つかったものを採用する）:
//   1. DATABASE_URL が設定済み          → そのまま使う
//   2. localhost:5432 に接続できる      → 既に動いている PostgreSQL を使う
//   3. docker info が成功する           → docker compose --profile dev up -d
//   4. いずれも無い                     → PGlite（API サーバーの中で動く。入れるものが無い）
// 本番と同じ PostgreSQL で確かめたい場合は、マネージドの無料枠（managed）も選べる。
//
// このスクリプトは検出と案内だけを行う。導入の実行は /shinnn-app:setup が行う。

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { release, version as osVersion } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/** 値を取る引数（`--名前 値`）を読む。無ければ undefined */
function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const repositoryRoot = resolve(readOption('--repo-dir') || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const envDocumentPath = join(repositoryRoot, 'docs', 'env.md');
const shouldWrite = process.argv.includes('--write');
const postgresPort = 5432;
const connectTimeoutMs = 1500;
const commandTimeoutMs = 15000;

/** 前提の Node.js の版。テンプレートのルートの package.json の engines（>=24.15 <25）と同じ */
const requiredNode = { major: 24, minor: 15 };

/** 前提の npm の系。Node.js 24 に同梱される版 */
const requiredNpmMajor = 11;

/** コマンドを実行して成功したかを返す。 */
function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: commandTimeoutMs });

    return true;
  } catch {
    return false;
  }
}

/** コマンドを実行し、終了コードと出力を返す。コマンドが無い・時間切れで起動できなければ null。 */
function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: commandTimeoutMs });

  if (result.error !== undefined) {
    return null;
  }

  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** コマンドが出す版（x.y.z）を返す。コマンドが無い・失敗したときは null。 */
function commandVersion(command, args) {
  const result = runCommand(command, args);

  if (result === null || result.status !== 0) {
    return null;
  }

  return result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? result.stdout.split('\n')[0];
}

/** OS の名前と版。WSL の中なら、そう分かるようにする（Windows 側とは入っているものが違うため）。 */
function describeOs() {
  const architecture = `（${process.arch}）`;

  if (process.platform === 'win32') {
    return `${osVersion()} ${release()}${architecture}`;
  }
  if (process.platform === 'darwin') {
    const productVersion = runCommand('sw_vers', ['-productVersion']);

    return `macOS ${productVersion?.status === 0 ? productVersion.stdout : release()}${architecture}`;
  }
  if (process.platform === 'linux') {
    return `Linux ${release()}${/microsoft/i.test(release()) ? '（WSL）' : ''}${architecture}`;
  }

  return `${process.platform} ${release()}${architecture}`;
}

/**
 * npm の版。見つからなければ null、あるが版を確かめられなければ空文字。
 *
 * Windows の npm は多くの場合 npm.cmd で、シェルを介さずには起動できない。そのときは PATH で最初に
 * 見つかる npm.cmd と同じフォルダにある npm 本体の package.json から版を読む（npm.cmd が動かすのはこの本体）。
 */
function detectNpmVersion() {
  const version = commandVersion('npm', ['--version']);

  if (version !== null || process.platform !== 'win32') {
    return version;
  }

  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '' || !existsSync(join(directory, 'npm.cmd'))) {
      continue;
    }

    try {
      return JSON.parse(readFileSync(join(directory, 'node_modules', 'npm', 'package.json'), 'utf8')).version;
    } catch {
      return '';
    }
  }

  return null;
}

/** `gh auth status` のスコープの並び（`'repo', 'workflow'` や `repo, workflow`）を配列にする。 */
function splitScopes(scopes) {
  if (typeof scopes !== 'string') {
    return [];
  }

  return scopes
    .split(',')
    .map((scope) => scope.trim().replace(/^'|'$/g, ''))
    .filter((scope) => scope !== '');
}

/**
 * github.com へのログインの状態とスコープ。トークンそのものは出さない（--show-token を付けない）。
 * `--json` は新しい gh にしかないので、使えなければ文字の出力から読む。
 */
function detectGhLogin() {
  const json = runCommand('gh', ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts']);

  if (json !== null && json.status === 0) {
    try {
      const accounts = JSON.parse(json.stdout).hosts?.['github.com'] ?? [];
      const account = accounts.find((entry) => entry.active) ?? accounts[0];

      if (account === undefined) {
        return { login: null };
      }

      return { login: account.login, valid: account.state === 'success', scopes: splitScopes(account.scopes) };
    } catch {
      // 読めなければ、下の文字の出力で確かめる
    }
  }

  const text = runCommand('gh', ['auth', 'status', '--hostname', 'github.com']);
  const output = text === null ? '' : `${text.stdout}\n${text.stderr}`;
  const login = output.match(/Logged in to github\.com (?:account |as )(\S+)/)?.[1];

  if (login === undefined) {
    return { login: null };
  }

  return { login, valid: text.status === 0, scopes: splitScopes(output.match(/Token scopes: (.*)/)?.[1]) };
}

/** 開発環境の表の行。検出した内容と、足りないときにどうするかを 1 行ずつ持つ。 */
function detectEnvironment() {
  const rows = [];
  const osSupported = ['win32', 'darwin', 'linux'].includes(process.platform);

  rows.push({
    item: 'OS',
    detected: describeOs(),
    verdict: osSupported ? '対応しています' : '動作を確かめていない OS です',
  });

  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const nodeOk = nodeMajor === requiredNode.major && nodeMinor >= requiredNode.minor;

  rows.push({
    item: 'Node.js',
    detected: process.versions.node,
    verdict: nodeOk
      ? '満たしています'
      : `足りません。${requiredNode.major} 系の ${requiredNode.major}.${requiredNode.minor} 以上を入れてください`,
  });

  const npmVersion = detectNpmVersion();

  if (npmVersion === null) {
    rows.push({ item: 'npm', detected: '見つかりません', verdict: 'Node.js を入れると同梱されます' });
  } else if (npmVersion === '') {
    rows.push({
      item: 'npm',
      detected: 'あります（版を確かめられません）',
      verdict: `\`npm -v\` で ${requiredNpmMajor} 系かを確かめてください`,
    });
  } else {
    rows.push({
      item: 'npm',
      detected: npmVersion,
      verdict:
        Number(npmVersion.split('.')[0]) === requiredNpmMajor
          ? '満たしています'
          : `${requiredNpmMajor} 系ではありません。Node.js ${requiredNode.major} に同梱の npm を使ってください`,
    });
  }

  const gitVersion = commandVersion('git', ['--version']);

  rows.push({
    item: 'Git',
    detected: gitVersion ?? '見つかりません',
    verdict: gitVersion === null ? '必須です。Git を入れてください' : '使えます',
  });

  const ghVersion = commandVersion('gh', ['--version']);

  if (ghVersion === null) {
    rows.push({
      item: 'GitHub CLI（gh）',
      detected: '見つかりません',
      verdict: 'Issue と PR を使う機能が動きません。GitHub CLI を入れて `gh auth login` でログインしてください',
    });
  } else {
    const gh = detectGhLogin();

    if (gh.login === null) {
      rows.push({
        item: 'GitHub CLI（gh）',
        detected: `${ghVersion}。ログインしていません`,
        verdict: '`gh auth login` でログインしてください',
      });
    } else if (!gh.valid) {
      rows.push({
        item: 'GitHub CLI（gh）',
        detected: `${ghVersion}。${gh.login} のログインを確かめられません`,
        verdict: '`gh auth status` で理由を見て、ログインが切れていれば `gh auth login` でログインし直してください',
      });
    } else {
      const scopes = gh.scopes.length > 0 ? gh.scopes.join(', ') : '確かめられません';
      let verdict = '使えます';

      if (gh.scopes.length > 0 && !gh.scopes.includes('workflow')) {
        verdict =
          '使えます。`workflow` スコープが無いので、ワークフローを変える PR を gh からマージできません' +
          '（足すには `gh auth refresh -h github.com -s workflow`）';
      }

      rows.push({
        item: 'GitHub CLI（gh）',
        detected: `${ghVersion}。ログイン: ${gh.login}。スコープ: ${scopes}`,
        verdict,
      });
    }
  }

  const dockerVersion = commandVersion('docker', ['--version']);
  // 動いているかは PostgreSQL の検出 3 でも使う
  const dockerRunning = dockerVersion !== null && commandSucceeds('docker', ['info']);

  if (dockerVersion === null) {
    rows.push({
      item: 'Docker',
      detected: '見つかりません',
      verdict: '任意です。無ければ PostgreSQL は下の候補から選びます',
    });
  } else {
    rows.push({
      item: 'Docker',
      detected: `${dockerVersion}。${dockerRunning ? '動いています' : '動いていません'}`,
      verdict: dockerRunning
        ? '使えます'
        : '任意です。使うなら Docker Desktop（または WSL の Docker Engine）を起動してください',
    });
  }

  return { rows, dockerRunning };
}

/** 開発環境の表を Markdown の表にする。 */
function formatEnvironment(rows) {
  return [
    '## 開発環境',
    '',
    '| もの | 検出した内容 | 判定 |',
    '| :-- | :-- | :-- |',
    ...rows.map((row) => `| ${row.item} | ${row.detected} | ${row.verdict} |`),
  ].join('\n');
}

/** TCP ポートに接続できるかを確かめる。 */
function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(connectTimeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * PostgreSQL の用意の仕方。キーは `.shinnn/setup.json` の `database.mode` と同じ語。
 * `howToStart` は docs/env.md の「起動と停止」に 1 行ずつ箇条書きで入る。
 */
const databaseModes = {
  'database-url': {
    label: '環境変数 DATABASE_URL の接続先',
    howToStart: ['既に用意されている PostgreSQL に接続します。起動と停止は提供元の手順に従ってください。'],
  },
  'local-postgres': {
    label: `このパソコンで動いている PostgreSQL（localhost:${postgresPort}）`,
    howToStart: ['サービスとして常駐しています。停止と起動は OS のサービス管理から行います。'],
  },
  docker: {
    label: 'Docker の PostgreSQL 16（docker-compose.yml。Docker Desktop でも WSL の Docker Engine でも動きます）',
    howToStart: [
      '起動: `docker compose --profile dev up -d`',
      '停止: `docker compose --profile dev down`',
      'テスト用（ポート 5433、データを残さない）: `docker compose --profile test up -d`',
    ],
  },
  pglite: {
    label: 'PGlite（API サーバーの中で動く PostgreSQL。Docker も PostgreSQL も要りません）',
    howToStart: [
      '設定: `server/.env` の `DB_DRIVER` を `pglite` にします（`.env.example` の `# DB_DRIVER=pg` の行）。`DATABASE_URL` は使われません',
      '起動と停止: API サーバー（`npm run dev -w server`）と一緒に動きます。起動のたびにマイグレーションを適用するので、`db:migrate` は実行しません',
      'データ: `server/.pglite/` に残ります（git の管理外）。消すと空の DB からやり直せます',
      '注意: API サーバーを動かしている間は、`seed` など同じ DB を開く別のコマンドを実行しません。本番では使わず、本番の前に PostgreSQL で動作を確かめます',
    ],
  },
  managed: {
    label: 'マネージドの PostgreSQL（Neon などの無料枠）',
    howToStart: ['接続先を `server/.env` の `DATABASE_URL` に書きます。起動と停止は提供元の管理画面で行います。'],
  },
};

const databaseArgument = readOption('--database');

if (databaseArgument !== undefined && !Object.hasOwn(databaseModes, databaseArgument)) {
  console.error(
    `--database に指定できるのは ${Object.keys(databaseModes).join(' / ')} です（指定: ${databaseArgument}）`,
  );
  process.exit(1);
}

const environment = detectEnvironment();

console.log(formatEnvironment(environment.rows));

const results = [];
let detected = null;

if (typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0) {
  results.push('DATABASE_URL: 設定済み');
  detected = 'database-url';
} else {
  results.push('DATABASE_URL: 未設定');
}

if (detected === null) {
  const reachable = await canConnect('127.0.0.1', postgresPort);

  results.push(`localhost:${postgresPort}: ${reachable ? '接続できました' : '接続できません'}`);

  if (reachable) {
    detected = 'local-postgres';
  }
}

if (detected === null) {
  const dockerAvailable = environment.dockerRunning;

  results.push(`docker: ${dockerAvailable ? '使えます' : '使えません'}`);

  // Docker Desktop に限らず、`docker` コマンドが動けばよい（WSL の Docker Engine も同じ）。
  // WSL の中だけに入れている場合、Windows 側からは `docker` が見えないので「使えません」になる。
  // その場合も WSL でコンテナを起動すれば localhost:5432 に出るので、上の検出 2 で拾える。
  if (!dockerAvailable) {
    results.push(
      'docker の補足: WSL の中だけに Docker がある場合は、WSL でコンテナを起動すると localhost:5432 経由で使えます',
    );
  }

  if (dockerAvailable) {
    detected = 'docker';
  }
}

// Docker も PostgreSQL も無いパソコンでは、API サーバーの中で動く PGlite を使う（入れるものが無い）
if (detected === null) {
  detected = 'pglite';
}

const adopted = databaseArgument ?? detected;

if (adopted !== detected) {
  results.push(`指定された方法: ${adopted}（検出で最初に見つかったのは ${detected}）`);
}

const summary = [
  '',
  '## ローカルの PostgreSQL',
  '',
  `- 採用: ${databaseModes[adopted].label}`,
  `- 検出日: ${new Date().toISOString().slice(0, 10)}`,
  '',
  '### 起動と停止',
  '',
  ...databaseModes[adopted].howToStart.map((line) => `- ${line}`),
  '',
  '### 検出の結果',
  '',
  ...results.map((line) => `- ${line}`),
  '',
  '### 採用しなかった場合の代わり',
  '',
  '- テストは常に PGlite（Postgres の WASM 版）を使うので、上のどれが選ばれても実行できます。',
  '- 本番と同じ PostgreSQL で確かめたいときは、マネージドの PostgreSQL の無料枠（Neon など）も使えます。',
  '  接続先を `DATABASE_URL` に設定すれば、このスクリプトは 1 番目の候補として認識します。',
  '',
].join('\n');

console.log(summary);

if (!shouldWrite) {
  console.log('（「ローカルの PostgreSQL」の節を docs/env.md に書き込むには --write を付けて実行してください）');
  process.exit(0);
}

await mkdir(join(repositoryRoot, 'docs'), { recursive: true });

let existing = '';

try {
  existing = await readFile(envDocumentPath, 'utf8');
} catch {
  existing = '';
}

if (existing.includes('## ローカルの PostgreSQL')) {
  console.log('docs/env.md に「ローカルの PostgreSQL」の節が既にあります。');
  console.log('内容が変わった場合は、その節を上の内容で置き換えてください（自動では上書きしません）。');
  process.exit(0);
}

await appendFile(envDocumentPath, summary, 'utf8');
console.log('docs/env.md に追記しました。');
