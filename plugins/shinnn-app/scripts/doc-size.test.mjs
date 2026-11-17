// 顧客のアプリで Claude に読み込まれる文書の大きさに上限を置く回帰テスト。
// 読み込まれる量が増えると、毎回の会話が重くなり、早く要約されて前の内容を失う。
// 上限を超えたら、上限を上げる前に、ほかの文書との重複・説明だけの文・その場面でしか要らない枝を削れないかを確かめる。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const templateRoot = join(pluginRoot, 'template');
const rulesDir = join(templateRoot, '.claude/rules');
const KB = 1024;

/** 会話のはじめから読み込まれる量（root の CLAUDE.md と、paths を持たない規約の合計） */
const ALWAYS_LOADED_LIMIT = 20 * KB;
/** paths を持つ規約 1 本（触るファイルに合わせて読み込まれる） */
const RULE_LIMIT = 10 * KB;
/** client と server の CLAUDE.md 1 つ（そのフォルダで作業すると読み込まれる） */
const PACKAGE_CLAUDE_LIMIT = 5 * KB;
/** スキルの SKILL.md 1 本（呼ぶたびに全部が読み込まれる。その場面でしか要らない枝は同じフォルダの別ファイルにする） */
const SKILL_LIMIT = 28 * KB;
/** setup は、アプリを作るときに 1 回だけ呼ぶので、別の上限にする */
const SKILL_LIMITS = { setup: 66 * KB };

function byteSize(path) {
  return Buffer.byteLength(readFileSync(path, 'utf8'));
}

function hasPaths(ruleText) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(ruleText);
  return frontmatter !== null && /^paths:/m.test(frontmatter[1]);
}

const ruleNames = readdirSync(rulesDir).filter((name) => name.endsWith('.md'));

test('文書の大きさ: 会話のはじめから読み込まれる量が上限に収まる', () => {
  let total = byteSize(join(templateRoot, 'CLAUDE.md'));
  const always = ['CLAUDE.md'];
  for (const name of ruleNames) {
    const path = join(rulesDir, name);
    if (!hasPaths(readFileSync(path, 'utf8'))) {
      total += byteSize(path);
      always.push(`.claude/rules/${name}`);
    }
  }
  // paths を持たない規約は git-workflow.md だけ（ほかの規約から paths が消えると、常に読み込まれるようになる）
  assert.deepEqual(always, ['CLAUDE.md', '.claude/rules/git-workflow.md']);
  assert.ok(total <= ALWAYS_LOADED_LIMIT, `${always.join(' + ')} = ${total}B（上限 ${ALWAYS_LOADED_LIMIT}B）`);
});

test('文書の大きさ: paths を持つ規約は、1 本ずつ上限に収まる', () => {
  for (const name of ruleNames) {
    const path = join(rulesDir, name);
    if (!hasPaths(readFileSync(path, 'utf8'))) {
      continue;
    }
    const size = byteSize(path);
    assert.ok(size <= RULE_LIMIT, `${name} = ${size}B（上限 ${RULE_LIMIT}B）`);
  }
});

test('文書の大きさ: client と server の CLAUDE.md は上限に収まる', () => {
  for (const path of ['client/CLAUDE.md', 'server/CLAUDE.md']) {
    const size = byteSize(join(templateRoot, path));
    assert.ok(size <= PACKAGE_CLAUDE_LIMIT, `${path} = ${size}B（上限 ${PACKAGE_CLAUDE_LIMIT}B）`);
  }
});

test('文書の大きさ: スキルの SKILL.md は 1 本ずつ上限に収まる', () => {
  const skillsDir = join(pluginRoot, 'skills');
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const limit = SKILL_LIMITS[entry.name] ?? SKILL_LIMIT;
    const size = byteSize(join(skillsDir, entry.name, 'SKILL.md'));
    assert.ok(size <= limit, `${entry.name}/SKILL.md = ${size}B（上限 ${limit}B）`);
  }
});
