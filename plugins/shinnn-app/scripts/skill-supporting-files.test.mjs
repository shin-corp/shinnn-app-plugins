// スキルの別ファイル（SKILL.md と同じフォルダのほかの .md）を固める回帰テスト。
// 別ファイルは SKILL.md から名指しされたときだけ読まれるので、名指しの無いファイルはどこからも読まれない。
// 別ファイルの 1 行目に「SKILL.md の「<見出し>」から読む」と書いたものは、SKILL.md にその見出しが残り、
// その見出しの下で別ファイルを名指ししていることまで見る（ほかのスキル・規約・hooks が見出しを名指ししているため）。
// ${CLAUDE_PLUGIN_ROOT} は SKILL.md を読み込むときにしか置き換わらないので、別ファイルのコマンドには SKILL.md の読み替えの文が要る。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const skillsRoot = fileURLToPath(new URL('../skills/', import.meta.url));
const pluginRootVariable = '${CLAUDE_PLUGIN_ROOT}';
const substitutionSentence = 'プラグインのフォルダを変数 CLAUDE_PLUGIN_ROOT で書いている';
/** 1 行目から見出しを取り出せる別ファイル（`<スキルのフォルダ>/<ファイル>`）。plan.md は 1 行目の形が違うので入らない */
const FILES_WITH_ENTRY_LINE = [
  'feature/finish.md',
  'feature/first-screen-check.md',
  'feature/rebuild.md',
  'feature/resume.md',
  'feature/stopping.md',
  'pr/ci-not-starting.md',
];

/** スキルのフォルダごとの、SKILL.md の中身と別ファイルの名前と中身 */
function listSkills() {
  const skills = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = join(skillsRoot, entry.name);
    const others = [];
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.md') && name !== 'SKILL.md') {
        others.push({ name, text: readFileSync(join(dir, name), 'utf8') });
      }
    }
    skills.push({ name: entry.name, skill: readFileSync(join(dir, 'SKILL.md'), 'utf8'), others });
  }
  return skills;
}

/** SKILL.md の行のうち、読み替えの文の行を除いたもの（読み替えの文は別ファイルの名前を例に挙げるので、名指しに数えない） */
function linesWithoutSubstitution(skill) {
  return skill.split('\n').filter((line) => !line.includes(substitutionSentence));
}

/**
 * 別ファイルの 1 行目が挙げる、読みに来る見出し（「A」の「B」のように入れ子で書いたものは、内側の B だけ）。
 * 1 行目がその形でなければ空の配列
 */
function entryHeadings(otherText) {
  const firstLine = otherText.split('\n')[0];
  if (!/SKILL\.md の「.+」から読む。$/.test(firstLine)) {
    return [];
  }
  const headings = [];
  for (const match of firstLine.matchAll(/「([^」]+)」/g)) {
    const isContainer = firstLine.startsWith('の「', match.index + match[0].length);
    if (!isContainer) {
      headings.push(match[1]);
    }
  }
  return headings;
}

/** SKILL.md の見出しの下の行（次の見出しの手前まで）。見出しが無ければ undefined */
function sectionUnder(lines, heading) {
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.replace(/^#{2,4} /, '').startsWith(heading));
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('スキルの別ファイル: どれも SKILL.md から名指しされている（読み替えの文は数えない）', () => {
  for (const { name, skill, others } of listSkills()) {
    const body = linesWithoutSubstitution(skill).join('\n');
    for (const other of others) {
      assert.ok(body.includes(`\`${other.name}\``), `${name}/SKILL.md が ${other.name} を名指しする`);
    }
  }
});

test('スキルの別ファイル: 1 行目が挙げる見出しが SKILL.md に残り、その下で別ファイルを名指しする', () => {
  const checkedFiles = [];
  for (const { name, skill, others } of listSkills()) {
    const lines = linesWithoutSubstitution(skill);
    for (const other of others) {
      const headings = entryHeadings(other.text);
      for (const heading of headings) {
        const section = sectionUnder(lines, heading);
        assert.ok(section !== undefined, `${name}/SKILL.md に見出し「${heading}」がある`);
        assert.ok(
          section.includes(`\`${other.name}\``),
          `${name}/SKILL.md の「${heading}」の下で ${other.name} を名指しする`,
        );
      }
      if (headings.length > 0) {
        checkedFiles.push(`${name}/${other.name}`);
      }
    }
  }
  // 見出しを取り出せた別ファイルが、決めた一覧と同じことを確かめる（1 行目の形が崩れて、そのファイルを見なくなるのを防ぐ）
  assert.deepEqual(checkedFiles.sort(), [...FILES_WITH_ENTRY_LINE].sort());
});

test('スキルの別ファイル: CLAUDE_PLUGIN_ROOT を使うなら、SKILL.md に読み替えの文がある', () => {
  for (const { name, skill, others } of listSkills()) {
    const usesVariable = others.some((other) => other.text.includes(pluginRootVariable));
    if (!usesVariable) {
      continue;
    }
    assert.ok(skill.includes(substitutionSentence), `${name}/SKILL.md に読み替えの文がある`);
    // 読み替えの文の置き換え先は、SKILL.md を読み込むときに置き換わる形で書く
    const sentenceLine = skill.split('\n').find((line) => line.includes(substitutionSentence));
    assert.ok(sentenceLine.includes(`\`${pluginRootVariable}\` に置き換える`), `${name}/SKILL.md の読み替えの文の形`);
  }
});
