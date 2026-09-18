import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { buildPath, defineRoute, type RouteHandlerInput, type RouteInput, type RouteOutput } from './route.js';

/** 型推論の検証用。params と body を持ち、レスポンスを返すエンドポイント。 */
const updateThing = defineRoute({
  method: 'PUT',
  path: '/api/things/:id',
  params: z.object({ id: z.uuid() }),
  body: z.object({ name: z.string() }),
  response: z.object({ id: z.uuid(), name: z.string() }),
});

/** 型推論の検証用。既定値を持つクエリだけを取り、本文を返さないエンドポイント。 */
const purgeThings = defineRoute({
  method: 'DELETE',
  path: '/api/things',
  query: z.object({ limit: z.number().default(20) }),
  response: z.undefined(),
});

describe('defineRoute', () => {
  describe('正常系', () => {
    it('渡した定義をそのまま返す', () => {
      expect(updateThing.method).toBe('PUT');
      expect(updateThing.path).toBe('/api/things/:id');
      expect(purgeThings.method).toBe('DELETE');
      // 省略できる部分は型の上でも省略可能なままにする（server の route() は未定義を見て検証を飛ばす）。
      expect(purgeThings.params).toBeUndefined();
    });

    it('定義した部分だけが RouteInput のキーになる', () => {
      expectTypeOf<RouteInput<typeof updateThing>>().toEqualTypeOf<{
        params: { id: string };
        body: { name: string };
      }>();
    });

    it('省略した部分は RouteInput のキーごと消える', () => {
      expectTypeOf<RouteInput<typeof purgeThings>>().toEqualTypeOf<{
        query: { limit?: number | undefined };
      }>();
    });

    it('RouteHandlerInput は検証後の型になり既定値が適用済みになる', () => {
      expectTypeOf<RouteHandlerInput<typeof purgeThings>>().toEqualTypeOf<{
        query: { limit: number };
      }>();
    });

    it('RouteOutput はレスポンススキーマの型になる', () => {
      expectTypeOf<RouteOutput<typeof updateThing>>().toEqualTypeOf<{ id: string; name: string }>();
      expectTypeOf<RouteOutput<typeof purgeThings>>().toEqualTypeOf<undefined>();
    });
  });
});

describe('buildPath', () => {
  describe('正常系', () => {
    it('パスパラメータを値に置き換える', () => {
      expect(buildPath('/api/things/:id', { id: 'abc' })).toBe('/api/things/abc');
    });

    it('複数のパスパラメータを置き換える', () => {
      expect(buildPath('/api/things/:thingId/parts/:partId', { thingId: 1, partId: 2 })).toBe('/api/things/1/parts/2');
    });

    it('パスパラメータが無いパスはそのまま返す', () => {
      expect(buildPath('/api/things')).toBe('/api/things');
    });
  });

  describe('異常系', () => {
    it('値が渡されていないパスパラメータがあると例外になる', () => {
      expect(() => buildPath('/api/things/:id')).toThrow('パスパラメータ id の値が渡されていません');
    });
  });

  describe('エッジケース', () => {
    it('値に含まれる記号を符号化する', () => {
      expect(buildPath('/api/things/:id', { id: 'a/b c' })).toBe('/api/things/a%2Fb%20c');
    });
  });
});
