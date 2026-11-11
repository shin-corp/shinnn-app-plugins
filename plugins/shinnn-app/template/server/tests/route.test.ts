/**
 * @file API 定義をルーターへ登録する `route()` の確認。
 *
 * サンプルの API 定義とルーターは、値を変換する検証と、1 つのルートだけに掛ける middleware を使わない。
 * そのため、試験用の API 定義だけを登録した Express アプリを立て、HTTP として確かめる。
 */

import { buildPath, defineRoute, type HttpMethod } from '@app/shared/api';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommonException } from '../src/exception/common-exception.js';
import { HttpStatus } from '../src/util/http-status.js';
import { MessageKeys } from '../src/util/message/index.js';
import { route } from '../src/util/route.js';

/** 数字の文字列を数値に変える。値が検証後の値に置き換わったかを、型の違いで確かめるために使う。 */
const digitsToNumber = z.string().regex(/^\d+$/).max(10).transform(Number);

/** パスパラメータを数値に変える。 */
const routeTestParams = defineRoute({
  method: 'GET',
  path: '/api/route-test/params/:count',
  params: z.object({ count: digitsToNumber }),
  response: z.object({ count: z.number() }),
});

/** クエリ文字列を数値に変える。 */
const routeTestQuery = defineRoute({
  method: 'GET',
  path: '/api/route-test/query',
  query: z.object({ count: digitsToNumber }),
  response: z.object({ count: z.number() }),
});

/** 本文の前後の空白を除く。本文は middleware が作る。 */
const routeTestBody = defineRoute({
  method: 'POST',
  path: '/api/route-test/body',
  body: z.object({ name: z.string().trim().min(1).max(100) }),
  response: z.object({ name: z.string() }),
});

/** API 定義で使えるメソッドのすべて。 */
const allMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const satisfies readonly HttpMethod[];

/**
 * middleware が先にレスポンスを返すルートの API 定義を作る。
 *
 * @param method - メソッド
 * @returns メソッドごとにパスの違う API 定義
 */
function routeTestGuarded(method: HttpMethod) {
  return defineRoute({
    method,
    path: `/api/route-test/guarded/${method.toLowerCase()}`,
    response: z.object({ ok: z.boolean() }),
  });
}

/** middleware が本文に入れる名前。前後に空白を付け、検証で除かれることを確かめる。 */
const nameFromMiddleware = '  middleware が入れた名前  ';

/** 本文を作る middleware。ファイルを含むフォームの本文を受け取る middleware と同じく、検証より前に `req.body` を作る。 */
const fillBody: express.RequestHandler = (req, _res, next) => {
  req.body = { name: nameFromMiddleware };
  next();
};

/** 認証に失敗したときと同じレスポンスを返し、後ろへ進ませない middleware。 */
const rejectRequest: express.RequestHandler = (_req, res) => {
  const exception = new CommonException(HttpStatus.UNAUTHORIZED, MessageKeys.APP_UNAUTHORIZED);
  res.status(HttpStatus.UNAUTHORIZED).json(exception.toResponseBody());
};

/** handler まで届いたメソッド。 */
const reachedMethods = new Set<HttpMethod>();

let server: ReturnType<express.Express['listen']>;
let baseUrl: string;

beforeAll(async () => {
  const router = express.Router();
  route(router, routeTestParams, (req, res) => {
    res.status(HttpStatus.OK).json({ count: req.params.count });
  });
  route(router, routeTestQuery, (req, res) => {
    res.status(HttpStatus.OK).json({ count: req.query.count });
  });
  route(router, routeTestBody, fillBody, (req, res) => {
    res.status(HttpStatus.CREATED).json({ name: req.body.name });
  });
  for (const method of allMethods) {
    route(router, routeTestGuarded(method), rejectRequest, (_req, res) => {
      reachedMethods.add(method);
      res.status(HttpStatus.OK).json({ ok: true });
    });
  }

  const app = express();
  app.use(express.json());
  app.use(router);

  server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    // 送る先と同じ 127.0.0.1 で待ち受ける（理由は helpers/server.ts の startServer()）。
    const listening = app.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(listening);
    });
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe('正常系', () => {
  it('req.params は、検証後の値（数字の文字列から変えた数値）に置き換わって handler に届く', async () => {
    const res = await fetch(`${baseUrl}${buildPath(routeTestParams.path, { count: '7' })}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 7 });
  });

  it('req.query は、検証後の値（数字の文字列から変えた数値）に置き換わって handler に届く', async () => {
    const res = await fetch(`${baseUrl}${buildPath(routeTestQuery.path)}?count=5`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 5 });
  });

  it('handler の前に並べた middleware は検証より前に動き、middleware が作った本文も検証後の値で handler に届く', async () => {
    const res = await fetch(`${baseUrl}${buildPath(routeTestBody.path)}`, { method: 'POST' });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ name: nameFromMiddleware.trim() });
  });
});

describe('異常系', () => {
  it('検証に通らない入力は、handler に届かずに 400 になる', async () => {
    const res = await fetch(`${baseUrl}${buildPath(routeTestParams.path, { count: 'abc' })}`);

    expect(res.status).toBe(400);
  });

  it.each(allMethods)(
    '%s のルートでも、handler の前に並べた middleware がレスポンスを返すと、handler は呼ばれない',
    async (method) => {
      const res = await fetch(`${baseUrl}${buildPath(routeTestGuarded(method).path)}`, { method });

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_UNAUTHORIZED' });
      expect(reachedMethods.has(method)).toBe(false);
    },
  );
});
