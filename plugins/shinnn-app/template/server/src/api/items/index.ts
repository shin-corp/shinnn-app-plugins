/**
 * @file item API のルーティング。
 *
 * URL は shared の API 定義がそのまま正になる（ここには書かない）。
 * 新しい機能を足すときはこのファイルを手本にして api/<機能>/index.ts を作り、app.ts で mount する。
 */

import { itemsApi } from '@app/shared/api';
import express from 'express';
import { isAuthenticated } from '../../util/auth.js';
import { route } from '../../util/route.js';
import * as controller from './items.controller.js';

/** item API の URL の共通部分。認証を必須にする範囲の指定に使う。 */
const itemsBasePath = '/api/items';

/** item のルーター。 */
export const itemsRouter = express.Router();

// item の API はすべて認証を必須にする。公開してよい API がある機能では、この行を置かず、
// 認証の要るルートの route() で、handler の前に isAuthenticated() を並べる。
itemsRouter.use(itemsBasePath, isAuthenticated());

route(itemsRouter, itemsApi.listItems, controller.listItems);
route(itemsRouter, itemsApi.getItem, controller.getItem);
route(itemsRouter, itemsApi.createItem, controller.createItem);
route(itemsRouter, itemsApi.updateItem, controller.updateItem);
route(itemsRouter, itemsApi.deleteItem, controller.deleteItem);
