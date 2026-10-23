/**
 * ローカル開発・プレビュー用HTTPサーバースクリプト（scripts/dev-server.mjs）
 *
 * `npm run dev` または `npm run preview` で起動し、`dist/` を配信します。
 * 開発モード時は `src/` および `index.html` の変更を監視して自動再ビルドを行います。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from './build.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const isPreviewOnly = process.argv.includes('--dist');
const requestedPort = Number(process.env.PORT || 5173);

if (!isPreviewOnly || !fs.existsSync(path.join(distDir, 'index.html'))) {
  runBuild();
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const cleanPathname = decodeURIComponent(rawUrl.split('?')[0] || '/');
  const relativePath = cleanPathname === '/' ? 'index.html' : cleanPathname.replace(/^\/+/, '');
  const filePath = path.resolve(distDir, relativePath);
  const relativeToDist = path.relative(distDir, filePath);

  // ディレクトリトラバーサル防止
  if (
    relativeToDist === '..' ||
    relativeToDist.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToDist)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(requestedPort, '127.0.0.1', () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  console.log(`\n============================================================`);
  console.log(`  地域別写真撮影地点投稿Webサイト ローカルサーバー起動完了`);
  console.log(`  URL: http://localhost:${actualPort}/`);
  console.log(`============================================================\n`);
});

if (!isPreviewOnly) {
  let rebuildTimeout = null;
  const triggerRebuild = (filename) => {
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(() => {
      console.log(`[dev] ファイル変更を検知 (${filename}) -> 再ビルドを実行します...`);
      try {
        runBuild();
      } catch (err) {
        console.error('[dev] 再ビルド中にエラーが発生しました:', err);
      }
    }, 200);
  };

  fs.watch(path.join(projectRoot, 'src'), { recursive: true }, (_eventType, filename) => {
    if (filename) {
      triggerRebuild(filename);
    }
  });
}
