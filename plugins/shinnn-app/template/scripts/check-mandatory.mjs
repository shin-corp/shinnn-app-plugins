#!/usr/bin/env node
// 必須項目が実際に残っているかを検査する。
//
// 実行例:
//   node scripts/check-mandatory.mjs
//
// 判定の仕方:
//   .shinnn/setup.json の mandatory 配列（宣言）だけでなく、必須ファイルの実体・
//   .claude/settings.json の deny・.claude/rules/ の顔ぶれも見る。
//   宣言だけを見ると、setup.json に触れずに実体を消せば緑のままになる。
// CI の policy job から呼ばれる。

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** `.shinnn/setup.json` の `mandatory` に必ず並ぶキー。 */
const MANDATORY_KEYS = [
  'claude-md',
  'claude-rules',
  'claude-settings-deny',
  'import-restriction-lint',
  'husky-pre-commit',
  'ci-check',
  'ci-test',
  'ci-policy',
  'issue-templates',
  'issue-labels',
  'progress-snapshot',
  'docs-specification',
  'docs-env',
  'security-defaults',
  'dependabot',
  'npm-audit',
  'commit-convention',
  'handover-definition',
  'codeowners',
];

/** 消してはいけないファイル。宣言ではなく実体を見る。 */
const REQUIRED_FILES = [
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/rules/.standards-version',
  '.husky/pre-commit',
  '.lintstagedrc.json',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/workflows/ci.yaml',
  '.github/workflows/progress-snapshot.yaml',
  '.github/workflows/dependabot-issue.yaml',
  'docs/仕様書.md',
  'docs/env.md',
  'docs/progress.md',
  '.shinnn/setup.json',
];

/** `.claude/settings.json` の deny から外してはいけない指定。 */
const REQUIRED_DENY = [
  'Bash(rm -rf *)',
  'Bash(git push --force*)',
  'Bash(git reset --hard*)',
  'Bash(git commit --no-verify*)',
  'Bash(sudo *)',
  'Read(.env)',
  'Read(**/.env)',
  'Edit(.env)',
  'Edit(**/.env)',
  'Bash(cat .env*)',
  'Bash(cat */.env*)',
  'Bash(head .env*)',
  'Bash(head */.env*)',
  'Bash(tail .env*)',
  'Bash(tail */.env*)',
  'Bash(less .env*)',
  'Bash(less */.env*)',
  'Bash(type .env*)',
  'Bash(type */.env*)',
  'Bash(Get-Content .env*)',
  'Bash(Get-Content */.env*)',
  'Edit(.github/workflows/**)',
  'Edit(.claude/settings.json)',
  'Edit(.claude/rules/**)',
  'Edit(.shinnn/**)',
  'Edit(package-lock.json)',
  'Edit(.github/CODEOWNERS)',
  'Edit(server/drizzle/**)',
  'Edit(docs/progress.md)',
];

/** `.claude/rules/` に必ずある規約。プラグインが配る顔ぶれと同じにする。 */
const REQUIRED_RULES = [
  'ai-integration.md',
  'api-contract.md',
  'client-architecture.md',
  'client-coding-conventions.md',
  'client-styling.md',
  'db.md',
  'git-workflow.md',
  'messages.md',
  'server-architecture.md',
  'server-coding-conventions.md',
  'testing.md',
];

/** `client-only` プロファイルではサーバー側の規約を持たない。 */
const SERVER_ONLY_RULES = [
  'ai-integration.md',
  'db.md',
  'messages.md',
  'server-architecture.md',
  'server-coding-conventions.md',
];

/** 見つかった不足。1 件ずつ「何が / どう直す」を持たせる。 */
const problems = [];

/** ファイルがあるか。 */
async function exists(relativePath) {
  try {
    await stat(join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

/** JSON を読む。読めなければ検査を続けられないのでその場で終わる。 */
function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8'));
  } catch {
    console.error(`${relativePath} を読めません。/shinnn-app:setup を実行してください。`);
    process.exit(1);
  }
}

const setup = readJson('.shinnn/setup.json');
const declared = new Set(setup.mandatory ?? []);
const missingKeys = MANDATORY_KEYS.filter((key) => !declared.has(key));

if (missingKeys.length > 0) {
  problems.push({
    what: `.shinnn/setup.json の mandatory から外れています: ${missingKeys.join(', ')}`,
    how: '外した項目を戻す。必須項目は案件ごとに外せません',
  });
}

const isClientOnly = setup.profile === 'client-only';

for (const relativePath of REQUIRED_FILES) {
  if (!(await exists(relativePath))) {
    problems.push({
      what: `必須のファイルがありません: ${relativePath}`,
      how: 'テンプレートから復元する（/shinnn-app:sync-standards か、当社に相談）',
    });
  }
}

const settings = readJson('.claude/settings.json');
const deny = new Set(settings.permissions?.deny ?? []);
const missingDeny = REQUIRED_DENY.filter((entry) => !deny.has(entry));

if (missingDeny.length > 0) {
  problems.push({
    what: `.claude/settings.json の deny から外れています: ${missingDeny.join(', ')}`,
    how: '/shinnn-app:sync-standards で標準の deny を取り込み直す',
  });
}

let ruleFiles = [];

try {
  ruleFiles = (await readdir(join(repositoryRoot, '.claude', 'rules'))).filter((name) => name.endsWith('.md'));
} catch {
  problems.push({ what: '.claude/rules/ がありません', how: '/shinnn-app:sync-standards で取り込み直す' });
}

const expectedRules = isClientOnly
  ? REQUIRED_RULES.filter((name) => !SERVER_ONLY_RULES.includes(name))
  : REQUIRED_RULES;
const missingRules = expectedRules.filter((name) => !ruleFiles.includes(name));

if (missingRules.length > 0) {
  problems.push({
    what: `.claude/rules/ に規約がありません: ${missingRules.join(', ')}`,
    how: '/shinnn-app:sync-standards で取り込み直す',
  });
}

if (problems.length === 0) {
  console.log(
    `必須項目を確認しました（宣言 ${MANDATORY_KEYS.length} 件 / ファイル ${REQUIRED_FILES.length} 件 / ` +
      `deny ${REQUIRED_DENY.length} 件 / 規約 ${expectedRules.length} 件）。`,
  );
  process.exit(0);
}

console.error('必須項目が欠けています。');
console.error('');

for (const problem of problems) {
  console.error(`  何が: ${problem.what}`);
  console.error(`  どう直す: ${problem.how}`);
  console.error('');
}

console.error('  なぜ: 必須項目は「顧客が編集しても標準が保たれる」ことの根拠です。');
console.error('        宣言だけを見ていると、実体を消しても CI が緑のままになります。');
console.error('  規約: このリポジトリの .claude/rules/（配布元は shinnn-app プラグイン）');
process.exit(1);
