/**
 * @file resources/messages.json から src/util/message/message-keys.ts を生成する（`npm run messages`）。
 *
 * メッセージを足すときに編集するのは messages.json だけ。生成物は手で書き換えない
 * （書き換えても次の生成で消え、キーの綴り違いに気付けなくなる）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const sourceFile = path.join(serverDir, 'resources', 'messages.json');
const targetFile = path.join(serverDir, 'src', 'util', 'message', 'message-keys.ts');

/** メッセージキーとして使える文字（TypeScript の識別子にそのまま書ける形）。 */
const keyPattern = /^[A-Z][A-Z0-9_]*$/;

const messages = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const keys = Object.keys(messages);

const invalidKeys = keys.filter((key) => !keyPattern.test(key));
if (invalidKeys.length > 0) {
  throw new Error(`メッセージキーは英大文字・数字・アンダースコアで書きます: ${invalidKeys.join(', ')}`);
}

const entries = keys.map((key) => `  ${key}: '${key}',`).join('\n');

const contents = `/**
 * @file メッセージキー（自動生成。手で編集しない）。
 *
 * 生成元は resources/messages.json。追加・変更したら \`npm run messages -w server\` を実行する。
 */

/** メッセージキー。値はエラー応答の messageKey としてそのまま画面へ返る。 */
export const MessageKeys = {
${entries}
} as const;

/** @exports メッセージキー。 */
export type MessageKey = (typeof MessageKeys)[keyof typeof MessageKeys];
`;

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, contents, 'utf8');
console.log(`${path.relative(serverDir, targetFile)} を生成しました（${keys.length} 件）`);
