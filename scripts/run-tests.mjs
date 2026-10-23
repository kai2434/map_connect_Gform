/**
 * テスト実行スクリプト（scripts/run-tests.mjs）
 *
 * 1. 最新コードでビルド（TypeScript型チェック＋dist出力）を実行
 * 2. Node.js標準テストランナー（node --test）で単体・結合テスト（tests/app.test.mjs）と
 *    実ブラウザE2Eテスト（tests/e2e-browser.test.mjs）を順次実行
 */

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from './build.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-form-test-build-'));
const { TEST_REGIONS } = await import('../tests/fixtures/regions.mjs');

runBuild({
  outDir: testBuildDir,
  regions: TEST_REGIONS,
  thumbnailDir: path.join(projectRoot, 'tests', 'fixtures', 'images'),
});

console.log('\n[test] 本番地域設定と分離したビルドで単体・統合・実ブラウザE2Eテストを実行しています...\n');
const testResult = spawnSync(
  process.execPath,
  [
    '--test',
    path.join(projectRoot, 'tests', 'build.test.mjs'),
    path.join(projectRoot, 'tests', 'app.test.mjs'),
    path.join(projectRoot, 'tests', 'e2e-browser.test.mjs'),
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      TEST_BUILD_DIR: testBuildDir,
    },
    stdio: 'inherit',
  }
);

process.exit(testResult.status ?? 1);
