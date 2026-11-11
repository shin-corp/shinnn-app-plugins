/**
 * @file API 定義から Express のルートを作るヘルパー。
 *
 * shared の API 定義（URL・入力・出力）を Express のルーターへ登録する。
 * 登録するときに、API 定義の zod スキーマで入力を検証する middleware を handler の直前に差し込む。
 * handler は Express の `(req, res)` の形で書き、`RouteHandler<typeof <機能>Api.<名前>>` の型を付ける。
 * 型を付けると、`req.params` / `req.query` / `req.body` と `res.json()` の引数に API 定義の型が付く。
 * 定義とサーバーの実装がずれるとビルドエラーになる。
 * ルートを直接 `router.get(...)` で書かない（入力の検証が抜ける）。
 */

import type { AnyRouteDef, HttpMethod, RouteHandlerInput, RouteOutput } from '@app/shared/api';
import type express from 'express';
import { replaceWithValidatedInput } from './validate.js';

/**
 * API 定義の 1 か所分（params / query / body）の、検証後の型。
 *
 * API 定義に無い部分は `unknown` にする。検証していない値を、そのままでは読めないようにするため。
 */
type ValidatedPart<D extends AnyRouteDef, K extends 'params' | 'query' | 'body'> =
  K extends keyof RouteHandlerInput<D> ? RouteHandlerInput<D>[K] : unknown;

/** API 定義に対応するリクエスト。`req.params` / `req.query` / `req.body` は検証済みの値。 */
export type RouteRequest<D extends AnyRouteDef> = express.Request<
  ValidatedPart<D, 'params'>,
  RouteOutput<D>,
  ValidatedPart<D, 'body'>,
  ValidatedPart<D, 'query'>
>;

/** API 定義に対応するレスポンス。`res.json()` には、API 定義の `response` の型の値だけを渡せる。 */
export type RouteResponse<D extends AnyRouteDef> = express.Response<RouteOutput<D>>;

/** API 定義に対応する handler。Express の handler と同じく、`res` でレスポンスを返す。 */
export type RouteHandler<D extends AnyRouteDef> = (req: RouteRequest<D>, res: RouteResponse<D>) => void | Promise<void>;

/** `route()` に並べるもの。このルートだけに掛ける middleware（無ければ省く）と、最後に handler。 */
type RouteHandlers<D extends AnyRouteDef> = [...middleware: express.RequestHandler[], handler: RouteHandler<D>];

/** API 定義のメソッドと、それを登録する Router のメソッドの名前。 */
const routerMethods = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const satisfies Record<HttpMethod, keyof express.Router>;

/**
 * API 定義をルーターへ登録する。
 *
 * 並べた middleware の後、handler の直前で入力を検証する。検証に失敗すると 400 の CommonException になる。
 * 検証に通ると、`req.params` / `req.query` / `req.body` を検証後の値（既定値と変換を適用済み）に置き換える。
 * handler が投げた例外は Express 5 が error middleware へ渡すため、ここでは捕まえない。
 *
 * @example
 * ```ts
 * route(router, itemsApi.createItem, controller.createItem);
 * route(router, filesApi.uploadFile, upload.single('file'), controller.uploadFile);
 * ```
 *
 * @param router - 登録先のルーター
 * @param def - API 定義
 * @param handlers - このルートだけに掛ける middleware（無ければ省く）と、最後に handler
 */
export function route<D extends AnyRouteDef>(router: express.Router, def: D, ...handlers: RouteHandlers<D>): void {
  // 可変長の要素が先に来る組は、最後の要素の型を絞れないので、ここで分けて型を付ける。
  const middleware = handlers.slice(0, -1) as express.RequestHandler[];
  const handler = handlers[handlers.length - 1] as RouteHandler<D>;

  const validateInput: express.RequestHandler = (req, _res, next) => {
    replaceWithValidatedInput(def, req);
    next();
  };

  // validateInput が req の値を検証後の値に置き換えた後に呼ぶので、API 定義の型として渡す。
  const callHandler: express.RequestHandler = (req, res) => handler(req as unknown as RouteRequest<D>, res);

  router[routerMethods[def.method]](def.path, ...middleware, validateInput, callHandler);
}
