/**
 * @file Drizzle クライアントの生成。DB への接続を作るのはここだけにする。
 *
 * 既定は PostgreSQL（`DB_DRIVER=pg`）。`DB_DRIVER=pglite` にすると、PostgreSQL を用意せずに
 * その場限りの DB で動かせる（テストと動作確認用。本番では使わない）。
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema/index.js';

/** アプリが使う DB のハンドル。service はこの型だけを受け取る。 */
export type AppDatabase = NodePgDatabase<typeof schema>;

/**
 * トランザクションの中で使うハンドル。`db.transaction()` のコールバックが受け取る型。
 */
export type AppTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/**
 * 問い合わせに使えるハンドル。
 *
 * 通常の接続とトランザクションのどちらでも動く処理は、この型で受け取る
 * （そうしないと、同じ処理をトランザクションの中から呼べない）。
 */
export type AppDbExecutor = AppDatabase | AppTransaction;

/** DB の接続とその後始末。 */
export interface DbHandle {
  /** 問い合わせに使うハンドル。 */
  readonly db: AppDatabase;
  /** 接続方式。マイグレータの選択に使う。 */
  readonly driver: 'pg' | 'pglite';
  /** 接続を閉じる。 */
  readonly close: () => Promise<void>;
}

/**
 * PostgreSQL への接続を作る。
 *
 * pg の Pool は最初の問い合わせまで接続しないため、ここでは接続を確立しない。
 *
 * @param connectionString - 接続先。既定は `DATABASE_URL`
 * @returns DB のハンドル
 */
export function createPgDb(connectionString: string = config.DATABASE_URL): DbHandle {
  const pool = new pg.Pool({ connectionString });
  return {
    db: drizzle(pool, { schema, casing: 'snake_case' }),
    driver: 'pg',
    close: () => pool.end(),
  };
}

/**
 * PGlite（Node の中で動く PostgreSQL）への接続を作る。
 *
 * `@electric-sql/pglite` は開発時にしか要らないので、必要になった時点で読み込む
 * （本番の依存に入れないため）。
 *
 * @param dataDir - 保存先。既定はメモリ上（プロセスが終わると消える）
 * @returns DB のハンドル
 */
export async function createPgliteDb(dataDir = 'memory://'): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const client = new PGlite(dataDir);
  /*
   * PGlite 用のハンドルは接続方式ごとに別の型になるが、問い合わせの書き方は同じ。
   * service が接続方式を意識しなくて済むよう、ここで 1 度だけ AppDatabase として扱う。
   */
  const db = drizzlePglite(client, { schema, casing: 'snake_case' }) as unknown as AppDatabase;
  return {
    db,
    driver: 'pglite',
    close: () => client.close(),
  };
}

/**
 * `DB_DRIVER` に従って DB のハンドルを作る。
 *
 * @returns DB のハンドル
 */
export async function createDb(): Promise<DbHandle> {
  if (config.DB_DRIVER === 'pglite') {
    return createPgliteDb();
  }
  return createPgDb();
}
