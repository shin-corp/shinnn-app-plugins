/**
 * @file API 定義（shared の zod スキーマ）による入力検証。
 *
 * `route()` が handler の直前にここを通し、`req.params` / `req.query` / `req.body` を検証後の値に置き換える。
 * handler が読む値は検証を通ったものだけになるので、以降は型を信じて書ける。
 */

import type { AnyRouteDef } from '@app/shared/api';
import type express from 'express';
import type { z } from 'zod';
import { CommonException } from '../exception/common-exception.js';
import { HttpStatus } from './http-status.js';
import { MessageKeys } from './message/index.js';

/**
 * 1 か所分の入力を検証する。
 *
 * @param schema - API 定義のスキーマ
 * @param value - 検証前の値
 * @returns 検証後の値（既定値は適用済み）
 * @throws 検証に失敗したとき 400 の CommonException
 */
function parseOrThrow(schema: z.ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CommonException(HttpStatus.BAD_REQUEST, MessageKeys.APP_VALIDATION_FAILED, {
      details: result.error.issues,
    });
  }
  return result.data;
}

/**
 * リクエストの値を置き換える。
 *
 * Express 5 の `req.query` は読み取り専用（getter）で、代入すると例外になる。
 * そのため、代入せずにプロパティを定義し直す。`req.params` と `req.body` も同じ形で置き換える。
 *
 * @param req - リクエスト
 * @param key - 置き換える場所
 * @param value - 検証後の値
 */
function replaceRequestValue(req: express.Request, key: 'params' | 'query' | 'body', value: unknown): void {
  Object.defineProperty(req, key, { value, writable: true, configurable: true, enumerable: true });
}

/**
 * API 定義に沿ってリクエストの入力を検証し、検証後の値に置き換える。
 *
 * API 定義で指定していない部分（body を持たない GET など）は検証も置き換えもしない。
 *
 * @param def - API 定義
 * @param req - リクエスト
 * @throws 検証に失敗したとき 400 の CommonException
 */
export function replaceWithValidatedInput(def: AnyRouteDef, req: express.Request): void {
  if (def.params) {
    replaceRequestValue(req, 'params', parseOrThrow(def.params, req.params));
  }
  if (def.query) {
    replaceRequestValue(req, 'query', parseOrThrow(def.query, req.query));
  }
  if (def.body) {
    replaceRequestValue(req, 'body', parseOrThrow(def.body, req.body));
  }
}
