---
paths:
  - 'server/src/provider/**'
  - 'server/evals/**'
---

# 外部の AI サービスとの連携（Claude Agent SDK など）

`server/src/provider/` に置く、外部システムの SDK を呼ぶコードと、その評価（`server/evals/`）の規約です。
ここでは Claude Agent SDK を例に書きますが、他の AI サービスや外部 API でも同じ考え方で扱います。

## 置き場所と呼び出し

- 入れると決まった SDK がライセンスの検査（`scripts/check-licenses.mjs`）を通らない場合は、通し方をシン株式会社の指示に従って決める
- SDK を import するのは `server/src/provider/<システム>.provider.ts` だけにする（検査: ESLint。
  `src/`（`provider/` を除く）・`seed/`・`evals/` からの、`server/eslint.config.js` に名前を書いた SDK の import だけを止める）
- 新しい SDK を入れたら、そのパッケージ名を `server/eslint.config.js` の禁止に足す
- `provider/` には通信だけを書く（渡された文字列を送って、結果を返す）
- プロンプトの組み立てとモデルの出力の解釈は `service/` に書く

## Claude Agent SDK を呼ぶときに指定すること

- `tools` は `[]` にする
- `strictMcpConfig` は `true` にする
- `disallowedTools` は `['mcp__*']` にする
- `settingSources` は `[]` にする
- 文章を返すだけのときは、`maxTurns` を `1` にする
- 1 往復で終わらない実行（`error_max_turns`）は、失敗として扱う
- `persistSession` は `false` にする
- `env` は、`process.env` を土台に組み立てる
- **`env` に、端末の `ANTHROPIC_API_KEY` を渡さない**
- このアプリでキーを使うときは、専用の環境変数（`<アプリ名>_ANTHROPIC_API_KEY`。例 `MYAPP_ANTHROPIC_API_KEY`）を
  `config.ts` で読む
- `env` の `ANTHROPIC_API_KEY` には、専用の環境変数の値だけを入れる
- ただし、専用の環境変数が無いときは、手元の Claude Code のログインで動かしてよい
- 第三者に提供するサービスでは、専用のキーを設定する
- `abortController` で、上限時間を超えた生成を `abort()` する
- 上限時間（例 `GENERATION_TIMEOUT_MS`）は、環境変数で決める
- 上限時間を超えたら、502 を返す

## 運用で守ること

- **同時実行数に上限を置く**（例 `MAX_CONCURRENT_GENERATIONS`）。上限を超えたリクエストは 429 で断る
- **利用者ごとの頻度制限**を掛ける（例 1 分 5 回）
- **利用者の入力（説明文・生成物）をログに出さない。** ログに残すのは、モデル名・所要時間・費用・失敗の種類だけにする
- **SDK が返した失敗の中身を、利用者へのレスポンスに載せない。** `details` には理由の種類だけを入れる。中身はログに残す
- SDK が返した出力は、`service/` で解析・検証してから使う（HTML なら形式の検査、JSON ならスキーマの検証）

## テスト

- **SDK に渡した `options` が「Claude Agent SDK を呼ぶときに指定すること」のとおりかを検証する**テストを 1 本以上書く。
  このテストでは、SDK の `query()` を `vi.hoisted` + `vi.mock` で差し替えて、HTTP 経由で API を呼ぶ
- 専用のキーを設定した場合の `env` は、`config` を差し替える別ファイルのテストで確かめる
- 差し替えた SDK に形の崩れた出力を返させ、その出力を使わずに失敗（502）として扱うことを確かめるテストを置く

## 評価（実際にモデルを呼んで確かめる）

AI を呼ぶ機能ごとに、代表的な入力と正しい答えの条件を決めておく。実際のモデルで繰り返し流して判定する。

- 置き場所: 入力と条件は `server/evals/<機能>/cases.json` に置く。`server/package.json` に `eval`（例
  `tsx --env-file-if-exists=.env evals/run.ts`）を足し、`npm run eval -w server -- <機能>` で流す
- ケース: 代表的な入力を 3〜5 件。答えが入力に無いもの、または曖昧なものを 1 件は入れる（無い値を作らないかを見る）。
  利用者の実データは入れない
- 回数: 各ケース 3 回（例: 5 件 × 3 回 = 15 回呼ぶ）
- 呼び方: プロンプトの組み立て・`provider/` の呼び出し・出力の検証をまとめた `service/` の関数を直接呼ぶ。HTTP・認証・
  DB への保存は通さない
- 判定: コードで確かめられる条件を使う（値の一致、語を含む、出力の検証を通る、入力に無い値を作っていない）。
  読みやすさのように機械で決められない質だけ、別の呼び出しで 1〜5 の採点をさせ、合格とみなす点数の下限を決める。
  採点のプロンプトの組み立てと結果の解釈は `evals/` に置き、呼び出しは `provider/` を通す
- 合格の基準: 案件で決めて `docs/decisions/` に残す（例: 不合格は全体で 1 回まで。「入力に無い値を作っていない」
  条件は全回で合格）
- 回すとき: AI を呼ぶ機能を足したとき、プロンプト・モデル・出力の扱いを変えたとき。CI では回さない
- 記録: `docs/results/<機能>-eval.md` に、日付・コミット・モデル・ケースごとの合格数・基準と判定を書く。回し直したら
  同じファイルを書き換える。PR 本文の「確認した結果」に合否と記録のファイルを書く

`server/evals/` を初めて置くときは、次を確かめる。

- `server/tsconfig.check.json` の `include` に `evals/**/*.ts` があること。無ければ足す
- `server/eslint.config.js` の、SDK の import を止める設定の `files` に `evals/**/*.ts` があること。無ければ足す
- `server/eslint.config.js` の、開発用の依存を読んでよい範囲（`import-x/no-extraneous-dependencies` の `devDependencies`）に `evals/**` があること。無ければ足す
- 結果の表示は `process.stdout.write` で行う（検査: ESLint。`console` を止める）

## 記録

- SDK を採用した理由と、上の指定の根拠を `docs/decisions/` に残す

## 理由

この規約の理由は `.claude/rules-why/ai-integration.md` にあります。決まりに当てはまるかを迷ったときに読みます。
