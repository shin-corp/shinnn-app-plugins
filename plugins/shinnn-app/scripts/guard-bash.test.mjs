/**
 * guard-bash.mjs の回帰テスト。`node --test scripts/` で実行する。
 * hook の入力（JSON）を標準入力で渡し、終了コード（0: 通す / 2: 止める）を確かめる。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./guard-bash.mjs', import.meta.url));

function runGuard(command) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  return result.status;
}

/** 止めるべきコマンド */
const blocked = {
  '.env を cat で読む': 'cat server/.env',
  '.env.local を head で読む': 'head -n 3 .env.local',
  'Windows の type で .env を読む': 'type .env',
  'bash に流し込む heredoc の中の cat .env': "bash <<'EOF'\ncat .env\nEOF",
  'bash -s に流し込む heredoc の中の cat .env': "bash -s <<'EOF'\ncat .env\nEOF",
  'sh -c にコマンド文字列として渡す heredoc': 'sh -c "$(cat <<\'EOF\'\ncat server/.env\nEOF\n)"',
  'eval にコマンド文字列として渡す heredoc': 'eval "$(cat <<\'EOF\'\ncat .env\nEOF\n)"',
  'node -e で settings.json を書き換える': "node -e \"require('fs').writeFileSync('.claude/settings.json', '{}')\"",
  'sed -i でワークフローを書き換える': "sed -i 's/a/b/' .github/workflows/ci.yaml",
  'リダイレクトで settings.json を上書きする': 'echo x > .claude/settings.json',
  'リダイレクトで .env を作る': 'echo KEY=1 > server/.env',
  'force push': 'git push --force origin main',
  'pre-commit の迂回': 'git commit --no-verify -m x',
};

/** 通すべきコマンド（本文の語に反応しないこと など） */
const allowed = {
  'process.env を含むコミットメッセージ（heredoc）':
    'git commit -m "$(cat <<\'EOF\'\n[server]process.env を土台に ANTHROPIC_API_KEY を除いて渡す\nEOF\n)"',
  '.env.example に触れる Issue 本文（heredoc）':
    'gh issue create --title x --body "$(cat <<\'EOF\'\n見本は server/.env.example にある\nEOF\n)"',
  '.env.example の git add': 'git add server/src/config.ts server/.env.example',
  '.env.example を読む': 'cat server/.env.example',
  'docs/env.md を grep する': 'grep -n AUI docs/env.md',
  'node -e で時刻を表示する': 'node -e "console.log(Date.now())"',
  'node -e で環境変数を表示する': 'node -e "console.log(Boolean(process.env.HOME))"',
  'scripts/ の検査スクリプトを実行する': 'node scripts/check-ac-coverage.mjs',
  '矢印関数を含む node の stdin スクリプト':
    "node - <<'EOF'\nconst f = (s) => s.replace('a', 'b');\nconsole.log(f(process.env.HOME || ''));\nEOF",
  'shared のビルド': 'npm run build -w shared',
};

for (const [name, command] of Object.entries(blocked)) {
  test(`止める: ${name}`, () => {
    assert.equal(runGuard(command), 2);
  });
}

for (const [name, command] of Object.entries(allowed)) {
  test(`通す: ${name}`, () => {
    assert.equal(runGuard(command), 0);
  });
}
