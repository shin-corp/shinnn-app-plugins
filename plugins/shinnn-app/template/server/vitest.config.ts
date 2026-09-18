import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /*
     * src/config.ts は読み込み時に環境変数を検証する。テストは .env を読まないので、
     * 検証を通せる値をここで与える（値はテスト専用。本番の設定とは無関係）。
     * DB は PGlite の in-memory を使うため DATABASE_URL は接続されない。
     */
    env: {
      NODE_ENV: 'test',
      DB_DRIVER: 'pglite',
      DATABASE_URL: 'postgres://app:app@localhost:5432/app',
      JWT_SECRET: 'test-secret-test-secret-test-secret-01',
      JWT_AUDIENCE: 'app-client',
      CORS_ORIGIN: 'http://localhost:4200',
      TRUST_PROXY: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
