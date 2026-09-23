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

/**
 * item。利用者ごとのデータで、持ち主（ownerId）の item だけをその利用者に見せる。
 * 名前は同じ持ち主の中で重複させない（重複は service が 409 で弾く）。
 */
export const items = pgTable(
  'items',
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * 持ち主。JWT の sub（利用者の識別子）をそのまま入れる。
     * 認証の方式によって sub が uuid とは限らないので文字列で持つ。
     */
    ownerId: varchar({ length: 255 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 1000 }),
    status: itemStatus().notNull().default('draft'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // 一意性を持ち主ごとにするのは、他人が付けた名前と重複したことが 409 で分かると、
  // 他人のデータの存在が漏れるため。この索引は持ち主での絞り込みにも使われる。
  (table) => [uniqueIndex('items_owner_id_name_key').on(table.ownerId, table.name)],
);

/** @exports 取得した item の行。 */
export type ItemRow = typeof items.$inferSelect;

/** @exports 登録する item の行。 */
export type NewItemRow = typeof items.$inferInsert;
