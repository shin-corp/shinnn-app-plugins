/**
 * スキルに書くコマンドの、シェルで動きが変わる形の回帰テスト。
 * `node --test scripts/skill-shell-forms.test.mjs` で実行する。
 *
 * 顧客の手元が Windows のとき、Claude Code は Windows PowerShell 5.1 でコマンドを動かすことがある。
 * - `&&` と `||` は構文エラーになる
 * - `date` は `Get-Date` として動く。`date -u +%Y-%m-%dT%H:%M:%SZ` は、現地の時刻に `Z` を付けて返す
 * - `>` はファイルの先頭に BOM（文字コードを示す印）を書く
 * CI は Linux で動くので PowerShell 5.1 を動かせない。ここでは書いてある形を見る。時刻のコマンドは Node で動かす。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** スキルの置き場所 */
const SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));

/** 文書のファイルをすべて集める */
function collectMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

/** スキルの文書を読む */
function readSkill(...segments) {
  return readFileSync(join(SKILLS_ROOT, ...segments), 'utf8');
}

/** スキルの文書のうち、形に当てはまる行を、ファイルと行番号を付けて集める */
function findLines(pattern) {
  const files = collectMarkdownFiles(SKILLS_ROOT);
  assert.ok(files.length > 0, 'スキルの文書を 1 つも読めていない');

  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(SKILLS_ROOT, file).split(sep).join('/')}:${index + 1} ${line}`] : [],
      ),
  );
}

test('スキルに && と || を書かない', () => {
  assert.deepEqual(findLines(/&&|\|\|/), [], 'コマンドを分けて、前のコマンドが成功したら次を実行すると書く');
});

test('スキルに date コマンドを書かない', () => {
  assert.deepEqual(findLines(/(^|[\s(`])date(\s|\)|`|$)/), [], '時刻は node -p で取る');
});

test('スキルにリダイレクトを書かない', () => {
  // `>` の前に空白がある形だけを見る。空白の無い形まで見ると、`<番号>` のような置き換え用の表記に当たる
  assert.deepEqual(findLines(/\S\s+\d?>>?\s*[^=\s|]/), [], 'ファイルは Write ツールで scratchpad に書く');
});

test('pr は main への切り替えと取り込みを別のコマンドにし、失敗したら次に進まない', () => {
  const skill = readSkill('pr', 'SKILL.md');

  assert.ok(skill.includes('git switch main\ngit pull --ff-only\n'));
  assert.match(skill, /コマンドは上から 1 つずつ実行する。失敗したら次に進まない。/);
});

test('feature と check は git switch main が成功してから git pull --ff-only を実行し、失敗したら止まる', () => {
  const steps =
    /`git switch main` を実行し、成功したら `git pull --ff-only` を実行する。失敗したら、次に進まずに報告する/g;

  assert.equal(readSkill('feature', 'SKILL.md').match(steps)?.length, 2);
  assert.equal(readSkill('check', 'SKILL.md').match(steps)?.length, 1);
});

test('pr の時刻のコマンドは、現地の時刻によらず UTC を秒までで返す', () => {
  const command = readSkill('pr', 'SKILL.md').match(/^\s*node -p "([^"]+)"$/m);
  assert.ok(command, 'pr に node -p の時刻のコマンドが無い');

  const before = Math.floor(Date.now() / 1000) * 1000;
  const result = spawnSync(process.execPath, ['-p', command[1]], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Asia/Tokyo' },
  });
  const after = Date.now();

  assert.equal(result.status, 0, result.stderr);
  const time = result.stdout.trim();
  // 実行の createdAt は秒まで。ミリ秒を付けると、控えた時刻と同じ秒に作られた実行が外れる
  assert.match(time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(Date.parse(time) >= before && Date.parse(time) <= after, `${time} が今の時刻と合わない`);
});

test('pr は引き継ぎメモの本文を check・retro と同じく Write ツールで書く', () => {
  const skill = readSkill('pr', 'SKILL.md');

  assert.ok(skill.includes('今の本文は `gh issue view <Issue 番号> --json body --jq .body` で読む。'));
  assert.ok(
    skill.includes(
      '書き換えた本文は、Write ツールで scratchpad の `issue-body.md` に書き、`gh issue edit <Issue 番号> --body-file <そのファイル>` に渡す。',
    ),
  );
});
