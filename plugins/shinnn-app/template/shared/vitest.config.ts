import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // API 定義ヘルパーの価値は型推論にあるため、実行時アサーションと合わせて型も検査する。
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.check.json',
      include: ['src/**/*.test.ts'],
    },
  },
});
