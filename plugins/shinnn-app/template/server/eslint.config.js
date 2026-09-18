// @ts-check
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * 層をまたぐ import の許可関係をここで機械的に強制する（違反はビルド失敗として扱う）。
 *
 *   api  →  service  →  db
 *     ＼      ＼  ＼     ／
 *        util / exception   provider（外部システム。service からだけ呼ぶ）
 *
 * - api は DB を直接触らない（値の import は禁止。DB のハンドルを service へ渡すための型だけ許す）
 * - api は provider も直接呼ばない（外部システムの呼び出しは service を通す）
 * - service は HTTP を知らない（api を import しない）
 * - provider は上の層と db を import しない。外部システムの SDK を import できるのは provider だけ
 * - db と util / exception は上の層を import しない
 *
 * 対象はパッケージ内の相対 import。`@app/shared/api` は API 定義なのでどの層からも読める。
 */
const relativeImportOf = (segments) => String.raw`^(\.\.?/)+` + `(${segments})(/|$)`;

const forbidDbValues = {
  regex: relativeImportOf('db'),
  message: 'api から DB を直接触らない。問い合わせは service に置く（型の import だけは許可）。',
  allowTypeImports: true,
};

const forbidProvider = {
  regex: relativeImportOf('provider'),
  message: 'api から外部システムを直接呼ばない。呼び出しは service に置く。',
};

const forbidProviderUpperLayers = {
  regex: relativeImportOf('api|service|db'),
  message: 'provider は通信だけを担う。api / service / db を import しない。',
};

/**
 * 外部システムの SDK を import してよいのは provider だけ（rules/ai-integration.md）。SDK を足したらここに名前を足す。
 * provider 以外の層の設定には、この `paths` を必ず入れる。
 */
const forbidAgentSdk = {
  name: '@anthropic-ai/claude-agent-sdk',
  message: '外部システムの SDK は src/provider/ からだけ呼ぶ（.claude/rules/ai-integration.md）。',
};

const forbidApi = {
  regex: relativeImportOf('api'),
  message: 'service は HTTP を知らない。req / res や controller を import しない。',
};

const forbidApiAndService = {
  regex: relativeImportOf('api|service'),
  message: 'db は上の層を import しない。',
};

const forbidUpperLayers = {
  regex: relativeImportOf('api|service|db'),
  message: 'util / exception は上の層を import しない（どこからでも呼べる部品に保つ）。',
};

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**'] },
  tseslint.configs.recommendedTypeChecked,
  {
    // package.json に書いていないパッケージの import を止める（いわゆる幻の依存）。
    // ワークスペースでは他パッケージの依存も node_modules に並ぶため、書き忘れても動いてしまう。
    // devDependencies を読んでよいのは、配布物に入らないテスト・種データ・設定・スクリプトと、
    // PGlite を必要になった時点だけ読み込む db/ の 2 ファイル（下の no-restricted-syntax と同じ範囲）。
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.ts',
            'tests/**',
            'seed/**',
            'scripts/**',
            'eslint.config.js',
            'vitest.config.ts',
            'drizzle.config.ts',
            'src/db/client.ts',
            'src/db/migrate.ts',
          ],
          optionalDependencies: false,
          peerDependencies: false,
          includeTypes: true,
        },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        // tests / seed / 設定ファイルも型情報つきで検査する。
        project: ['./tsconfig.check.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // ログは util/log.ts の Log だけを使う（出力先を変えるときに直す場所を 1 か所に保つ）。
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // 動的 import は静的に検査できないので使わない。
    // 例外は db/ の 2 ファイルだけ。開発とテストでしか使わない PGlite を本番の起動経路に載せないため。
    files: ['src/**/*.ts'],
    ignores: ['src/db/client.ts', 'src/db/migrate.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: '動的 import を使わない。静的な import 文で書く。' },
      ],
    },
  },
  {
    // どの層にも共通の制限（層ごとの制限は下の設定で上書きするので、そちらにも paths を書く）。
    files: ['src/**/*.ts', 'seed/**/*.ts'],
    ignores: ['src/provider/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { paths: [forbidAgentSdk] }] },
  },
  {
    files: ['src/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [forbidAgentSdk], patterns: [forbidDbValues, forbidProvider] },
      ],
    },
  },
  {
    files: ['src/service/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [forbidAgentSdk], patterns: [forbidApi] }],
    },
  },
  {
    files: ['src/provider/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [forbidProviderUpperLayers] }] },
  },
  {
    files: ['src/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [forbidAgentSdk], patterns: [forbidApiAndService] },
      ],
    },
  },
  {
    files: ['src/util/**/*.ts', 'src/exception/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [forbidAgentSdk], patterns: [forbidUpperLayers] }],
    },
  },
  {
    // 生成スクリプトは標準出力が利用者への表示手段そのものなので console を許可する。
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
