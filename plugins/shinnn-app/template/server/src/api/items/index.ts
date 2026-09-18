/**
 * @file item API のルーティング。
 *
 * URL は shared の API 定義がそのまま正になる（ここには書かない）。
 * 新しい機能を足すときはこのファイルを手本にして api/<機能>/index.ts を作り、app.ts で mount する。
 */

import { itemsApi } from '@app/shared/api';
import express from 'express';
import type { AppDatabase } from '../../db/client.js';
import { isAuthenticated } from '../../util/auth.js';
import { route } from '../../util/route.js';
import { createItemsController } from './items.controller.js';

/** item API の URL の共通部分。認証を必須にする範囲の指定に使う。 */
const itemsBasePath = '/api/items';

/**
 * item のルーターを作る。
 *
 * @param db - DB のハンドル
 * @returns ルーター
 */
export function createItemsRouter(db: AppDatabase): express.Router {
  const router = express.Router();
  const controller = createItemsController(db);

  // item の API はすべて認証を必須にする。公開してよい API がある機能では、ここを個別に付ける。
  router.use(itemsBasePath, isAuthenticated());

  route(router, itemsApi.listItems, controller.listItems);
  route(router, itemsApi.getItem, controller.getItem);
  route(router, itemsApi.createItem, controller.createItem);
  route(router, itemsApi.updateItem, controller.updateItem);
  route(router, itemsApi.deleteItem, controller.deleteItem);

  return router;
}
