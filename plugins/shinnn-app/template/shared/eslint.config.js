// @ts-check
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * package.json に書いていないパッケージの import を止める（いわゆる幻の依存）。
 * ワークスペースでは他パッケージの依存も node_modules に並ぶため、書き忘れても動いてしまう。
 * 動くうちに気づけないと、単体で配布・デプロイした瞬間に落ちる。
 *
 * @param devDependencies - devDependencies からの import を許すファイル（テストと設定ファイルだけ）
 */
const noExtraneousDependencies = (devDependencies) => ({
  'import-x/no-extraneous-dependencies': [
    'error',
    { devDependencies, optionalDependencies: false, peerDependencies: false, includeTypes: true },
  ],
});

export default tseslint.config(
  { ignores: ['dist/**'] },
  tseslint.configs.recommendedTypeChecked,
  {
    plugins: { 'import-x': importX },
    rules: noExtraneousDependencies(['**/*.test.ts', 'eslint.config.js', 'vitest.config.ts']),
  },
  {
    languageOptions: {
      parserOptions: {
        // テストと設定ファイルも型情報つきで検査するため、check 用の tsconfig を参照する。
        project: ['./tsconfig.check.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // shared は API 定義（zod スキーマ）だけを置く。業務ロジック・DB 依存・ログ出力は持ち込まない。
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // 1 ファイルの長さの上限（空行とコメントは数えない）。超えたら分ける（ルートの CLAUDE.md の「共通方針」）。
    // 標準の取り込みの時点で超えていたファイルは、この後ろに、ファイルごとの上限を置く（/shinnn-app:update-rules）。
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['**/*.test.ts'],
    rules: { 'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }] },
  },
);
