/**
 * @file API 定義から Express のルートを作るヘルパー。
 *
 * shared の API 定義（URL・入力・出力）をそのまま登録するので、
 * 定義とサーバーの実装がずれるとビルドエラーになる。
 * ルートを直接 `router.get(...)` で書かない。
 */

import type { AnyRouteDef, RouteHandlerInput, RouteOutput } from '@app/shared/api';
import type express from 'express';
import { validateRouteInput } from './validate.js';
import { HttpStatus } from './http-status.js';

/** ハンドラに渡す要求・応答。ヘッダの読み書きなど、入出力以外が必要なときだけ使う。 */
export interface RouteContext {
  readonly req: express.Request;
  readonly res: express.Response;
}

/** API 定義に対応する処理。検証済みの入力を受け取り、応答の中身を返す。 */
export type RouteHandler<D extends AnyRouteDef> = (
  input: RouteHandlerInput<D>,
  ctx: RouteContext,
) => Promise<RouteOutput<D>>;

/**
 * 応答の本文を返さない API 定義かどうか。
 *
 * `response` が `z.undefined()` のときに 204 を返すための判定。
 * zod のクラスで判定すると、依存の解決のされ方によって別インスタンスになり得るため、
 * 「undefined を受け付けるか」という振る舞いで判定する。
 *
 * @param def - API 定義
 * @returns 本文を返さないなら true
 */
function isNoContent(def: AnyRouteDef): boolean {
  return def.response.safeParse(undefined).success;
}

/**
 * API 定義をルーターへ登録する。
 *
 * 入力は API 定義の zod スキーマで検証し、失敗すると 400 の CommonException になる。
 * ハンドラが投げた例外は Express 5 が error middleware へ渡すため、ここでは捕まえない。
 *
 * @param router - 登録先のルーター
 * @param def - API 定義
 * @param handler - 処理
 */
export function route<D extends AnyRouteDef>(
  router: express.Router,
  def: D,
  handler: RouteHandler<D>,
): void {
  const noContent = isNoContent(def);
  const successStatus = def.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;

  const requestHandler: express.RequestHandler = async (req, res) => {
    const input = validateRouteInput(def, req);
    const output = await handler(input, { req, res });
    if (noContent) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }
    res.status(successStatus).json(output);
  };

  switch (def.method) {
    case 'GET':
      router.get(def.path, requestHandler);
      break;
    case 'POST':
      router.post(def.path, requestHandler);
      break;
    case 'PUT':
      router.put(def.path, requestHandler);
      break;
    case 'PATCH':
      router.patch(def.path, requestHandler);
      break;
    case 'DELETE':
      router.delete(def.path, requestHandler);
      break;
  }
}
