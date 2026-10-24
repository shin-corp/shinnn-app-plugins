/**
 * テンプレートの CI のワークフロー（ci.yaml と policy.yaml）の構成の回帰テスト。`node --test scripts/` で実行する。
 *
 * - 本文の編集（`edited`）で走るのは policy.yaml だけ。ci.yaml の `pull_request` には `edited` を付けない
 * - 2 つのワークフローの concurrency の group は別の名前にする（同じだと互いの実行を取り消す）
 * - concurrency の group にはイベントの種類を入れる（入れないと、`main` への push が手で走らせた実行を取り消す）
 * - どちらにも `workflow_dispatch` がある（Actions が使えなかった間にマージした PR を、`main` で手で確かめる）
 *
 * YAML のパーサーは使わない（プラグインは依存を持たない）。ブロック形式で書いた最上位のキーの下の行を、文字列として読む。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** テンプレートのワークフローの中身 */
function workflow(name) {
  return readFileSync(fileURLToPath(new URL(`../template/.github/workflows/${name}`, import.meta.url)), 'utf8');
}

/** 最上位のキー（`on:` など）の下にある行（次の最上位のキーの手前まで）。コメントだけの行は除く */
function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `最上位に ${key}: がありません`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) {
      break;
    }
    if (!/^\s*#/.test(line)) {
      block.push(line);
    }
  }
  return block;
}

/** `on:` の下の `pull_request:` の下にある行 */
function pullRequestLines(text) {
  const on = topLevelBlock(text, 'on');
  const start = on.findIndex((line) => line === '  pull_request:');
  assert.notEqual(start, -1, 'on: に pull_request: がありません');
  const lines = [];
  for (const line of on.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) {
      break;
    }
    lines.push(line);
  }
  return lines;
}

/** `concurrency:` の group の値 */
function concurrencyGroup(text) {
  const group = topLevelBlock(text, 'concurrency').find((line) => /^\s+group:/.test(line));
  assert.notEqual(group, undefined, 'concurrency: に group: がありません');
  return group.replace(/^\s+group:\s*/, '').trim();
}

test('本文の編集（edited）で走るのは policy.yaml だけ', () => {
  assert.ok(!pullRequestLines(workflow('ci.yaml')).some((line) => line.includes('edited')));
  const types = pullRequestLines(workflow('policy.yaml')).find((line) => /^\s+types:/.test(line));
  assert.notEqual(types, undefined, 'policy.yaml の pull_request に types: がありません');
  assert.match(types, /edited/);
});

test('ci.yaml と policy.yaml の concurrency の group は別の名前', () => {
  assert.notEqual(concurrencyGroup(workflow('ci.yaml')), concurrencyGroup(workflow('policy.yaml')));
});

test('ci.yaml と policy.yaml の concurrency の group にはイベントの種類が入っている', () => {
  for (const name of ['ci.yaml', 'policy.yaml']) {
    assert.match(concurrencyGroup(workflow(name)), /\$\{\{ github\.event_name \}\}/, name);
  }
});

test('ci.yaml と policy.yaml のどちらにも workflow_dispatch がある', () => {
  for (const name of ['ci.yaml', 'policy.yaml']) {
    assert.ok(topLevelBlock(workflow(name), 'on').includes('  workflow_dispatch:'), name);
  }
});
