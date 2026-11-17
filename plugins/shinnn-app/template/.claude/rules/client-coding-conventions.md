---
paths:
  - 'client/src/**/*.ts'
  - 'client/src/**/*.html'
---

# コーディング規約（client）

Angular の書き方です。

## コンポーネント

- **すべて standalone にする**（検査: ESLint）
- **`ChangeDetectionStrategy.OnPush`** を全コンポーネントに付ける（検査: ESLint。OnPush 以外を指定したものだけを止める）
- DI は **`inject()` 関数**で書く。コンストラクタ引数で注入しない（検査: ESLint）
- ルートから遅延読み込みされるページは `export default class`、それ以外は名前付きの `export class` にする
- セレクタは `app-kebab-case`、ディレクティブは `appCamelCase` にする（検査: ESLint）
- ファイル名は `kebab-case.{component,directive,pipe,guard,routes}.ts` にする

## テンプレート

- 制御構文は **`@if` / `@for` / `@switch`** を使う。`*ngIf` / `*ngFor` を使わない（検査: ESLint）
- signal で読める条件を 2 つ以上組み合わせる（`&&` / `||`）ときは、`computed()` に出す。ただし、Reactive Forms の
  状態（`form.invalid` など）を含む条件は、テンプレートに書いてよい
- 定数と比較するときは文字列リテラルを直書きせず、`protected readonly itemStatus = ItemStatus;` の
  ように公開して参照する

## 状態

- 派生値は `computed()` で持つ。**`effect()` と `set()` で派生値を作らない**
- 親子の受け渡しは `input()` / `output()` で書く。`@Input()` / `@Output()` デコレータを使わない（検査: ESLint。`@Input()` だけを止める）
- 子から親の状態を直接書き換えない。`output()` で親に知らせる
- コンポーネントの外から書き換えさせない signal は、`private readonly xxxSignal = signal<T>(...)` と
  `readonly xxx = this.xxxSignal.asReadonly()` の 2 本立てにする

## API 呼び出し

- **`fetch` を `api-client.ts` 以外から呼ばない**（検査: ESLint。グローバルの `fetch` を名前で参照したものだけを止める。
  `window.fetch` などは止まらない。テストは対象外）
- `HttpClient` を使わない（検査: ESLint）
- URL をテンプレートやコンポーネントで組み立てない。パスは API 定義から取る
- `subscribe()` を呼ばない。ただし、RxJS の Observable を購読するほかない場合は、`takeUntilDestroyed()` を
  付けたうえで `subscribe()` してよい
- エラーは `ApiError` で受け取る
- 画面には `describeError()` の文言を出す
- `messageKey` で分岐するときは、定数と比較する

## Material のコンポーネント

- 使うコンポーネントの module を、その画面の `imports` 配列に **standalone import** する
  （`MatTableModule` / `MatButtonModule` など）。共通の「Material まとめ module」を作らない

## 型

- **API の型は `@app/shared` の zod スキーマから導く。手書きの型定義を作らない**
- `any` を使わない（検査: ESLint）。避けられない箇所は `unknown` と型ガードで書く
- `as` キャストと non-null assertion（`!`）は、型ガードや zod の検証で型を絞れない場合にだけ使う
- ただし、API 定義で形が決まっているレスポンスの本文（`api-client.ts` の `call()`）は、検証せずに `as` で型を付けてよい
- `enum` を使わず、次の形（`as const` のオブジェクトと、同じ名前の型）で書く。名前は PascalCase にする

  ```ts
  export const ItemStatus = { draft: 'draft', active: 'active' } as const;
  export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];
  ```

## その他

- `console` を使わない（検査: ESLint。`console.error` だけは使ってよい）
- `setTimeout` でタイミングを調整しない。signal と `resource()` の状態で表す

## 理由

この規約の理由は `.claude/rules-why/client-coding-conventions.md` にあります。決まりに当てはまるかを迷ったときに読みます。
