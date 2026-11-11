/**
 * @file [API]item。
 *
 * controller は薄く保つ。検証済みの入力（`req.params` / `req.query` / `req.body`）を service に渡し、
 * 結果を `res.status(...).json(...)` で返すだけにする。
 * 業務としての判断（未存在・重複など）は service に置く。
 * 利用者ごとのデータは `currentUser(req).id` を service に渡し、持ち主で絞らせる。
 * DB のハンドルは `req.db`（`createApp()` が入れる）を service に渡す。
 */

import { itemsApi } from '@app/shared/api';
import * as itemsService from '../../service/items.service.js';
import { currentUser } from '../../util/auth.js';
import { HttpStatus } from '../../util/http-status.js';
import type { RouteHandler } from '../../util/route.js';

/** item の一覧を返す。 */
export const listItems: RouteHandler<typeof itemsApi.listItems> = async (req, res) => {
  const list = await itemsService.listItems(req.db, currentUser(req).id, req.query);
  res.status(HttpStatus.OK).json(list);
};

/** item を 1 件返す。 */
export const getItem: RouteHandler<typeof itemsApi.getItem> = async (req, res) => {
  const item = await itemsService.getItem(req.db, currentUser(req).id, req.params.id);
  res.status(HttpStatus.OK).json(item);
};

/** item を作成し、作成した item を返す。 */
export const createItem: RouteHandler<typeof itemsApi.createItem> = async (req, res) => {
  const item = await itemsService.createItem(req.db, currentUser(req).id, req.body);
  res.status(HttpStatus.CREATED).json(item);
};

/** item を更新し、更新後の item を返す。 */
export const updateItem: RouteHandler<typeof itemsApi.updateItem> = async (req, res) => {
  const item = await itemsService.updateItem(req.db, currentUser(req).id, req.params.id, req.body);
  res.status(HttpStatus.OK).json(item);
};

/** item を削除する。API 定義の response が z.undefined() なので、本文を付けずに 204 を返す。 */
export const deleteItem: RouteHandler<typeof itemsApi.deleteItem> = async (req, res) => {
  await itemsService.deleteItem(req.db, currentUser(req).id, req.params.id);
  res.status(HttpStatus.NO_CONTENT).end();
};
