/**
 * @file サーバーの起動。
 *
 * 組み立て（app.ts）と待ち受け（このファイル）を分ける。
 * テストは app.ts だけを使い、ポートを固定せずに立てられる。
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db/client.js';
import { Log } from './util/log.js';
import { MessageKeys } from './util/message/index.js';

const logger = new Log('server');

const handle = await createDb();
const app = createApp({ db: handle.db });

const server = app.listen(config.PORT, (error?: Error) => {
  // Express 5 では待ち受けに失敗した理由（ポートの重複など）がここに渡る。
  if (error) {
    logger.message(MessageKeys.APP_SERVER_START_FAILED, [], { err: error });
    process.exitCode = 1;
    return;
  }
  logger.message(MessageKeys.APP_SERVER_STARTED, [config.PORT]);
});

/**
 * 終了要求を受けたときに、処理中の要求を終わらせてから止める。
 */
function shutdown(): void {
  logger.message(MessageKeys.APP_SERVER_SHUTTING_DOWN);
  server.close(() => {
    void handle.close();
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
