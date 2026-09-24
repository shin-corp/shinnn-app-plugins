/**
 * @file item の一覧画面。新しい画面はこのファイルの形をまねて作る。
 *
 * 押さえどころ:
 * - standalone / OnPush、状態は signal() と computed()（NgModule も NgRx も使わない）
 * - 取得は api-client の call() + resource()（手で subscribe しない）
 * - 一覧は shared/data-table に任せる。並べ替え・ページング・絞り込みを画面ごとに書かない
 * - 失敗は MatSnackBar で messageKey つきで見せる（問い合わせで原因を追えるようにする）
 */

import { ChangeDetectionStrategy, Component, computed, effect, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { itemsApi, type Item } from '@app/shared/api';
import { firstValueFrom } from 'rxjs';

import { call, describeError } from '../../api-client';
import type { DataTableColumn } from '../../shared/data-table/data-table.component';
import { DataTableComponent } from '../../shared/data-table/data-table.component';
import { ItemFormComponent, type ItemFormData } from './item-form.component';
import { ITEM_STATUS_LABELS } from './item-status';

/**
 * 1 度に取得する件数。API 定義（`ItemListQuerySchema`）の上限に合わせてある。
 *
 * data-table の並べ替え・絞り込み・ページングは手元にある行だけを対象にするため、
 * ここで取れなかった分は画面に出ない。これを超える件数を扱う画面では、
 * サーバー側のページング（`limit` と `offset` を画面の状態にする）へ切り替える。
 */
const fetchLimit = 100;

/** ISO 8601 の文字列を画面表示用の日時にする。 */
function formatDateTime(isoText: string): string {
  return new Date(isoText).toLocaleString('ja-JP');
}

@Component({
  selector: 'app-items-page',
  imports: [DataTableComponent, MatButtonModule, MatProgressBarModule],
  templateUrl: './items-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class ItemsPageComponent {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** 一覧のデータ。`reload()` で読み直す。 */
  protected readonly itemsResource = resource({
    loader: ({ abortSignal }) =>
      call(itemsApi.listItems, { query: { limit: fetchLimit } }, { signal: abortSignal }),
  });

  /*
   * 取得に失敗した resource の value() は、読むと例外を投げる。hasValue() で確かめてから読まないと、
   * 失敗したときに画面の描画ごと止まり、失敗の通知も出ない。
   */
  protected readonly items = computed(() => (this.itemsResource.hasValue() ? this.itemsResource.value().items : []));
  protected readonly total = computed(() => (this.itemsResource.hasValue() ? this.itemsResource.value().total : 0));

  /** 総件数のうち取得できていない分があるか。件数の食い違いを黙って隠さないために出す。 */
  protected readonly hasUnfetched = computed(() => this.total() > this.items().length);

  /** 一覧に出す列。表示文字列の作り方はここだけに書く。 */
  protected readonly columns: readonly DataTableColumn<Item>[] = [
    { key: 'name', header: '名前', value: (item) => item.name, filterable: true },
    { key: 'description', header: '説明', value: (item) => item.description ?? '', filterable: true },
    { key: 'status', header: '状態', value: (item) => ITEM_STATUS_LABELS[item.status], filterable: true },
    { key: 'updatedAt', header: '更新日時', value: (item) => formatDateTime(item.updatedAt) },
  ];

  constructor() {
    effect(() => {
      const error = this.itemsResource.error();
      if (error !== undefined) {
        this.notifyFailure(error);
      }
    });
  }

  protected async openForm(item?: Item): Promise<void> {
    const data: ItemFormData = { item };
    const dialogRef = this.dialog.open<ItemFormComponent, ItemFormData, boolean>(ItemFormComponent, {
      data,
      width: '480px',
    });
    const saved = await firstValueFrom(dialogRef.afterClosed());
    if (saved === true) {
      this.itemsResource.reload();
    }
  }

  protected async remove(item: Item): Promise<void> {
    if (!confirm(`「${item.name}」を削除します。よろしいですか。`)) {
      return;
    }
    try {
      await call(itemsApi.deleteItem, { params: { id: item.id } });
      this.itemsResource.reload();
    } catch (error: unknown) {
      this.notifyFailure(error);
    }
  }

  private notifyFailure(error: unknown): void {
    this.snackBar.open(describeError(error), '閉じる', { duration: 8000 });
  }
}
