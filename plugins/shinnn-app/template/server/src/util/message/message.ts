/**
 * @file メッセージ本文の取得。
 *
 * 文言は resources/messages.json に 1 か所で書き、コードからはキーで参照する。
 * 文言を直接書かないので、表示を直すときにコードを触らずに済む。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageKeys, type MessageKey } from './message-keys.js';

/** メッセージの種別。ログの重大度と対応する。 */
export const MessageTypes = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const;

/** @exports メッセージの種別。 */
export type MessageType = (typeof MessageTypes)[number];

/** messages.json の 1 件分。 */
export interface MessageConfig {
  /** 種別。ログに出すときの重大度になる。 */
  readonly type: MessageType;
  /** 文言。`%1` `%2` … の位置にパラメータが入る。 */
  readonly message: string;
}

/*
 * ビルド後は dist/util/message/message.js から読むことになるため、
 * 実行ファイルからの相対位置ではなく server/ からの位置で解決する
 * （src からでも dist からでも 3 つ上が server/ になる）。
 */
const messagesFile = fileURLToPath(new URL('../../../resources/messages.json', import.meta.url));

const configs = JSON.parse(fs.readFileSync(messagesFile, 'utf8')) as Record<string, MessageConfig>;

/** 未定義のキーを参照したときに使う設定。起動時ではなく参照時に気付けるよう文言にキーを残す。 */
const unknownConfig: MessageConfig = { type: 'ERROR', message: '未定義のメッセージです。' };

/**
 * メッセージ設定を取得する。
 *
 * @param key - メッセージキー
 * @returns メッセージ設定
 */
export function getMessageConfig(key: MessageKey): MessageConfig {
  return configs[key] ?? unknownConfig;
}

/**
 * メッセージへ埋め込む値を文字列にする。
 *
 * オブジェクトをそのまま連結すると `[object Object]` になり、何が起きたか分からなくなる。
 *
 * @param value - 埋め込む値
 * @returns 文字列
 */
function stringifyParam(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * メッセージ本文を組み立てる。
 *
 * @param key - メッセージキー
 * @param params - `%1` から順に埋め込む値
 * @returns 組み立てた文言
 */
export function getMessage(key: MessageKey, params: readonly unknown[] = []): string {
  const config = getMessageConfig(key);
  return config.message.replace(/%(\d+)/g, (matched, position: string) => {
    const value = params[Number(position) - 1];
    return value === undefined ? matched : stringifyParam(value);
  });
}

/**
 * 文字列がメッセージキーかどうかを判定する。
 *
 * @param value - 判定する値
 * @returns メッセージキーなら true
 */
export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && Object.hasOwn(MessageKeys, value);
}
