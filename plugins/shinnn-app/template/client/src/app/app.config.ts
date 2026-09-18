/** @file アプリ全体のプロバイダ。画面固有の設定はここに書かない。 */

import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';

/** @exports bootstrapApplication に渡す設定。 */
export const appConfig: ApplicationConfig = {
  providers: [
    // 捕まえ損ねた例外・Promise の reject をコンソールに出す。
    provideBrowserGlobalErrorListeners(),
    // ルートパラメータ（/items/:id の id）を画面の input() で受ける。
    provideRouter(routes, withComponentInputBinding()),
  ],
};
