/**
 * @file item API のテスト。新しい機能のテストはこのファイルを手本にする。
 *
 *  - 本番と同じ組み立てのサーバーへ native fetch で要求する（内部の関数を直接呼ばない）
 *  - 要求先の URL は API 定義から組み立てる（`server.url(itemsApi.getItem, { id })`）
 *  - describe は 正常系 / 異常系 / エッジケース で分ける
 *  - テスト名の先頭に docs/仕様書.md の受入条件の番号（AC-n）を書く
 *  - サーバーと DB はファイルごとに 1 回作り、テストごとにデータを空にするので、実行順に結果が左右されない
 *  - 利用者ごとのデータは、別の利用者のトークンで「見えない・変えられない」ことを必ず確かめる（AC-7）
 */

import { itemsApi, type Item, type ItemList } from '@app/shared/api';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeaders } from './helpers/auth.js';
import { startServer, type TestServer } from './helpers/server.js';

let server: TestServer;
let authHeaders: Record<string, string>;
/** 別の利用者の認証ヘッダ。他人の item に届かないことの確認に使う。 */
let otherUserHeaders: Record<string, string>;

/** 存在しない item の id。形式は正しいので、404 と 400 を区別して確かめられる。 */
const missingItemId = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  server = await startServer();
  authHeaders = await createAuthHeaders();
  otherUserHeaders = await createAuthHeaders({ subject: '00000000-0000-4000-8000-000000000002' });
});

beforeEach(async () => {
  await server.reset();
});

afterAll(async () => {
  await server.close();
});

/**
 * item を 1 件作る。
 *
 * @param body - 作成する内容
 * @param headers - 作成する利用者の認証ヘッダ。省略すると既定の利用者
 * @returns 作成した item
 */
async function createItem(body: Record<string, unknown>, headers = authHeaders): Promise<Item> {
  const res = await fetch(server.url(itemsApi.createItem), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Item;
}

describe('正常系', () => {
  it('AC-1 item が無いときは空の一覧を返す', async () => {
    const res = await fetch(server.url(itemsApi.listItems), { headers: authHeaders });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [], total: 0 });
  });

  it('AC-1 一覧は name の順で返る', async () => {
    await createItem({ name: 'い' });
    await createItem({ name: 'あ' });

    const res = await fetch(server.url(itemsApi.listItems), { headers: authHeaders });
    const body = (await res.json()) as ItemList;

    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.name)).toEqual(['あ', 'い']);
    expect(body.total).toBe(2);
  });

  it('AC-3 id を指定して 1 件取得できる', async () => {
    const created = await createItem({ name: '作業手順書', description: '現場での手順' });

    const res = await fetch(server.url(itemsApi.getItem, { id: created.id }), { headers: authHeaders });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(created);
  });

  it('AC-2 作成すると 201 で作成した item を返す', async () => {
    const res = await fetch(server.url(itemsApi.createItem), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '見積フォーマット', status: 'active' }),
    });
    const body = (await res.json()) as Item;

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ name: '見積フォーマット', status: 'active' });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC-2 status を省略すると draft になる', async () => {
    const created = await createItem({ name: '下書き' });

    expect(created.status).toBe('draft');
  });

  it('AC-3 渡した項目だけを書き換える', async () => {
    const created = await createItem({ name: '旧価格表', description: '2025 年度', status: 'active' });

    const res = await fetch(server.url(itemsApi.updateItem, { id: created.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    const body = (await res.json()) as Item;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ name: '旧価格表', description: '2025 年度', status: 'archived' });
  });

  it('AC-3 説明を空文字にすると説明が消える', async () => {
    const created = await createItem({ name: '説明を消す item', description: '消される説明' });

    const res = await fetch(server.url(itemsApi.updateItem, { id: created.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '' }),
    });
    const body = (await res.json()) as Item;

    expect(res.status).toBe(200);
    expect(body.description).toBe('');
  });

  it('AC-3 削除すると 204 で本文を返さず、その後は取得できない', async () => {
    const created = await createItem({ name: '削除する item' });

    const deleted = await fetch(server.url(itemsApi.deleteItem, { id: created.id }), {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(deleted.status).toBe(204);
    await expect(deleted.text()).resolves.toBe('');

    const res = await fetch(server.url(itemsApi.getItem, { id: created.id }), { headers: authHeaders });
    expect(res.status).toBe(404);
  });
});

describe('異常系', () => {
  it('AC-4 トークンが無いと 401 を返す', async () => {
    const res = await fetch(server.url(itemsApi.listItems));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_UNAUTHORIZED' });
  });

  it('AC-4 受け取り手（aud）が違うトークンは 401 を返す', async () => {
    const headers = await createAuthHeaders({ audience: 'other-app' });

    const res = await fetch(server.url(itemsApi.listItems), { headers });

    expect(res.status).toBe(401);
  });

  it('AC-4 期限切れのトークンは 401 を返す', async () => {
    const headers = await createAuthHeaders({ expiresIn: '-1h' });

    const res = await fetch(server.url(itemsApi.listItems), { headers });

    expect(res.status).toBe(401);
  });

  it('AC-4 有効期限（exp）の無いトークンは 401 を返す', async () => {
    const headers = await createAuthHeaders({ expiresIn: null });

    const res = await fetch(server.url(itemsApi.listItems), { headers });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_UNAUTHORIZED' });
  });

  it('AC-5 name が空だと 400 と検証の内訳を返す', async () => {
    const res = await fetch(server.url(itemsApi.createItem), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    const body = (await res.json()) as { messageKey: string; details: unknown[] };

    expect(res.status).toBe(400);
    expect(body.messageKey).toBe('APP_VALIDATION_FAILED');
    expect(body.details).toHaveLength(1);
  });

  it('AC-5 id が uuid の形でないと 400 を返す', async () => {
    const res = await fetch(server.url(itemsApi.getItem, { id: 'not-a-uuid' }), { headers: authHeaders });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_VALIDATION_FAILED' });
  });

  it('AC-5 limit が上限を超えると 400 を返す', async () => {
    const res = await fetch(`${server.url(itemsApi.listItems)}?limit=101`, { headers: authHeaders });

    expect(res.status).toBe(400);
  });

  it('AC-5 本文が JSON として読めないと 400 を返す', async () => {
    const res = await fetch(server.url(itemsApi.createItem), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_INVALID_JSON' });
  });

  it('AC-6 同じ name で作成すると 409 を返す', async () => {
    await createItem({ name: '重複する名前' });

    const res = await fetch(server.url(itemsApi.createItem), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重複する名前' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ messageKey: 'APP_ITEM_NAME_DUPLICATE' });
  });

  it('AC-6 他の item と同じ name へ更新すると 409 を返す', async () => {
    await createItem({ name: '先にある名前' });
    const target = await createItem({ name: '後から作った名前' });

    const res = await fetch(server.url(itemsApi.updateItem, { id: target.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '先にある名前' }),
    });

    expect(res.status).toBe(409);
  });

  it('AC-3 存在しない id の取得・更新・削除は 404 を返す', async () => {
    const got = await fetch(server.url(itemsApi.getItem, { id: missingItemId }), { headers: authHeaders });
    const updated = await fetch(server.url(itemsApi.updateItem, { id: missingItemId }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    const deleted = await fetch(server.url(itemsApi.deleteItem, { id: missingItemId }), {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect([got.status, updated.status, deleted.status]).toEqual([404, 404, 404]);
    await expect(got.json()).resolves.toMatchObject({ messageKey: 'APP_ITEM_NOT_FOUND' });
  });

  it('AC-7 他の利用者の item の取得・更新・削除は 404 を返し、item は変わらない', async () => {
    const others = await createItem({ name: '他人の item', status: 'active' }, otherUserHeaders);

    const got = await fetch(server.url(itemsApi.getItem, { id: others.id }), { headers: authHeaders });
    const updated = await fetch(server.url(itemsApi.updateItem, { id: others.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    const deleted = await fetch(server.url(itemsApi.deleteItem, { id: others.id }), {
      method: 'DELETE',
      headers: authHeaders,
    });

    // 403 でなく 404 にするのは、その id の item が存在すること自体を他人に知らせないため。
    expect([got.status, updated.status, deleted.status]).toEqual([404, 404, 404]);
    await expect(got.json()).resolves.toMatchObject({ messageKey: 'APP_ITEM_NOT_FOUND' });

    const own = await fetch(server.url(itemsApi.getItem, { id: others.id }), { headers: otherUserHeaders });
    await expect(own.json()).resolves.toEqual(others);
  });
});

describe('エッジケース', () => {
  it('AC-7 一覧と総件数には自分の item だけが入る', async () => {
    await createItem({ name: '自分の item' });
    await createItem({ name: '他人の item' }, otherUserHeaders);

    const res = await fetch(server.url(itemsApi.listItems), { headers: authHeaders });
    const body = (await res.json()) as ItemList;

    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.name)).toEqual(['自分の item']);
    expect(body.total).toBe(1);
  });

  it('AC-6 他の利用者の item と同じ name なら作成も更新もできる', async () => {
    await createItem({ name: '同じ名前' }, otherUserHeaders);

    const created = await createItem({ name: '同じ名前' });
    const target = await createItem({ name: '変える前の名前' });
    await createItem({ name: '更新先の名前' }, otherUserHeaders);
    const res = await fetch(server.url(itemsApi.updateItem, { id: target.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '更新先の名前' }),
    });

    expect(created.name).toBe('同じ名前');
    expect(res.status).toBe(200);
  });

  it('AC-1 limit と offset で範囲を絞れる', async () => {
    await createItem({ name: 'a' });
    await createItem({ name: 'b' });
    await createItem({ name: 'c' });

    const res = await fetch(`${server.url(itemsApi.listItems)}?limit=1&offset=1`, { headers: authHeaders });
    const body = (await res.json()) as ItemList;

    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.name)).toEqual(['b']);
    // total は絞り込み前の件数なので、limit を掛けても変わらない。
    expect(body.total).toBe(3);
  });

  it('AC-3 書き換える項目が無い更新は値を変えない', async () => {
    const created = await createItem({ name: '変えない item' });

    const res = await fetch(server.url(itemsApi.updateItem, { id: created.id }), {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(created);
  });

  it('AC-2 name は 100 文字まで受け付け、101 文字は 400 を返す', async () => {
    const created = await createItem({ name: 'あ'.repeat(100) });
    expect(created.name).toHaveLength(100);

    const res = await fetch(server.url(itemsApi.createItem), {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'あ'.repeat(101) }),
    });

    expect(res.status).toBe(400);
  });

  it('AC-2 description を省略すると応答に含まれない', async () => {
    const created = await createItem({ name: '説明なし' });

    expect(created).not.toHaveProperty('description');
  });
});
