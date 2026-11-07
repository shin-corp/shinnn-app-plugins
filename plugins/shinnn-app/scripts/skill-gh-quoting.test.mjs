/**
 * 文書の gh の `--jq` の式と、`gh api` のパスの書き方の回帰テスト。
 * `node --test scripts/skill-gh-quoting.test.mjs` で実行する。
 *
 * 顧客の手元が Windows のとき、Claude Code は PowerShell 5.1 でコマンドを動かすことがある。
 * PowerShell 5.1 は、単一引用符の中の二重引用符を落として gh に渡す。gh は引数か式を読めずに失敗する。
 * 引用符の無い `{owner}` は、スクリプトブロック（`{ }` で囲んだ処理のかたまり）として読む。gh が動く前に止まる。
 * CI は Linux で動くので PowerShell 5.1 を動かせない。ここでは書いてある形を見る。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** プラグインのルート */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * gh に式を渡す引数とその式。引数は `--jq`・`--jq=` と、gh のコマンドの `-q` を読む。
 * 式は、単一引用符・二重引用符で囲んだものと、引用符の無いものを読む
 */
const JQ_EXPRESSION = /(?:--jq[\s=]\s*|\bgh\s[^`\n|]*\s-q\s+)('[^']*'|"[^"]*"|[^\s`]+)/g;

/** 二重引用符で囲んでいない `repos/{owner}` */
const UNQUOTED_OWNER_PATH = /(?<!")repos\/\{owner\}/;

/** 文書のファイルをすべて集める */
function collectMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

/** プラグインのルートからのパスで、スキルの文書を読む */
function readSkill(...segments) {
  return readFileSync(join(PLUGIN_ROOT, 'skills', ...segments), 'utf8');
}

/** 文書のすべての行を、ファイルと行番号を付けて集める */
function collectDocumentLines() {
  return collectMarkdownFiles(PLUGIN_ROOT).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({
        where: `${relative(PLUGIN_ROOT, file).split(sep).join('/')}:${index + 1}`,
        line,
      })),
  );
}

/** 文書の中の `--jq` の式を、ファイルと行番号を付けて集める */
function collectJqExpressions() {
  return collectDocumentLines().flatMap(({ where, line }) =>
    [...line.matchAll(JQ_EXPRESSION)].map((match) => ({ where, expression: match[1] })),
  );
}

test('文書の --jq の式に二重引用符が無い', () => {
  const expressions = collectJqExpressions();
  assert.ok(expressions.length > 0, '--jq の式を 1 つも読めていない');

  const quoted = expressions.filter(({ expression }) => expression.includes('"'));

  assert.deepEqual(
    quoted.map(({ where, expression }) => `${where} ${expression}`),
    [],
    '--jq の式は単一引用符で囲み、中に二重引用符を書かない。文字列で比べるときは --json の結果を Claude が読む形にする',
  );
});

test('check は直しの Issue を --json の結果から題で探す', () => {
  const skill = readSkill('check', 'SKILL.md');

  assert.match(
    skill,
    /`gh issue list --state open --label type:deps --limit 200 --json number,title,labels` の結果から、題が `\[依存\] 依存の脆弱性の修正` のものを探す/,
  );
});

test('pr の CI の見分け方は、job と step の conclusion を出す式を使う', () => {
  const skill = readSkill('pr', 'SKILL.md');

  assert.ok(
    skill.includes(
      `gh run view <実行の番号> --json jobs --jq '.jobs[] | {databaseId, name, conclusion, steps: [.steps[] | {name, conclusion}]}'`,
    ),
  );
  assert.doesNotMatch(skill, /step=|failed=/);
});

test('pr は必須のチェックをルールの種類の名前で見分ける', () => {
  const skill = readSkill('pr', 'SKILL.md');

  assert.ok(skill.includes(`gh api "repos/{owner}/{repo}/rules/branches/main" --jq '.[].type'`));
  assert.match(skill, /2 つ目に `required_status_checks` の行が出れば/);
});

test('文書の gh api のパスを引用符で囲む', () => {
  const lines = collectDocumentLines();

  assert.deepEqual(
    lines.filter(({ line }) => UNQUOTED_OWNER_PATH.test(line)).map(({ where, line }) => `${where} ${line.trim()}`),
    [],
    '`repos/{owner}/…` は二重引用符で囲む',
  );
  assert.ok(lines.some(({ line }) => line.includes('"repos/{owner}/')));
});

test('feature の計画は、読んだ id を次のコマンドに書いて sub-issue を紐づける', () => {
  const plan = readSkill('feature', 'plan.md');

  assert.ok(plan.includes(`gh api "repos/{owner}/{repo}/issues/<子の番号>" --jq .id`));
  assert.ok(
    plan.includes(`gh api "repos/{owner}/{repo}/issues/<親の番号>/sub_issues" -F sub_issue_id=<1 行目で出た id>`),
  );
  assert.doesNotMatch(plan, /\$\(/);
});
