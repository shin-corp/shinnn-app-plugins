import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // マイグレーション済みの DB の中身を 1 回だけ作り、各テストファイルに読み込ませる（tests/global-setup.ts）
    globalSetup: ['tests/global-setup.ts'],
    /*
     * 待ち時間の上限。既定（hook 10 秒・test 5 秒）では、ほかの重い処理と同時に流したときに、beforeAll のサーバーの
     * 起動が上限を超えて落ちることがある。上限は失敗とみなすまでの待ち時間で、結果を時間で決めるものではない。
     * 止まったままのテストを見つけられるよう、上限は無くさない。
     */
    hookTimeout: 60_000,
    testTimeout: 30_000,
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
