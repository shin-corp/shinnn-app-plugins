/**
 * @file item テーブルの定義。
 *
 * テーブルを足すときはこのファイルを手本に db/schema/<テーブル>.ts を作り、
 * `npm run db:generate -w server` でマイグレーション SQL を生成する（SQL は手で書かない）。
 * 列名は drizzle.config.ts の `casing: 'snake_case'` で自動変換されるので、TypeScript 側は camelCase で書く。
 */

import { pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/** item の状態。値は shared の ItemStatusSchema と一致させる。 */
export const itemStatus = pgEnum('item_status', ['draft', 'active', 'archived']);

/** item。名前は重複させない（重複は service が 409 で弾く）。 */
export const items = pgTable(
  'items',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 1000 }),
    status: itemStatus().notNull().default('draft'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('items_name_key').on(table.name)],
);

/** @exports 取得した item の行。 */
export type ItemRow = typeof items.$inferSelect;

/** @exports 登録する item の行。 */
export type NewItemRow = typeof items.$inferInsert;
