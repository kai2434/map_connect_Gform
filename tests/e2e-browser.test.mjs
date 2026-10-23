/**
 * 実ブラウザ（Google Chrome + Playwright）によるE2E動作検証テストスイート
 * （tests/e2e-browser.test.mjs）
 *
 * 検証項目：
 * 1. ビルド構成・ES Modules配信・Leaflet CSS/JS適用・GitHub Pagesサブパス（/subpath-repo/）動作検証
 * 2. 地域選択画面から地図画面への遷移・地理院タイルの実読み込み・出典常時表示
 * 3. 地図の拡大・縮小・移動（ズームボタン・ドラッグパン）
 * 4. ピンの設置・再配置・ドラッグ移動・募集範囲外へのピン設置防止（クリック＆ドラッグスナップバック）
 * 5. 5段階スライダーと円形範囲（L.circleによる実距離半径）の連動・画面上の円サイズ比較
 * 6. 地域のみ（レベル0）の投稿とレベル復帰時のピン位置復元
 * 7. モバイル画面（390x844・タッチ操作有効）でのレスポンシブ表示とタッチ操作
 * 8. Googleフォーム連携URLの実ブラウザ生成検証（地域ID、緯度経度6桁、半径0m、50m/150m/500m、地域のみの省略、未設定時のブロック）
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { TEST_REGIONS, pointInTestRegion } from './fixtures/regions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(process.env.TEST_BUILD_DIR ?? path.join(projectRoot, 'dist'));
const TEST_REGION = TEST_REGIONS[0];
const TILE_URL_PATTERN = 'https://cyberjapandata.gsi.go.jp/xyz/pale/**';

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
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function resolveChromeExecutable() {
  const candidates = [];
  if (process.env.CHROME_PATH?.trim()) candidates.push(process.env.CHROME_PATH.trim());

  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (root) candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    if (process.env.HOME) {
      candidates.push(path.join(process.env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
    }
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      if (directory) {
        candidates.push(...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map((name) => path.join(directory, name)));
      }
    }
  }

  try {
    candidates.push(chromium.executablePath());
  } catch {
    // playwright-core はブラウザを同梱しないため、候補がなければ下で案内する。
  }

  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      'Chrome が見つかりません。Chrome をインストールするか、環境変数 CHROME_PATH に実行ファイルのパスを指定してください。'
    );
  }
  return executable;
}

/**
 * テスト用の1x1透過PNGバイナリ（オフライン環境でもタイルリクエストの挙動を検証可能にしつつ、
 * 地理院タイルURLへのリクエスト発生自体もキャプチャする）
 */
const DUMMY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * ルート（/）およびGitHub Pages想定のサブディレクトリ（/repo-subpath/）の
 * 両方で dist/ を配信するテスト用HTTPサーバーを起動する
 */
function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rawUrl = req.url || '/';
      let cleanPathname = decodeURIComponent(rawUrl.split('?')[0] || '/');

      // GitHub Pagesのサブディレクトリ配信（/repo-subpath/...）をシミュレート
      if (cleanPathname === '/repo-subpath') {
        res.writeHead(301, { Location: '/repo-subpath/' });
        res.end();
        return;
      }
      if (cleanPathname.startsWith('/repo-subpath/')) {
        cleanPathname = cleanPathname.slice('/repo-subpath'.length);
      }

      const relativePath =
        cleanPathname === '/' ? 'index.html' : cleanPathname.replace(/^\/+/, '');
      const filePath = path.resolve(distDir, relativePath);
      const relativeToDist = path.relative(distDir, filePath);

      if (
        relativeToDist === '..' ||
        relativeToDist.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToDist) ||
        !fs.existsSync(filePath) ||
        fs.statSync(filePath).isDirectory()
      ) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

describe('実ブラウザ（Google Chrome + Playwright）によるE2E総合検証', () => {
  let server;
  let baseUrl;
  let subpathUrl;
  let browser;

  before(async () => {
    const srv = await startTestServer();
    server = srv.server;
    baseUrl = `http://127.0.0.1:${srv.port}/`;
    subpathUrl = `http://127.0.0.1:${srv.port}/repo-subpath/`;

    browser = await chromium.launch({
      executablePath: resolveChromeExecutable(),
      headless: true,
    });
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      server.close();
    }
  });

  it('1. [ビルド構成・GitHub Pagesサブパス確認] distに必要なファイルがすべて出力され、ルートおよびサブディレクトリ（/repo-subpath/）の両方でコンソールエラー・404なしに動作する', async () => {
    // distディレクトリの必須ファイル存在確認
    const requiredDistFiles = [
      'index.html',
      '.nojekyll',
      'main.js',
      'app.js',
      'styles/main.css',
      'vendor/leaflet/leaflet.css',
      'vendor/leaflet/leaflet-src.esm.js',
      'images/test-thumbnail.svg',
      'config/regions.js',
      'config/accuracyLevels.js',
      'config/googleForm.js',
      'domain/regionValidator.js',
      'domain/accuracyManager.js',
      'domain/submissionState.js',
      'domain/googleFormUrlBuilder.js',
      'map/mapController.js',
      'ui/regionSelectView.js',
      'ui/mapView.js',
      'ui/confirmModal.js',
    ];
    for (const rel of requiredDistFiles) {
      assert.equal(
        fs.existsSync(path.join(distDir, rel)),
        true,
        `dist/${rel} が存在すること`
      );
    }

    // サブパス環境（/repo-subpath/）での実ブラウザ読み込み検証
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedResponses = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
    page.on('response', (res) => {
      if (res.url().startsWith('http://127.0.0.1') && res.status() >= 400) {
        failedResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.route(TILE_URL_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: DUMMY_PNG_BUFFER,
      });
    });

    await page.goto(subpathUrl, { waitUntil: 'networkidle' });

    // テスト専用fixtureの件数と地域データが表示されること
    const cardCount = await page.locator('.region-card').count();
    assert.equal(cardCount, TEST_REGIONS.length, 'fixtureの全地域カードが表示されること');
    const thumbnail = page.locator(`[data-region-id="${TEST_REGION.id}"] img.region-card__thumb`);
    await thumbnail.evaluate((image) => image.decode());
    assert.ok(await thumbnail.evaluate((image) => image.naturalWidth > 0), 'ローカルサムネイルがサブパス配下で読み込めること');

    // カードをクリックして地図画面へ遷移し、LeafletのCSSが正しく適用されているか確認
    await page.locator('.region-card__btn').first().click();
    await page.waitForSelector('.leaflet-container');

    const mapContainerComputed = await page.evaluate(() => {
      const el = document.querySelector('#map-canvas');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        overflow: style.overflow,
        width: el.clientWidth,
        height: el.clientHeight,
      };
    });

    assert.ok(mapContainerComputed, '地図コンテナが存在すること');
    assert.equal(mapContainerComputed.position, 'relative', 'Leaflet CSSのposition: relativeが適用されていること');
    assert.equal(mapContainerComputed.overflow, 'hidden', 'Leaflet CSSのoverflow: hiddenが適用されていること');
    assert.ok(mapContainerComputed.width > 500 && mapContainerComputed.height > 300, '地図コンテナが十分なサイズで描画されていること');

    assert.deepEqual(consoleErrors, [], 'コンソールエラーが0件であること');
    assert.deepEqual(failedResponses, [], 'ローカル配信アセットの404エラーが0件であること');

    await context.close();
  });

  it('2. [地図操作・地理院タイル・ピン設置・ドラッグ・範囲外防止・5段階スライダー連動] PCブラウザ画面での実操作検証', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();

    // 地理院タイルへのリクエストURLを記録しつつ、高速・確実な検証のため実ネットワークまたはPNG応答を返す
    const gsiTileRequests = [];
    await page.route(TILE_URL_PATTERN, async (route) => {
      gsiTileRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: DUMMY_PNG_BUFFER,
      });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // (1) 地域選択画面からfixtureの地域を選択して地図画面へ遷移
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');

    // (2) 地理院タイルが要求・描画され、出典表記「地理院タイル」が常時表示されていることを確認
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 0);
    assert.ok(gsiTileRequests.length > 0, '国土地理院の淡色地図タイル（cyberjapandata.gsi.go.jp/xyz/pale/）へのリクエストが行われていること');

    const attributionText = await page.locator('.leaflet-control-attribution').innerText();
    assert.ok(attributionText.includes('地理院タイル'), '地図上に出典「地理院タイル」が常時表示されていること');

    // (3) 地図の拡大・縮小・移動（ズームボタンの実クリックとドラッグパン）
    const initialZoom = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getZoom());
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction((z) => window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getZoom() === z + 1, initialZoom);
    const zoomedIn = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getZoom());
    assert.equal(zoomedIn, initialZoom + 1, 'ズームインボタンで地図が拡大されること');

    // Leafletのズームアニメーション完了後にズームアウトボタンをクリック
    await page.waitForTimeout(350);
    await page.locator('.leaflet-control-zoom-out').click();
    await page.waitForFunction((z) => window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getZoom() === z, initialZoom);
    const zoomedOut = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getZoom());
    assert.equal(zoomedOut, initialZoom, 'ズームアウトボタンで地図が縮小されること');

    // ズームアウトのCSSトランジション（250ms）完了を待ってからドラッグ移動（パン操作）を検証
    await page.waitForTimeout(350);
    const centerBeforePan = await page.evaluate(() => {
      const c = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    const mapBoxForPan = await page.locator('#map-canvas').boundingBox();
    await page.mouse.move(mapBoxForPan.x + mapBoxForPan.width / 2, mapBoxForPan.y + mapBoxForPan.height / 2);
    await page.mouse.down();
    await page.mouse.move(mapBoxForPan.x + mapBoxForPan.width / 2 + 120, mapBoxForPan.y + mapBoxForPan.height / 2 + 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const centerAfterPan = await page.evaluate(() => {
      const c = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    assert.notDeepEqual(centerAfterPan, centerBeforePan, '地図のドラッグ操作で表示位置を移動（パン）できること');

    // 「範囲全体を表示」ボタンで初期範囲にフィットさせる
    await page.locator('.map-topbar__fit').click();
    await page.waitForTimeout(350);

    // (4) 募集範囲外へのピン設置防止（募集対象矩形の外側の画面座標を計算して実クリック）
    const pointInside = pointInTestRegion(TEST_REGION, 0.45, 0.45);
    const pointInsideAgain = pointInTestRegion(TEST_REGION, 0.7, 0.7);
    const pointOutside = {
      lat: pointInside.lat,
      lng: TEST_REGION.bounds.southWest.lng - 0.005,
    };
    const clickCoordinates = await page.evaluate(({ pointInside, pointInsideAgain, pointOutside }) => {
      const map = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance();
      const mapEl = document.getElementById('map-canvas');
      const rect = mapEl.getBoundingClientRect();

      const insidePt = map.latLngToContainerPoint([pointInside.lat, pointInside.lng]);
      const secondInsidePt = map.latLngToContainerPoint([pointInsideAgain.lat, pointInsideAgain.lng]);
      const outsidePt = map.latLngToContainerPoint([pointOutside.lat, pointOutside.lng]);

      return {
        inside: { x: rect.left + insidePt.x, y: rect.top + insidePt.y },
        secondInside: { x: rect.left + secondInsidePt.x, y: rect.top + secondInsidePt.y },
        outside: { x: rect.left + outsidePt.x, y: rect.top + outsidePt.y },
      };
    }, { pointInside, pointInsideAgain, pointOutside });

    // 範囲外を実際にマウスクリック
    await page.mouse.click(clickCoordinates.outside.x, clickCoordinates.outside.y);
    const pinCountAfterOutsideClick = await page.locator('.custom-map-pin').count();
    assert.equal(pinCountAfterOutsideClick, 0, '募集範囲外をクリックしてもピンが設置されないこと');

    const toastVisible = await page.locator('.map-toast').isVisible();
    const toastText = await page.locator('.map-toast').innerText();
    assert.equal(toastVisible, true, '範囲外クリック時に警告トーストが表示されること');
    assert.ok(toastText.includes('募集対象範囲外'), '範囲外である旨の日本語メッセージが表示されること');

    // (5) 募集範囲内の実クリックによるピン設置
    const submitBtn = page.locator('[data-testid="submit-photo-btn"]');
    assert.equal(await submitBtn.isDisabled(), true, 'ピン設置前は投稿ボタンが無効であること');

    await page.mouse.click(clickCoordinates.inside.x, clickCoordinates.inside.y);
    await page.waitForSelector('.custom-map-pin', { state: 'visible' });
    assert.equal(await submitBtn.isDisabled(), false, '範囲内にピンを設置すると投稿ボタンが有効になること');

    // マウスクリックでのピン設置時は中央照準および確定ボタンが非表示（opacity: 0）のまま維持されること
    const clickReticleOpacity = await page.locator('.map-center-reticle').evaluate((el) => getComputedStyle(el).opacity);
    const clickCenterBtnOpacity = await page.locator('[data-testid="select-map-center-btn"]').evaluate((el) => getComputedStyle(el).opacity);
    assert.equal(clickReticleOpacity, '0', 'マウスクリックでのピン設置時は中央照準が非表示（opacity: 0）であること');
    assert.equal(clickCenterBtnOpacity, '0', 'マウスクリックでのピン設置時は確定ボタンが非表示（opacity: 0）であること');

    const firstPinPos = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getStore().getSnapshot().effectivePinPosition);
    assert.ok(firstPinPos && Math.abs(firstPinPos.lat - pointInside.lat) < 0.001, 'クリックした地点の緯度経度が取得されていること');

    // (6) 別地点クリックによるピンの移動
    await page.mouse.click(clickCoordinates.secondInside.x, clickCoordinates.secondInside.y);
    const secondPinPos = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getStore().getSnapshot().effectivePinPosition);
    assert.notDeepEqual(secondPinPos, firstPinPos, '別地点のクリックでピン位置が移動すること');

    // (7) ピンの実マウスドラッグによる位置変更＆範囲外ドラッグ時のスナップバック検証
    const pinBox = await page.locator('.custom-map-pin').boundingBox();
    assert.ok(pinBox, 'ピンのバウンディングボックスが取得できること');
    const pinCenterX = pinBox.x + pinBox.width / 2;
    const pinCenterY = pinBox.y + pinBox.height / 2;

    // 範囲内の別位置へマウスドラッグ
    await page.mouse.move(pinCenterX, pinCenterY);
    await page.mouse.down();
    await page.mouse.move(clickCoordinates.inside.x, clickCoordinates.inside.y, { steps: 8 });
    await page.mouse.up();

    const draggedPinPos = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getStore().getSnapshot().effectivePinPosition);
    assert.ok(
      Math.abs(draggedPinPos.lat - pointInside.lat) < 0.0015,
      '実マウスドラッグによってピンの座標が更新されること'
    );

    // 範囲外へマウスドラッグしてドロップ -> 元の位置（draggedPinPos）にスナップバックされること
    const updatedPinBox = await page.locator('.custom-map-pin').boundingBox();
    await page.mouse.move(updatedPinBox.x + updatedPinBox.width / 2, updatedPinBox.y + updatedPinBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(clickCoordinates.outside.x, clickCoordinates.outside.y, { steps: 8 });
    await page.mouse.up();

    const afterInvalidDragPos = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getStore().getSnapshot().effectivePinPosition);
    assert.deepEqual(
      afterInvalidDragPos,
      draggedPinPos,
      '範囲外へドラッグ＆ドロップした場合は元の有効な座標へ戻されること'
    );

    // (8) 5段階スライダーと円形範囲（L.circle）の連動検証
    // 初期状態（レベル1：正確な地点）ではピンのみで円は描画されていない（.leaflet-overlay-pane には募集範囲の矩形1つのみ）
    const pathCountLv1 = await page.locator('.leaflet-overlay-pane svg path').count();
    assert.equal(pathCountLv1, 1, 'レベル1では募集範囲の四角形のみで、精度円は描画されないこと');

    // レベル2（50m）を選択
    await page.locator('.slider-tick-btn[data-level="2"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane svg path').length === 2);
    const circleBoxLv2 = await page.locator('.leaflet-overlay-pane svg path').nth(1).boundingBox();

    // レベル3（150m）を選択 -> 円が拡大すること
    await page.locator('.slider-tick-btn[data-level="3"]').click();
    const circleBoxLv3 = await page.locator('.leaflet-overlay-pane svg path').nth(1).boundingBox();

    // レベル4（500m）を選択 -> さらに円が拡大すること
    await page.locator('.slider-tick-btn[data-level="4"]').click();
    const circleBoxLv4 = await page.locator('.leaflet-overlay-pane svg path').nth(1).boundingBox();

    assert.ok(circleBoxLv2 && circleBoxLv3 && circleBoxLv4, 'レベル2〜4で円がDOM上に描画されること');
    assert.ok(
      circleBoxLv2.width < circleBoxLv3.width && circleBoxLv3.width < circleBoxLv4.width,
      `実距離半径に応じて画面上の円のサイズが大きくなること (50m=${circleBoxLv2.width.toFixed(1)}px < 150m=${circleBoxLv3.width.toFixed(1)}px < 500m=${circleBoxLv4.width.toFixed(1)}px)`
    );

    // (9) レベル0（地域のみ）への変更と位置復元検証
    await page.locator('.slider-tick-btn[data-level="0"]').click();
    assert.equal(await page.locator('.custom-map-pin').count(), 0, 'レベル0ではピンが非表示になること');
    assert.equal(await page.locator('.leaflet-overlay-pane svg path').count(), 1, 'レベル0では円が非表示になること');
    assert.equal(await submitBtn.isDisabled(), false, 'レベル0では投稿ボタンが有効であること');

    // レベル0からレベル2へ戻すと、以前のピン位置と円が復元されること
    await page.locator('.slider-tick-btn[data-level="2"]').click();
    assert.equal(await page.locator('.custom-map-pin').count(), 1, 'レベル0から戻すとピンが復元されること');
    assert.equal(await page.locator('.leaflet-overlay-pane svg path').count(), 2, 'レベル0からレベル2へ戻すと円も復元されること');

    await context.close();
  });

  it('3. [複数スマートフォン画面での実動作] 320x568・360x640・390x844・横向きで、ピン設置後に全精度段階から投稿へ進める', async () => {
    const viewports = [
      { width: 320, height: 568, label: '320x568' },
      { width: 360, height: 640, label: '360x640' },
      { width: 390, height: 844, label: '390x844' },
      { width: 844, height: 390, label: '横向き844x390' },
    ];

    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      const page = await context.newPage();
      await page.route(TILE_URL_PATTERN, async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG_BUFFER });
      });

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.equal(hasHorizontalOverflow, false, `${viewport.label}: 不要な横スクロールがないこと`);

      await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).tap();
      await page.waitForSelector('#map-canvas.leaflet-container');
      const mapStageBox = await page.locator('.map-stage').boundingBox();
      assert.ok(mapStageBox && mapStageBox.height > 100, `${viewport.label}: 地図に操作できる高さがあること`);

      await page.touchscreen.tap(
        mapStageBox.x + mapStageBox.width / 2,
        mapStageBox.y + mapStageBox.height / 2
      );
      await page.waitForSelector('.custom-map-pin', { state: 'visible' });

      // タッチ操作時も中央照準および確定ボタンが非表示（opacity: 0）のまま維持されること
      const touchReticleOpacity = await page.locator('.map-center-reticle').evaluate((el) => getComputedStyle(el).opacity);
      const touchCenterBtnOpacity = await page.locator('[data-testid="select-map-center-btn"]').evaluate((el) => getComputedStyle(el).opacity);
      assert.equal(touchReticleOpacity, '0', `${viewport.label}: タッチ操作時は中央照準が非表示（opacity: 0）であること`);
      assert.equal(touchCenterBtnOpacity, '0', `${viewport.label}: タッチ操作時は確定ボタンが非表示（opacity: 0）であること`);

      for (const level of [0, 1, 2, 3, 4]) {
        await page.locator(`.slider-tick-btn[data-level="${level}"]`).tap();
        await page.locator('[data-testid="submission-guide-message"]').evaluate((guide) => {
          guide.textContent +=
            ' 長い案内文の表示確認です。撮影地点の指定内容と位置精度の意味を確認してから投稿できます。画面が小さい場合も操作パネルを通常のスクロールで移動し、投稿ボタンまで到達できる必要があります。';
        });
        const submitButton = page.locator('[data-testid="submit-photo-btn"]');
        assert.equal(await submitButton.isDisabled(), false, `${viewport.label} Lv.${level}: 投稿ボタンが有効であること`);

        // locator.click() の自動スクロールを使わず、現在の画面から実際に押せるかを判定する。
        const submitBox = await submitButton.boundingBox();
        const isReachable = await page.evaluate((box) => {
          if (!box) return false;
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          const hit = document.elementFromPoint(centerX, centerY);
          return centerY >= 0 && centerY <= window.innerHeight && Boolean(hit?.closest('[data-testid="submit-photo-btn"]'));
        }, submitBox);
        assert.equal(isReachable, true, `${viewport.label} Lv.${level}: 投稿ボタンが画面内で押せること`);

        await page.mouse.click(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
        await page.locator('.modal-backdrop').waitFor({ state: 'visible' });
        await page.locator('.modal-dialog__close').click();
        await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
      }

      await context.close();
    }
  });

  it('4. [地図のキーボード操作] 矢印キーでパンし、TabとEnterで中央地点を確定できる', async () => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await page.route(TILE_URL_PATTERN, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG_BUFFER });
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');

    const initialCenter = await page.evaluate(() => {
      const center = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance().getCenter();
      return { lat: center.lat, lng: center.lng };
    });
    await page.locator('#map-canvas').focus();
    await page.evaluate(() => {
      const map = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance();
      window.__testMapMoveEnd = new Promise((resolve) => map.once('moveend', resolve));
    });
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.__testMapMoveEnd);
    await page.waitForFunction((previousLng) => {
      const map = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance();
      return Math.abs(map.getCenter().lng - previousLng) > 0.000001;
    }, initialCenter.lng);

    const centerAfterPan = await page.evaluate(() => {
      const app = window.__PHOTO_SPOT_APP__;
      const center = app.getActiveMapView().getMapController().getMapInstance().getCenter();
      return {
        center: { lat: center.lat, lng: center.lng },
        selectedPin: app.getStore().getSnapshot().effectivePinPosition,
      };
    });
    assert.notEqual(centerAfterPan.center.lng, initialCenter.lng, '矢印キーで地図中央が移動すること');
    assert.equal(centerAfterPan.selectedPin, null, 'パン操作だけでは地点を確定しないこと');

    let focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    for (let index = 0; index < 6 && focusedTestId !== 'select-map-center-btn'; index += 1) {
      await page.keyboard.press('Tab');
      focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    }
    assert.equal(focusedTestId, 'select-map-center-btn', 'Tabで中央地点の確定ボタンへ進めること');
    await page.waitForFunction(() => {
      const reticle = document.querySelector('.map-center-reticle');
      return reticle && getComputedStyle(reticle).opacity === '1';
    });
    assert.equal(
      await page.locator('.map-center-reticle').evaluate((element) => getComputedStyle(element).opacity),
      '1',
      '地図操作へフォーカスがある間は照準が表示されること'
    );
    assert.equal(
      await page.locator('[data-testid="select-map-center-btn"]').evaluate((element) => getComputedStyle(element).opacity),
      '1',
      'キーボード操作時は確定ボタンが表示されること'
    );
    await page.keyboard.press('Enter');
    await page.waitForSelector('.custom-map-pin', { state: 'visible' });

    const selectedPin = await page.evaluate(() => window.__PHOTO_SPOT_APP__.getStore().getSnapshot().effectivePinPosition);
    assert.ok(Math.abs(selectedPin.lat - centerAfterPan.center.lat) < 0.000001, '確定した緯度が地図中央と一致すること');
    assert.ok(Math.abs(selectedPin.lng - centerAfterPan.center.lng) < 0.000001, '確定した経度が地図中央と一致すること');
    assert.equal(await page.locator('[data-testid="submit-photo-btn"]').isDisabled(), false, '地点確定後に投稿できること');
    await context.close();
  });

  it('5. [確認モーダルのキーボード操作] Tabをモーダル内に閉じ込め、Escape後に投稿ボタンへフォーカスを戻す', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.route(TILE_URL_PATTERN, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG_BUFFER });
    });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');
    await page.locator('.slider-tick-btn[data-level="0"]').click();

    const submitButton = page.locator('[data-testid="submit-photo-btn"]');
    await submitButton.click();
    const modal = page.locator('.modal-backdrop[aria-modal="true"]');
    await modal.waitFor({ state: 'visible' });
    const focusableCount = await modal.locator('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])').count();
    assert.ok(focusableCount > 0, 'モーダル内にフォーカス可能な操作があること');
    const backgroundParts = page.locator('.map-page > :not(.modal-backdrop)');
    assert.ok(await backgroundParts.count() > 0, 'モーダル表示中の背景要素が存在すること');
    assert.equal(
      await backgroundParts.evaluateAll((elements) => elements.every((element) => element.inert)),
      true,
      'モーダル表示中は背景の全領域が操作できないこと'
    );

    for (let index = 0; index < focusableCount + 2; index += 1) {
      await page.keyboard.press('Tab');
      assert.equal(
        await modal.evaluate((element) => element.contains(document.activeElement)),
        true,
        'Tab移動のフォーカスがモーダル内に留まること'
      );
    }
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await modal.evaluate((element) => element.contains(document.activeElement)),
      true,
      'Shift+Tab移動のフォーカスがモーダル内に留まること'
    );

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
      'submit-photo-btn',
      'Escapeで閉じた後、起点の投稿ボタンへフォーカスが戻ること'
    );
    await context.close();
  });

  it('6. [地図タイル全件失敗と復旧] エラー案内を保持し、再試行後に実成功したときだけ閉じる', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    let failTiles = true;
    let failedResponses = 0;
    let successfulResponses = 0;
    await page.route(TILE_URL_PATTERN, async (route) => {
      if (failTiles) {
        failedResponses += 1;
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'tile unavailable' });
      } else {
        successfulResponses += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG_BUFFER });
      }
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');
    const banner = page.locator('[data-testid="map-tile-error-banner"]');
    await banner.waitFor({ state: 'visible' });
    assert.ok(failedResponses > 0, 'タイル要求が実際に失敗したこと');

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(50);
    assert.equal(await banner.isVisible(), true, 'onlineイベントだけでは失敗案内を閉じないこと');

    const failuresBeforeRetry = failedResponses;
    await banner.locator('.map-error-banner__btn').click();
    const retryDeadline = Date.now() + 1500;
    while (failedResponses <= failuresBeforeRetry && Date.now() < retryDeadline) {
      await page.waitForTimeout(50);
    }
    assert.ok(failedResponses > failuresBeforeRetry, '再読み込み操作が失敗中のタイルをもう一度要求したこと');
    assert.equal(await banner.isVisible(), true, '失敗が続く再試行後も案内を保つこと');

    failTiles = false;
    await banner.locator('.map-error-banner__btn').click();
    await page.waitForFunction(() => {
      const currentBanner = document.querySelector('[data-testid="map-tile-error-banner"]');
      return !currentBanner || currentBanner.hidden || getComputedStyle(currentBanner).display === 'none';
    });
    assert.ok(successfulResponses > 0, '再試行で実際の成功応答を受け取ったこと');
    assert.equal(failedResponses >= failuresBeforeRetry, true);
    await context.close();
  });

  it('7. [タイル部分失敗とパン後の回復] 失敗中のタイルを表示したまま新規タイルが成功しても案内を残す', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    let releaseRequests;
    const requestGate = new Promise((resolve) => { releaseRequests = resolve; });
    let failedTileUrl = null;
    let allowFailedTile = false;
    let failedResponses = 0;
    let successfulResponses = 0;
    const tileAttempts = new Map();
    const pendingTileUrls = [];

    await page.route(TILE_URL_PATTERN, async (route) => {
      const requestUrl = route.request().url();
      pendingTileUrls.push(requestUrl);
      await requestGate;
      tileAttempts.set(requestUrl, (tileAttempts.get(requestUrl) ?? 0) + 1);
      if (requestUrl === failedTileUrl && !allowFailedTile) {
        failedResponses += 1;
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'one tile unavailable' });
      } else {
        successfulResponses += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG_BUFFER });
      }
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');
    const centerTile = await page.evaluate(() => {
      const map = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance();
      const zoom = map.getZoom();
      const projected = map.project(map.getCenter(), zoom);
      const x = Math.floor(projected.x / 256);
      const y = Math.floor(projected.y / 256);
      return { zoom, x, y };
    });
    const requestDeadline = Date.now() + 1500;
    while (pendingTileUrls.length === 0 && Date.now() < requestDeadline) {
      await page.waitForTimeout(30);
    }
    const candidates = pendingTileUrls
      .map((url) => {
        const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png(?:\?.*)?$/);
        if (!match) return null;
        const [, zoom, x, y] = match.map(Number);
        return { url, zoom, x, y };
      })
      .filter((candidate) => candidate && candidate.zoom === centerTile.zoom)
      .sort((left, right) =>
        (Math.abs(left.x - centerTile.x) + Math.abs(left.y - centerTile.y)) -
        (Math.abs(right.x - centerTile.x) + Math.abs(right.y - centerTile.y))
      );
    assert.ok(candidates.length > 0, '地図中央に近い保留タイル要求が存在すること');
    failedTileUrl = candidates[0].url;
    releaseRequests();
    await page.waitForLoadState('networkidle');

    const banner = page.locator('[data-testid="map-tile-error-banner"]');
    await banner.waitFor({ state: 'visible' });
    assert.ok(successfulResponses > 0, '部分失敗と同時に他タイルが読み込まれたこと');
    assert.ok(failedResponses > 0, '表示範囲のタイル要求が失敗したこと');

    const isFailedTileVisible = async () => page.evaluate((url) => {
      const mapElement = document.querySelector('#map-canvas');
      const mapRect = mapElement.getBoundingClientRect();
      const failedTile = [...mapElement.querySelectorAll('img.leaflet-tile')]
        .find((tile) => tile.src === url);
      if (!failedTile) return false;
      const tileRect = failedTile.getBoundingClientRect();
      return tileRect.right > mapRect.left && tileRect.left < mapRect.right &&
        tileRect.bottom > mapRect.top && tileRect.top < mapRect.bottom;
    }, failedTileUrl);
    assert.equal(await isFailedTileVisible(), true, '失敗したタイルが地図内に残っていること');

    const successesBeforePan = successfulResponses;
    for (let attempt = 0; attempt < 5 && successfulResponses === successesBeforePan; attempt += 1) {
      await page.evaluate(() => {
        const map = window.__PHOTO_SPOT_APP__.getActiveMapView().getMapController().getMapInstance();
        map.panBy([80, 0], { animate: false });
      });
      await page.waitForTimeout(120);
    }
    assert.ok(successfulResponses > successesBeforePan, 'パンで新しいタイル要求が成功したこと');
    assert.equal(await isFailedTileVisible(), true, 'パン後も同じ失敗タイルが地図内に残っていること');
    assert.equal(await banner.isVisible(), true, '新規タイルの成功だけでは失敗案内を閉じないこと');

    const failedAttemptsBeforeRecovery = tileAttempts.get(failedTileUrl) ?? 0;
    allowFailedTile = true;
    await banner.locator('.map-error-banner__btn').click();
    await page.waitForFunction(() => {
      const currentBanner = document.querySelector('[data-testid="map-tile-error-banner"]');
      return !currentBanner || currentBanner.hidden || getComputedStyle(currentBanner).display === 'none';
    });
    assert.ok((tileAttempts.get(failedTileUrl) ?? 0) > failedAttemptsBeforeRecovery, '回復操作で失敗タイル自体が再取得されたこと');
    await context.close();
  });

  it('8. [Googleフォーム連携URLの実ブラウザ確認] 本番設定での全レベルURL生成（地域ID、緯度、経度、半径0m/50m/150m/500m、地域のみの省略）と、未設定時のブロック確認', async () => {
    // -------------------------------------------------------------------------
    // 8-1. window.__PHOTO_SPOT_TEST_FORM_CONFIG__ を注入しない既定状態（本番の src/config/googleForm.ts 設定）
    // -------------------------------------------------------------------------
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    await page.route(TILE_URL_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: DUMMY_PNG_BUFFER,
      });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await page.waitForSelector('#map-canvas.leaflet-container');

    // 募集範囲内の中心付近をクリックしてピンを設置
    const mapBox = await page.locator('#map-canvas').boundingBox();
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.waitForSelector('.custom-map-pin', { state: 'visible' });

    // マウスクリックでのピン設置時は中央照準および確定ボタンが非表示（opacity: 0）のまま維持されること
    const clickReticleOpacity = await page.locator('.map-center-reticle').evaluate((el) => getComputedStyle(el).opacity);
    const clickCenterBtnOpacity = await page.locator('[data-testid="select-map-center-btn"]').evaluate((el) => getComputedStyle(el).opacity);
    assert.equal(clickReticleOpacity, '0', 'マウスクリック設置時は中央照準が非表示（opacity: 0）であること');
    assert.equal(clickCenterBtnOpacity, '0', 'マウスクリック設置時は確定ボタンが非表示（opacity: 0）であること');

    // 検証ヘルパー：指定レベルを選択 -> 投稿ボタンを押下 -> 確認モーダル内の遷移先URLを取得 -> モーダルを閉じる
    async function getGeneratedUrlForLevel(level) {
      await page.locator(`.slider-tick-btn[data-level="${level}"]`).click();
      await page.locator('[data-testid="submit-photo-btn"]').click();
      const linkLocator = page.locator('a.modal-proceed-link');
      await linkLocator.waitFor({ state: 'visible' });
      const href = await linkLocator.getAttribute('href');
      await page.locator('.modal-dialog__close').click();
      await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
      return new URL(href);
    }

    // 本番フォームの entry ID
    const PROD_ENTRIES = {
      regionId: 'entry.849123997',
      latitude: 'entry.2018650203',
      longitude: 'entry.1920272994',
      accuracyRadius: 'entry.1323470590',
    };

    // (1) レベル1（正確な地点：半径 0m）
    const urlLv1 = await getGeneratedUrlForLevel(1);
    assert.equal(
      urlLv1.origin + urlLv1.pathname,
      'https://docs.google.com/forms/d/e/1FAIpQLSeFYPB0RD6ENjKX9Ju3XvF6kq-fatpaSS4ny1uLDEsMMoBWZA/viewform',
      '本番フォームのURLパスであること'
    );
    assert.equal(urlLv1.searchParams.get('usp'), 'pp_url');
    assert.equal(urlLv1.searchParams.get(PROD_ENTRIES.regionId), TEST_REGION.id, '地域IDが正しく設定されること');
    assert.match(urlLv1.searchParams.get(PROD_ENTRIES.latitude), /^\d+\.\d{6}$/, '緯度が小数点以下6桁で設定されること');
    assert.match(urlLv1.searchParams.get(PROD_ENTRIES.longitude), /^\d+\.\d{6}$/, '経度が小数点以下6桁で設定されること');
    assert.equal(urlLv1.searchParams.get(PROD_ENTRIES.accuracyRadius), '0', 'レベル1で半径 "0" が省略されず明示的に設定されること');

    // (2) レベル2（半径 50m）
    const urlLv2 = await getGeneratedUrlForLevel(2);
    assert.equal(urlLv2.searchParams.get(PROD_ENTRIES.accuracyRadius), '50', 'レベル2で半径 "50" が設定されること');
    assert.equal(urlLv2.searchParams.get(PROD_ENTRIES.regionId), TEST_REGION.id);

    // (3) レベル3（半径 150m）
    const urlLv3 = await getGeneratedUrlForLevel(3);
    assert.equal(urlLv3.searchParams.get(PROD_ENTRIES.accuracyRadius), '150', 'レベル3で半径 "150" が設定されること');

    // (4) レベル4（半径 500m）
    const urlLv4 = await getGeneratedUrlForLevel(4);
    assert.equal(urlLv4.searchParams.get(PROD_ENTRIES.accuracyRadius), '500', 'レベル4で半径 "500" が設定されること');

    // (5) レベル0（地域のみ：直前にピンを設置していても緯度・経度・半径がすべて省略されること）
    const urlLv0 = await getGeneratedUrlForLevel(0);
    assert.equal(urlLv0.searchParams.get(PROD_ENTRIES.regionId), TEST_REGION.id, 'レベル0でも地域IDは送信されること');
    assert.equal(urlLv0.searchParams.has(PROD_ENTRIES.latitude), false, 'レベル0では緯度パラメータが省略されること');
    assert.equal(urlLv0.searchParams.has(PROD_ENTRIES.longitude), false, 'レベル0では経度パラメータが省略されること');
    assert.equal(urlLv0.searchParams.has(PROD_ENTRIES.accuracyRadius), false, 'レベル0では半径パラメータが省略されること');

    await context.close();

    // -------------------------------------------------------------------------
    // 8-2. window.__PHOTO_SPOT_TEST_FORM_CONFIG__ に未設定プレースホルダーを注入した場合のブロック検証
    // -------------------------------------------------------------------------
    const unconfiguredContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const unconfiguredPage = await unconfiguredContext.newPage();

    await unconfiguredPage.route(TILE_URL_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: DUMMY_PNG_BUFFER,
      });
    });

    await unconfiguredPage.addInitScript(() => {
      window.__PHOTO_SPOT_TEST_FORM_CONFIG__ = {
        formUrl: 'https://docs.google.com/forms/d/e/YOUR_FORM_ID_HERE/viewform',
        entryIds: {
          regionId: 'entry.000000001',
          latitude: 'entry.000000002',
          longitude: 'entry.000000003',
          accuracyRadius: 'entry.000000004',
        },
      };
    });

    await unconfiguredPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await unconfiguredPage.locator(`[data-region-id="${TEST_REGION.id}"] .region-card__btn`).click();
    await unconfiguredPage.waitForSelector('#map-canvas.leaflet-container');

    // レベル0を選択して投稿ボタンを押下
    await unconfiguredPage.locator('.slider-tick-btn[data-level="0"]').click();
    await unconfiguredPage.locator('[data-testid="submit-photo-btn"]').click();

    // 確認モーダルが開き、遷移ボタンが無効化されて案内が表示されること
    const modalBackdrop = unconfiguredPage.locator('.modal-backdrop');
    await modalBackdrop.waitFor({ state: 'visible' });
    assert.equal(await unconfiguredPage.locator('a.modal-proceed-link').count(), 0, '未設定時は遷移リンクが生成されないこと');
    const modalText = await modalBackdrop.innerText();
    assert.ok(modalText.includes('未設定のため遷移不可'), '未設定のため遷移不可メッセージが表示されること');

    await unconfiguredContext.close();
  });
});
