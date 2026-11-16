/**
 * スキル add-screen の「9. 作った画面を見直す」の 1（画面を撮る）と、「作り直しのとき」と、デザインの指導を受ける手順の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * 環境変数 CHROME_PATH は、外の仕組み（ブラウザで Claude Code を動かすサービスなど）がワークスペースに置く。
 * 撮るスクリプト capture-screens.mjs が CHROME_PATH を読む（capture-screens.test.mjs が確かめる）。
 * そのため、手順 9 の 1 がそのスクリプトで撮ることと、CHROME_PATH の名前を文で確かめる。
 * 値を Bash で出すと確認が出るので、出さないことも確かめる。
 * 作り直しでは frontend-design を呼ばず、元と並べた画像で見直す。その手順が並べるスクリプトを名指ししていることも確かめる。
 * デザインの指導（frontend-design）を受けるのは、手順 0 で見た目の方針を決めるときだけにする（規約 client-styling.md の「デザインの指導」）。
 * 手順 3（画面の案）と手順 9（作った画面の見直し）が指導を受けないことも確かめる。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** 確かめるスキル */
const skill = readFileSync(fileURLToPath(new URL('../skills/add-screen/SKILL.md', import.meta.url)), 'utf8');

/** 見出しから次の `## ` の見出しの手前までの本文 */
function sectionOf(heading) {
  const start = skill.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `見出し「${heading}」がありません`);
  const rest = skill.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** 手順 9 の 1 の本文（見出しから、2 の行の手前まで） */
function shootStep() {
  const section = sectionOf('9. 作った画面を見直す');
  const end = section.search(/^2\. /m);
  assert.notEqual(end, -1, '手順 9 の 2 がありません');
  return section.slice(0, end);
}

test('手順 9 の 1 は、プラグインの capture-screens.mjs の shot で、通行証を入れて screenshots/ に撮る', () => {
  assert.match(
    shootStep(),
    /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/capture-screens\.mjs shot --url <画面の URL> --out screenshots\/<画面の名前>\.png --token/,
  );
});

test('外の仕組みとの約束: 手順 9 の 1 は、CHROME_PATH に値があればスクリプトがそのブラウザを使うと書く', () => {
  assert.match(shootStep(), /環境変数 `CHROME_PATH` に値があれば、スクリプトはそのブラウザを使う/);
});

test('手順 9 の 1 は、CHROME_PATH の値を Bash で出して確かめない', () => {
  assert.match(shootStep(), /`CHROME_PATH` の値は、Bash で出して確かめない/);
});

test('冒頭は、方針が空なら手順 0 で frontend-design を呼び、手順 3 と 9 は飛ばさないと書く', () => {
  const intro = skill.slice(0, skill.indexOf('## デザインの指導を受ける'));
  assert.match(
    intro,
    /方針が空なら、Skill ツールで `frontend-design:frontend-design` を\n呼んで、デザインの指導を受ける。/,
  );
  assert.match(intro, /どれも飛ばさない。/);
});

test('手順 0 だけが「デザインの指導を受ける」を行う', () => {
  assert.match(sectionOf('0. 見た目の方針を確かめる'), /「デザインの指導を受ける」のとおり指導を受け/);
  assert.match(
    sectionOf('デザインの指導を受ける'),
    /^手順 0 で見た目の方針を決めるときと変えるときに、次のとおり受ける。$/m,
  );
});

test('手順 3 と手順 9 は指導を受けない', () => {
  for (const heading of ['3. 画面の案', '9. 作った画面を見直す']) {
    const step = sectionOf(heading);
    assert.doesNotMatch(step, /frontend-design/, heading);
    assert.doesNotMatch(step, /「デザインの指導を受ける」/, heading);
    assert.match(step, /指導は受けない（規約 `client-styling\.md` の「デザインの指導」）/, heading);
  }
});

test('手順 9 は、撮った画像を Read で開いて崩れを探し、1 巡だけ直す', () => {
  const review = sectionOf('9. 作った画面を見直す');
  // 何を崩れとするかは規約に置き、手順は名指しするだけにする（写すと食い違う）
  assert.match(
    review,
    /^2\. 撮った画像を Read で開き、崩れ（何を崩れとするかは規約 `client-styling\.md` の「デザインの指導」）を探す。/m,
  );
  assert.match(review, /直すのは 1 巡にする。/);
});

test('作り直しのとき: frontend-design を呼ばず、元と新を並べる compare を screenshots/compare/ に書く', () => {
  const rebuild = sectionOf('作り直しのとき');
  assert.match(rebuild, /`frontend-design` を呼ばない/);
  assert.match(
    rebuild,
    /capture-screens\.mjs compare --left screenshots\/original\/<元の画面の画像> --right screenshots\/<画面の名前>\.png --out screenshots\/compare\/<画面の名前>\.png/,
  );
});
