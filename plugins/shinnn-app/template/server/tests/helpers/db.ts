/**
 * @file テスト用の DB。
 *
 * テストファイルごとに新しい in-memory の PGlite（Node の中で動く PostgreSQL）を作り、
 * 本番と同じマイグレーションを流す。テストの間ではデータだけを空にする（`clearTestDb()`）。
 * DB を作るたびにマイグレーションを流すので、テストごとに作り直すとその分だけ遅くなる。
 */

import { sql } from 'drizzle-orm';
import { createPgliteDb, type AppDatabase, type DbHandle } from '../../src/db/client.js';
import { applyMigrations } from '../../src/db/migrate.js';

/**
 * マイグレーション適用済みのテスト用 DB を作る。
 *
 * @returns DB のハンドル
 */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createPgliteDb();
  await applyMigrations(handle);
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
