#!/usr/bin/env node
// 開発中の画面から API を呼ぶための JWT を 1 つ発行して標準出力に出す。
//
// 実行例:
//   npm run token -w server
//   npm run token -w server -- --subject 00000000-0000-4000-8000-000000000002 --expires-in 8h
//
// ログイン API はテンプレートに含めていない（利用者の認証方式に合わせて作るもの）。
// それまでの間、画面を動かして確かめるための「開発用の通行証」をここで直接発行する。
// 署名鍵と受け取り手は server/.env の JWT_SECRET / JWT_AUDIENCE を使う（package.json の
// スクリプトが node --env-file-if-exists=.env で読み込む）。
//
// 本番では使わない。発行したトークンは誰にも共有しない。

import { SignJWT } from 'jose';

/** 引数の既定値。 */
const defaults = {
  subject: '00000000-0000-4000-8000-000000000001',
  name: '開発用の利用者',
  expiresIn: '8h',
};

/** `--key value` の形の引数を読む。 */
function parseArgs(argv) {
  const options = { ...defaults };

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];

    if (value === undefined) {
      throw new Error(`${key} の値が指定されていません。`);
    }
    if (key === '--subject') {
      options.subject = value;
      continue;
    }
    if (key === '--name') {
      options.name = value;
      continue;
    }
    if (key === '--expires-in') {
      options.expiresIn = value;
      continue;
    }
    throw new Error(`知らない引数です: ${key}`);
  }

  return options;
}

/** 環境変数を読む。無ければ何を用意すればよいかを出して終わる。 */
function readEnv(name, hint) {
  const value = process.env[name];

  if (value === undefined || value === '') {
    console.error(`${name} が設定されていません。`);
    console.error(`  どう直す: server/.env に ${name} を書く（${hint}）。雛形は server/.env.example です。`);
    console.error('  値そのものは人が入れます（Claude は .env を読み書きしません）。');
    process.exit(1);
  }

  return value;
}

const options = parseArgs(process.argv.slice(2));
const secret = readEnv('JWT_SECRET', '32 文字以上のランダムな文字列');
const audience = readEnv('JWT_AUDIENCE', '.env.example の既定は app-client');

const token = await new SignJWT({ name: options.name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(options.subject)
  .setAudience(audience)
  .setIssuedAt()
  .setExpirationTime(options.expiresIn)
  .sign(new TextEncoder().encode(secret));

console.log(token);
console.error('');
console.error(`有効期限: ${options.expiresIn} / 利用者: ${options.subject}`);
console.error('画面で使うには、ブラウザの開発者ツールのコンソールで次を実行してから再読み込みします。');
console.error(`  localStorage.setItem('token', '${token}')`);
