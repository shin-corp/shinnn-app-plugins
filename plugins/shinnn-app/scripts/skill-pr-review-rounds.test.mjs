/**
 * スキル pr のセルフレビューの巡の回し方と、後回しにした点の Issue の回帰テスト。
 * `node --test scripts/` で実行する。
 *
 * Warning を直すのは 1 巡目だけにし、2 巡目からは Critical だけを直す。
 * 2 巡目からの Warning と範囲外で気づいた点は、PR 1 本につき 1 件の `[後回し]` の Issue にまとめ、ラベルを付けない。
 * `feature` は `status:next` の Issue しか選ばないので、計画の途中に割り込まない。
 * 題の頭を `[改善]`（AI の出力の評価の直しと、session-retro の反映。頼まれなくても着手する）と分ける。
 * 頼まれて `status:next` を付けた後は、continue-on-stop.mjs が数えて、feature が残りを作りきる。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
const prSkill = readFileSync(join(pluginRoot, 'skills/pr/SKILL.md'), 'utf8');
const featureSkill = readFileSync(join(pluginRoot, 'skills/feature/SKILL.md'), 'utf8');
const gitWorkflow = readFileSync(join(pluginRoot, 'template/.claude/rules/git-workflow.md'), 'utf8');
const continueOnStop = readFileSync(join(pluginRoot, 'scripts/continue-on-stop.mjs'), 'utf8');

/** 見出しから次の `## ` の見出しの手前までの本文 */
function sectionOf(text, heading) {
  const start = text.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `見出し「${heading}」がありません`);
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

test('pr の手順 2 は、Warning を 1 巡目だけ直し、2 巡目からは Critical だけを直す', () => {
  const step2 = sectionOf(prSkill, '2. コミットして、push の前にレビューを回す');
  assert.match(step2, /\| 1 巡目 \| Critical と Warning \|/);
  assert.match(step2, /\| 2 巡目から \| Critical だけ \|/);
  assert.match(step2, /何も直さなかった巡で終える/);
  assert.match(step2, /同じ Critical が 2 巡続けて残ったとき/);
  assert.doesNotMatch(step2, /Critical \/ Warning が 0 件になるまで回す/);
});

test('pr の手順 6 は、後回しにした点を PR 1 本につき 1 件の [後回し] の Issue にまとめ、ラベルを付けない', () => {
  const step6 = sectionOf(prSkill, '6. 報告');
  assert.match(step6, /`\[後回し\] PR #<PR 番号> のレビューで気づいた点`/);
  assert.match(step6, /ラベルは付けない/);
  assert.match(step6, /後回しにした Warning も範囲外で気づいた点も無ければ、Issue を作らない/);
});

test('pr の手順 7 は、後回しにした Warning が残っていてもマージしてよい（Critical は 0 件）', () => {
  const step7 = sectionOf(prSkill, '7. マージする');
  assert.match(step7, /「後回しにした Warning」だけである（Critical は 0 件/);
});

test('規約の「auto-merge のとき」は、[後回し] の Issue に status を付けず、頼まれるまで着手しない', () => {
  const section = sectionOf(gitWorkflow, '`auto-merge` のとき');
  assert.match(section, /利用者に聞かずに `\[後回し\]` の Issue にする/);
  assert.match(section, /^- `\[後回し\]` の Issue は、PR 1 本につき 1 件にまとめる$/m);
  assert.match(section, /^- `\[後回し\]` の Issue には、利用者に頼まれるまで `status:\*` を付けない$/m);
  assert.match(section, /^- `\[後回し\]` の Issue には、利用者に頼まれるまで着手しない（/m);
  assert.match(section, /同じレビューの指摘（セルフレビューでは Critical、PR に付いた指摘では Critical か Warning）/);
  assert.doesNotMatch(section, /`\[改善\]` の Issue/);
});

test('feature は、頼まれて status:next を付けた [後回し] の Issue を、計画の Issue と同じに続けて作る', () => {
  const opening = featureSkill.slice(featureSkill.indexOf('# 作りたいことを形にする'), featureSkill.indexOf('## '));
  assert.match(
    opening,
    /「後回しにした点も進めて」と頼まれたときは、open なすべての `\[後回し\]` の Issue（[^）]*）に `status:next` を付けて、「続きから始める」の 2 から進める/,
  );
  const step6 = sectionOf(featureSkill, '6. ');
  assert.match(step6, /利用者に頼まれて `status:next` を付けた `\[後回し\]` の Issue なら、続けて 7 に進む/);
  const step7 = sectionOf(featureSkill, '7. 次の Issue へ進む');
  assert.match(step7, /利用者に頼まれて `status:next` を付けた `\[後回し\]` の Issue も、6 から 7 に進むこと/);
  const stop = featureSkill.slice(featureSkill.indexOf('### 止まるとき'), featureSkill.indexOf('## 8. '));
  assert.match(stop, /`\[後回し\]` の Issue の番号と件数/);
  assert.match(stop, /「後回しにした点も進めて」と伝えれば作ること/);
  assert.match(featureSkill.match(/^description: (.*)$/m)[1], /「後回しにした点も進めて」/);
});

test('continue-on-stop.mjs は、題の頭 [後回し] を数えない題の頭に入れない（頼まれて status:next を付けたら続けさせる）', () => {
  const line = continueOnStop.split('\n').find((text) => text.startsWith('const EXCLUDED_TITLE_PREFIXES'));
  assert.ok(line, 'EXCLUDED_TITLE_PREFIXES がありません');
  assert.doesNotMatch(line, /後回し/);
});
