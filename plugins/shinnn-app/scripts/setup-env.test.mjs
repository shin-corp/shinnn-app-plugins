/**
 * scripts/setup-env.mjs（/shinnn-app:setup の手順 2 が使う環境の検出）の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 対象のリポジトリは一時フォルダを `--repo-dir` で渡し、`--write` はその docs/env.md に書く。
 * 外部のコマンドが 1 つも無い環境で動かし、コマンドが無くても落ちないことと、
 * 手元に何が入っているかに結果が左右されないことを両方確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 環境の検出スクリプト */
const setupEnvScript = fileURLToPath(new URL('./setup-env.mjs', import.meta.url));

/** テストで使う一時ファイルをすべて置くディレクトリ */
let workRoot;

/**
 * 外部のコマンドが 1 つも見つからない環境。PATH だけを空のフォルダにする。
 * Windows では環境変数の名前が `Path` のこともあるので、大文字小文字を問わず除いてから入れる。
 */
function envWithoutCommands(extra) {
  const emptyDir = mkdtempSync(join(workRoot, 'no-commands-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return { ...env, PATH: emptyDir, ...extra };
}

/** 対象のリポジトリにする空の一時フォルダ */
function makeEnvRepo() {
  return mkdtempSync(join(workRoot, 'env-'));
}

/**
 * setup-env.mjs をコマンドの無い環境で実行する。DB の検出は DATABASE_URL で済ませ、接続も docker も試さない。
 * カレントは対象の外に置き、書き込み先が `--repo-dir` で決まることも確かめる
 */
function runSetupEnv(repo, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [setupEnvScript, '--repo-dir', repo, ...args], {
    cwd: workRoot,
    encoding: 'utf8',
    env: envWithoutCommands({ DATABASE_URL: 'postgres://localhost:5432/app', ...extraEnv }),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * 決まった版を出すだけの偽の claude を置いたフォルダ。
 * Windows では、npm から入れたときと同じく claude.cmd だけを置く。
 */
function fakeClaudeDir(version) {
  const dir = mkdtempSync(join(workRoot, 'fake-claude-'));

  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'claude.cmd'), `@echo ${version} (Claude Code)\r\n`);
  } else {
    writeFileSync(join(dir, 'claude'), `#!/bin/sh\necho '${version} (Claude Code)'\n`);
    chmodSync(join(dir, 'claude'), 0o755);
  }

  return dir;
}

before(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'setup-env-test-'));
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

test('setup-env: 開発環境を表で示し、コマンドが 1 つも無くても落ちない', () => {
  const repo = makeEnvRepo();
  const result = runSetupEnv(repo, []);

  assert.equal(result.status, 0, result.stderr);
  for (const row of ['OS', 'Node.js', 'npm', 'Claude Code', 'Git', 'GitHub CLI（gh）', 'Docker']) {
    assert.match(result.stdout, new RegExp(`^\\| ${row.replace(/[.()（）]/g, '\\$&')} \\| .+ \\|$`, 'm'), row);
  }
  assert.match(
    result.stdout,
    new RegExp(`^\\| Node\\.js \\| ${process.versions.node.replaceAll('.', '\\.')} \\|`, 'm'),
  );
  for (const row of ['npm', 'Claude Code', 'Git', 'GitHub CLI（gh）', 'Docker']) {
    assert.match(
      result.stdout,
      new RegExp(`^\\| ${row.replace(/[()（）]/g, '\\$&')} \\| 見つかりません \\|`, 'm'),
      row,
    );
  }
  assert.match(result.stdout, /^\| Claude Code \| 見つかりません \| 版を確かめられません。.*2\.1\.283 以上/m);
  // PostgreSQL の候補もこれまでどおり出す
  assert.match(result.stdout, /## ローカルの PostgreSQL/);
  assert.match(result.stdout, /採用: 環境変数 DATABASE_URL の接続先/);
  assert.equal(existsSync(join(repo, 'docs')), false);
});

for (const [version, expected] of [
  ['2.1.283', /^\| Claude Code \| 2\.1\.283 \| 満たしています \|$/m],
  ['2.1.282', /^\| Claude Code \| 2\.1\.282 \| 2\.1\.283 以上にしてください（`claude update`）/m],
]) {
  test(`setup-env: Claude Code の ${version} を前提の版と比べる`, () => {
    const result = runSetupEnv(makeEnvRepo(), [], { PATH: fakeClaudeDir(version) });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected);
  });
}

test('setup-env --write: docs/env.md には PostgreSQL の節だけを追記し、2 回目は書かない', () => {
  const repo = makeEnvRepo();
  const first = runSetupEnv(repo, ['--write']);

  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /docs\/env\.md に追記しました。/);
  const written = readFileSync(join(repo, 'docs', 'env.md'), 'utf8');
  assert.match(written, /^## ローカルの PostgreSQL$/m);
  assert.match(written, /- 採用: 環境変数 DATABASE_URL の接続先/);
  // 開発環境の表は使う人のパソコンごとに違うので、リポジトリの文書には残さない
  assert.ok(!written.includes('## 開発環境'), written);

  const second = runSetupEnv(repo, ['--write']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /節が既にあります/);
  assert.equal(readFileSync(join(repo, 'docs', 'env.md'), 'utf8'), written);
});

test('setup-env --database: 検出の結果ではなく、指定した方式の手順を書く', () => {
  const repo = makeEnvRepo();
  const result = runSetupEnv(repo, ['--write', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  const written = readFileSync(join(repo, 'docs', 'env.md'), 'utf8');
  assert.match(written, /^- 採用: PGlite/m);
  assert.match(written, /^- 設定: `server\/\.env` の `DB_DRIVER` を `pglite` にします/m);
  // テンプレートの server/src/config.ts は、pglite でも DATABASE_URL が無いと起動しない
  assert.match(written, /^- `DATABASE_URL`: 接続には使いません。.*`\.env\.example` の値のまま残します$/m);
  assert.ok(!written.includes('使われません'), written);
  // update-rules は server/seed/ を写さないので、seed がマイグレーションを適用しないアプリでも正しい手順にする
  assert.match(written, /^- 初期データ: `npm run seed -w server` で入れます。.*API サーバーを 1 回起動して止めます。/m);
  // 検出では DATABASE_URL が先に見つかっている。指定で置き換えたことが分かるように残す
  assert.match(written, /^- 指定された方法: pglite（検出で最初に見つかったのは database-url）$/m);
});

test('setup-env: server/.env の DATABASE_URL は検出に使わない', () => {
  const repo = makeEnvRepo();
  mkdirSync(join(repo, 'server'));
  writeFileSync(join(repo, 'server', '.env'), 'DATABASE_URL=postgres://app:app@localhost:5432/app\n');
  // 環境変数の空の値は、設定されていないものとして扱う
  const result = runSetupEnv(repo, [], { DATABASE_URL: '' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^- DATABASE_URL: 未設定$/m);
});

/** テンプレートの server/.env.example。--server-env はこれを写す */
const templateEnvExample = readFileSync(
  fileURLToPath(new URL('../template/server/.env.example', import.meta.url)),
  'utf8',
);

/** server/.env.example を置いた対象のリポジトリ */
function makeServerRepo(example = templateEnvExample) {
  const repo = makeEnvRepo();
  mkdirSync(join(repo, 'server'));
  writeFileSync(join(repo, 'server', '.env.example'), example);
  return repo;
}

/** 作った server/.env の中身 */
function readServerEnv(repo) {
  return readFileSync(join(repo, 'server', '.env'), 'utf8');
}

/** `名前=値` の行の値。無ければ undefined */
function envValue(body, name) {
  return body.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];
}

test('setup-env --server-env: .env.example を写し、DB_DRIVER を pglite に、JWT_SECRET をランダムな値にする', () => {
  const repo = makeServerRepo();
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^server\/\.env を作りました（server\/\.env\.example を写したもの。DB_DRIVER は pglite、JWT_SECRET はランダムな値。値は出しません）。$/m,
  );

  const written = readServerEnv(repo);
  const secret = envValue(written, 'JWT_SECRET');

  assert.equal(envValue(written, 'DB_DRIVER'), 'pglite');
  assert.doesNotMatch(written, /^# DB_DRIVER=/m);
  // テンプレートの server/src/config.ts の検査（32 文字以上）を通る。.env にそのまま書ける文字だけ
  assert.match(secret, /^[A-Za-z0-9_-]{64}$/);

  // 置き換えた 2 行のほかは、.env.example のまま
  const unchanged = (body) =>
    body
      .split('\n')
      .filter((line) => !/^(# )?(DB_DRIVER|JWT_SECRET)=/.test(line))
      .join('\n');
  assert.equal(unchanged(written), unchanged(templateEnvExample));

  // 値の空の行は残らない（テンプレートの config.ts が必須にする値は、すべて埋まる）
  assert.doesNotMatch(written, /^[A-Z][A-Z0-9_]*=$/m);
  for (const name of ['DATABASE_URL', 'JWT_AUDIENCE', 'CORS_ORIGIN']) {
    assert.ok((envValue(written, name) ?? '') !== '', name);
  }

  // 値は出力に出さない。開発環境の検出もしない
  assert.ok(!result.stdout.includes(secret), result.stdout);
  assert.doesNotMatch(result.stdout, /## 開発環境/);
  assert.equal(existsSync(join(repo, 'docs')), false);
  assert.doesNotMatch(result.stdout, /値が空の項目/);
});

test('setup-env --server-env: JWT_SECRET は作るたびに違う', () => {
  const secrets = [makeServerRepo(), makeServerRepo()].map((repo) => {
    const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);
    assert.equal(result.status, 0, result.stderr);
    return envValue(readServerEnv(repo), 'JWT_SECRET');
  });

  assert.notEqual(secrets[0], secrets[1]);
});

test('setup-env --server-env: 既にある server/.env は上書きせず、足りないものの名前だけを示す', () => {
  const repo = makeServerRepo();
  const existing = 'DB_DRIVER=pg\nJWT_SECRET=short-secret-value\n';
  writeFileSync(join(repo, 'server', '.env'), existing);
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readServerEnv(repo), existing);
  assert.match(result.stdout, /server\/\.env は既にあります。上書きしません/);
  assert.match(result.stdout, /DB_DRIVER: pglite になっていません/);
  assert.match(result.stdout, /JWT_SECRET: 32 文字以上になっていません/);
  assert.ok(!result.stdout.includes('short-secret-value'), result.stdout);
});

test('setup-env --server-env: 既にある server/.env が PGlite で動く形なら、そう示す', () => {
  const repo = makeServerRepo();
  const existing = `DB_DRIVER="pglite" # コメント\nJWT_SECRET=${'a'.repeat(32)}\n`;
  writeFileSync(join(repo, 'server', '.env'), existing);
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readServerEnv(repo), existing);
  assert.match(result.stdout, /DB_DRIVER: pglite になっています/);
  assert.match(result.stdout, /JWT_SECRET: 32 文字以上です/);
});

test('setup-env --server-env: 既にある server/.env は Node.js の --env-file と同じに読む', () => {
  // 引用符の無い値は、最初の # から後ろを捨てる。Node.js では JWT_SECRET が「abc」になり、32 文字に足りない
  const cut = makeServerRepo();
  writeFileSync(join(cut, 'server', '.env'), `DB_DRIVER=pglite\nJWT_SECRET=abc#${'x'.repeat(40)}\n`);
  const cutResult = runSetupEnv(cut, ['--server-env', '--database', 'pglite']);
  assert.equal(cutResult.status, 0, cutResult.stderr);
  assert.match(cutResult.stdout, /JWT_SECRET: 32 文字以上になっていません/);

  // 行頭の空白、前に付けた export、= の前後の空白は、Node.js も読む
  const indented = makeServerRepo();
  writeFileSync(join(indented, 'server', '.env'), `  DB_DRIVER = pglite\nexport JWT_SECRET=${'a'.repeat(40)}\n`);
  const indentedResult = runSetupEnv(indented, ['--server-env', '--database', 'pglite']);
  assert.equal(indentedResult.status, 0, indentedResult.stderr);
  assert.match(indentedResult.stdout, /DB_DRIVER: pglite になっています/);
  assert.match(indentedResult.stdout, /JWT_SECRET: 32 文字以上です/);
});

test('setup-env --server-env: .env.example に値の空の項目がほかにあれば、名前だけを示す', () => {
  const repo = makeServerRepo(`${templateEnvExample}\n# 外部サービスの鍵。\nEXTERNAL_API_KEY=\n`);
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /値が空の項目があります: EXTERNAL_API_KEY。/);
  assert.equal(envValue(readServerEnv(repo), 'EXTERNAL_API_KEY'), '');
});

test('setup-env --server-env: .env.example に DB_DRIVER の行が無ければ、末尾に足す', () => {
  const repo = makeServerRepo('DATABASE_URL=postgres://app:app@localhost:5432/app\nJWT_SECRET=');
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 0, result.stderr);
  const written = readServerEnv(repo);
  assert.match(
    written,
    /^DATABASE_URL=postgres:\/\/app:app@localhost:5432\/app\nJWT_SECRET=[A-Za-z0-9_-]{64}\nDB_DRIVER=pglite\n$/,
  );
});

test('setup-env --server-env: pglite のほかの方式と、方式の指定が無いときは、何も書かずに止める', () => {
  for (const args of [['--database', 'docker'], ['--database', 'managed'], []]) {
    const repo = makeServerRepo();
    const result = runSetupEnv(repo, ['--server-env', ...args]);

    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /--server-env は --database pglite と一緒に指定します/);
    assert.equal(existsSync(join(repo, 'server', '.env')), false);
  }
});

test('setup-env --server-env: server/.env.example が無ければ、何も書かずに止める', () => {
  const repo = makeEnvRepo();
  const result = runSetupEnv(repo, ['--server-env', '--database', 'pglite']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/\.env\.example がありません/);
  assert.equal(existsSync(join(repo, 'server')), false);
});

test('setup-env --server-env --write: server/.env を作り、docs/env.md にも PGlite の手順を書く', () => {
  const repo = makeServerRepo();
  const result = runSetupEnv(repo, ['--write', '--database', 'pglite', '--server-env']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(envValue(readServerEnv(repo), 'DB_DRIVER'), 'pglite');
  assert.match(readFileSync(join(repo, 'docs', 'env.md'), 'utf8'), /^- 採用: PGlite/m);
  assert.match(result.stdout, /## 開発環境/);
});

test('setup-env --database: 知らない方式は、何も書かずに止める', () => {
  const repo = makeEnvRepo();
  const result = runSetupEnv(repo, ['--write', '--database', 'embedded-postgres']);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--database に指定できるのは database-url \/ local-postgres \/ docker \/ pglite \/ managed です/,
  );
  assert.equal(existsSync(join(repo, 'docs')), false);
});
