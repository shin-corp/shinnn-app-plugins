/**
 * 作業が詰まったところの手元の記録（record-friction.mjs が書く）の、ファイルの名前と読み方。
 * record-friction.mjs・friction-report.mjs・session-start.mjs・check-on-stop.mjs が使う。
 * 置き場所は lib/hook-io.mjs の stateDir()。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 記録のファイルの名前。1 行が 1 件の JSON */
export const FRICTION_FILE = 'friction.jsonl';

/** friction-report.mjs が最後にまとめた時刻を残すファイルの名前 */
export const REPORTED_AT_FILE = 'friction-reported-at';

/**
 * API のエラーで中断したときの印のファイルの名前。作業フォルダごとに分ける。
 * 置き場所の git の共通フォルダは、同じリポジトリのどの worktree からも同じなので、1 つの名前だと別の worktree の印を上書きする。
 *
 * 印は、同じ作業フォルダで始めた別のセッションの最初に、session-start.mjs が読んで知らせ、消す。
 * 同じセッションの続き（会話の要約の後や resume）では、知らせずに消す。
 * 同じセッションの応答が終わりまで届いたら（check-on-stop.mjs）、知らせずに消す。
 */
export function stopFailureFile(root) {
  const key = createHash('sha1').update(resolve(root)).digest('hex').slice(0, 12);
  return `last-stop-failure-${key}.json`;
}

/** 中断の印を読む。無いか壊れていれば null。印は { at, error, details, session（セッション ID の先頭 8 文字）, root } */
export function readStopFailure(dir, root) {
  const marker = join(dir, stopFailureFile(root));
  if (!existsSync(marker)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    return null;
  }
}

/** 中断の印を消す。消せなくても止めない */
export function removeStopFailure(dir, root) {
  try {
    unlinkSync(join(dir, stopFailureFile(root)));
  } catch {
    // 無い・消せないときは何もしない
  }
}

/** 記録のファイルの行を読む。壊れた行は飛ばす */
export function readRecords(file) {
  if (!existsSync(file)) {
    return [];
  }
  const records = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      // 書きかけの行などは数えない
    }
  }
  return records;
}
