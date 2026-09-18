/**
 * @file item の業務処理。
 *
 * 新しい機能もこのファイルを手本にする。守ること 3 つ。
 *  - HTTP の都合（req / res）を持ち込まない。DB のハンドルは引数で受け取る
 *  - 業務としての失敗（未存在・重複）は CommonException で投げ、controller では判定しない
 *  - 返す値は shared の型（Item など）に合わせる。DB の行をそのまま返さない
 */

import type { CreateItem, Item, ItemList, ItemListQuery, UpdateItem } from '@app/shared/api';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { CommonException } from '../exception/common-exception.js';
import type { AppDatabase, AppDbExecutor } from '../db/client.js';
import { items, type ItemRow, type NewItemRow } from '../db/schema/items.js';
import { HttpStatus } from '../util/http-status.js';
import { MessageKeys } from '../util/message/index.js';

/**
 * DB の行を API の形へ変換する。
 *
 * 日時は JSON に型が無いので ISO 8601 の文字列にし、未設定の列は null でなく未指定にする。
 *
 * @param row - DB の行
 * @returns API が返す item
 */
function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** PostgreSQL が一意制約違反として返す SQLSTATE。 */
const UNIQUE_VIOLATION = '23505';

/** name の重複を表す 409 の例外を作る。 */
function nameDuplicateException(name: string): CommonException {
  return new CommonException(HttpStatus.CONFLICT, MessageKeys.APP_ITEM_NAME_DUPLICATE, { params: [name] });
}

/** 値が指定の SQLSTATE を持つエラーか。 */
function hasSqlState(value: unknown, state: string): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === state;
}

/**
 * 一意制約違反かどうか。
 *
 * ドライバによっては元のエラーを `cause` に包んで投げるため、1 段だけ辿って確かめる。
 *
 * @param err - 受け取ったエラー
 * @returns 一意制約違反なら true
 */
function isUniqueViolation(err: unknown): boolean {
  if (hasSqlState(err, UNIQUE_VIOLATION)) {
    return true;
  }
  return typeof err === 'object' && err !== null && 'cause' in err && hasSqlState(err.cause, UNIQUE_VIOLATION);
}

/**
 * 同じ name の item が既にあれば 409 で失敗させる。
 *
 * これは分かりやすいエラーを返すための事前確認で、同時実行の担保ではない
 * （確認と登録の間に別の要求が割り込める）。最終的な担保は DB の一意制約が行う。
 *
 * @param db - DB のハンドル（重複確認と登録を同じトランザクションで行うため呼び出し側から渡す）
 * @param name - 確認する name
 * @param excludeId - 確認から除く item の id（更新時に自分自身を重複と見なさないため）
 * @throws 重複しているとき 409 の CommonException
 */
async function assertNameNotTaken(db: AppDbExecutor, name: string, excludeId?: string): Promise<void> {
  const condition =
    excludeId === undefined ? eq(items.name, name) : and(eq(items.name, name), ne(items.id, excludeId));
  const found = await db.select({ id: items.id }).from(items).where(condition).limit(1);
  if (found.length > 0) {
    throw nameDuplicateException(name);
  }
}

/**
 * item の一覧を取得する。
 *
 * @param db - DB のハンドル
 * @param query - 取得する範囲
 * @returns item の一覧と、絞り込み前の総件数
 */
export async function listItems(db: AppDbExecutor, query: ItemListQuery): Promise<ItemList> {
  const rows = await db
    .select()
    .from(items)
    // name は重複しないので、並び順が実行のたびに変わらない。
    .orderBy(asc(items.name))
    .limit(query.limit)
    .offset(query.offset);
  const [total] = await db.select({ value: count() }).from(items);

  return { items: rows.map(toItem), total: total?.value ?? 0 };
}

/**
 * item を 1 件取得する。
 *
 * @param db - DB のハンドル
 * @param id - item の id
 * @returns item
 * @throws 見つからないとき 404 の CommonException
 */
export async function getItem(db: AppDbExecutor, id: string): Promise<Item> {
  const [row] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (row === undefined) {
    throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] });
  }
  return toItem(row);
}

/**
 * item を作成する。
 *
 * 事前確認は分かりやすいエラーのために行い、同時に同じ name を登録しようとした場合は
 * 一意制約に任せて登録を見送る（`onConflictDoNothing`）。行が返らなければ重複なので 409 にする。
 * こうしないと、確認をすり抜けた後発の要求が一意制約違反の例外で 500 になる。
 *
 * @param db - DB のハンドル
 * @param input - 作成する item
 * @returns 作成した item
 * @throws 同じ name の item があるとき 409 の CommonException
 */
export async function createItem(db: AppDatabase, input: CreateItem): Promise<Item> {
  return db.transaction(async (tx) => {
    await assertNameNotTaken(tx, input.name);
    const [row] = await tx
      .insert(items)
      .values({ name: input.name, description: input.description, status: input.status })
      .onConflictDoNothing({ target: items.name })
      .returning();
    if (row === undefined) {
      throw nameDuplicateException(input.name);
    }
    return toItem(row);
  });
}

/**
 * 更新で書き換える列を組み立てる。
 *
 * 渡されなかった項目は書き換えない（`undefined` を混ぜると Drizzle が列名を出せずに失敗する）。
 *
 * @param input - 書き換える項目
 * @returns 書き換える列
 */
function toUpdateValues(input: UpdateItem): Partial<NewItemRow> {
  const values: Partial<NewItemRow> = {};
  if (input.name !== undefined) {
    values.name = input.name;
  }
  if (input.description !== undefined) {
    values.description = input.description;
  }
  if (input.status !== undefined) {
    values.status = input.status;
  }
  return values;
}

/**
 * item を更新する。渡された項目だけを書き換える。
 *
 * 作成と同じく、事前確認をすり抜けた同時実行は一意制約が弾く。
 * その例外をそのまま投げると 500 になるので、ここで 409 に言い換える。
 *
 * @param db - DB のハンドル
 * @param id - item の id
 * @param input - 書き換える項目
 * @returns 更新後の item
 * @throws 見つからないとき 404、同じ name の item があるとき 409 の CommonException
 */
export async function updateItem(db: AppDatabase, id: string, input: UpdateItem): Promise<Item> {
  const values = toUpdateValues(input);
  if (Object.keys(values).length === 0) {
    // 書き換える項目が無いなら現在の値をそのまま返す（updatedAt を無意味に進めない）。
    return getItem(db, id);
  }

  const name = input.name;

  return db.transaction(async (tx) => {
    if (name !== undefined) {
      await assertNameNotTaken(tx, name, id);
    }

    let updated: ItemRow[];
    try {
      updated = await tx.update(items).set(values).where(eq(items.id, id)).returning();
    } catch (err: unknown) {
      if (name !== undefined && isUniqueViolation(err)) {
        throw nameDuplicateException(name);
      }
      throw err;
    }

    const [row] = updated;
    if (row === undefined) {
      throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] });
    }
    return toItem(row);
  });
}

/**
 * item を削除する。
 *
 * @param db - DB のハンドル
 * @param id - item の id
 * @throws 見つからないとき 404 の CommonException
 */
export async function deleteItem(db: AppDbExecutor, id: string): Promise<void> {
  const deleted = await db.delete(items).where(eq(items.id, id)).returning({ id: items.id });
  if (deleted.length === 0) {
    throw new CommonException(HttpStatus.NOT_FOUND, MessageKeys.APP_ITEM_NOT_FOUND, { params: [id] });
  }
}
