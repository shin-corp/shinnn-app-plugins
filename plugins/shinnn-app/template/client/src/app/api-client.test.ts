/** @file api-client の検証。fetch を差し替えて、組み立てた要求と応答の扱いを確かめる。 */

import { itemsApi } from '@app/shared/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, call, describeError } from './api-client';

/** fetch の差し替え。呼ばれた引数を後から読めるようにする。 */
function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** JSON を返す応答を作る。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('call', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('正常系', () => {
    it('クエリ付きの GET を組み立て、応答の JSON を返す', async () => {
      const fetchMock = stubFetch(jsonResponse({ items: [], total: 0 }));

      const result = await call(itemsApi.listItems, { query: { limit: 5, offset: 10 } });

      expect(result).toEqual({ items: [], total: 0 });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/items?limit=5&offset=10');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });

    it('パスパラメータを URL に埋め込む', async () => {
      const fetchMock = stubFetch(jsonResponse({ id: 'a' }));

      await call(itemsApi.getItem, { params: { id: 'a-b-c' } });

      expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/items/a-b-c');
    });

    it('ボディ付きの POST では JSON として送る', async () => {
      const fetchMock = stubFetch(jsonResponse({ id: 'a' }, 201));

      await call(itemsApi.createItem, { body: { name: '新しい item' } });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ name: '新しい item' }));
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    });

    it('localStorage の token を Bearer で付ける', async () => {
      localStorage.setItem('token', 'abc123');
      const fetchMock = stubFetch(jsonResponse({ items: [], total: 0 }));

      await call(itemsApi.listItems, { query: {} });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer abc123');
    });

    it('token が無ければ Authorization を付けない', async () => {
      const fetchMock = stubFetch(jsonResponse({ items: [], total: 0 }));

      await call(itemsApi.listItems, { query: {} });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
    });

    it('204 の応答では undefined を返す', async () => {
      stubFetch(new Response(null, { status: 204 }));

      await expect(call(itemsApi.deleteItem, { params: { id: 'a' } })).resolves.toBeUndefined();
    });
  });

  describe('異常系', () => {
    it('エラー応答を ApiError にして投げる', async () => {
      stubFetch(
        jsonResponse({ messageKey: 'APP_ITEM_NOT_FOUND', message: 'item が見つかりません', details: { id: 'a' } }, 404),
      );

      const error = await call(itemsApi.getItem, { params: { id: 'a' } }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(404);
      expect(apiError.messageKey).toBe('APP_ITEM_NOT_FOUND');
      expect(apiError.details).toEqual({ id: 'a' });
    });

    it('JSON でないエラー応答でも ApiError にする', async () => {
      stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));

      const error = (await call(itemsApi.listItems, { query: {} }).catch((caught: unknown) => caught)) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.messageKey).toBe('APP_UNEXPECTED_ERROR');
    });
  });

  describe('型', () => {
    it('入力が要るルートでは input を省略できない', () => {
      // 実行はしない。ここに書いた呼び出しが型検査を通るかどうかだけを見る。
      function typeCheckOnly(): void {
        // @ts-expect-error params を渡さない呼び出しは型検査で落ちる（実行時まで気づけないのを防ぐ）。
        void call(itemsApi.getItem);
        // @ts-expect-error query を渡さない呼び出しも同じ。
        void call(itemsApi.listItems);
        void call(itemsApi.getItem, { params: { id: 'a' } });
        void call(itemsApi.listItems, { query: {} });
      }

      expect(typeCheckOnly).toBeTypeOf('function');
    });
  });

  describe('エッジケース', () => {
    it('値が未指定のクエリ項目は送らない', async () => {
      const fetchMock = stubFetch(jsonResponse({ items: [], total: 0 }));

      await call(itemsApi.listItems, { query: { limit: undefined, offset: 0 } });

      expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/items?offset=0');
    });
  });
});

describe('describeError', () => {
  it('ApiError では messageKey を併記する', () => {
    expect(describeError(new ApiError(409, 'APP_ITEM_DUPLICATED', '同じ名前の item があります'))).toBe(
      '同じ名前の item があります（APP_ITEM_DUPLICATED）',
    );
  });

  it('Error 以外は既定の文言にする', () => {
    expect(describeError('文字列')).toBe('不明なエラーが発生しました。');
  });
});
