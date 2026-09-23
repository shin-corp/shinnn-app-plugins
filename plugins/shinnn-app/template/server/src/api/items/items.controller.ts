/**
 * @file [API]item。
 *
 * controller は薄く保つ。検証済みの入力を service に渡し、戻り値をそのまま返すだけにする
 * （HTTP のステータスと本文は util/route.ts が API 定義から決める）。
 * 業務としての判断（未存在・重複など）は service に置く。
 * 利用者ごとのデータは `currentUser(req).id` を service に渡し、持ち主で絞らせる。
 */

import { itemsApi } from '@app/shared/api';
import type { AppDatabase } from '../../db/client.js';
import * as itemsService from '../../service/items.service.js';
import { currentUser } from '../../util/auth.js';
import type { RouteHandler } from '../../util/route.js';

/** item の API 定義に対応する処理。 */
export interface ItemsController {
  listItems: RouteHandler<typeof itemsApi.listItems>;
  getItem: RouteHandler<typeof itemsApi.getItem>;
  createItem: RouteHandler<typeof itemsApi.createItem>;
  updateItem: RouteHandler<typeof itemsApi.updateItem>;
  deleteItem: RouteHandler<typeof itemsApi.deleteItem>;
}

/**
 * item の controller を作る。
 *
 * DB のハンドルを引数で受け取るので、テストはその場限りの DB を渡して同じ経路を動かせる。
 *
 * @param db - DB のハンドル
 * @returns controller
 */
export function createItemsController(db: AppDatabase): ItemsController {
  return {
    listItems: (input, { req }) => itemsService.listItems(db, currentUser(req).id, input.query),
    getItem: (input, { req }) => itemsService.getItem(db, currentUser(req).id, input.params.id),
    createItem: (input, { req }) => itemsService.createItem(db, currentUser(req).id, input.body),
    updateItem: (input, { req }) => itemsService.updateItem(db, currentUser(req).id, input.params.id, input.body),
    deleteItem: async (input, { req }) => {
      await itemsService.deleteItem(db, currentUser(req).id, input.params.id);
      // 204 で本文を返さないため、応答の中身は undefined になる。
      return undefined;
    },
  };
}
