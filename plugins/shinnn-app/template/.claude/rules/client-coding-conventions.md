---
paths:
  - 'client/src/**/*.ts'
  - 'client/src/**/*.html'
---

# コーディング規約（client）

Angular の書き方です。置き場所は [client-architecture.md](client-architecture.md)、
見た目は [client-styling.md](client-styling.md) を参照。

## コンポーネント

- **すべて standalone。** 依存は `imports` 配列に書く。**NgModule を作らない**
- **`ChangeDetectionStrategy.OnPush`** を全コンポーネントに付ける（ESLint で強制）
- DI は **`inject()` 関数**。コンストラクタ引数での注入は使わない
- ルートから遅延読み込みされるページは `export default class`、それ以外は名前付き `export class`
- セレクタは `app-kebab-case`、ディレクティブは `appCamelCase`
- ファイル名は `kebab-case.{component,directive,pipe,guard,routes}.ts`

## テンプレート

- 制御構文は **`@if` / `@for` / `@switch`**。`*ngIf` / `*ngFor` を使わない
- `@for` には必ず `track` を書く
- テンプレートに業務ロジックを書かない。条件が 2 つ以上重なったら `computed()` に出す
- 定数と比較するときは文字列リテラルを直書きせず、`protected readonly itemStatus = ItemStatus;` の
  ように公開して参照する

## 状態

- 状態は `signal()`、派生値は `computed()`。**`effect()` + `set()` で導出値を作らない**
- 親子の受け渡しは `input()` / `output()`。`@Input()` / `@Output()` デコレータを使わない
- 子から親の状態を直接書き換えない。`output()` で親に知らせる
- 外から書き換えられたくない signal は `private readonly xxxSignal = signal<T>(...)` と
  `readonly xxx = this.xxxSignal.asReadonly()` の 2 本立てにする
- **NgRx を入れない**

## API 呼び出し

- **サーバーを呼ぶのは `api-client.ts` の `call()` だけ。** 画面は `call()` と API 定義
  （`itemsApi.listItems` など）を import して呼ぶ。機能ごとの呼び出しラッパーを別ファイルに作らない
  （サンプルの `items` を消した後は、既存の機能を手本にする）
- **`fetch` を画面から直接呼ばない**（ESLint で禁止。例外は `api-client.ts` とテストだけ）
- `HttpClient` を使わない。`call()` は fetch で動くので、通信経路を 1 本にそろえる
- URL をテンプレートやコンポーネントで組み立てない。パスは API 定義が持っている
- 手動 `subscribe` をしない。RxJS を使う場合は `takeUntilDestroyed()` を付けて解除を不要にする
- エラーは `ApiError`（`status` / `messageKey` / `message` / `details`）で受け取り、
  `describeError()` の文言を画面に出す。`messageKey` で分岐したいときは定数と比較する

## Material のコンポーネント

- 使うコンポーネントの module を、その画面の `imports` 配列に **standalone import** する
  （`MatTableModule` / `MatButtonModule` など）。共通の「Material まとめ module」を作らない
- 表・フォーム・ダイアログ・日付選択は Material のものを使い、自前で作り直さない
- 一覧は同梱の `data-table` を使う。ソート・ページング・列フィルタが入っている

## 型

- **API の型は `@app/shared` の zod スキーマから導出する。手書きの型定義を作らない**
- `any` を使わない（ESLint で error）。避けられない箇所は `unknown` + 型ガード
- `as` キャストと non-null assertion（`!`）は最小限にする
- 定数は camelCase。`enum` は使わず次の形にする

  ```ts
  export const ItemStatus = { draft: 'draft', active: 'active' } as const;
  export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];
  ```

## その他

- `console` を使わない（ESLint で error。`console.error` のみ許可）
- `setTimeout` でタイミングを調整しない。signal と `resource()` の状態で表現する

## なぜ

signals と `OnPush` にそろえるのは、画面が「なぜ更新されたか」を追える状態を保つためです。
どこからでも変更できるグローバルストアがあると、非エンジニアが 1 か所直したときの影響範囲を
読み切れなくなります。

手書きの型定義を禁じるのは、API 定義との食い違いを型検査で見つけるためです。手でコピーした型は
サーバー側を変えても壊れないので、実行するまで間違いに気づけません。

`any` を禁じるのは、`any` が付いた瞬間にその先すべての型検査が無効になるからです。1 か所の妥協が、
離れた場所の実行時エラーになって返ってきます。
