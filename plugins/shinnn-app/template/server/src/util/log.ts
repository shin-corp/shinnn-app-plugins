/**
 * @file ログ出力。
 *
 * ログを書く手段はこのファイルだけにする（`console` は eslint で禁止）。
 * 出力先や形式を変えたくなったときに、直す場所を 1 か所に保つため。
 */

import pino, { type Level, type Logger } from 'pino';
import { config } from '../config.js';
import { getMessage, getMessageConfig, type MessageKey, type MessageType } from './message/index.js';

/** ログに添える構造化データ。個人情報・認証情報は入れない。 */
export type LogData = Record<string, unknown>;

/** メッセージの種別と pino のレベルの対応。 */
const levelOfType: Record<MessageType, Level> = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
};

const rootLogger = pino({ level: config.LOG_LEVEL });

/**
 * ログ出力。
 *
 * @example
 * ```ts
 * const logger = new Log('items.service');
 * logger.info('item を作成しました', { id });
 * ```
 */
export class Log {
  private readonly logger: Logger;

  /**
   * @param tag - 出力元を表す名前。ファイル名か機能名を書く
   */
  constructor(tag: string) {
    this.logger = rootLogger.child({ tag });
  }

  trace(message: string, data?: LogData): void {
    this.logger.trace(data ?? {}, message);
  }

  debug(message: string, data?: LogData): void {
    this.logger.debug(data ?? {}, message);
  }

  info(message: string, data?: LogData): void {
    this.logger.info(data ?? {}, message);
  }

  warn(message: string, data?: LogData): void {
    this.logger.warn(data ?? {}, message);
  }

  error(message: string, data?: LogData): void {
    this.logger.error(data ?? {}, message);
  }

  fatal(message: string, data?: LogData): void {
    this.logger.fatal(data ?? {}, message);
  }

  /**
   * メッセージキーの文言を、そのキーの種別に対応するレベルで出力する。
   *
   * @param key - メッセージキー
   * @param params - メッセージの `%1` から順に埋め込む値
   * @param data - 添える構造化データ
   */
  message(key: MessageKey, params: readonly unknown[] = [], data?: LogData): void {
    const level = levelOfType[getMessageConfig(key).type];
    this.logger[level]({ ...data, messageKey: key }, getMessage(key, params));
  }

  /**
   * 例外を出力する。スタックは pino が展開する。
   *
   * @param error - 例外
   * @param data - 添える構造化データ
   */
  exception(error: unknown, data?: LogData): void {
    this.logger.error({ ...data, err: error }, error instanceof Error ? error.message : String(error));
  }
}
