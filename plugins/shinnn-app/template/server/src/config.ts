/**
 * @file 環境変数の解決。読み込み時に zod で検証し、型の誤りや空文字はここで落とす。
 *
 * 各所で `process.env` を直接読まない（読んでよいのは drizzle.config.ts だけ。あれはアプリの外で動く）。
 * 既定値を置けない値には `default()` を付けず、未設定なら起動を失敗させる。
 * 名前と意味の一覧は .env.example と docs/env.md にある。
 */

import { z } from 'zod';

/**
 * X-Forwarded-For をどこまで信頼するかの指定。
 *
 * Express の `trust proxy` にそのまま渡す。手前にリバースプロキシが無いなら false のままにする
 * （true にすると誰でも自分の IP を詐称でき、rate limit の単位が壊れる）。
 */
const TrustProxySchema = z
  .string()
  .default('false')
  .transform((value): boolean | number | string => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
    return value;
  });

/** 画面を配信するオリジン。カンマ区切りで複数書ける。`*` は許可しない。 */
const CorsOriginSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .refine((origins) => origins.every((origin) => origin.length > 0 && origin !== '*'), {
    message: 'CORS_ORIGIN にはオリジンを明示する（`*` は使えない）',
  });

const EnvSchema = z.object({
  /** 実行環境。ログの詳しさと起動時の挙動を切り替える。 */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** API サーバーが待ち受けるポート番号。 */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** ログの下限レベル。 */
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  /** DB の接続方式。pglite は PostgreSQL を用意せずに動かすためのもので、本番では使わない。 */
  DB_DRIVER: z.enum(['pg', 'pglite']).default('pg'),
  /** PostgreSQL への接続先。 */
  DATABASE_URL: z.string().min(1),
  /** JWT の署名鍵。短い鍵は総当たりで破られるため 32 文字以上にする。 */
  JWT_SECRET: z.string().min(32),
  /** JWT の受け取り手。トークンの aud クレームがこの値と一致しないと認証を通さない。 */
  JWT_AUDIENCE: z.string().min(1),
  /** 画面を配信するオリジン。 */
  CORS_ORIGIN: CorsOriginSchema,
  /** X-Forwarded-For を信頼する範囲。 */
  TRUST_PROXY: TrustProxySchema,
});

/** @exports 検証済みの環境変数。 */
export type AppConfig = z.infer<typeof EnvSchema>;

/** 検証済みの環境変数。 */
export const config: AppConfig = EnvSchema.parse(process.env);
