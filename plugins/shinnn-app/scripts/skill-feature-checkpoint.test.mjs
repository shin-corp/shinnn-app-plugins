/**
 * スキル feature の「確かめてもらう位置」の印の回帰テスト。`node --test scripts/` で実行する。
 *
 * `auto-merge` の計画では、`plan.md` の「1. 分ける」が、最初の画面を仕上げる Issue に印を付ける。
 * `SKILL.md` の「10. 最初の画面を確かめてもらう」は、親 Issue の「作る順番」でこの印を探して、止まるかを決める。
 * 2 つの文書の印が 1 文字でも違うと、印を付けても止まらないか、印の無い計画として扱われる。
 * そのため、両方に同じ文字列があることを確かめる。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 印の文字列（2 つの文書の約束） */
const MARKER = '（ここまで作ったら、利用者に確かめてもらう）';

/** スキルの文書を読む */
function readSkill(...parts) {
  return readFileSync(fileURLToPath(new URL(`../skills/feature/${parts.join('/')}`, import.meta.url)), 'utf8');
}

const plan = readSkill('plan.md');
const skill = readSkill('SKILL.md');

/** 見出しから次の `## ` の見出しの手前までの本文 */
function sectionOf(text, heading) {
  const start = text.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `見出し「${heading}」がありません`);
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

test('plan.md の「1. 分ける」は、確かめてもらう位置に付ける印を、文字どおり決めている', () => {
  const split = sectionOf(plan, '1. 分ける');
  assert.match(split, /^\| 確かめてもらう位置 \|/m);
  assert.ok(split.includes(`印 \`${MARKER}\` を付ける`), split);
});

test('plan.md の親 Issue の本文の例は、作る順番の行の末尾に印を付けている', () => {
  assert.match(plan, new RegExp(`^1\\. #12 商品を登録・一覧できる${MARKER}$`, 'm'));
});

test('feature の手順 10 は、同じ印を付けた Issue のマージで止まると決めている', () => {
  const step = sectionOf(skill, '10. 最初の画面を確かめてもらう');
  assert.ok(step.includes(`印 \`${MARKER}\` を付けた Issue の PR がマージ済みである`), step);
});
