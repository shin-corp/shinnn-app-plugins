/**
 * @file [API]item。
 *
 * controller は薄く保つ。検証済みの入力を service に渡し、戻り値をそのまま返すだけにする
 * （HTTP のステータスと本文は util/route.ts が API 定義から決める）。
 * 業務としての判断（未存在・重複など）は service に置く。
 */

import { itemsApi } from '@app/shared/api';
import type { AppDatabase } from '../../db/client.js';
import * as itemsService from '../../service/items.service.js';
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
    listItems: (input) => itemsService.listItems(db, input.query),
    getItem: (input) => itemsService.getItem(db, input.params.id),
    createItem: (input) => itemsService.createItem(db, input.body),
    updateItem: (input) => itemsService.updateItem(db, input.params.id, input.body),
    deleteItem: async (input) => {
      await itemsService.deleteItem(db, input.params.id);
      // 204 で本文を返さないため、応答の中身は undefined になる。
      return undefined;
    },
  };
}
