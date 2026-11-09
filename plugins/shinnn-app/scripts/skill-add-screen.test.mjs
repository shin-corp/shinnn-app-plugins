/**
 * スキル add-screen の「9. 作った画面を見直す」の 1（画面を撮る）の回帰テスト。`node --test scripts/` で実行する。
 *
 * 環境変数 CHROME_PATH は、外の仕組み（ブラウザで Claude Code を動かすサービスなど）がワークスペースに置く。
 * 名前が変わると、その仕組みの上で画面を撮れなくなる。
 * そのため、名前と、見る順番（CHROME_PATH が先、channel が後）を文で確かめる。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 確かめるスキル */
const skill = readFileSync(fileURLToPath(new URL('../skills/add-screen/SKILL.md', import.meta.url)), 'utf8');

/** 手順 9 の 1 の本文（見出しから、2 の行の手前まで） */
function shootStep() {
  const start = skill.indexOf('## 9. 作った画面を見直す');
  assert.notEqual(start, -1, '手順 9 の見出しがありません');
  const section = skill.slice(start);
  const end = section.search(/^2\. /m);
  assert.notEqual(end, -1, '手順 9 の 2 がありません');
  return section.slice(0, end);
}

test('外の仕組みとの約束: 手順 9 の 1 は、CHROME_PATH があれば、その値を executablePath に渡してブラウザを動かす', () => {
  assert.match(shootStep(), /環境変数 `CHROME_PATH` があれば、その値を `executablePath` に渡して動かす/);
});

test('外の仕組みとの約束: 手順 9 の 1 は、CHROME_PATH が無ければ、入っているブラウザを channel で動かす', () => {
  const step = shootStep();
  assert.match(step, /無ければ、入っているブラウザ（`channel: 'msedge'` か `'chrome'`）を動かす/);
  assert.ok(step.indexOf('CHROME_PATH') < step.indexOf("channel: 'msedge'"), 'CHROME_PATH を channel より先に見る');
});
