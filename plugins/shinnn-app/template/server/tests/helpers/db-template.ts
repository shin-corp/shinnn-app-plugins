/**
 * @file テスト用 DB の雛形（マイグレーション済みの DB の中身）を書き出す。
 *
 * PGlite は新しい DB を作るたびに PostgreSQL の初期化（initdb）を行い、これが DB を作る時間の大半を占める
 * （負荷の高い機械では、1 回に 10 秒近くかかる）。初期化を済ませた中身を各テストファイルが読み込めば、DB を作る時間は
 * その数分の 1 で済む。
 *
 * 雛形のファイル名には指紋（マイグレーションの SQL と記録と PGlite の版から作る）を入れ、指紋が変わるまで、実行をまたいで
 * 使い回す。そのため、1 つのテストファイルだけを流すとき（応答の終わりの自動チェックや mutation-check）も、初期化を待たない。
 * 同じ名前のファイルは上書きしない（Windows では、ほかの実行が読んでいるファイルを差し替えられない）。
 *
 * vitest の globalSetup（vitest の本体のプロセス）から読むので、vitest を import しない。
 */

import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgliteDb } from '../../src/db/client.js';
import { applyMigrations, migrationsFolder } from '../../src/db/migrate.js';

/** 雛形の置き場所。git の管理外（node_modules の下）。 */
const templateFolder = fileURLToPath(new URL('../../node_modules/.cache/test-db/', import.meta.url));

/** 書きかけのまま残った一時ファイルを消すまでの時間（ミリ秒）。ほかの実行が書いている途中のファイルは消さない */
const STALE_TEMPORARY_FILE_MS = 10 * 60 * 1000;

/**
 * 入っている PGlite の package.json の中身を読む（`exports` に package.json が無いので、本体の場所からたどる）。
 *
 * @returns package.json の中身
 */
function readPglitePackageJson(): string {
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve('@electric-sql/pglite'));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, 'utf8');
      if ((JSON.parse(text) as { name?: string }).name === '@electric-sql/pglite') {
        return text;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('@electric-sql/pglite の package.json が見つかりません');
    }
    dir = parent;
  }
}

/**
 * 今のマイグレーションと PGlite の版に当たる雛形のパス。マイグレーションの SQL・記録・PGlite の版のどれかが変わると変わる。
 *
 * @returns 雛形のパス
 */
export function testDbTemplatePath(): string {
  const hash = createHash('sha256');
  const sqlFiles = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of sqlFiles) {
    hash.update(name);
    hash.update(readFileSync(join(migrationsFolder, name)));
  }
  hash.update(readFileSync(join(migrationsFolder, 'meta/_journal.json')));
  // 版が変わると、書き出した中身を読み込めなくなることがある
  hash.update(readPglitePackageJson());
  return join(templateFolder, `template-${hash.digest('hex').slice(0, 16)}.tar`);
}

/**
 * 今の雛形のほかの雛形と、書きかけのまま残った古い一時ファイルを消す（消せなくても止めない）。
 *
 * @param currentPath - 今の雛形のパス
 */
async function removeOldFiles(currentPath: string): Promise<void> {
  for (const name of await readdir(templateFolder)) {
    const path = join(templateFolder, name);
    if (path === currentPath) {
      continue;
    }
    try {
      const isOldTemplate = name.startsWith('template-') && name.endsWith('.tar');
      const isStaleTemporary =
        name.endsWith('.tmp') && Date.now() - (await stat(path)).mtimeMs > STALE_TEMPORARY_FILE_MS;
      if (isOldTemplate || isStaleTemporary) {
        await rm(path, { force: true });
      }
    } catch {
      // ほかの実行が読んでいる（Windows）など。次の実行で消す
    }
  }
}

/**
 * マイグレーションを流した DB の中身（データのフォルダの tar）を、今の指紋の雛形として書き出す。
 * 同じ指紋の雛形が既にあれば、何もしない。`tests/global-setup.ts` が実行の最初に 1 回だけ呼ぶ。
 */
export async function writeTestDbTemplate(): Promise<void> {
  const templatePath = testDbTemplatePath();
  await mkdir(templateFolder, { recursive: true });
  if (!existsSync(templatePath)) {
    const handle = await createPgliteDb();
    let dump: Blob;
    try {
      await applyMigrations(handle);
      // createPgliteDb() のハンドルは pg 用の型として扱っているので、PGlite の本体は drizzle の $client から取る
      dump = await (handle.db as unknown as { $client: PGlite }).$client.dumpDataDir('none');
    } finally {
      await handle.close();
    }

    // 書きかけのファイルを読まれないよう、別の名前で書いてから名前を変える
    const temporaryPath = `${templatePath}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, new Uint8Array(await dump.arrayBuffer()));
      await rename(temporaryPath, templatePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      // 同時に動いたほかの実行が、同じ指紋の雛形を先に書いていれば、それを使う
      if (!existsSync(templatePath)) {
        throw error;
      }
    }
  }
  await removeOldFiles(templatePath);
}
