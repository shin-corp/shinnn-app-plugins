/**
 * @file 例外：共通。
 *
 * アプリが意図して返すエラーはすべてこの例外で表す。
 * どこで throw しても error middleware が 1 か所で受け取り、同じ形の JSON で応答する。
 */

import { getMessage, getMessageConfig, type MessageKey, type MessageType } from '../util/message/index.js';

/** 例外を作るときの任意指定。 */
export interface CommonExceptionOptions {
  /** メッセージの `%1` から順に埋め込む値。 */
  readonly params?: readonly unknown[];
  /** 画面へ返す補足情報（検証エラーの内訳など）。 */
  readonly details?: unknown;
  /** 元になった例外。ログにだけ出し、画面へは返さない。 */
  readonly cause?: unknown;
}

/** エラー応答の JSON。client の `call()` はこの形を前提に ApiError を組み立てる。 */
export interface ErrorResponseBody {
  readonly messageKey: MessageKey;
  readonly message: string;
  readonly details?: unknown;
}

/**
 * 例外：共通。
 *
 * @example
 * ```ts
 * throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] });
 * ```
 */
export class CommonException extends Error {
  /** HTTP ステータスコード。 */
  readonly statusCode: number;

  /** メッセージキー。画面はこの値で分岐する（文言では分岐しない）。 */
  readonly messageKey: MessageKey;

  /** メッセージの種別。ログの重大度に使う。 */
  readonly type: MessageType;

  /** 画面へ返す補足情報。 */
  readonly details?: unknown;

  constructor(statusCode: number, messageKey: MessageKey, options: CommonExceptionOptions = {}) {
    super(getMessage(messageKey, options.params), { cause: options.cause });
    this.name = 'CommonException';
    this.statusCode = statusCode;
    this.messageKey = messageKey;
    this.type = getMessageConfig(messageKey).type;
    this.details = options.details;
  }

  /**
   * エラー応答の本文へ変換する。
   *
   * @returns 応答の JSON
   */
  toResponseBody(): ErrorResponseBody {
    if (this.details === undefined) {
      return { messageKey: this.messageKey, message: this.message };
    }
    return { messageKey: this.messageKey, message: this.message, details: this.details };
  }
}

/**
 * 共通例外かどうかを判定する。
 *
 * @param value - 判定する値
 * @returns 共通例外なら true
 */
export function isCommonException(value: unknown): value is CommonException {
  return value instanceof CommonException;
}
