/**
 * @file マイグレーションの適用。
 *
 * 単体で実行すると `DATABASE_URL` の DB へ適用する（`npm run db:migrate -w server`）。
 * テストは `applyMigrations()` を呼び、その場で作った PGlite の DB へ同じ SQL を流す。
 *
 * SQL の生成は `db:generate`（drizzle-kit）で行い、drizzle/ の生成物は手で編集しない。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { Log } from '../util/log.js';
import { MessageKeys } from '../util/message/index.js';
import { createDb, type DbHandle } from './client.js';

const logger = new Log('db.migrate');

/*
 * 生成物の場所は server/drizzle。src から実行しても dist から実行しても 2 つ上が server/ になる。
 */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * マイグレーションを適用する。
 *
 * @param handle - DB のハンドル
 */
export async function applyMigrations(handle: DbHandle): Promise<void> {
  if (handle.driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as unknown as PgliteDatabase, { migrationsFolder });
    return;
  }

  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(handle.db, { migrationsFolder });
}

/** このファイルを直接実行したか（`import` されただけなら false）。 */
const isDirectRun =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  const handle = await createDb();
  try {
    await applyMigrations(handle);
    logger.message(MessageKeys.APP_DB_MIGRATION_APPLIED);
  } finally {
    await handle.close();
  }
}
