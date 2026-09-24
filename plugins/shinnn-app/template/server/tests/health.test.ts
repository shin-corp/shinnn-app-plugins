/**
 * @file 稼働確認と、どのルートにも当たらない URL の確認。
 *
 * 稼働確認は利用者から見た機能ではなくサーバーの仕組みなので、受入条件（AC-n）には入れていない。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server.close();
});

describe('正常系', () => {
  it('稼働確認は認証なしで 200 を返す', async () => {
    const res = await fetch(`${server.baseUrl}/health`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});

describe('異常系', () => {
  it('どのルートにも当たらない URL は 404 を返す', async () => {
    const res = await fetch(`${server.baseUrl}/api/unknown`);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_ROUTE_NOT_FOUND' });
  });
});
