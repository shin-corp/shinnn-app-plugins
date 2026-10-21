/**
 * 「引き継ぎメモ」Issue の本文から、「CI で確かめていないマージ」の行を取り出す。
 * Actions が使えず CI が始まらなかった間に手元の確かめで進めた PR は、この見出しの下に `- #<PR 番号>（<YYYY-MM-DD>）` の形で残す。
 * 外しているブランチ保護も、同じ見出しの下に `- ブランチ保護を外している（<YYYY-MM-DD>。ブランチ保護 / ルールセット）` の形で残す。
 */

/** 「引き継ぎメモ」Issue の見出し（`## ` を除く） */
export const UNVERIFIED_MERGES_HEADING = 'CI で確かめていないマージ';

/**
 * 見出しの下（次の `#` で始まる見出しの手前まで）の、`- ` で始まる行を返す。見出しが無ければ空の配列。
 *
 * @param body - 「引き継ぎメモ」Issue の本文
 */
export function unverifiedMergeLines(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const isHeading = (line) => /^#+\s/.test(line) && line.replace(/^#+\s+/, '').trim() === UNVERIFIED_MERGES_HEADING;
  const start = lines.findIndex(isHeading);
  if (start === -1) {
    return [];
  }
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#+\s/.test(line)) {
      break;
    }
    if (line.startsWith('- ')) {
      found.push(line.trim());
    }
  }
  return found;
}
