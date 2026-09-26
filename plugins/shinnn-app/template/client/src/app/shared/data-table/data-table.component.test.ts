/** @file data-table の検証。並べ替え・絞り込みの規則と、ページングした表示を確かめる。 */

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { DataTableComponent, filterRows, sortRows, type DataTableColumn } from './data-table.component';

interface Row {
  name: string;
  amount: number;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: '名前', value: (row) => row.name, filterable: true },
  { key: 'amount', header: '金額', value: (row) => String(row.amount) },
];

const rows: Row[] = [
  { name: 'Beta', amount: 20 },
  { name: 'alpha', amount: 100 },
  { name: 'Gamma', amount: 3 },
];

/** 列の識別子と行を渡して表を作る。 */
function createTable(tableRows: readonly Row[], pageSize = 10) {
  const fixture = TestBed.createComponent<DataTableComponent<Row>>(DataTableComponent);
  fixture.componentRef.setInput('columns', columns);
  fixture.componentRef.setInput('rows', tableRows);
  fixture.componentRef.setInput('pageSize', pageSize);
  return fixture;
}

/** 表の本体行に出ている文字列を、行ごとの配列で取り出す。 */
function readBodyRows(element: HTMLElement): string[][] {
  return [...element.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim()),
  );
}

describe('filterRows', () => {
  describe('正常系', () => {
    it('大文字小文字を区別せず部分一致で絞り込む', () => {
      expect(filterRows(rows, columns, { name: 'a' }).map((row) => row.name)).toEqual(['Beta', 'alpha', 'Gamma']);
      expect(filterRows(rows, columns, { name: 'BET' }).map((row) => row.name)).toEqual(['Beta']);
    });

    it('複数の列の条件はすべて満たす行だけを残す', () => {
      expect(filterRows(rows, columns, { name: 'a', amount: '3' }).map((row) => row.name)).toEqual(['Gamma']);
    });
  });

  describe('エッジケース', () => {
    it('空白だけの絞り込み語は条件にしない', () => {
      expect(filterRows(rows, columns, { name: '   ' })).toHaveLength(3);
    });

    it('元の配列を書き換えない', () => {
      filterRows(rows, columns, { name: 'a' });
      expect(rows.map((row) => row.name)).toEqual(['Beta', 'alpha', 'Gamma']);
    });
  });
});

describe('sortRows', () => {
  describe('正常系', () => {
    it('昇順・降順で並べ替える', () => {
      expect(sortRows(rows, columns, { active: 'name', direction: 'asc' }).map((row) => row.name)).toEqual([
        'alpha',
        'Beta',
        'Gamma',
      ]);
      expect(sortRows(rows, columns, { active: 'name', direction: 'desc' }).map((row) => row.name)).toEqual([
        'Gamma',
        'Beta',
        'alpha',
      ]);
    });

    it('数字は桁数どおりに並べる', () => {
      expect(sortRows(rows, columns, { active: 'amount', direction: 'asc' }).map((row) => row.amount)).toEqual([
        3, 20, 100,
      ]);
    });
  });

  describe('エッジケース', () => {
    it('向きが未指定なら元の並びを保つ', () => {
      expect(sortRows(rows, columns, { active: 'name', direction: '' }).map((row) => row.name)).toEqual([
        'Beta',
        'alpha',
        'Gamma',
      ]);
    });

    it('知らない列を指定されたら元の並びを保つ', () => {
      expect(sortRows(rows, columns, { active: 'unknown', direction: 'asc' }).map((row) => row.name)).toEqual([
        'Beta',
        'alpha',
        'Gamma',
      ]);
    });
  });
});

describe('DataTableComponent', () => {
  describe('正常系', () => {
    it('列定義どおりの見出しと行を出す', async () => {
      const fixture = createTable(rows);
      await fixture.whenStable();

      const element = fixture.nativeElement as HTMLElement;
      const headers = [...element.querySelectorAll('th.mat-mdc-header-cell')].map((cell) =>
        (cell.textContent ?? '').trim(),
      );
      expect(headers).toContain('名前');
      expect(headers).toContain('金額');
      expect(readBodyRows(element)).toEqual([
        ['Beta', '20'],
        ['alpha', '100'],
        ['Gamma', '3'],
      ]);
    });

    it('1 ページの件数を超えた行は次のページに送る', async () => {
      const fixture = createTable(rows, 2);
      await fixture.whenStable();

      expect(readBodyRows(fixture.nativeElement as HTMLElement)).toHaveLength(2);
    });

    it('ページャの文言を日本語で出す', async () => {
      const fixture = createTable(rows, 2);
      await fixture.whenStable();

      const element = fixture.nativeElement as HTMLElement;
      expect(element.querySelector('.mat-mdc-paginator-page-size-label')?.textContent?.trim()).toBe('表示件数:');
      expect(element.querySelector('.mat-mdc-paginator-range-label')?.textContent?.trim()).toBe('全 3 件中 1〜2 件');
      expect(element.querySelector('button.mat-mdc-paginator-navigation-next')?.getAttribute('aria-label')).toBe(
        '次のページ',
      );
    });
  });

  describe('エッジケース', () => {
    it('最終ページで行が減ると 1 つ前のページに詰まる', async () => {
      const fixture = createTable(rows, 2);
      await fixture.whenStable();

      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLButtonElement>('button.mat-mdc-paginator-navigation-next')?.click();
      await fixture.whenStable();
      expect(readBodyRows(element)).toEqual([['Gamma', '3']]);

      // 3 件目が消えると 2 ページ目は存在しなくなる。1 ページ目へ詰めないと空の表になる。
      fixture.componentRef.setInput('rows', rows.slice(0, 2));
      await fixture.whenStable();

      expect(readBodyRows(element)).toEqual([
        ['Beta', '20'],
        ['alpha', '100'],
      ]);
    });

    it('行が無いときは案内を出す', async () => {
      const fixture = createTable([]);
      await fixture.whenStable();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('該当するデータがありません。');
    });
  });
});
