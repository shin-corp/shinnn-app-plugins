// @ts-check
import angular from 'angular-eslint';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/** どのファイルでも禁止する import。パッケージの入口を 1 つに保つ。 */
const commonRestrictedImports = {
  paths: [
    {
      name: '@angular/common/http',
      message: 'HttpClient は使わない。サーバー呼び出しは api-client.ts の call() を通す。',
    },
  ],
  patterns: [
    {
      regex: '^@app/shared/(?!api$)',
      message: "@app/shared の入口は '@app/shared' と '@app/shared/api' だけ。深い import をしない。",
    },
    {
      regex: '^@app/server',
      message: 'server の実装を client から import しない（画面のバンドルに巻き込まれる）。',
    },
  ],
};

/** 機能どうしを直接つながせないための import 制限。features/ と shared/ に足す。 */
const crossFeatureImportPatterns = [
  {
    // 例: features/items/ から '../other/foo' を読む
    regex: String.raw`^\.\./[^./][^/]*/`,
    message: 'features 配下の別機能を直接 import しない。共有するものは shared/ に置く。',
  },
  {
    // 例: '../../features/other/foo'
    regex: '(^|/)features/',
    message: 'features 配下の別機能を直接 import しない。共有するものは shared/ に置く。',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', '.angular/**', 'out-tsc/**', 'node_modules/**'] },
  {
    // package.json に書いていないパッケージの import を止める（いわゆる幻の依存）。
    // ワークスペースでは他パッケージの依存も node_modules に並ぶため、書き忘れても動いてしまう。
    // 画面のバンドルに入らないテストと設定ファイルだけ devDependencies を読んでよい。
    files: ['**/*.ts'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: ['**/*.test.ts', 'eslint.config.js'],
          optionalDependencies: false,
          peerDependencies: false,
          includeTypes: true,
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      // 変更検知は全コンポーネントで OnPush にする。
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      // 状態は signal()。@Input() / @Output() / @ViewChild() デコレータは使わない。
      '@angular-eslint/prefer-signals': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error'] }],
      'no-restricted-imports': ['error', commonRestrictedImports],
    },
  },
  {
    // 機能どうしの相互 import と、共有部品から機能への逆流を止める。
    files: ['src/app/features/**/*.ts', 'src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: commonRestrictedImports.paths,
          patterns: [...commonRestrictedImports.patterns, ...crossFeatureImportPatterns],
        },
      ],
    },
  },
  {
    // サーバー呼び出しの入口を 1 か所に保つ。
    files: ['src/**/*.ts'],
    ignores: ['src/app/api-client.ts', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'fetch を直接呼ばない。サーバー呼び出しは api-client.ts の call() を通す。' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // 制御フローは @if / @for / @switch。*ngIf / *ngFor は使わない。
      '@angular-eslint/template/prefer-control-flow': 'error',
    },
  },
);
