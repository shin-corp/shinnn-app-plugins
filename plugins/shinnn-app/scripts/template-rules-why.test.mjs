// 規約の決まりと理由を分けた形を固める回帰テスト。
// 規約（.claude/rules/）は会話に読み込まれるので、決まりだけを置く。理由は、読み込まれない .claude/rules-why/ に置く。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const templateRoot = fileURLToPath(new URL('../template/', import.meta.url));
const rulesDir = join(templateRoot, '.claude/rules');
const whyDir = join(templateRoot, '.claude/rules-why');

const ruleNames = readdirSync(rulesDir)
  .filter((name) => name.endsWith('.md'))
  .sort();

test('規約の理由: 規約ごとに、同じ名前の理由のファイルがある', () => {
  const whyNames = readdirSync(whyDir).sort();
  assert.deepEqual(whyNames, ruleNames);
  for (const name of ruleNames) {
    const why = readFileSync(join(whyDir, name), 'utf8');
    assert.match(why, /^# .+の理由\n\n\S/, `${name} の理由に見出しと本文がある`);
  }
});

test('規約の理由: 規約に「なぜ」の節を置かず、末尾の「## 理由」で理由の置き場所を示す', () => {
  for (const name of ruleNames) {
    const rule = readFileSync(join(rulesDir, name), 'utf8');
    assert.doesNotMatch(rule, /^#{2,} なぜ/m, `${name} に「なぜ」で始まる見出しが無い`);
    const pointer = `この規約の理由は \`.claude/rules-why/${name}\` にあります。`;
    // 末尾の節が「## 理由」で、その中に置き場所の文があること
    const lastSection = rule.slice(rule.lastIndexOf('\n## ') + 1);
    assert.ok(lastSection.startsWith('## 理由\n\n'), `${name} の末尾の節が「## 理由」`);
    assert.ok(lastSection.includes(pointer), `${name} の「## 理由」が理由の置き場所を示す`);
    assert.ok(existsSync(join(whyDir, name)), `${name} の理由のファイルがある`);
  }
});
