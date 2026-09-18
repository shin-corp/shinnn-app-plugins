/**
 * @file Express アプリの組み立て。
 *
 * ここでは待ち受けを始めない（`listen` は index.ts）。
 * テストは同じ組み立てのまま `app.listen(0)` で空きポートに立て、本番と同じ経路を HTTP で確かめる。
 */

import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { createItemsRouter } from './api/items/index.js';
import { config } from './config.js';
import { CommonException, isCommonException } from './exception/common-exception.js';
import type { AppDatabase } from './db/client.js';
import { HttpStatus, toResponseStatus } from './util/http-status.js';
import { Log } from './util/log.js';
import { MessageKeys } from './util/message/index.js';

const logger = new Log('app');

/** リクエスト本文の上限。大きな本文でメモリを埋める攻撃を防ぐ。 */
const jsonBodyLimit = '1mb';

/** 同じ送信元からの要求を数える時間の幅[ms]。 */
const rateLimitWindowMs = 60_000;

/** 上の時間内に受け付ける要求の数。 */
const rateLimitMax = 300;

/** API の URL の共通部分。認証も rate limit もこの配下に掛ける。 */
const apiBasePath = '/api';

/** 稼働確認用の URL。監視から叩くため認証を掛けない。 */
const healthPath = '/health';

/** アプリを組み立てるときの指定。 */
export interface CreateAppOptions {
  /** DB のハンドル。 */
  readonly db: AppDatabase;
}

/**
 * body-parser が投げたエラーを共通例外へ言い換える。
 *
 * @param err - 受け取ったエラー
 * @returns 言い換えた例外。body-parser のエラーでなければ undefined
 */
function toBodyParserException(err: unknown): CommonException | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) {
    return undefined;
  }
  if (err.type === 'entity.too.large') {
    return new CommonException(HttpStatus.PAYLOAD_TOO_LARGE, MessageKeys.APP_PAYLOAD_TOO_LARGE, {
      cause: err,
    });
  }
  if (err.type === 'entity.parse.failed') {
    return new CommonException(HttpStatus.BAD_REQUEST, MessageKeys.APP_INVALID_JSON, { cause: err });
  }
  return undefined;
}

/**
 * エラー応答（4 引数の error middleware）。
 *
 * 例外を応答へ変換する場所はここ 1 か所だけにする。
 * Express 5 は async ハンドラの reject も自動でここへ渡すため、各ハンドラで try / catch しない。
 *
 * @param err - 受け取ったエラー
 * @param _req - 要求
 * @param res - 応答
 * @param next - 次処理ハンドラ
 */
function errorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (res.headersSent) {
    // 応答の途中で失敗した場合は Express 既定の処理（接続を切る）に任せる。
    next(err);
    return;
  }

  const exception =
    (isCommonException(err) ? err : undefined) ??
    toBodyParserException(err) ??
    new CommonException(HttpStatus.INTERNAL_SERVER_ERROR, MessageKeys.APP_INTERNAL_ERROR, { cause: err });

  if (exception.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    logger.exception(err, { messageKey: exception.messageKey });
  } else {
    logger.debug(exception.message, { messageKey: exception.messageKey });
  }

  res.status(toResponseStatus(exception.statusCode)).json(exception.toResponseBody());
}

/**
 * Express アプリを組み立てる。
 *
 * @param options - 組み立てるときの指定
 * @returns Express アプリ
 */
export function createApp({ db }: CreateAppOptions): express.Express {
  const app = express();

  /*
   * X-Forwarded-For をどこまで信頼するか。既定は「信頼しない」。
   * 手前にリバースプロキシがある構成でだけ TRUST_PROXY を設定する
   * （無条件に信頼すると送信元 IP を偽装でき、rate limit の単位が壊れる）。
   */
  app.set('trust proxy', config.TRUST_PROXY);
  // Express 既定の `X-Powered-By` は使っている製品を教えるだけなので出さない。
  app.disable('x-powered-by');

  app.use(helmet());
  // 画面のオリジンを明示する。Cookie を使わないので credentials は許可しない。
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: false }));
  app.use(express.json({ limit: jsonBodyLimit }));

  app.use(
    apiBasePath,
    rateLimit({
      windowMs: rateLimitWindowMs,
      limit: rateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // 応答の形を他のエラーと揃えるため、既定の応答ではなく共通例外を通す。
      handler: (_req, _res, next) => {
        next(new CommonException(HttpStatus.TOO_MANY_REQUESTS, MessageKeys.APP_RATE_LIMIT_EXCEEDED));
      },
    }),
  );

  app.get(healthPath, (_req, res) => {
    res.status(HttpStatus.OK).json({ status: 'ok' });
  });

  app.use(createItemsRouter(db));

  // どのルートにも当たらなかったとき。API 定義に無い URL はここで 404 になる。
  app.use((_req, _res, next) => {
    next(new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ROUTE_NOT_FOUND));
  });

  // error middleware は 4 引数で、すべてのルートを登録した後に 1 か所だけ置く。
  app.use(errorHandler);

  return app;
}
