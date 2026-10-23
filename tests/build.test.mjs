import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../scripts/build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('非破壊ビルド出力先', () => {
  it('既存ファイルがある明示出力先を変更せずに拒否する', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-form-build-safety-'));
    const outDir = path.join(tempRoot, 'existing-output');
    const markerPath = path.join(outDir, 'keep.txt');
    fs.mkdirSync(outDir);
    fs.writeFileSync(markerPath, 'preserve this output', 'utf8');

    assert.throws(
      () => runBuild({ outDir }),
      /既存ファイルがあるため中断/,
      '既存出力に対してビルドを開始しないこと'
    );
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'preserve this output');
    assert.deepEqual(fs.readdirSync(outDir), ['keep.txt']);
  });

  it('プロジェクトのソースディレクトリを出力先にできない', () => {
    assert.throws(
      () => runBuild({ outDir: path.join(projectRoot, 'src') }),
      /ソースを保護/,
      'src/ を出力先に指定した場合は書き込む前に拒否すること'
    );
  });

  it('配列でない地域fixtureと許可外の画像元をビルド前に拒否する', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-form-build-preflight-'));
    const invalidRegionsOut = path.join(tempRoot, 'invalid-regions');
    assert.throws(
      () => runBuild({ outDir: invalidRegionsOut, regions: {} }),
      /regions は配列/,
      '不正なfixtureは出力を作る前に拒否すること'
    );
    assert.equal(fs.existsSync(invalidRegionsOut), false);

    const invalidImagesOut = path.join(tempRoot, 'invalid-images');
    assert.throws(
      () => runBuild({ outDir: invalidImagesOut, thumbnailDir: path.join(projectRoot, 'src') }),
      /サムネイル元は/,
      '許可外の画像元は出力を作る前に拒否すること'
    );
    assert.equal(fs.existsSync(invalidImagesOut), false);
  });

  it('既存の親フォルダがsrc/へのシンボリックリンクでも保護する', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-form-build-link-'));
    const sourceLink = path.join(tempRoot, 'source-link');
    fs.symlinkSync(path.join(projectRoot, 'src'), sourceLink, process.platform === 'win32' ? 'junction' : 'dir');

    assert.throws(
      () => runBuild({ outDir: path.join(sourceLink, 'unsafe-output') }),
      /ソースを保護/,
      '親リンクの実体がsrc/なら出力前に拒否すること'
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'src', 'unsafe-output')), false);
  });
});
