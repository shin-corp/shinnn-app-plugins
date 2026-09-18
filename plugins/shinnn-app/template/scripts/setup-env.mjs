#!/usr/bin/env node
// ローカルの PostgreSQL をどう用意するかを決める。検出だけを行い、結果を docs/env.md に追記する。
//
// 実行例:
//   node scripts/setup-env.mjs             検出して結果を表示する
//   node scripts/setup-env.mjs --write      検出結果を docs/env.md に追記する
//
// 検出の順番（先に見つかったものを採用する）:
//   1. DATABASE_URL が設定済み          → そのまま使う
//   2. localhost:5432 に接続できる      → 既に動いている PostgreSQL を使う
//   3. docker info が成功する           → docker compose --profile dev up -d
//   4. embedded-postgres が入れられる   → npm から PostgreSQL 16 の実バイナリを起動する
//   5. PGlite                           → 最終手段（忠実度に注意）
//   6. いずれも不可                     → マネージドの無料枠を案内する
//
// このスクリプトは検出と案内だけを行う。導入の実行は /shinnn-app:setup が行う。

import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const envDocumentPath = join(repositoryRoot, 'docs', 'env.md');
const shouldWrite = process.argv.includes('--write');
const postgresPort = 5432;
const connectTimeoutMs = 1500;

/** コマンドを実行して成功したかを返す。 */
function commandSucceeds(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 15000 });

    return true;
  } catch {
    return false;
  }
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
 * Windows で「管理者として実行」したターミナルかを調べる。
 * embedded-postgres は管理者権限のターミナルからは PostgreSQL の起動を拒否する。
 */
function isWindowsElevatedTerminal() {
  if (process.platform !== 'win32') {
    return false;
  }

  // 管理者でないと開けないディレクトリへの書き込み権限で判定する
  return commandSucceeds('net', ['session']);
}

const results = [];
let selected = null;

if (typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0) {
  results.push('DATABASE_URL: 設定済み');
  selected = {
    id: 'database-url',
    label: '環境変数 DATABASE_URL の接続先',
    howToStart: '既に用意されている PostgreSQL に接続します。起動と停止は提供元の手順に従ってください。',
  };
} else {
  results.push('DATABASE_URL: 未設定');
}

if (selected === null) {
  const reachable = await canConnect('127.0.0.1', postgresPort);

  results.push(`localhost:${postgresPort}: ${reachable ? '接続できました' : '接続できません'}`);

  if (reachable) {
    selected = {
      id: 'local-postgres',
      label: `このパソコンで動いている PostgreSQL（localhost:${postgresPort}）`,
      howToStart: 'サービスとして常駐しています。停止と起動は OS のサービス管理から行います。',
    };
  }
}

if (selected === null) {
  const dockerAvailable = commandSucceeds('docker', ['info']);

  results.push(`docker: ${dockerAvailable ? '使えます' : '使えません'}`);

  if (dockerAvailable) {
    selected = {
      id: 'docker',
      label: 'Docker の PostgreSQL 16（docker-compose.yml）',
      howToStart: [
        '起動: `docker compose --profile dev up -d`',
        '停止: `docker compose --profile dev down`',
        'テスト用（ポート 5433、データを残さない）: `docker compose --profile test up -d`',
      ].join('\n'),
    };
  }
}

if (selected === null) {
  const elevated = isWindowsElevatedTerminal();

  results.push(`管理者として実行したターミナル: ${elevated ? 'はい' : 'いいえ'}`);

  if (elevated) {
    console.error('');
    console.error('  何が: 管理者として実行したターミナルで動いています。');
    console.error('  なぜ: この後の候補である embedded-postgres は、管理者権限のターミナルからは');
    console.error('        PostgreSQL の起動を拒否します（PostgreSQL 本体の仕様です）。');
    console.error('  どう直す: 通常のターミナル（管理者としてではなく開いたもの）で開き直し、');
    console.error('            もう一度このコマンドを実行してください。');
    console.error('');
    process.exit(1);
  }

  selected = {
    id: 'embedded-postgres',
    label: 'embedded-postgres（npm から入る PostgreSQL 16 の実バイナリ）',
    howToStart: [
      '導入: `npm install -D embedded-postgres -w server` のあと `npm install-scripts approve embedded-postgres`',
      '起動と停止はサーバーの起動スクリプトが行います。管理者権限は要りません。',
      '注意: Windows では「管理者として実行」したターミナルから起動できません。',
    ].join('\n'),
  };
}

const summary = [
  '',
  '## ローカルの PostgreSQL',
  '',
  `- 採用: ${selected.label}`,
  `- 検出日: ${new Date().toISOString().slice(0, 10)}`,
  '',
  '### 起動と停止',
  '',
  selected.howToStart,
  '',
  '### 検出の結果',
  '',
  ...results.map((line) => `- ${line}`),
  '',
  '### 採用しなかった場合の代わり',
  '',
  '- テストは常に PGlite（Postgres の WASM 版）を使うので、上のどれが選ばれても実行できます。',
  '- どの方法も使えない場合は、マネージドの PostgreSQL の無料枠（Neon など）を検討してください。',
  '  接続先を `DATABASE_URL` に設定すれば、このスクリプトは 1 番目の候補として認識します。',
  '',
].join('\n');

console.log(summary);

if (!shouldWrite) {
  console.log('（docs/env.md に書き込むには --write を付けて実行してください）');
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
  console.log('内容が変わった場合は、その節を人が置き換えてください（自動では上書きしません）。');
  process.exit(0);
}

await appendFile(envDocumentPath, summary, 'utf8');
console.log('docs/env.md に追記しました。');
