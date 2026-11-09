/**
 * スキル add-screen の「9. 作った画面を見直す」の 1（画面を撮る）の回帰テスト。`node --test scripts/` で実行する。
 *
 * 環境変数 CHROME_PATH は、外の仕組み（ブラウザで Claude Code を動かすサービスなど）がワークスペースに置く。
 * 名前が変わると、その仕組みの上で画面を撮れなくなる。そのため、名前を文で確かめる。
 * CHROME_PATH を置いた環境では、その値のブラウザが動くと分かっている。そのため、channel より先に見ることも確かめる。
 * 値を Bash で出すと確認が出るので、撮るスクリプトの中で読むことも確かめる。
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

test('外の仕組みとの約束: 手順 9 の 1 は、撮るスクリプトの中で CHROME_PATH を読み、値があれば executablePath に渡し、無ければ続けて channel で動かす', () => {
  // 2 つの文が隣り合っていることまで見る。間に別の文が入ると、「無ければ」の指す先が変わる
  assert.match(
    shootStep(),
    /環境変数 `CHROME_PATH`（`process\.env\.CHROME_PATH`）に値があれば、その値を `executablePath` に渡してブラウザを動かす。\s*`CHROME_PATH` が無ければ、入っているブラウザ（`channel: 'msedge'` か `'chrome'`）を動かす/,
  );
});

test('手順 9 の 1 は、CHROME_PATH の値を Bash で出して確かめない', () => {
  assert.match(shootStep(), /`CHROME_PATH` の値は、Bash で出して確かめない/);
});
