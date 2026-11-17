// テンプレートの整形の設定（.prettierrc.json）を固める回帰テスト。
// 仕様書と移植対応表は、prettier が表の列の幅を空白でそろえて膨らむので、幅の広い表を詰める設定（proseWrap: never）にする。
// 設定はコミットのときに lint-staged が使い、update-rules（copy-standard.mjs）が既存のアプリに写す。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const templateRoot = fileURLToPath(new URL('../template/', import.meta.url));

test('整形の設定: 仕様書と移植対応表だけを proseWrap: never にする', () => {
  const config = JSON.parse(readFileSync(join(templateRoot, '.prettierrc.json'), 'utf8'));
  assert.equal(config.proseWrap, 'preserve', 'ほかの md は改行をそのまま残す');
  const override = config.overrides.find((entry) => entry.options?.proseWrap === 'never');
  assert.ok(override, 'proseWrap: never の上書きがある');
  assert.deepEqual([...override.files].sort(), ['docs/仕様書.md', 'docs/移植対応表.md'].sort());
});

test('整形の設定: コミットのときに md を prettier で整え、update-rules が設定を写す', () => {
  const lintStaged = JSON.parse(readFileSync(join(templateRoot, '.lintstagedrc.json'), 'utf8'));
  const markdownTask = Object.entries(lintStaged).find(([glob]) => /\bmd\b/.test(glob));
  assert.ok(markdownTask, '.lintstagedrc.json が md を対象にしている');
  assert.match(String(markdownTask[1]), /prettier --write/);
  const copyStandard = readFileSync(fileURLToPath(new URL('./copy-standard.mjs', import.meta.url)), 'utf8');
  assert.match(copyStandard, /^ {2}'\.prettierrc\.json',$/m, 'copy-standard.mjs が .prettierrc.json を写す');
});
