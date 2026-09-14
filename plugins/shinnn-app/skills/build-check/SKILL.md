---
name: build-check
description: TypeScript のビルドと型検査を実行し、コンパイルが通ることを確認する。「ビルドして」「型エラーを見て」「コンパイルが通るか」で起動
---

# ビルドの確認

## 実行

| 範囲 | コマンド |
|:--|:--|
| すべて | `npm run build` |
| 1 つのパッケージ | `npm run build -w <client\|server\|shared>`（先に `npm run build -w shared`） |
| テストと seed も含めた型検査 | `npm exec -w <パッケージ> -- tsc -p tsconfig.check.json --noEmit` |

`shared` は他から参照されるので、**変更したら最初にビルドする**。ここが通らないと server と client の型エラーは当てにならない。

## 成功の基準

- 終了コードが 0
- 型エラーが 0 件

## 落ちたとき

- 型エラーの**最初の 1 件**から読む。後続はその波及であることが多い
- `shared` を変えた直後の client / server のエラーは、たいてい**画面やサーバーが定義に追いついていない**。
  API 定義を戻すのではなく、参照側を合わせる
- `Cannot find module '@app/shared'` は `shared` が未ビルド。先に `npm run build -w shared`

## 報告

```
ビルド: OK / NG
NG の場合: ファイル:行 - エラー内容（最初の 5 件まで）
```
