/** @file item 機能のルート定義。app.routes.ts からまとめて遅延読み込みする。 */

import type { Routes } from '@angular/router';

export const itemsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./items-page.component'),
  },
];
