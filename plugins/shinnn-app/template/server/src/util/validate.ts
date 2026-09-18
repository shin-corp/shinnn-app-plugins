/**
 * @file API 定義（shared の zod スキーマ）による入力検証。
 *
 * `req.params` / `req.query` / `req.body` をそのまま読まず、必ずここを通す。
 * 検証を通った値だけが controller へ渡るので、以降は型を信じて書ける。
 */

import type { AnyRouteDef, RouteHandlerInput } from '@app/shared/api';
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
 * API 定義に沿って要求の入力を検証する。
 *
 * API 定義で指定していない部分（body を持たない GET など）は検証も代入もしない。
 *
 * @param def - API 定義
 * @param req - 要求
 * @returns 検証後の入力
 * @throws 検証に失敗したとき 400 の CommonException
 */
export function validateRouteInput<D extends AnyRouteDef>(
  def: D,
  req: express.Request,
): RouteHandlerInput<D> {
  const input: Record<string, unknown> = {};
  if (def.params) {
    input.params = parseOrThrow(def.params, req.params);
  }
  if (def.query) {
    input.query = parseOrThrow(def.query, req.query);
  }
  if (def.body) {
    input.body = parseOrThrow(def.body, req.body);
  }

  /*
   * どのキーを持つかは API 定義から型で決まるが、値を組み立てる側では型が絞れない。
   * キーの有無は上の分岐が API 定義と一致しているため、ここで RouteHandlerInput として扱う。
   */
  return input as RouteHandlerInput<D>;
}
