---
paths:
  - 'server/resources/messages.json'
  - 'server/src/util/message/**'
---

# メッセージ規約

エラーや通知の文言は **`server/resources/messages.json` にだけ**書き、
そこから `server/src/util/message/message-keys.ts` を生成します。

## 編集の手順

1. `server/resources/messages.json` にエントリを追加する（`"<キー>": { "type": "INFO | WARN | ERROR | FATAL", "message": "文言" }`）
2. `npm run messages` を実行する（`server/scripts/gen-message-keys.mjs` が動く）
3. 生成された `server/src/util/message/message-keys.ts` をコミットする

## キーの付け方

- キーは `APP_<領域>_<内容>` の形で、英大文字・数字・アンダースコアで書く（例: `APP_VALIDATION_FAILED`、
  `APP_ITEM_NOT_FOUND`）（検査: `npm run messages`。英大文字で始まり、英大文字・数字・アンダースコアだけで
  できているかだけを見る。`APP_` で始まるかは見ない）
- 機能に固有のキーは、`<領域>` に機能名を書く（item なら `APP_ITEM_`）
- **コードでは、キーを文字列リテラルで書かない。** `MessageKeys.APP_ITEM_NOT_FOUND` の形で参照する
- 1 つの状況に 1 つのキーを割り当てる。文言だけが違うキーを足さない。文言を変えたいときは `messages.json` の
  文言を直す

## 文言の書き方

- 文言は、アプリの利用者に向けて書く。開発者に向けて書かない
- **「何が起きたか」と「どうすればよいか」の両方を書く。** 「エラーが発生しました」だけにしない
- 内部の情報（テーブル名・SQL・スタックトレース・ファイルパス）を、文言に入れない。調査に必要な情報はログに入れる
  （`CommonException` の `details` の決まりは [server-coding-conventions.md](server-coding-conventions.md) の「エラー」）
- 値を埋め込むときはプレースホルダ（`%1` / `%2` …）を使う。文字列の連結で組み立てない

## 理由

この規約の理由は `.claude/rules-why/messages.md` にあります。決まりに当てはまるかを迷ったときに読みます。
