/**
 * @file テスト用の DB。
 *
 * ファイルごとに新しい in-memory の PGlite（Node の中で動く PostgreSQL）を作り、
 * 本番と同じマイグレーションを流す。テスト間でデータが混ざらないのでお互いの結果に影響しない。
 */

import { createPgliteDb, type DbHandle } from '../../src/db/client.js';
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
