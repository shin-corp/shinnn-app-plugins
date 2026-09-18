/** @file ルート定義。1 機能 = features/<機能>/ で、機能ごとに遅延読み込みする。 */

import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'items' },
  {
    path: 'items',
    loadChildren: () => import('./features/items/items.routes').then((m) => m.itemsRoutes),
  },
];
