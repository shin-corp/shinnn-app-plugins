/** @file item の状態の表示名。一覧とフォームの両方で使うため 1 か所にまとめる。 */

import { ItemStatusSchema, type ItemStatus } from '@app/shared/api';

/** 状態の表示名。API 定義（zod の enum）に値を足したらここも足す。 */
export const ITEM_STATUS_LABELS: Readonly<Record<ItemStatus, string>> = {
  draft: '下書き',
  active: '運用中',
  archived: '保管済み',
};

/** 選択肢に出す順に並べた状態の一覧。 */
export const ITEM_STATUSES: readonly ItemStatus[] = ItemStatusSchema.options;
