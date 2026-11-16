/**
 * スキル design-review と、それを呼ぶ feature の手順 8 と、Stop の hook（continue-on-stop.mjs）の約束の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * design-review は、記録の Issue（題 `[調整] デザインの見直し`）を作る。
 * feature の手順 8 は、この題の Issue で、計画ごとに 1 回かを見分ける。
 * continue-on-stop.mjs は、この題の Issue を進められる Issue に数えない。
 * 3 つの題が 1 文字でも違うと、見直しが計画ごとに何度も走るか、hook が記録の Issue を作るよう伝える。そのため、題が同じことを確かめる。
 *
 * 改善案の Issue は、利用者が入れると決めるまで、作る列（status:next / status:doing）に入れない。
 * 入れると決めた Issue にも、すべてを聞き終えてから status:next を付ける。
 * 途中で付けると、auto-merge では、聞いている途中で hook が作り続けるよう伝える。その手順の形も確かめる。
 *
 * 入れると決めた改善案（題が `[デザイン]` の Issue）は、feature が計画の Issue と同じ流れで続けて作る。
 * 作り直しのアプリでは、design-review を呼ばずに、すべての画面を元と並べて撮る。
 * どちらも文の 1 か所が欠けると、作り続けずに止まるか、新しいデザインを出して元に寄せた見た目を崩す。その文も確かめる。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** プラグインのルートからのパスで読む */
function readPluginFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

const skill = readPluginFile('skills/design-review/SKILL.md');
const feature = readPluginFile('skills/feature/SKILL.md');
const hook = readPluginFile('scripts/continue-on-stop.mjs');
const addScreen = readPluginFile('skills/add-screen/SKILL.md');

/** 記録の Issue の題（3 つの文書の約束） */
const RECORD_TITLE = '[調整] デザインの見直し';

/** 見直し済みの印になる題。この題の Issue がある計画では、すべての画面は見直し済みなので、見直しを行わない */
const REVIEWED_MARK_TITLE = '[調整] すべての画面の見直し';

/** 入れると決まった改善案に、聞いている途中で残すコメント（4 の 3 で書き、0 の 1 で見分ける） */
const ACCEPTED_COMMENT = '入れると決まった（ラベルは最後に付ける）';

/** 見出しから次の `## ` の見出しの手前までの本文 */
function sectionOf(text, heading) {
  const start = text.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `見出し「${heading}」がありません`);
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

test('frontmatter: 名前がフォルダと同じで、allowed-tools を付けない', () => {
  const frontmatter = skill.slice(0, skill.indexOf('\n---', 4));
  assert.match(frontmatter, /^name: design-review$/m);
  assert.doesNotMatch(frontmatter, /allowed-tools/);
});

test('手順 1 は、capture-screens.mjs の batch で、通行証を入れて screenshots/review/ にまとめて撮る', () => {
  const step = sectionOf(skill, '1. 材料をそろえる');
  assert.match(
    step,
    /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/capture-screens\.mjs batch --list <一覧のファイル> --out-dir screenshots\/review --token/,
  );
  // batch が撮れなかった画面ごとに出す文の書き出し（capture-screens.mjs の batch）
  assert.ok(step.includes('「撮れませんでした: <name>（理由）」'), step);
  assert.match(readPluginFile('scripts/capture-screens.mjs'), /`撮れませんでした: \$\{screen\.name\}（\$\{reason\}）`/);
});

test('手順 2 は、Skill ツールで frontend-design:frontend-design を 1 回呼ぶ', () => {
  assert.match(sectionOf(skill, '2. 指導を受ける'), /Skill ツールで `frontend-design:frontend-design` を 1 回呼ぶ/);
});

test('記録の Issue の題が、design-review と feature の手順 8 と continue-on-stop.mjs で同じ', () => {
  assert.ok(
    sectionOf(skill, '3. 改善案を Issue にする').includes(
      `gh issue create --title "${RECORD_TITLE}" --label type:feature`,
    ),
  );
  // 文書の中で題を書いたところ（`[調整] …`）が、記録の Issue の題か、見直し済みの印になる題のどちらかであること
  for (const [where, text] of [
    ['design-review', skill],
    ['feature の手順 8', sectionOf(feature, '8. デザインを見直す')],
  ]) {
    const titles = text.match(/`\[調整\] [^`]*`/g) ?? [];
    assert.ok(titles.includes(`\`${RECORD_TITLE}\``), `${where} に記録の Issue の題がありません`);
    for (const title of titles) {
      assert.ok([`\`${RECORD_TITLE}\``, `\`${REVIEWED_MARK_TITLE}\``].includes(title), `${where}: ${title}`);
    }
  }
  const excluded = hook.match(/^const EXCLUDED_TITLES = \[(.*)\];$/m);
  assert.ok(excluded, 'continue-on-stop.mjs に EXCLUDED_TITLES がありません');
  assert.ok(excluded[1].split(', ').includes(`'${RECORD_TITLE}'`), excluded[0]);
});

test('改善案の Issue は、作るときに status:* を付けない', () => {
  const step = sectionOf(skill, '3. 改善案を Issue にする');
  const creates = step.match(/^ *gh issue create .*$/gm) ?? [];
  assert.equal(creates.length, 2, step);
  for (const command of creates) {
    assert.doesNotMatch(command, /status:/, command);
  }
});

test('手順 4 は、入れない改善案を not planned で閉じ、入れる改善案にはすべてを聞き終えてから status:next を付ける', () => {
  const step = sectionOf(skill, '4. 1 件ずつ聞く');
  // gh issue close の --reason が受け付けるのは completed と not planned（gh issue close --help）
  assert.ok(step.includes('gh issue close <番号> --reason "not planned" --comment "<理由>"'), step);
  assert.match(
    step,
    /^3\. 入れると言われたら、その Issue に次のコメントを残し、番号を控える。ラベルは、すべてを聞き終えてから付ける$/m,
  );
  assert.ok(step.includes(`gh issue comment <番号> --body "${ACCEPTED_COMMENT}"`), step);
  assert.match(
    step,
    /^5\. すべてを聞き終えたら、入れる Issue（3 のコメントを残した Issue）に `status:next` を付ける$/m,
  );
  assert.ok(step.indexOf('gh issue edit <番号> --add-label status:next') > step.indexOf('5. すべてを聞き終えたら'));
});

test('feature の手順 8 は、Skill ツールで shinnn-app:design-review を呼ぶ', () => {
  const step = sectionOf(feature, '8. デザインを見直す');
  assert.match(step, /Skill ツールで `shinnn-app:design-review` を呼ぶ/);
  assert.match(step, /`args` には、この計画の親 Issue の番号を `計画: #<親の番号>` の形で渡す/);
  assert.match(
    skill,
    /`args` に `計画: #<親の番号>` があれば、`\/shinnn-app:feature` の「8\. デザインを見直す」から呼ばれている/,
  );
});

test('continue-on-stop.mjs は、design-review で利用者に聞いている間は止まってよいと伝える', () => {
  assert.ok(hook.includes("'- /shinnn-app:design-review の手順 4 で、改善案を入れるかを利用者に聞いている',"));
  assert.match(skill, /^## 4\. 1 件ずつ聞く$/m);
});

test('feature の手順 6 は、題が [デザイン] の Issue も 7 に進める', () => {
  assert.match(
    sectionOf(feature, '6. 仕上げ'),
    /計画の Issue か、題が `\[デザイン\]` の Issue か[^。]*なら、続けて 7 に進む。/,
  );
});

test('feature の手順 7 は、[デザイン] の Issue を、7 に進むことと次の Issue の選び方だけ計画の Issue と同じに扱う', () => {
  assert.match(
    sectionOf(feature, '7. 次の Issue へ進む'),
    /題が `\[デザイン\]` の Issue（[^）]*）[^。]*も、6 から 7 に進むことと、次の Issue の選び方は、計画の Issue と同じに扱う。/,
  );
  // 止まるときに 8 へ進む条件は、8 で決めた「この計画」で見る（聞き終えていない [デザイン] が残っても 8 に届く）
  assert.match(
    feature,
    /^1\. 「8\. デザインを見直す」でいう「この計画」（「作る順番」の Issue がすべて閉じた計画）があれば、8 を行う$/m,
  );
  // [デザイン] はどの計画の「作る順番」にも無いので、番号の順で取る
  assert.match(
    sectionOf(feature, '続きから始める'),
    /計画の「作る順番」に `status:next` が無ければ（計画が無いときを含む）、`status:next` の Issue を番号の小さい順に取る/,
  );
});

test('feature の手順 8 は、作り直しのアプリでは design-review を呼ばず、すべての画面を元と並べて撮る', () => {
  const step = sectionOf(feature, '8. デザインを見直す');
  assert.match(step, /「元に寄せる」のアプリでは、下の「作り直しのとき」を行い、`design-review` を呼ばない/);
  assert.match(
    step,
    /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/capture-screens\.mjs batch --list <一覧のファイル> --out-dir screenshots --token/,
  );
  assert.match(step, /"original": "screenshots\/original\/<元の画面の画像>"/);
  // 計画ごとに 1 回の印。見分ける文と、付ける文が同じであること
  const mark = 'すべての画面を元と並べて撮った（screenshots/compare/）';
  assert.ok(step.includes(`親 Issue のコメントに \`${mark}\` があれば`), step);
  assert.ok(step.includes(`gh issue comment <親の番号> --body "${mark}"`), step);
  assert.match(step, /報告には、並べた画像の置き場所を添える/);
});

test('feature の手順 8 は、「この計画」を 1 か所で決め、見直し済みの印の題がある計画では行わず、design-review を終えたら決まった手順に戻る', () => {
  const step = sectionOf(feature, '8. デザインを見直す');
  assert.match(
    step,
    /^この節と「止まるとき」の 1 でいう「この計画」は、題が `\[計画\]` の Issue のうち、「作る順番」の Issue がすべて閉じているもの（親が open でも closed でも）で、\n子 Issue が最後に閉じたのがいちばん新しいものを指す。/m,
  );
  assert.match(step, /^- この計画の `\[調整\] すべての画面の見直し` がある（この計画のすべての画面は見直し済み）$/m);
  // design-review は、直接呼ばれたときの計画を、feature の 8 の決め方で選ぶ
  assert.match(
    sectionOf(skill, '3. 改善案を Issue にする'),
    /利用者が直接呼んだときも、`\/shinnn-app:feature` の「8\. デザインを見直す」でいう「この計画」があり、/,
  );
  assert.match(
    step,
    /あれば、「続きから始める」の 2 から作る。\n無ければ、7 の「止まるとき」の、報告の前に行う 2 に進む。/,
  );
});

test('design-review の 0 の 1 は、open な記録の Issue があれば、撮り直さずに 4 から聞き、計画が違えば聞き終えた後に 0 の 2 から始める', () => {
  const step = sectionOf(skill, '0. 始める前に確かめる');
  assert.match(step, /撮り直さずに、「4\. 1 件ずつ聞く」から続ける。/);
  assert.match(step, /`status:\*` のラベルが無い open な Issue/);
  assert.match(step, /`args` の計画の見直しを、この節の 2 から始める/);
  // 入れると決まったコメントのある Issue は、聞き直さずに入れる側に数える
  assert.ok(
    step.includes(`4 の 3 のコメント（\`${ACCEPTED_COMMENT}\`）がある Issue は聞かずに、入れる側に数える`),
    step,
  );
});

test('design-review の 4 は、1 回の応答で 1 件だけ聞き、最初に件数とまとめて答えてよいことを添える', () => {
  const step = sectionOf(skill, '4. 1 件ずつ聞く');
  assert.match(step, /1 回の応答で聞くのは 1 件にする。/);
  assert.match(step, /最初の 1 件を聞くときは、改善案の全部の件数と、残りはまとめて答えてもよいことも添える/);
});

test('design-review の 5 は、直接呼ばれて auto-merge なら feature を呼ぶ', () => {
  assert.match(
    sectionOf(skill, '5. 次へ進む'),
    /^- ただし、`auto-merge` なら、伝えた後に Skill ツールで `shinnn-app:feature` を呼び、「続きから始める」の順で作る$/m,
  );
});

test('add-screen の手順 0 は、変え方まで指定された依頼では、指導と確認（下の 1 と 2）を飛ばす', () => {
  assert.match(
    sectionOf(addScreen, '0. 見た目の方針を確かめる'),
    /`\/shinnn-app:design-review` で入れると決めた改善案を含む）では、\n下の 1 と 2 を行わず、指定のとおりに下の 3 から進める/,
  );
});

test('add-screen の作り直しの 0 の行は、[デザイン] の Issue が方針を変えるときに、元の色と書体に戻さない', () => {
  const row = sectionOf(addScreen, '作り直しのとき').match(/^\| 0\. 見た目の方針 \|.*$/m);
  assert.ok(row, '作り直しのときの表に 0 の行がありません');
  assert.match(
    row[0],
    /が見た目の方針（配色・書体）を変えるときは、「0\. 見た目の方針を確かめる」の 3 と 4 を、Issue の「変えること」のとおりに行う（元の色・書体に戻さない）/,
  );
});

test('feature の「続きから始める」の 0 は、.gitignore に足した行だけなら、[デザイン] か open な記録の Issue があるときに行わない', () => {
  assert.match(
    sectionOf(feature, '続きから始める'),
    /`\.gitignore` に足した `\/screenshots\/` の行だけで、`status:next` の `\[デザイン\]` の Issue があるか、\n   open な記録の Issue `\[調整\] デザインの見直し` があるときは、0 を行わない/,
  );
});
