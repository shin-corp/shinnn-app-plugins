/**
 * PreToolUse（Edit / Write / NotebookEdit）ガード。
 * 標準の必須ファイルと生成物を Claude から守り、編集してよい範囲だけを通す。
 * 通らないパスは exit 2 でブロックし、stderr に「何を / なぜ / どう直す / 規約」を出す。
 */
import { blockMessage, isTemplateRepo, matchesAny, projectDir, readHookInput, toRepoPath } from './lib/hook-io.mjs';

/** 標準の一部で、顧客リポジトリでは /shinnn-app:setup と /shinnn-app:sync-standards だけが書き換える */
const PROTECTED = [
  { pattern: '.env', reason: '認証情報を含むファイルは Claude が読み書きしない取り決め', fix: '値の追加は人が手で行い、キーの一覧だけを docs/env.md に書く' },
  { pattern: '.env.*', reason: '認証情報を含むファイルは Claude が読み書きしない取り決め', fix: '値の追加は人が手で行い、キーの一覧だけを docs/env.md に書く' },
  { pattern: '**/.env', reason: '認証情報を含むファイルは Claude が読み書きしない取り決め', fix: '値の追加は人が手で行い、キーの一覧だけを docs/env.md に書く' },
  { pattern: '**/.env.*', reason: '認証情報を含むファイルは Claude が読み書きしない取り決め', fix: '値の追加は人が手で行い、キーの一覧だけを docs/env.md に書く' },
  { pattern: '.github/workflows/**', reason: 'CI は品質ゲートそのもので、緩めると壊れたコードが main に入る', fix: '/shinnn-app:setup を再実行して選択を変える。差分は PR になる' },
  { pattern: '.claude/settings.json', reason: '権限の deny は顧客側で上書きできない前提で安全性を担保している', fix: '/shinnn-app:sync-standards で標準側の更新を取り込む' },
  { pattern: '.claude/rules/**', reason: '規約は当社が配布する正本で、リポジトリごとに書き換えると保守を引き継げない', fix: '/shinnn-app:sync-standards で更新する。例外は CLAUDE.local.md に書く' },
  { pattern: '.shinnn/**', reason: 'setup の記録は CI の policy job が標準と照合する対象', fix: '/shinnn-app:setup を再実行する' },
  { pattern: 'package-lock.json', reason: '手編集した lock は再現しないビルドの原因になる', fix: 'npm install を実行して生成させる' },
  { pattern: '.github/CODEOWNERS', reason: 'レビュー担当の割り当ては引き継ぎの前提条件', fix: '/shinnn-app:setup を再実行して担当を変更する' },
  { pattern: 'server/drizzle/**', reason: 'マイグレーションは drizzle-kit の生成物で、手編集すると適用済みの DB と食い違う', fix: 'server/src/db/schema/*.ts を直してから /shinnn-app:db-migrate を実行する' },
  { pattern: 'docs/progress.md', reason: 'マージ時の Action が Issues から再生成するスナップショットで、手で書くと必ずずれる', fix: 'Issue の内容と status ラベルを直す。まとめは /shinnn-app:retro で残す' },
  { pattern: '**/message-keys.ts', reason: 'messages.json からの生成物', fix: 'server/resources/messages.json を直して npm run messages を実行する' },
  { pattern: '**/dist/**', reason: 'ビルド生成物', fix: '生成元のソースを直してビルドし直す' },
  { pattern: '**/node_modules/**', reason: '依存パッケージの実体', fix: '依存の変更は package.json と npm install で行う' },
];

/**
 * 見本ファイルは値を持たず、規約（server-coding-conventions.md）が「環境変数を足したら名前を追記する」と求めるので、
 * PROTECTED の .env.* から除外する。
 */
const ENV_EXAMPLE = '**/.env.example';

/** 通常の開発で編集してよい範囲。ここに無いパスは既定でブロックする */
const ALLOWED = [
  ENV_EXAMPLE,
  'shared/src/**',
  'shared/tests/**',
  'client/src/**',
  'client/tests/**',
  'server/src/**',
  'server/tests/**',
  'server/seed/**',
  'server/resources/**',
  'docs/**',
  'README.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'client/CLAUDE.md',
  'server/CLAUDE.md',
];

const input = await readHookInput();
const toolName = input.tool_name || '';
if (!['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(toolName)) {
  process.exit(0);
}

// テンプレートから作ったリポジトリでだけ動く
const root = projectDir(input);
if (!isTemplateRepo(root)) {
  process.exit(0);
}

const target = input.tool_input?.file_path || input.tool_input?.notebook_path || '';
const repoPath = toRepoPath(target, root);

if (!repoPath) {
  console.error(
    blockMessage({
      what: `リポジトリ外のファイルを書こうとしました（${target}）`,
      why: 'リポジトリ外の変更は git に残らず、当社が引き継げない',
      how: 'リポジトリ内のパスに書く。一時ファイルは scratchpad を使う',
      rule: 'CLAUDE.md「変更はリポジトリの中だけ」',
    }),
  );
  process.exit(2);
}

let hit;
if (!matchesAny([ENV_EXAMPLE], repoPath)) {
  hit = PROTECTED.find((entry) => matchesAny([entry.pattern], repoPath));
}
if (hit) {
  console.error(
    blockMessage({
      what: `保護されたファイルを編集しようとしました（${repoPath}）`,
      why: hit.reason,
      how: hit.fix,
      rule: '.claude/rules/ と、プラグインの standards/README.md「標準」',
    }),
  );
  process.exit(2);
}

if (!matchesAny(ALLOWED, repoPath)) {
  console.error(
    blockMessage({
      what: `編集を許可していない場所のファイルです（${repoPath}）`,
      why: '設定・ビルド周りを個別に触ると、テンプレートの更新を取り込めなくなる',
      how: `編集してよいのは ${ALLOWED.join(' / ')}。設定を変える必要があるなら /shinnn-app:why で理由を確認し、それでも必要なら /shinnn-app:setup か当社レビュー付きの PR で変更する`,
      rule: '.claude/rules/git-workflow.md',
    }),
  );
  process.exit(2);
}

process.exit(0);
