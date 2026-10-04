---
paths:
  - 'client/src/**/*.ts'
  - 'client/src/**/*.html'
---

# コーディング規約（client）

Angular の書き方です。置き場所は [client-architecture.md](client-architecture.md)、
見た目は [client-styling.md](client-styling.md) を参照。

「（検査: …）」には、その決まりを機械で確かめる仕組みを書いています。付いていない決まりは、レビューだけで確かめます。

## コンポーネント

- **すべて standalone にする**（検査: ESLint）
- 依存は `imports` 配列に書く
- **NgModule を作らない**
- **`ChangeDetectionStrategy.OnPush`** を全コンポーネントに付ける（検査: ESLint。OnPush 以外を指定したものだけを止める）
- DI は **`inject()` 関数**で書く。コンストラクタ引数で注入しない（検査: ESLint）
- ルートから遅延読み込みされるページは `export default class`、それ以外は名前付きの `export class` にする
- セレクタは `app-kebab-case`、ディレクティブは `appCamelCase` にする（検査: ESLint）
- ファイル名は `kebab-case.{component,directive,pipe,guard,routes}.ts` にする

## テンプレート

- 制御構文は **`@if` / `@for` / `@switch`** を使う。`*ngIf` / `*ngFor` を使わない（検査: ESLint）
- `@for` には `track` を書く（検査: ビルド）
- テンプレートに業務ロジックを書かない
- signal で読める条件を 2 つ以上組み合わせる（`&&` / `||`）ときは、`computed()` に出す。ただし、Reactive Forms の
  状態（`form.invalid` など）を含む条件は、テンプレートに書いてよい
- 定数と比較するときは文字列リテラルを直書きせず、`protected readonly itemStatus = ItemStatus;` の
  ように公開して参照する

## 状態

- 状態は `signal()`、派生値は `computed()` で持つ。**`effect()` と `set()` で導出値を作らない**
- 親子の受け渡しは `input()` / `output()` で書く。`@Input()` / `@Output()` デコレータを使わない（検査: ESLint。`@Input()` だけを止める）
- 子から親の状態を直接書き換えない。`output()` で親に知らせる
- コンポーネントの外から書き換えさせない signal は、`private readonly xxxSignal = signal<T>(...)` と
  `readonly xxx = this.xxxSignal.asReadonly()` の 2 本立てにする
- **NgRx を入れない**

## API 呼び出し

- **サーバーを呼ぶのは `api-client.ts` の `call()` だけにする。** 画面は `call()` と API 定義
  （`itemsApi.listItems` など）を import して呼ぶ。機能ごとの呼び出しラッパーを作らない
  （サンプルの `items` を消した後は、既存の機能を手本にする）
- **`fetch` を `api-client.ts` 以外から呼ばない**（検査: ESLint。`fetch(...)` の形の呼び出しだけを止める。テストは対象外）
- `HttpClient` を使わない（検査: ESLint）
- URL をテンプレートやコンポーネントで組み立てない。パスは API 定義から取る
- `subscribe()` を呼ばない。ただし、RxJS の Observable を購読するほかない場合は、`takeUntilDestroyed()` を
  付けたうえで `subscribe()` してよい
- エラーは `ApiError`（`status` / `messageKey` / `message` / `details`）で受け取る。画面には `describeError()` の文言を
  出す。`messageKey` で分岐するときは、定数と比較する

## Material のコンポーネント

- 使うコンポーネントの module を、その画面の `imports` 配列に **standalone import** する
  （`MatTableModule` / `MatButtonModule` など）。共通の「Material まとめ module」を作らない
- 表・フォーム・ダイアログ・日付選択は Material のものを使う。自前で作り直さない
- 一覧は同梱の `data-table` を使う（ソート・ページング・列フィルタが入っている）

## 型

- **API の型は `@app/shared` の zod スキーマから導く。手書きの型定義を作らない**
- `any` を使わない（検査: ESLint）。避けられない箇所は `unknown` と型ガードで書く
- `as` キャストと non-null assertion（`!`）は、型ガードや zod の検証で型を絞れない場合にだけ使う。手本では、API 定義で
  形が決まっているレスポンス（`api-client.ts` の `call()`）と DOM のイベントに使っている
- `enum` を使わず、次の形（`as const` のオブジェクトと、同じ名前の型）で書く。名前は PascalCase にする

  ```ts
  export const ItemStatus = { draft: 'draft', active: 'active' } as const;
  export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];
  ```

## その他

- `console` を使わない（検査: ESLint。`console.error` だけは使ってよい）
- `setTimeout` でタイミングを調整しない。signal と `resource()` の状態で表す

## なぜ

signals と `OnPush` にそろえるのは、画面が「なぜ更新されたか」を追える状態を保つためです。
どこからでも変更できるグローバルストアがあると、非エンジニアが 1 か所直したときの影響範囲を
読み切れなくなります。

手書きの型定義を禁じるのは、API 定義との食い違いを型検査で見つけるためです。手でコピーした型は、サーバー側を
変えても壊れません。そのため、間違いに気づくのは実行したときになります。

`HttpClient` を使わないのは、サーバーとの通信の経路を `call()` の 1 本にそろえるためです。

`computed()` に出すのは、条件に名前を付けて読めるようにするためです。`computed()` は signal の変化しか拾いません。
Reactive Forms の状態は signal ではないので、`computed()` に出すと、フォームの妥当性が変わっても値が変わりません。

`any` を禁じるのは、型検査が効かない箇所を作らないためです。`any` が付くと、その値から先の型検査がすべて
無効になります。1 か所の妥協が、離れた場所の実行時エラーになって返ってきます。
