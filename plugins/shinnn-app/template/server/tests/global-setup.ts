/**
 * @file テストの実行の最初に 1 回だけ行う準備（vitest の globalSetup）。
 *
 * マイグレーション済みの DB の中身を書き出し、各テストファイルの `createTestDb()` に読み込ませる
 * （`helpers/db-template.ts`）。
 */

import type { TestProject } from 'vitest/node';

/**
 * テスト用 DB の雛形を書き出す。
 *
 * @param project - vitest のプロジェクト
 */
export default async function setup(project: TestProject): Promise<void> {
  /*
   * globalSetup はテストの外（vitest の本体のプロセス）で動くので、vitest.config.ts の env が入らない。
   * src/config.ts は読み込み時に環境変数を検証するので、同じ値を入れてから読み込む。
   */
  for (const [key, value] of Object.entries(project.config.env)) {
    if (value !== undefined) {
      process.env[key] = String(value);
    }
  }
  const { writeTestDbTemplate } = await import('./helpers/db-template.js');
  try {
    await writeTestDbTemplate();
  } catch (error) {
    /*
     * 雛形を作れない（マイグレーションの SQL が壊れている、node_modules に書けない）ときも、テストは止めない。
     * createTestDb() が雛形を使わずに作るので、テストファイルごとに本当の原因のエラーで落ちる。
     */
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`テスト用 DB の雛形を作れなかったので、雛形を使わずに DB を作ります: ${reason}\n`);
  }
}
