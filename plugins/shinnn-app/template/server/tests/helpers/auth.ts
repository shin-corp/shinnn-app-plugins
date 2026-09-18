/**
 * @file テスト用の JWT。
 *
 * ログイン API はテンプレートに含めていないので、認証が通るトークンをここで直接発行する。
 * 鍵と aud は src/config.ts と同じ値（vitest.config.ts の env）を使う。
 */

import { SignJWT } from 'jose';
import { config } from '../../src/config.js';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

/** トークンに入れる内容。既定から変えたいものだけ渡す。 */
export interface TokenOptions {
  /** 利用者の識別子（sub）。 */
  readonly subject?: string;
  /** 受け取り手（aud）。別の用途のトークンを弾くことの確認に使う。 */
  readonly audience?: string;
  /**
   * 有効期限。`-1h` のように過去を指定すると期限切れのトークンになる。
   * `null` を渡すと `exp` を入れない（期限の無いトークンを弾けることの確認に使う）。
   */
  readonly expiresIn?: string | null;
}

/**
 * 署名済みのトークンを発行する。
 *
 * @param options - トークンに入れる内容
 * @returns トークン
 */
export async function createToken(options: TokenOptions = {}): Promise<string> {
  const token = new SignJWT({ name: 'テスト利用者' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject ?? '00000000-0000-4000-8000-000000000001')
    .setAudience(options.audience ?? config.JWT_AUDIENCE)
    .setIssuedAt();

  if (options.expiresIn !== null) {
    token.setExpirationTime(options.expiresIn ?? '1h');
  }

  return token.sign(secretKey);
}

/**
 * 認証ヘッダを作る。
 *
 * @param options - トークンに入れる内容
 * @returns fetch にそのまま渡せるヘッダ
 */
export async function createAuthHeaders(options: TokenOptions = {}): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await createToken(options)}` };
}
