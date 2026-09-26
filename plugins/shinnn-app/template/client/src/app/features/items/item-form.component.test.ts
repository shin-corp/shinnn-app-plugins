/**
 * @file item の作成・編集ダイアログの検証。fetch を差し替えて、保存に失敗したときに画面に出る結果を確かめる。
 *
 * テスト名の先頭の AC-n は docs/仕様書.md の受入条件の番号（画面に現れる条件）。
 */

import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ItemFormComponent, type ItemFormData } from './item-form.component';

/** 保存の API の応答を差し替える。 */
function stubResponse(body: unknown, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
    ),
  );
}

/** 要素を 1 つ探す。見つからなければテストを失敗させる。 */
function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`${selector} が見つからない`);
  }
  return found;
}

/** ダイアログの中身を組み立てる。閉じたかどうかは `close` の呼び出しで見る。 */
async function renderForm(data: ItemFormData = {}) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(ItemFormComponent);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, close };
}

describe('ItemFormComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('異常系', () => {
    it('AC-10 保存に失敗したら理由を出し、ダイアログを閉じない', async () => {
      stubResponse(
        { messageKey: 'APP_ITEM_NAME_DUPLICATE', message: '同じ name の item が既に存在します。name: 見積書' },
        409,
      );
      const { fixture, element, close } = await renderForm();

      const nameInput = query<HTMLInputElement>(element, 'input[formcontrolname="name"]');
      nameInput.value = '見積書';
      nameInput.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      query<HTMLButtonElement>(element, 'button[type="submit"]').click();
      await fixture.whenStable();

      expect(document.body.textContent).toContain(
        '同じ name の item が既に存在します。name: 見積書（APP_ITEM_NAME_DUPLICATE）',
      );
      expect(close).not.toHaveBeenCalled();
    });
  });
});
