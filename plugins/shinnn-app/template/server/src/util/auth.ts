/**
 * @file 認証。Bearer トークン（JWT）を検証して要求に利用者を紐づける。
 *
 * JWT は「署名付きの通行証」。ログイン時に発行し、以降の要求では Authorization ヘッダで送る。
 * Cookie でセッションを持たないため、CSRF 対策の middleware は入れていない（理由は server/CLAUDE.md）。
 */

import type express from 'express';
import { jwtVerify } from 'jose';
import { config } from '../config.js';
import { CommonException } from '../exception/common-exception.js';
import { HttpStatus } from './http-status.js';
import { MessageKeys } from './message/index.js';

/** 認証を通った利用者。 */
export interface AuthenticatedUser {
  /** 利用者の識別子（JWT の sub）。 */
  readonly id: string;
  /** 表示名。トークンに無ければ undefined。 */
  readonly name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 認証を通った利用者。`isAuthenticated()` を通ったルートでのみ入る。 */
      user?: AuthenticatedUser;
    }
  }
}

/** 署名鍵。文字列のままでは扱えないのでバイト列にしておく。 */
const secretKey = new TextEncoder().encode(config.JWT_SECRET);

/**
 * Authorization ヘッダから Bearer トークンを取り出す。
 *
 * @param req - 要求
 * @returns トークン。取り出せなければ undefined
 */
function extractBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined) {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

/**
 * 認証を必須にする middleware を作る。
 *
 * 署名アルゴリズム・受け取り手（aud）・有効期限（exp）を明示して検証する。
 * 明示しないと、別の用途で発行されたトークンや alg を細工したトークンを通してしまう。
 * exp は「あれば検証する」だけでは、入れ忘れたトークンが永久に有効になるので必須にする。
 *
 * @returns middleware
 */
export function isAuthenticated(): express.RequestHandler {
  return (req, _res, next) => {
    const token = extractBearerToken(req);
    if (token === undefined) {
      next(new CommonException(HttpStatus.UNAUTHORIZED, MessageKeys.APP_UNAUTHORIZED));
      return;
    }

    jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
      audience: config.JWT_AUDIENCE,
      requiredClaims: ['exp'],
    })
      .then(({ payload }) => {
        if (payload.sub === undefined) {
          next(new CommonException(HttpStatus.UNAUTHORIZED, MessageKeys.APP_UNAUTHORIZED));
          return;
        }
        req.user = {
          id: payload.sub,
          name: typeof payload.name === 'string' ? payload.name : undefined,
        };
        next();
      })
      .catch((err: unknown) => {
        next(new CommonException(HttpStatus.UNAUTHORIZED, MessageKeys.APP_UNAUTHORIZED, { cause: err }));
      });
  };
}
