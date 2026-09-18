/**
 * @file 一覧表示の標準部品。Material の mat-table に並べ替え・ページング・列ごとの絞り込みを足したもの。
 *
 * 列の定義（`DataTableColumn`）を入力で受け取るので、機能ごとに表を作り直さなくてよい。
 * 行の操作ボタン（編集・削除など）は `#rowActions` の ng-template で差し込む。
 *
 * 並べ替えと絞り込みは `sortRows()` / `filterRows()` に切り出してある（画面を起動せずに検証できる）。
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import type { TemplateRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';

/** 表の 1 列。`value` が表示・並べ替え・絞り込みのすべてに使われる。 */
export interface DataTableColumn<T> {
  /** 列の識別子。行データのキーと一致していなくてよい。 */
  readonly key: string;
  /** 見出しに出す文字列。 */
  readonly header: string;
  /** 行からこの列の表示文字列を取り出す。 */
  readonly value: (row: T) => string;
  /** 絞り込み欄を出すか。既定は出さない。 */
  readonly filterable?: boolean;
  /** 並べ替えを許すか。既定は許す。 */
  readonly sortable?: boolean;
}

/** 行の操作ボタンに渡す文脈。`$implicit` はその行。 */
export interface DataTableRowContext<T> {
  $implicit: T;
}

/** 操作列の識別子。列定義のキーと衝突しないよう記号で始める。 */
const ACTIONS_COLUMN = '__actions';

/** 絞り込み行の列識別子を作る。見出し行と別の列定義が要るため接頭辞を付ける。 */
function filterColumnKey(key: string): string {
  return `filter-${key}`;
}

/**
 * 列ごとの絞り込み語で行を絞る。大文字小文字を区別せず、部分一致で判定する。
 *
 * @param rows - 絞り込み前の行
 * @param columns - 列の定義
 * @param filters - 列の識別子ごとの絞り込み語。空文字の項目は条件にしない
 */
export function filterRows<T>(
  rows: readonly T[],
  columns: readonly DataTableColumn<T>[],
  filters: Readonly<Record<string, string>>,
): T[] {
  const conditions: { column: DataTableColumn<T>; keyword: string }[] = [];
  for (const column of columns) {
    const keyword = filters[column.key]?.trim().toLowerCase() ?? '';
    if (keyword !== '') {
      conditions.push({ column, keyword });
    }
  }
  if (conditions.length === 0) {
    return [...rows];
  }
  return rows.filter((row) =>
    conditions.every(({ column, keyword }) => column.value(row).toLowerCase().includes(keyword)),
  );
}

/**
 * 並べ替える。`direction` が空のときは元の並びを保つ。
 *
 * 数字を含む文字列が桁数どおりに並ぶよう `localeCompare` の数値比較を使う。
 *
 * @param rows - 並べ替え前の行
 * @param columns - 列の定義
 * @param sort - 並べ替える列と向き
 */
export function sortRows<T>(rows: readonly T[], columns: readonly DataTableColumn<T>[], sort: Sort): T[] {
  const column = columns.find((candidate) => candidate.key === sort.active);
  if (column === undefined || sort.direction === '') {
    return [...rows];
  }
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort(
    (left, right) => sign * column.value(left).localeCompare(column.value(right), 'ja', { numeric: true }),
  );
}

@Component({
  selector: 'app-data-table',
  imports: [MatPaginatorModule, MatSortModule, MatTableModule, NgTemplateOutlet],
  templateUrl: './data-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent<T> {
  /** 表示する列。 */
  readonly columns = input.required<readonly DataTableColumn<T>[]>();

  /** 表示する行。絞り込み・並べ替え・ページングはこの部品が行う。 */
  readonly rows = input.required<readonly T[]>();

  /** 1 ページの件数の初期値。ページャで変えられる。 */
  readonly pageSize = input(10);

  /** 件数の選択肢。 */
  readonly pageSizeOptions = input<number[]>([10, 25, 50]);

  /** 行の操作ボタン。`<ng-template #rowActions let-row>` で渡す。 */
  readonly rowActions = contentChild<TemplateRef<DataTableRowContext<T>>>('rowActions');

  /** 列の識別子ごとの絞り込み語。 */
  private readonly filters = signal<Record<string, string>>({});

  /** 並べ替えの状態。 */
  private readonly sort = signal<Sort>({ active: '', direction: '' });

  /** 表示中の 1 ページの件数。入力が変わったら追従し、ページャの操作でも変わる。 */
  protected readonly currentPageSize = linkedSignal(() => this.pageSize());

  /** 見出し行に並べる列。操作テンプレートが渡されたときだけ操作列を足す。 */
  protected readonly displayedColumns = computed(() => {
    const keys = this.columns().map((column) => column.key);
    return this.rowActions() === undefined ? keys : [...keys, ACTIONS_COLUMN];
  });

  /** 絞り込み行に並べる列。絞り込める列が 1 つも無ければ行ごと出さない。 */
  protected readonly filterColumns = computed(() => {
    if (!this.columns().some((column) => column.filterable === true)) {
      return [];
    }
    return this.displayedColumns().map(filterColumnKey);
  });

  /** 絞り込みと並べ替えを適用した行。ページャの総件数はこの件数になる。 */
  protected readonly matchedRows = computed(() =>
    sortRows(filterRows(this.rows(), this.columns(), this.filters()), this.columns(), this.sort()),
  );

  /**
   * 表示中のページ番号（0 始まり）。
   *
   * 表示対象の件数が減ってページが範囲外になったら、最後のページへ詰める。
   * 詰めないと、末尾のページで行を消したときに「データはあるのに空」の表示になる。
   * 1 ページの件数はページャ側が変更時にページ番号ごと通知してくるので、ここでは追跡しない。
   */
  protected readonly pageIndex = linkedSignal<number, number>({
    source: () => this.matchedRows().length,
    computation: (matchedCount, previous) => {
      const current = previous?.value ?? 0;
      const lastPageIndex = Math.max(0, Math.ceil(matchedCount / untracked(this.currentPageSize)) - 1);
      return Math.min(current, lastPageIndex);
    },
  });

  /** 表に流す行（現在のページの分だけ）。 */
  protected readonly pagedRows = computed(() => {
    const start = this.pageIndex() * this.currentPageSize();
    return this.matchedRows().slice(start, start + this.currentPageSize());
  });

  protected readonly filterColumnKey = filterColumnKey;

  protected filterValue(key: string): string {
    return this.filters()[key] ?? '';
  }

  protected onFilterInput(key: string, event: Event): void {
    const keyword = (event.target as HTMLInputElement).value;
    this.filters.update((current) => ({ ...current, [key]: keyword }));
    this.pageIndex.set(0);
  }

  protected onSortChange(sort: Sort): void {
    this.sort.set(sort);
    this.pageIndex.set(0);
  }

  protected onPage(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.currentPageSize.set(event.pageSize);
  }
}
