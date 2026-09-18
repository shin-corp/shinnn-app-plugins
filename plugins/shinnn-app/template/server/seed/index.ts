/**
 * @file 初期データの投入（`npm run seed -w server`）。
 *
 * 動かして確かめるための最小限のデータだけを入れる。実行前にマイグレーションを済ませておく。
 * 同じ name の item が既にあれば何もしないので、何度実行しても結果は変わらない。
 */

import { createDb } from '../src/db/client.js';
import { items, type NewItemRow } from '../src/db/schema/items.js';
import { Log } from '../src/util/log.js';
import { MessageKeys } from '../src/util/message/index.js';

const logger = new Log('seed');

const seedItems: NewItemRow[] = [
  { name: '見積フォーマット', description: '営業が使う見積のひな形', status: 'active' },
  { name: '作業手順書', description: '現場での作業手順', status: 'draft' },
  { name: '旧価格表', description: '2025 年度の価格表', status: 'archived' },
];

const handle = await createDb();
try {
  const inserted = await handle.db
    .insert(items)
    .values(seedItems)
    .onConflictDoNothing({ target: items.name })
    .returning({ id: items.id });
  logger.message(MessageKeys.APP_DB_SEEDED, [inserted.length]);
} finally {
  await handle.close();
}
