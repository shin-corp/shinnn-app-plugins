/**
 * @file ページャ（mat-paginator）の文言を日本語にする。Material の既定の文言は英語のため。
 *
 * data-table の `providers` で差し替えるので、表の中のページャに効く。
 */

import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

@Injectable()
export class JapanesePaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = '表示件数:';
  override nextPageLabel = '次のページ';
  override previousPageLabel = '前のページ';
  override firstPageLabel = '最初のページ';
  override lastPageLabel = '最後のページ';

  /** 「全 12 件中 1〜10 件」の形にする。範囲の外のページは、Material の既定と同じく件数を超えて数える。 */
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return `全 ${length} 件`;
    }
    const startIndex = page * pageSize;
    const endIndex = startIndex < length ? Math.min(startIndex + pageSize, length) : startIndex + pageSize;
    return `全 ${length} 件中 ${startIndex + 1}〜${endIndex} 件`;
  };
}
