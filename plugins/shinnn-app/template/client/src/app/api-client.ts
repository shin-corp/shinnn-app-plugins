/**
 * @file API 呼び出しの唯一の入口。
 *
 * 画面からサーバーを呼ぶときは必ずこの `call()` を通す。URL を個別に組み立てない。
 * Angular の HttpClient は使わない（`call()` は fetch で動く）。
 *
 * 入力と出力の形は `@app/shared/api` の API 定義（`defineRoute()`）だけが決める。
 * 手書きの API 型を作らない。API 定義を変えると、合っていない呼び出しがビルドエラーになる。
 */

import { buildPath, type AnyRouteDef, type PathParams, type RouteInput, type RouteOutput } from '@app/shared/api';

/** 認証トークンの保存先（localStorage のキー）。 */
const TOKEN_STORAGE_KEY = 'token';

/** サーバーがエラーを返したときの応答本文。 */
interface ErrorBody {
  messageKey: string;
  message: string;
  details?: unknown;
}

/**
 * サーバーが 2xx 以外を返したときに投げる例外。
 *
 * `messageKey` はメッセージの識別子で、サーバーの `resources/messages.json` と対応する。
 * 画面はこれを見て出し分けができる（例: 認証切れなら再ログインへ誘導する）。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageKey: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** `call()` に渡せる追加の指定。中断（`AbortSignal`）だけを受ける。 */
export interface CallOptions {
  signal?: AbortSignal;
}

/** 型引数を問わない入力の形。`RouteInput<D>` から中身を読み出すために使う。 */
interface LooseRouteInput {
  params?: PathParams;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** クエリ文字列を組み立てる。値が未指定の項目は送らない（サーバー側の既定値に任せる）。 */
function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.append(key, String(value));
  }
  const serialized = search.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

/** 保存済みの認証トークン。localStorage が使えない環境（SSR など）では未設定として扱う。 */
function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** エラー応答の本文を読む。JSON でないときは HTTP の状態だけで組み立てる。 */
async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body = (await response.json()) as Partial<ErrorBody>;
    if (typeof body.messageKey === 'string' && typeof body.message === 'string') {
      return { messageKey: body.messageKey, message: body.message, details: body.details };
    }
  } catch {
    // JSON として読めない応答（プロキシのエラーページなど）は下の既定値にする。
  }
  return { messageKey: 'APP_UNEXPECTED_ERROR', message: `サーバーがエラーを返しました（${response.status}）` };
}

/**
 * `call()` の第 2 引数以降。
 *
 * API 定義が params / query / body を 1 つも持たないときだけ入力を省略できる。
 * 第 2 引数を無条件に省略可能にすると、`:id` を渡し忘れた呼び出しが型検査を通ってしまう。
 */
type CallArgs<D extends AnyRouteDef> = keyof RouteInput<D> extends never
  ? [input?: undefined, options?: CallOptions]
  : [input: RouteInput<D>, options?: CallOptions];

/**
 * API 定義に従ってサーバーを呼ぶ。
 *
 * @param def - `@app/shared/api` の API 定義
 * @param args - パスパラメータ・クエリ・ボディ（API 定義で指定した部分をすべて渡す）と、中断の指定
 * @returns API 定義の `response` の型。本文を返さない API（204）では `undefined`
 * @throws {ApiError} サーバーが 2xx 以外を返したとき
 */
export async function call<D extends AnyRouteDef>(def: D, ...args: CallArgs<D>): Promise<RouteOutput<D>> {
  // 条件型のままでは要素を取り出せないので、実行時に必要な形へ 1 度だけ寄せる。
  const [input, options] = args as [LooseRouteInput | undefined, CallOptions | undefined];
  const { params, query, body } = input ?? {};
  const url = `${buildPath(def.path, params)}${buildQueryString(query)}`;

  const headers = new Headers();
  const token = readToken();
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    method: def.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    throw new ApiError(response.status, errorBody.messageKey, errorBody.message, errorBody.details);
  }

  // 204（本文なし）を返す API では読み取らずに undefined を返す。
  if (response.status === 204) {
    return undefined as RouteOutput<D>;
  }
  return (await response.json()) as RouteOutput<D>;
}

/**
 * 例外を画面に出す 1 行の文字列にする。
 *
 * サーバー由来のエラーは `messageKey` も併記する。問い合わせのときに原因を特定しやすくするため。
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message}（${error.messageKey}）`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '不明なエラーが発生しました。';
}
