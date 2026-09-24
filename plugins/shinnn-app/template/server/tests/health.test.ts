/**
 * @file 稼働確認と、どのルートにも当たらない URL の確認。
 *
 * テスト名の先頭の AC-n は docs/仕様書.md の受入条件の番号。
 * どの条件を確かめているテストなのかを、実行結果からたどれるようにする。
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
  it('AC-10 稼働確認は認証なしで 200 を返す', async () => {
    const res = await fetch(`${server.baseUrl}/health`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});

describe('異常系', () => {
  it('AC-10 どのルートにも当たらない URL は 404 を返す', async () => {
    const res = await fetch(`${server.baseUrl}/api/unknown`);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_ROUTE_NOT_FOUND' });
  });
});
