/**
 * PreToolUse（Bash）ガード。
 * settings.json の deny では表現しきれない危険なコマンドを止める。
 * 「取り返しがつかない」「品質ゲートを迂回する」の 2 つだけを対象にし、開発の邪魔をしない。
 *
 * 判定の前に heredoc の本文（コミットメッセージや Issue 本文）を取り除く。本文はコマンドではないので、
 * その中の語（`process.env` や `cat` など）には反応しない。ただし heredoc をシェルや node に流し込む
 * 場合は本文がそのまま実行されるので、取り除かずに判定する。
 */
import { blockMessage, projectDir, readHookInput } from './lib/hook-io.mjs';

/**
 * 認証情報のファイル（.env と .env.local など）をパスの語としてだけ一致させる。
 * `process.env` のような語の途中や、値を持たない見本 `.env.example` には一致しない。
 */
const ENV_FILE = String.raw`(?<![\w.-])\.env(?!\.example\b)\b`;

/** Edit / Write のガードが守るファイル。シェル経由の書き換えもここで止める */
const PROTECTED_PATH = String.raw`(?:${ENV_FILE}|\.github\/workflows|\.claude\/|\.shinnn|package-lock\.json|CODEOWNERS|server\/drizzle|docs\/progress\.md)`;

// ファイルを書き換える呼び出し。node の -e / -p の中身に対して見る
const WRITE_CALL =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync|truncate|truncateSync|unlink|unlinkSync|rm|rmSync|mkdir|mkdirSync)\b|>/;

/** 標準入力に渡した本文を、そのままプログラムとして実行するコマンド */
const STDIN_RUNNER = String.raw`(?:bash|sh|zsh|dash|python3?|pwsh|powershell|node)`;

/**
 * heredoc の流し込み先が、本文をそのまま実行するプログラムか。
 * `bash -s <<EOF` や `node - <<EOF` のように、コマンド名のあとにフラグが付く形まで見る。
 */
const EXECUTES_STDIN = new RegExp(String.raw`(?:^|[\s;&|(])(?:${STDIN_RUNNER}(?:\s+-\S*)*|eval|source)\s*$`);

/**
 * `sh -c "$(cat <<EOF` や `eval "$(cat <<EOF` のように、heredoc の本文をコマンド文字列として渡す形か。
 * `git commit -m "$(cat <<EOF` はデータの受け渡しなので、`-c` か `eval` があるときだけ実行扱いにする。
 */
const EXECUTES_COMMAND_STRING = new RegExp(
  String.raw`(?:${STDIN_RUNNER}\s+(?:-\S+\s+)*-c|eval)\b[^;&|]*\$\(\s*cat\b[^\n]*$`,
);

/** 流し込み先を探すために遡る文字数 */
const LOOKBEHIND_LENGTH = 80;

/**
 * heredoc の本文を印に置き換える。
 * 本文は実行されないデータ（コミットメッセージ・Issue 本文など）なので判定から外す。
 * 流し込み先がシェルや node のときは本文が実行されるので、そのまま残す。
 */
function stripHeredocs(command) {
  return command.replace(
    /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=[ \t]*(?:\n|$))/g,
    (whole, _quote, terminator, offset, source) => {
      const before = source.slice(Math.max(0, offset - LOOKBEHIND_LENGTH), offset);
      if (EXECUTES_STDIN.test(before) || EXECUTES_COMMAND_STRING.test(before)) {
        return whole;
      }
      return `<<${terminator} [heredoc] ${terminator}`;
    },
  );
}

const RULES = [
  {
    test: /\bgit\s+push\b[^|;&]*\s(--force\b|-f\b|--force-with-lease\b)/,
    what: 'force push',
    why: '他の人が push した履歴を消してしまう。PR のレビュー履歴も追えなくなる',
    how: 'リモートと食い違ったら git fetch してから普通に push し直す。履歴を書き換えたい場合は人に相談する',
  },
  {
    test: /\bgit\s+reset\s+--hard\b/,
    what: 'git reset --hard',
    why: 'コミットしていない変更が復元できない形で消える',
    how: '戻したいファイルだけ git restore <path> を使う。全部戻したいなら先に git stash で退避する',
  },
  {
    test: /\bgit\s+clean\b/,
    what: 'git clean',
    why: '追跡されていないファイル（作りかけの実装・ローカル設定）がまとめて消える',
    how: '消したいファイルを個別に削除する',
  },
  {
    test: /\bgit\s+commit\b[^|;&]*(--no-verify\b|\s-n\b)|\bgit\s+merge\b[^|;&]*--no-verify\b/,
    what: 'pre-commit フックの迂回',
    why: 'lint とフォーマットを通していないコードがそのまま履歴に入る',
    how: 'エラーの内容を読んで直してからコミットする。直せない理由があるなら人に相談する',
  },
  {
    test: /\bgit\s+checkout\s+\.(\s|$)|\bgit\s+restore\s+\.(\s|$)/,
    what: '作業ツリー全体の破棄',
    why: '関係ない変更まで巻き込んで消える',
    how: '対象のファイルを明示して git restore <path> を実行する',
  },
  {
    test: /\brm\b(?=[^|;&]*(\s-[a-zA-Z]*r|\s--recursive\b))(?=[^|;&]*(\s-[a-zA-Z]*f|\s--force\b))/,
    what: 'rm の再帰・強制削除',
    why: '対象を間違えたときに取り返しがつかない',
    how: '消すファイル・ディレクトリを 1 つずつ指定する。ビルド生成物なら npm のクリーン用スクリプトを使う',
  },
  {
    test: /\bsudo\b|\bdoas\b/,
    what: '管理者権限での実行',
    why: '開発に管理者権限は要らない。要るように見えるときは手順が間違っている',
    how: '何をしたいのかを人に伝える。ミドルウェアの導入が必要なら /shinnn-app:setup が案内する',
  },
  {
    test: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*\|\s*(ba)?sh\b/,
    what: 'ダウンロードしたスクリプトの直接実行',
    why: '中身を読まずに任意のコードを実行することになる',
    how: 'いったんファイルに保存して内容を確認してから実行する',
  },
  {
    test: /\bdrizzle-kit\s+push\b/,
    what: 'drizzle-kit push',
    why: 'マイグレーションファイルを残さずに DB を直接変えるため、他の環境で同じ状態を再現できない',
    how: '/shinnn-app:db-migrate（drizzle-kit generate → 確認 → migrate）を使う',
  },
  {
    test: /\b(pnpm|yarn|bun)\s+(install|add|i)\b/,
    what: 'npm 以外のパッケージマネージャ',
    why: 'lock ファイルが二重になり、CI と手元で入る依存が変わる',
    how: 'npm install を使う（パッケージを足すときは npm install <名前> -w <パッケージ>）',
  },
  {
    test: new RegExp(String.raw`\b(cat|head|tail|less|more|strings|grep|type|Get-Content)\b[^|;&]*${ENV_FILE}`),
    what: '.env を読み出すコマンド',
    why: '認証情報を含むファイルは Claude が読み書きしない取り決め。読むだけでも値が会話に残る',
    how: '値は人が入れる。キーの一覧は docs/env.md にある（見本は server/.env.example）',
  },
  {
    // -e / -p の中身に、書き換えの呼び出しと保護ファイルの両方があるときだけ止める（値を表示するだけの -e は通す）
    test: (command) => {
      const match = /\bnode\b[^|;&]*?\s(?:-e|--eval|-p|--print)\b([\s\S]*)/.exec(command);
      return match !== null && WRITE_CALL.test(match[1]) && new RegExp(PROTECTED_PATH).test(match[1]);
    },
    what: 'node -e による保護ファイルの書き換え',
    why: 'Edit / Write のガードを迂回して標準を変えてしまう。スクリプト経由なら中身が残るが、-e は残らない',
    how: '/shinnn-app:setup か /shinnn-app:sync-standards で変更する（適用スクリプトが差分を残す）',
  },
  {
    test: new RegExp(
      String.raw`\b(sed\s+-i|tee|npx)\b[^|;&]*(?:${ENV_FILE}|\.github\/workflows|\.claude\/rules|\.shinnn|package-lock\.json|CODEOWNERS|server\/drizzle|docs\/progress\.md)`,
    ),
    what: 'シェル経由での保護ファイルの書き換え',
    why: 'Edit / Write のガードを迂回して標準を変えてしまう',
    how: '/shinnn-app:setup か /shinnn-app:sync-standards で変更する',
  },
  {
    // `=>`（矢印関数）や `->` の `>` はリダイレクトではないので除く
    test: new RegExp(
      String.raw`(?<![=<-])>\s*[^\s;|&]*(?:${ENV_FILE}|\.github\/workflows\/|\.claude\/settings\.json|\.claude\/rules\/|\.shinnn\/|package-lock\.json|CODEOWNERS|docs\/progress\.md)`,
    ),
    what: 'リダイレクトによる保護ファイルの上書き',
    why: 'Edit / Write のガードを迂回して標準を変えてしまう',
    how: '/shinnn-app:setup か /shinnn-app:sync-standards で変更する',
  },
];

const input = await readHookInput();
if ((input.tool_name || '') !== 'Bash') {
  process.exit(0);
}

// 参照するだけで未使用にならないよう、ルート解決の副作用（環境変数の既定値）をここで確定させる
projectDir(input);

const original = input.tool_input?.command || '';
const command = stripHeredocs(original);
const hit = RULES.find((rule) => (typeof rule.test === 'function' ? rule.test(command) : rule.test.test(command)));
if (!hit) {
  process.exit(0);
}

console.error(
  blockMessage({
    what: `${hit.what} を実行しようとしました（${original.trim().slice(0, 200)}）`,
    why: hit.why,
    how: hit.how,
    rule: '.claude/settings.json の deny と .claude/rules/git-workflow.md',
  }),
);
process.exit(2);
