/**
 * @file テスト用のサーバー。
 *
 * 本番と同じ組み立て（createApp）のまま空きポートで立て、native fetch で HTTP として確かめる。
 * ポートを 0 にすると OS が空いている番号を割り当てるので、テストが並行しても衝突しない。
 */

import type { AnyRouteDef, PathParams } from '@app/shared/api';
import { buildPath } from '@app/shared/api';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';
import type { AppDatabase } from '../../src/db/client.js';
import { clearTestDb, createTestDb } from './db.js';

/** 立ち上げたテスト用サーバー。 */
export interface TestServer {
  /** `${baseUrl}/health` のように使う。末尾に `/` は付かない。 */
  readonly baseUrl: string;
  /**
   * API 定義から要求先の URL を組み立てる。
   *
   * URL を手で書かず定義を参照することで、パスを変えたときにテストも一緒に動く。
   * クエリ文字列は戻り値に足す（例: `${server.url(itemsApi.listItems)}?limit=1`）。
   */
  readonly url: (route: AnyRouteDef, params?: PathParams) => string;
  /** テストデータを直接用意したいときに使う DB のハンドル。 */
  readonly db: AppDatabase;
  /** DB のデータを空にする。前のテストが残したデータに依存しないよう、`beforeEach` で呼ぶ。 */
  readonly reset: () => Promise<void>;
  /** サーバーと DB を止める。`afterAll` で必ず呼ぶ。 */
  readonly close: () => Promise<void>;
}

/**
 * テスト用のサーバーを立てる。テストファイルごとに 1 回、`beforeAll` で呼ぶ。
 *
 * @returns 立ち上げたサーバー
 */
export async function startServer(): Promise<TestServer> {
  const handle = await createTestDb();
  const app = createApp({ db: handle.db });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listening = app.listen(0, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(listening);
    });
  });

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    url: (route, params) => `http://127.0.0.1:${port}${buildPath(route.path, params)}`,
    db: handle.db,
    reset: () => clearTestDb(handle.db),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await handle.close();
    },
  };
}
