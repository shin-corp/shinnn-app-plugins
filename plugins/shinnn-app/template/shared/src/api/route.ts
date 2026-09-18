/**
 * @file API 定義ヘルパー。
 *
 * API 定義とは、画面とサーバーがやり取りするデータの形（URL・入力・出力）を 1 か所に書いたもの。
 * ここで定義した `RouteDef` を server の `route()` と client の `call()` の両方が参照するため、
 * 定義を変えると使っている側がビルドエラーになり、書き写しによる食い違いが起きない。
 *
 * 依存はライブラリの zod だけに留める（決定事項 #8: 外部の RPC ライブラリを使わない）。
 */

import type { z } from 'zod';

/** API 定義で使える HTTP メソッド。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** API 定義の各部（params / query / body / response）に指定できる zod スキーマ。 */
export type RouteSchema = z.ZodType;

/**
 * 1 つのエンドポイントの定義。
 *
 * @typeParam P - パスパラメータのスキーマ。無いときは `undefined`
 * @typeParam Q - クエリ文字列のスキーマ。無いときは `undefined`
 * @typeParam B - リクエストボディのスキーマ。無いときは `undefined`
 * @typeParam R - レスポンスのスキーマ。本文を返さないときは `z.undefined()`
 */
export interface RouteDef<
  P extends RouteSchema | undefined = undefined,
  Q extends RouteSchema | undefined = undefined,
  B extends RouteSchema | undefined = undefined,
  R extends RouteSchema = RouteSchema,
> {
  readonly method: HttpMethod;
  /** Express 5 の書き方に合わせたパス。パスパラメータは `:name` で書く（例: `/api/items/:id`）。 */
  readonly path: string;
  readonly params?: P;
  readonly query?: Q;
  readonly body?: B;
  readonly response: R;
}

/** 具体的な型引数を問わない API 定義。ヘルパーの型引数の制約に使う。 */
export type AnyRouteDef = RouteDef<
  RouteSchema | undefined,
  RouteSchema | undefined,
  RouteSchema | undefined,
  RouteSchema
>;

/**
 * API 定義を宣言する。
 *
 * 値をそのまま返すだけだが、型引数の推論のために関数を通す。
 * これにより `params` を省略した定義では `RouteInput` から `params` のキー自体が消える。
 */
export function defineRoute<
  P extends RouteSchema | undefined = undefined,
  Q extends RouteSchema | undefined = undefined,
  B extends RouteSchema | undefined = undefined,
  R extends RouteSchema = RouteSchema,
>(def: RouteDef<P, Q, B, R>): RouteDef<P, Q, B, R> {
  return def;
}

/** スキーマが定義されていれば検証前の型を、省略されていれば `never` を返す。 */
type SchemaInput<S> = S extends RouteSchema ? z.input<S> : never;

/** スキーマが定義されていれば検証後の型を、省略されていれば `never` を返す。 */
type SchemaOutput<S> = S extends RouteSchema ? z.output<S> : never;

/** 値が `never` になったキーを落とす。省略した部分をキーごと消すために使う。 */
type OmitNeverValues<T> = {
  [K in keyof T as [T[K]] extends [never] ? never : K]: T[K];
};

/**
 * 呼び出し側（client の `call()`）が渡す入力。
 *
 * zod の検証前の型なので、既定値を持つ項目は省略できる。
 * API 定義で省略した部分（例: `body` を持たない GET）はキー自体が存在しない。
 */
export type RouteInput<D extends AnyRouteDef> = OmitNeverValues<{
  params: SchemaInput<D['params']>;
  query: SchemaInput<D['query']>;
  body: SchemaInput<D['body']>;
}>;

/**
 * ハンドラ（server の `route()`）が受け取る検証済みの入力。
 *
 * zod の検証後の型なので、既定値は適用済みで省略可能な項目が無い。
 */
export type RouteHandlerInput<D extends AnyRouteDef> = OmitNeverValues<{
  params: SchemaOutput<D['params']>;
  query: SchemaOutput<D['query']>;
  body: SchemaOutput<D['body']>;
}>;

/** ハンドラが返し、呼び出し側が受け取るレスポンス。 */
export type RouteOutput<D extends AnyRouteDef> = z.output<D['response']>;

/** パスパラメータに渡せる値。 */
export type PathParams = Record<string, string | number>;

/**
 * `:name` 形式のパスパラメータを実際の値に置き換える。
 *
 * 値は `encodeURIComponent` で符号化するため、`/` を含む値を渡してもパスが分割されない。
 *
 * @param path - API 定義の `path`（例: `/api/items/:id`）
 * @param params - パスパラメータの値
 * @returns 置き換え後のパス
 * @throws パスに含まれるパラメータの値が渡されていないとき
 */
export function buildPath(path: string, params?: PathParams): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_matched, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      throw new Error(`パスパラメータ ${name} の値が渡されていません: ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}
