/**
 * 静的サイトビルドスクリプト（scripts/build.mjs）
 *
 * TypeScript公式コンパイラ（tsc）による厳密な型チェックとトランスパイルを行い、
 * GitHub Pages等の静的ホスティングでそのまま動作する `dist/` ディレクトリを生成します。
 * Playwrightのブラウザ実行環境とは独立しており、ビルド自体に追加のネイティブツールは不要です。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const THUMBNAIL_EXTENSIONS = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp',
]);

/**
 * ディレクトリを再帰的にコピーする
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * `images/` 内の画像だけをコピーする。隠しファイルとシンボリックリンクは対象外。
 */
function copyThumbnailImages(src, dest) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(src);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`[build] 画像ルートは通常のディレクトリである必要があります: ${src}`);
  }

  function copyAllowedFiles(sourceDir, destDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const sourcePath = path.join(sourceDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`[build] 画像フォルダ内のシンボリックリンクはコピーできません: ${sourcePath}`);
      }
      if (entry.isDirectory()) {
        copyAllowedFiles(sourcePath, path.join(destDir, entry.name));
      } else if (entry.isFile() && THUMBNAIL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(sourcePath, path.join(destDir, entry.name));
      }
    }
  }

  copyAllowedFiles(src, dest);
}

function resolveThumbnailDirectory(thumbnailDir) {
  const allowedRoots = [
    path.join(projectRoot, 'images'),
    path.join(projectRoot, 'tests', 'fixtures', 'images'),
  ];
  const resolved = path.resolve(projectRoot, thumbnailDir);
  if (!allowedRoots.some((allowed) => path.resolve(allowed) === resolved)) {
    throw new Error('[build] サムネイル元は images/ または tests/fixtures/images/ に限定されています。');
  }
  return resolved;
}

function resolveOutputDirectory(outDir, { allowOutsideProject = false } = {}) {
  const resolved = path.resolve(projectRoot, outDir);
  const canonicalProjectRoot = fs.realpathSync(projectRoot);
  let existingParent = resolved;
  const missingSegments = [];
  while (true) {
    try {
      fs.lstatSync(existingParent);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existingParent);
      if (parent === existingParent) throw error;
      missingSegments.unshift(path.basename(existingParent));
      existingParent = parent;
    }
  }
  const canonicalOutput = path.resolve(fs.realpathSync(existingParent), ...missingSegments);
  const relative = path.relative(canonicalProjectRoot, canonicalOutput);
  const firstSegment = relative.split(path.sep)[0]?.toLowerCase();
  const protectedRoots = new Set(['src', 'scripts', 'tests', 'node_modules', 'docs', '.github', 'images']);
  const relativeFromOutputToProject = path.relative(canonicalOutput, canonicalProjectRoot);

  if (!relative) {
    throw new Error('[build] 出力先にプロジェクトルートそのものは指定できません。');
  }
  if (
    !allowOutsideProject &&
    (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  ) {
    throw new Error('[build] 内部の出力先はプロジェクト内に指定してください。');
  }
  if (
    relativeFromOutputToProject !== '' &&
    relativeFromOutputToProject !== '..' &&
    !relativeFromOutputToProject.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeFromOutputToProject)
  ) {
    throw new Error('[build] プロジェクトルートの親フォルダは出力先に指定できません。');
  }
  if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && protectedRoots.has(firstSegment)) {
    throw new Error(`[build] ソースを保護するため ${firstSegment}/ 配下は出力先にできません。`);
  }
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`[build] 出力先は通常のディレクトリである必要があります: ${resolved}`);
    }
    if (fs.readdirSync(resolved).length > 0) {
      throw new Error(
        `[build] 出力先に既存ファイルがあるため中断しました: ${resolved}\n` +
        '既存ファイルを保護するため削除・上書きしません。空の新しい出力先を --out-dir で指定してください。'
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return resolved;
}

function parseCliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('[build] --out-dir にはパスが必要です。');
      options.outDir = value;
      index += 1;
    } else if (argument.startsWith('--out-dir=')) {
      options.outDir = argument.slice('--out-dir='.length);
      if (!options.outDir) throw new Error('[build] --out-dir にはパスが必要です。');
    } else {
      throw new Error(`[build] 未知の引数です: ${argument}`);
    }
  }
  return options;
}

/**
 * ディレクトリ内の全 .js ファイルを再帰的に取得する
 */
function getAllJsFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') {
        getAllJsFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * ブラウザ標準のES Modulesとして直接実行できるよう import パスを解決する
 */
function rewriteEsModuleImports(jsFilePath, vendorLeafletEsmPath) {
  let code = fs.readFileSync(jsFilePath, 'utf8');
  const fileDir = path.dirname(jsFilePath);

  // 1. 'leaflet' のベアインポートを dist/vendor/leaflet/leaflet-src.esm.js への相対パスに変換
  let relativeLeafletPath = path.relative(fileDir, vendorLeafletEsmPath).replace(/\\/g, '/');
  if (!relativeLeafletPath.startsWith('.')) {
    relativeLeafletPath = `./${relativeLeafletPath}`;
  }
  code = code.replace(
    /from\s+['"]leaflet['"]/g,
    `from '${relativeLeafletPath}'`
  );

  // 2. 拡張子なしの相対インポート（from './xxx' または from '../xxx'）に .js を補完
  code = code.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (match, prefix, spec, suffix) => {
      if (spec.endsWith('.js') || spec.endsWith('.mjs') || spec.endsWith('.json')) {
        return match;
      }
      const resolvedAsIndex = path.resolve(fileDir, spec, 'index.js');
      if (fs.existsSync(resolvedAsIndex)) {
        return `${prefix}${spec}/index.js${suffix}`;
      }
      return `${prefix}${spec}.js${suffix}`;
    }
  );

  fs.writeFileSync(jsFilePath, code, 'utf8');
}

function createUniqueBuildId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${process.pid}-${randomBytes(3).toString('hex')}`;
}

function ensureBuildHistoryDirectory() {
  const historyDir = path.join(projectRoot, '.build-history');
  if (fs.existsSync(historyDir)) {
    const stat = fs.lstatSync(historyDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`[build] .build-history は通常のディレクトリである必要があります: ${historyDir}`);
    }
  } else {
    fs.mkdirSync(historyDir);
  }
  return historyDir;
}

function publishDefaultBuild(stageDir) {
  const historyDir = ensureBuildHistoryDirectory();
  const stageRelative = path.relative(projectRoot, stageDir);
  if (!stageRelative || stageRelative.startsWith(`..${path.sep}`) || path.isAbsolute(stageRelative)) {
    throw new Error('[build] ステージ出力先がプロジェクト内ではありません。');
  }

  let backupDir = null;
  if (fs.existsSync(distDir)) {
    const stat = fs.lstatSync(distDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`[build] dist は通常のディレクトリである必要があります: ${distDir}`);
    }
    backupDir = path.join(historyDir, `dist-${createUniqueBuildId()}`);
    fs.renameSync(distDir, backupDir);
  }

  try {
    fs.renameSync(stageDir, distDir);
  } catch (error) {
    if (backupDir && !fs.existsSync(distDir)) {
      try {
        fs.renameSync(backupDir, distDir);
      } catch (restoreError) {
        throw new Error(
          `[build] dist の切替に失敗し、旧 dist の復元にも失敗しました。旧成果物は ${backupDir} に保持されています。`,
          { cause: restoreError }
        );
      }
    }
    throw error;
  }

  console.log(backupDir
    ? `[build] 旧 dist を保存しました: ${backupDir}`
    : '[build] 新しい dist を作成しました。');
}

function buildIntoDirectory(outputDir, { regions, thumbnailDir } = {}) {
  console.log(`[build] 1/4 空の出力先を準備しています: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('[build] 2/4 TypeScriptの型チェックとコンパイルを実行しています...');
  const tscBin = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const tscResult = spawnSync(
    process.execPath,
    [
      tscBin,
      '--project',
      path.join(projectRoot, 'tsconfig.json'),
      '--noEmit',
      'false',
      '--outDir',
      outputDir,
      '--rootDir',
      path.join(projectRoot, 'src'),
      '--sourceMap',
      'true',
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );

  if (tscResult.status !== 0) {
    console.error('[build] TypeScriptのコンパイルエラーが発生しました。');
    throw new Error(`[build] TypeScript compiler exited with status ${tscResult.status ?? 1}`);
  }

  console.log('[build] 3/4 HTML・CSS・Leaflet・地域サムネイルをコピーしています...');
  fs.copyFileSync(path.join(projectRoot, 'index.html'), path.join(outputDir, 'index.html'));
  if (fs.existsSync(path.join(projectRoot, 'viewer.html'))) {
    fs.copyFileSync(path.join(projectRoot, 'viewer.html'), path.join(outputDir, 'viewer.html'));
  }
  copyDirSync(path.join(projectRoot, 'src', 'styles'), path.join(outputDir, 'styles'));

  // 地域設定で利用する公開画像だけを images/ からコピーする。
  const imageRoot = resolveThumbnailDirectory(thumbnailDir ?? path.join(projectRoot, 'images'));
  copyThumbnailImages(imageRoot, path.join(outputDir, 'images'));

  const leafletDistSrc = path.join(projectRoot, 'node_modules', 'leaflet', 'dist');
  const leafletDistDest = path.join(outputDir, 'vendor', 'leaflet');
  fs.mkdirSync(leafletDistDest, { recursive: true });
  fs.copyFileSync(
    path.join(leafletDistSrc, 'leaflet.css'),
    path.join(leafletDistDest, 'leaflet.css')
  );
  fs.copyFileSync(
    path.join(leafletDistSrc, 'leaflet-src.esm.js'),
    path.join(leafletDistDest, 'leaflet-src.esm.js')
  );
  if (fs.existsSync(path.join(leafletDistSrc, 'images'))) {
    copyDirSync(
      path.join(leafletDistSrc, 'images'),
      path.join(leafletDistDest, 'images')
    );
  }

  // GitHub Pages で Jekyll 処理を無効化する .nojekyll ファイルを生成
  fs.writeFileSync(path.join(outputDir, '.nojekyll'), '', 'utf8');

  // テスト専用 fixture は出力物へだけ適用し、本番ソースの設定や起動コードは変えない。
  if (regions !== undefined) {
    if (!Array.isArray(regions)) throw new TypeError('[build] regions は配列で指定してください。');
    fs.writeFileSync(
      path.join(outputDir, 'config', 'regions.js'),
      `export const REGIONS = ${JSON.stringify(regions)};\n`,
      'utf8'
    );
  }

  console.log('[build] 4/4 ES Modulesのインポートパスを最適化しています...');
  const vendorLeafletEsm = path.join(leafletDistDest, 'leaflet-src.esm.js');
  const jsFiles = getAllJsFiles(outputDir);
  for (const jsFile of jsFiles) {
    rewriteEsModuleImports(jsFile, vendorLeafletEsm);
  }

  console.log(`[build] 完了: ${outputDir} に静的サイト一式を生成しました（JSモジュール数: ${jsFiles.length}）。`);
}

export function runBuild(options = {}) {
  if (options.regions !== undefined && !Array.isArray(options.regions)) {
    throw new TypeError('[build] regions は配列で指定してください。');
  }
  if (options.thumbnailDir !== undefined) {
    resolveThumbnailDirectory(options.thumbnailDir);
  }
  const hasExplicitOutDir = Object.hasOwn(options, 'outDir');
  if (hasExplicitOutDir) {
    const outputDir = resolveOutputDirectory(options.outDir, { allowOutsideProject: true });
    buildIntoDirectory(outputDir, options);
    return outputDir;
  }

  const historyDir = ensureBuildHistoryDirectory();
  const stageDir = path.join(historyDir, `.stage-dist-${createUniqueBuildId()}`);
  const resolvedStageDir = resolveOutputDirectory(stageDir);
  buildIntoDirectory(resolvedStageDir, options);
  publishDefaultBuild(resolvedStageDir);
  return distDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    runBuild(parseCliOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
