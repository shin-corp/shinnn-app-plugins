/** @file HTTP ステータスコード。数字をそのまま書かず、ここの名前を使う。 */

/** このアプリが返す HTTP ステータスコード。 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/** @exports HTTP ステータスコード。 */
export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

/**
 * `res.status()` に渡せる値へ丸める。
 *
 * Express 5 の `res.status()` は 100〜999 の整数以外で例外を投げる。
 * 想定外の値を持つエラーが来ても応答を返せるようにする。
 *
 * @param statusCode - 丸める前のステータスコード
 * @returns 100〜999 の整数
 */
export function toResponseStatus(statusCode: unknown): number {
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
  if (statusCode < 100 || statusCode > 999) {
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
  return statusCode;
}
