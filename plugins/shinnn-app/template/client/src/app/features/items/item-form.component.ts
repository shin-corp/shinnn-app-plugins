/**
 * @file item の作成・編集フォーム（ダイアログ）。
 *
 * 編集対象は `MAT_DIALOG_DATA` で受け取る。呼び出し元の状態を直接読み書きしない。
 * 保存できたら `true` を返して閉じる。呼び出し元はそれを見て一覧を読み直す。
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { itemsApi, type Item, type ItemStatus } from '@app/shared/api';

import { call, describeError } from '../../api-client';
import { ITEM_STATUS_LABELS, ITEM_STATUSES } from './item-status';

/** ダイアログに渡す値。`item` が無ければ新規作成。 */
export interface ItemFormData {
  readonly item?: Item;
}

@Component({
  selector: 'app-item-form',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule],
  templateUrl: './item-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemFormComponent {
  private readonly dialogRef = inject<MatDialogRef<ItemFormComponent, boolean>>(MatDialogRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly data = inject<ItemFormData>(MAT_DIALOG_DATA);

  protected readonly statuses = ITEM_STATUSES;
  protected readonly statusLabels = ITEM_STATUS_LABELS;
  protected readonly isEdit = this.data.item !== undefined;

  /** 保存中は二重送信を防ぐためボタンを止める。 */
  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.item?.name ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    description: new FormControl(this.data.item?.description ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(1000)],
    }),
    status: new FormControl<ItemStatus>(this.data.item?.status ?? 'draft', { nonNullable: true }),
  });

  protected async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      return;
    }
    this.saving.set(true);
    const { name, description, status } = this.form.getRawValue();
    try {
      const item = this.data.item;
      if (item === undefined) {
        // 作成では空の説明を送らない（説明を持たない item として登録する）。
        await call(itemsApi.createItem, {
          body: { name, description: description === '' ? undefined : description, status },
        });
      } else {
        /*
         * 更新では空文字をそのまま送る。省略すると部分更新の「渡されなかった項目」と区別が付かず、
         * 説明を消したのに元の説明が残る。
         */
        await call(itemsApi.updateItem, { params: { id: item.id }, body: { name, description, status } });
      }
      this.dialogRef.close(true);
    } catch (error: unknown) {
      this.snackBar.open(describeError(error), '閉じる', { duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }
}
