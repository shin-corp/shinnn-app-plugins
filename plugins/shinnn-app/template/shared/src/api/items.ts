/**
 * @file サンプル縦切り `item` の API 定義。
 *
 * 新しい機能を足すときは、このファイルを手本にして `shared/src/api/<機能>.ts` を作る。
 * 手順は shared → server → client の順（定義が先、参照が後）で、同じ PR にまとめる。
 */

import { z } from 'zod';
import { defineRoute } from './route.js';

/** item の状態。下書き / 運用中 / 保管済み。 */
export const ItemStatusSchema = z.enum(['draft', 'active', 'archived']);

/** @exports item の状態。 */
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** item 1 件。日時は ISO 8601 の文字列で受け渡す（JSON に Date 型が無いため）。 */
export const ItemSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  status: ItemStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** @exports item 1 件。 */
export type Item = z.infer<typeof ItemSchema>;

/** 作成・更新で受け取る項目。id と日時はサーバーが決めるので含めない。 */
const ItemInputSchema = ItemSchema.omit({ id: true, createdAt: true, updatedAt: true });

/** item の作成。status を省略したときは draft になる。 */
export const CreateItemSchema = ItemInputSchema.extend({
  status: ItemStatusSchema.default('draft'),
});

/** @exports item の作成。 */
export type CreateItem = z.infer<typeof CreateItemSchema>;

/** item の部分更新。渡された項目だけを書き換える。 */
export const UpdateItemSchema = ItemInputSchema.partial();

/** @exports item の部分更新。 */
export type UpdateItem = z.infer<typeof UpdateItemSchema>;

/** パスパラメータ `:id`。 */
export const ItemParamsSchema = z.object({
  id: z.uuid(),
});

/**
 * クエリ文字列は文字列で届くため、数値に変換してから範囲を検証する。
 *
 * `z.coerce.number()` は検証前の型が `unknown` になり、呼び出し側の型検査が効かなくなるので使わない。
 */
const IntegerQuerySchema = z
  .union([z.number(), z.string().regex(/^\d+$/, '数値を指定してください')])
  .transform((value) => Number(value));

/** 一覧の絞り込み。1 回に取れる件数を 100 件までに制限する。 */
export const ItemListQuerySchema = z.object({
  limit: IntegerQuerySchema.pipe(z.number().int().min(1).max(100)).default(20),
  offset: IntegerQuerySchema.pipe(z.number().int().min(0)).default(0),
});

/** @exports 一覧の絞り込み。 */
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

/** 一覧のレスポンス。`total` は絞り込み前の総件数（ページャの表示に使う）。 */
export const ItemListSchema = z.object({
  items: z.array(ItemSchema),
  total: z.number().int().min(0),
});

/** @exports 一覧のレスポンス。 */
export type ItemList = z.infer<typeof ItemListSchema>;

/** item の一覧を取得する。 */
export const listItems = defineRoute({
  method: 'GET',
  path: '/api/items',
  query: ItemListQuerySchema,
  response: ItemListSchema,
});

/** item を 1 件取得する。 */
export const getItem = defineRoute({
  method: 'GET',
  path: '/api/items/:id',
  params: ItemParamsSchema,
  response: ItemSchema,
});

/** item を作成する。作成した item を 201 で返す。 */
export const createItem = defineRoute({
  method: 'POST',
  path: '/api/items',
  body: CreateItemSchema,
  response: ItemSchema,
});

/** item を更新する。更新後の item を返す。 */
export const updateItem = defineRoute({
  method: 'PUT',
  path: '/api/items/:id',
  params: ItemParamsSchema,
  body: UpdateItemSchema,
  response: ItemSchema,
});

/** item を削除する。本文を返さない（204）。 */
export const deleteItem = defineRoute({
  method: 'DELETE',
  path: '/api/items/:id',
  params: ItemParamsSchema,
  response: z.undefined(),
});

/** item の API 定義一式。server の router と client の呼び出しはここを参照する。 */
export const itemsApi = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
} as const;
