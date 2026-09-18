import { defineConfig } from 'drizzle-kit';

/*
 * drizzle-kit はアプリの外（CLI）で動くため、ここだけは process.env を直接読む。
 * アプリ内で使う環境変数は src/config.ts に集約する。
 */
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/app';

export default defineConfig({
  dialect: 'postgresql',
  // テーブル定義は 1 テーブル 1 ファイルで src/db/schema/ に置く。
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  // TypeScript 側は camelCase、PostgreSQL 側は snake_case。列名を二重に書かない。
  casing: 'snake_case',
  dbCredentials: { url: databaseUrl },
});
