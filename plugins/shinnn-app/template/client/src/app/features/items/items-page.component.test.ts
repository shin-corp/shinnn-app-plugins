/** @file items 一覧画面の検証。fetch を差し替えて、取得した item が表に並ぶことを確かめる。 */

import { TestBed } from '@angular/core/testing';
import type { Item } from '@app/shared/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ItemsPageComponent from './items-page.component';

const items: Item[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: '見積書テンプレート',
    description: '標準の見積書',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: '請求書テンプレート',
    status: 'draft',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
];

/** 一覧 API の応答を差し替える。 */
function stubListResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      ),
    ),
  );
}

/** 画面を組み立てて、取得が終わるまで待つ。 */
async function renderPage(): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(ItemsPageComponent);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('ItemsPageComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('正常系', () => {
    it('取得した item を表に並べる', async () => {
      stubListResponse({ items, total: items.length });

      const element = await renderPage();

      expect(element.textContent).toContain('全 2 件');
      const cells = [...element.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim());
      expect(cells).toContain('見積書テンプレート');
      expect(cells).toContain('請求書テンプレート');
    });

    it('状態は日本語の表示名にする', async () => {
      stubListResponse({ items, total: items.length });

      const element = await renderPage();

      const cells = [...element.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim());
      expect(cells).toContain('運用中');
      expect(cells).toContain('下書き');
    });
  });

  describe('エッジケース', () => {
    it('総件数より取得できた件数が少ないときは、その旨を添える', async () => {
      stubListResponse({ items, total: 137 });

      const element = await renderPage();

      expect(element.textContent).toContain('全 137 件');
      expect(element.textContent).toContain('先頭 2 件のみ表示しています');
    });

    it('item が 0 件なら案内を出す', async () => {
      stubListResponse({ items: [], total: 0 });

      const element = await renderPage();

      expect(element.textContent).toContain('全 0 件');
      expect(element.textContent).toContain('該当するデータがありません。');
    });
  });
});
