/**
 * @file テスト用の DB。
 *
 * テストファイルごとに新しい in-memory の PGlite（Node の中で動く PostgreSQL）を作る。中身は、本番と同じマイグレーションを
 * 流して書き出した雛形（`helpers/db-template.ts`。実行の最初に `tests/global-setup.ts` が用意する）を読み込む。
 * テストの間ではデータだけを空にする（`clearTestDb()`）。
 * 今のマイグレーションに当たる雛形が無いとき（watch の途中でマイグレーションを足した・書き換えたとき）は、雛形を使わずに作る。
 */

import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createPgliteDb, type AppDatabase, type DbHandle } from '../../src/db/client.js';
import { applyMigrations } from '../../src/db/migrate.js';
import { testDbTemplatePath } from './db-template.js';

/**
 * マイグレーション適用済みのテスト用 DB を作る。
 *
 * @returns DB のハンドル
 */
export async function createTestDb(): Promise<DbHandle> {
  const templatePath = testDbTemplatePath();
  const handle = existsSync(templatePath)
    ? await createPgliteDb('memory://', { loadDataDir: new Blob([await readFile(templatePath)]) })
    : await createPgliteDb();
  try {
    // 雛形から作ったときは、済んだ分が飛ばされて何も流れない
    await applyMigrations(handle);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
}

/**
 * アプリのテーブル（public スキーマ）の行をすべて消す。テーブルとマイグレーションの記録は残す。
 *
 * @param db - テスト用 DB のハンドル
 */
export async function clearTestDb(db: AppDatabase): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length === 0) {
    return;
  }
  await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
}
