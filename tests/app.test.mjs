/**
 * 地域別写真撮影地点投稿Webサイト 自動テストスイート（仕様要件 9）
 *
 * 検証項目：
 * 1. 地域選択（複数地域表示、地図切り替え、不正な地域ID・重複ID・不正bounds・未登録対応、サムネイルフォールバック）
 * 2. ピン操作（募集範囲内設置、範囲外設置禁止、ピン移動・ドラッグ範囲外スナップバック、地図ズーム後の座標維持）
 * 3. 精度スライダー（5段階選択、初期値レベル1、レベル1で円非表示、レベル2〜4で正しい半径50/150/500m、レベル0で位置情報非送信、レベル0から戻した際の位置復元）
 * 4. フォーム連携（URL生成、地域ID送信、緯度経度6桁送信、半径"0"の明示送信、位置不明時の座標・半径省略、設定不備時の遷移防止）
 * 5. レスポンシブ・UI・出典表示（スマホ・PC操作、地図とスライダーの非干渉、地理院タイル出典常時表示）
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { TEST_REGIONS as REGIONS, pointInTestRegion } from './fixtures/regions.mjs';

// Happy DOM でブラウザグローバル環境を初期化（LeafletおよびUIコンポーネントの動作検証用）
const happyWindow = new Window({
  url: 'http://localhost:5173/',
  width: 390,
  height: 844,
});

const globalProps = {
  window: happyWindow,
  document: happyWindow.document,
  navigator: happyWindow.navigator,
  HTMLElement: happyWindow.HTMLElement,
  HTMLInputElement: happyWindow.HTMLInputElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  HTMLImageElement: happyWindow.HTMLImageElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  SVGElement: happyWindow.SVGElement,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  KeyboardEvent: happyWindow.KeyboardEvent,
  CustomEvent: happyWindow.CustomEvent,
  history: happyWindow.history,
  location: happyWindow.location,
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
};

for (const [key, value] of Object.entries(globalProps)) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

// テスト専用の隔離ビルドを読み込む。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(process.env.TEST_BUILD_DIR ?? path.join(__dirname, '..', 'dist'));
const importBuiltModule = (relativePath) =>
  import(pathToFileURL(path.join(buildDir, relativePath)).href);
const { ACCURACY_LEVELS, DEFAULT_ACCURACY_LEVEL } = await importBuiltModule(
  'config/accuracyLevels.js'
);
const { GOOGLE_FORM_CONFIG } = await importBuiltModule('config/googleForm.js');
const {
  validateRegionBounds,
  validateRegionConfig,
  validateRegionsList,
  isPointWithinBounds,
} = await importBuiltModule('domain/regionValidator.js');
const { getAccuracyLevelConfig, validateAccuracyLevels } = await importBuiltModule(
  'domain/accuracyManager.js'
);
const { SubmissionStateStore } = await importBuiltModule('domain/submissionState.js');
const { validateGoogleFormConfig, buildGoogleFormUrl } = await import(
  pathToFileURL(path.join(buildDir, 'domain/googleFormUrlBuilder.js')).href
);
const { PhotoSpotApp } = await importBuiltModule('app.js');
const L = await importBuiltModule('vendor/leaflet/leaflet-src.esm.js');

/**
 * テスト用の有効なGoogleフォーム設定
 */
const VALID_TEST_FORM_CONFIG = {
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSeRealFormIdentifier987654321/viewform',
  entryIds: {
    regionId: 'entry.111111111',
    latitude: 'entry.222222222',
    longitude: 'entry.333333333',
    accuracyRadius: 'entry.444444444',
  },
};

/**
 * 未設定プレースホルダー状態のGoogleフォーム設定（未完了時のブロック検証用）
 */
const UNCONFIGURED_PLACEHOLDER_FORM_CONFIG = {
  formUrl: 'https://docs.google.com/forms/d/e/YOUR_FORM_ID_HERE/viewform',
  entryIds: {
    regionId: 'entry.000000001',
    latitude: 'entry.000000002',
    longitude: 'entry.000000003',
    accuracyRadius: 'entry.000000004',
  },
};

describe('1. 地域選択および地域設定バリデーションのテスト', () => {
  let rootEl;
  let app;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    rootEl = document.getElementById('app');
    window.location.hash = '';
  });

  afterEach(() => {
    if (app) {
      app.destroy();
      app = null;
    }
  });

  it('複数の募集地域がカードとして一覧表示され、サムネイル未設定地域には共通プレースホルダーが設定される', () => {
    app = new PhotoSpotApp({ rootElement: rootEl, regions: REGIONS });
    app.start();

    const cards = rootEl.querySelectorAll('.region-card');
    assert.equal(cards.length, REGIONS.length);
    assert.ok(cards.length >= 2, '複数の地域が表示されること');

    // サムネイル未設定地域に共通プレースホルダー画像が入ることを確認
    const placeholderRegion = REGIONS.find((region) => !region.thumbnail);
    assert.ok(placeholderRegion, 'サムネイル未設定のfixture地域が存在すること');
    const placeholderCard = rootEl.querySelector(`[data-region-id="${placeholderRegion.id}"]`);
    assert.ok(placeholderCard, 'サムネイル未設定地域のカードが存在すること');
    const img = placeholderCard.querySelector('img.region-card__thumb');
    assert.ok(img && img.src.startsWith('data:image/svg+xml'), '共通プレースホルダーが表示されること');
  });

  it('地域カードを選択すると該当地域の地図画面に切り替わる', () => {
    app = new PhotoSpotApp({ rootElement: rootEl, regions: REGIONS });
    app.start();

    const firstRegion = REGIONS[0];
    const firstCardBtn = rootEl.querySelector(
      `[data-region-id="${firstRegion.id}"] .region-card__btn`
    );
    assert.ok(firstCardBtn, '地域選択ボタンが存在すること');

    firstCardBtn.click();

    const mapPage = rootEl.querySelector('.map-page');
    assert.ok(mapPage, '地図画面に切り替わること');
    const topTitle = rootEl.querySelector('.map-topbar__title');
    assert.equal(topTitle?.textContent, firstRegion.name);
    assert.equal(app.getStore().getSnapshot().selectedRegion?.id, firstRegion.id);
  });

  it('存在しない不正な地域IDが指定された場合、クラッシュせず地域選択画面にエラー案内を表示する', () => {
    app = new PhotoSpotApp({ rootElement: rootEl, regions: REGIONS });
    app.start();

    app.navigateToRegion('non-existent-region-id-999');

    // 地図画面ではなく地域選択画面が表示され、エラーアラートが出ていること
    const regionPage = rootEl.querySelector('.region-select-page');
    assert.ok(regionPage, '地域選択画面が表示されること');
    const errorAlert = rootEl.querySelector('.alert--error');
    assert.ok(errorAlert, 'エラーバナーが表示されること');
    assert.ok(
      errorAlert.textContent.includes('non-existent-region-id-999'),
      '存在しない地域IDがエラーメッセージに含まれること'
    );
  });

  it('地域設定の不正なbounds（南西>=北東など）や重複ID、地域0件を検出できる', () => {
    // 0件のケース
    const emptyReport = validateRegionsList([]);
    assert.equal(emptyReport.valid, false);
    assert.ok(emptyReport.errors.length > 0);

    // 重複IDと不正boundsのケース
    const brokenRegions = [
      {
        id: 'dup-id',
        name: '地域A',
        bounds: {
          southWest: { lat: 35.0, lng: 139.0 },
          northEast: { lat: 35.5, lng: 139.5 },
        },
      },
      {
        id: 'dup-id',
        name: '地域B（重複ID）',
        bounds: {
          southWest: { lat: 36.0, lng: 140.0 },
          northEast: { lat: 36.5, lng: 140.5 },
        },
      },
      {
        id: 'invalid-bounds-region',
        name: '地域C（南西が北東より大きい）',
        bounds: {
          southWest: { lat: 36.0, lng: 139.5 },
          northEast: { lat: 35.0, lng: 139.0 },
        },
      },
    ];

    const report = validateRegionsList(brokenRegions);
    assert.equal(report.valid, false);
    assert.equal(report.hasDuplicateIds, true);
    assert.equal(report.validRegions.length, 1);
    assert.ok(report.errors.some((e) => e.includes('重複')));
    assert.ok(report.errors.some((e) => e.includes('南西端')));

    // 単体bounds検証
    assert.equal(
      validateRegionBounds({
        southWest: { lat: 35.68, lng: 139.75 },
        northEast: { lat: 35.67, lng: 139.77 },
      }).valid,
      false
    );
    assert.equal(
      validateRegionConfig({ id: '', name: '', bounds: REGIONS[0].bounds }).valid,
      false
    );
  });
});

describe('2. ピン操作（範囲内設置・範囲外禁止・移動・ズーム後の座標維持）のテスト', () => {
  let rootEl;
  let app;
  const targetRegion = REGIONS[0];

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    rootEl = document.getElementById('app');
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: VALID_TEST_FORM_CONFIG,
    });
    app.start();
    app.navigateToRegion(targetRegion.id);
  });

  afterEach(() => {
    if (app) {
      app.destroy();
      app = null;
    }
  });

  it('募集対象範囲内のタップ（clickイベント）でピンを設置できる', () => {
    const mapCtrl = app.getActiveMapView().getMapController();
    const leafletMap = mapCtrl.getMapInstance();
    assert.ok(leafletMap, 'Leaflet地図が初期化されていること');

    const validPoint = pointInTestRegion(targetRegion);
    assert.equal(isPointWithinBounds(validPoint, targetRegion.bounds), true);

    // 地図クリックを発火
    leafletMap.fire('click', { latlng: L.latLng(validPoint.lat, validPoint.lng) });

    const snapshot = app.getStore().getSnapshot();
    assert.deepEqual(snapshot.effectivePinPosition, validPoint);

    const layerState = mapCtrl.getDebugLayerState();
    assert.equal(layerState.isPinVisible, true);
    assert.deepEqual(layerState.pinLatLng, validPoint);
  });

  it('募集対象範囲外をタップしてもピンは設置・移動されず、範囲外案内が表示される', () => {
    const mapCtrl = app.getActiveMapView().getMapController();
    const leafletMap = mapCtrl.getMapInstance();

    // 範囲外の座標（北側へ外れた地点）
    const outPoint = {
      lat: targetRegion.bounds.northEast.lat + 0.01,
      lng: pointInTestRegion(targetRegion).lng,
    };
    assert.equal(isPointWithinBounds(outPoint, targetRegion.bounds), false);

    leafletMap.fire('click', { latlng: L.latLng(outPoint.lat, outPoint.lng) });

    // ピンが設置されていないこと
    const snapshot = app.getStore().getSnapshot();
    assert.equal(snapshot.effectivePinPosition, null);
    assert.equal(mapCtrl.getDebugLayerState().isPinVisible, false);

    // 範囲外であることを伝えるトースト案内が表示されていること
    const toast = rootEl.querySelector('.map-toast');
    assert.ok(toast && !toast.hidden, '範囲外トーストが表示されること');
    assert.ok(toast.textContent.includes('募集対象範囲外'));
  });

  it('設置済みのピンを別の範囲内地点タップやドラッグで移動でき、範囲外へドラッグした場合は元の位置に戻る', () => {
    const mapCtrl = app.getActiveMapView().getMapController();
    const leafletMap = mapCtrl.getMapInstance();

    const firstPoint = pointInTestRegion(targetRegion, 0.2, 0.2);
    const secondPoint = pointInTestRegion(targetRegion, 0.7, 0.7);

    // 1回目の設置
    leafletMap.fire('click', { latlng: L.latLng(firstPoint.lat, firstPoint.lng) });
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, firstPoint);

    // 2回目の別地点タップによる再配置
    leafletMap.fire('click', { latlng: L.latLng(secondPoint.lat, secondPoint.lng) });
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, secondPoint);
    assert.deepEqual(mapCtrl.getDebugLayerState().pinLatLng, secondPoint);

    // 範囲外をタップしても既存のピン位置（secondPoint）が維持されること
    leafletMap.fire('click', {
      latlng: L.latLng(
        targetRegion.bounds.southWest.lat - 0.01,
        targetRegion.bounds.southWest.lng - 0.01
      ),
    });
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, secondPoint);
    assert.deepEqual(mapCtrl.getDebugLayerState().pinLatLng, secondPoint);

    // ピンのドラッグ操作検証（範囲内へのドラッグと範囲外へのドラッグスナップバック）
    const pinMarker = mapCtrl.pinMarker;
    assert.ok(pinMarker, 'ピンマーカーインスタンスが存在すること');

    const draggedInsidePoint = pointInTestRegion(targetRegion, 0.4, 0.6);
    pinMarker.setLatLng([draggedInsidePoint.lat, draggedInsidePoint.lng]);
    pinMarker.fire('dragend');
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, draggedInsidePoint);

    // 範囲外へドラッグして離した場合 -> draggedInsidePoint に戻されること
    pinMarker.setLatLng([
      targetRegion.bounds.northEast.lat + 0.01,
      targetRegion.bounds.northEast.lng + 0.01,
    ]);
    pinMarker.fire('dragend');
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, draggedInsidePoint);
    assert.deepEqual(mapCtrl.getDebugLayerState().pinLatLng, draggedInsidePoint);
  });

  it('地図を拡大・縮小（ズーム変更）しても取得済みのピン座標が一切変化しない', () => {
    const mapCtrl = app.getActiveMapView().getMapController();
    const leafletMap = mapCtrl.getMapInstance();

    const exactPoint = pointInTestRegion(targetRegion, 0.35, 0.6);
    leafletMap.fire('click', { latlng: L.latLng(exactPoint.lat, exactPoint.lng) });

    const beforeZoomPayload = app.getStore().getSnapshot().submissionPayload;
    assert.equal(beforeZoomPayload?.latitude, exactPoint.lat.toFixed(6));
    assert.equal(beforeZoomPayload?.longitude, exactPoint.lng.toFixed(6));

    // ズームイン・ズームアウトを実行
    leafletMap.setZoom(17);
    assert.deepEqual(app.getStore().getSnapshot().effectivePinPosition, exactPoint);
    assert.deepEqual(mapCtrl.getDebugLayerState().pinLatLng, exactPoint);

    leafletMap.setZoom(12);
    const afterZoomPayload = app.getStore().getSnapshot().submissionPayload;
    assert.equal(afterZoomPayload?.latitude, exactPoint.lat.toFixed(6));
    assert.equal(afterZoomPayload?.longitude, exactPoint.lng.toFixed(6));
  });
});

describe('3. 5段階の位置精度スライダーと円形範囲表示のテスト', () => {
  let rootEl;
  let app;
  const targetRegion = REGIONS[0];
  const validPin = pointInTestRegion(targetRegion);

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    rootEl = document.getElementById('app');
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: VALID_TEST_FORM_CONFIG,
    });
    app.start();
    app.navigateToRegion(targetRegion.id);
  });

  afterEach(() => {
    if (app) {
      app.destroy();
      app = null;
    }
  });

  it('初期値はレベル1（正確な地点）であり、0〜4の5段階すべてをスライダーで選択できる', () => {
    assert.equal(DEFAULT_ACCURACY_LEVEL, 1);
    assert.equal( validateAccuracyLevels(ACCURACY_LEVELS).valid, true);

    const store = app.getStore();
    assert.equal(store.getSnapshot().accuracyLevel, 1);

    const slider = rootEl.querySelector('#accuracy-range-slider');
    assert.equal(slider.value, '1');

    for (const lv of [0, 1, 2, 3, 4]) {
      slider.value = String(lv);
      slider.dispatchEvent(new Event('input'));
      assert.equal(store.getSnapshot().accuracyLevel, lv);
    }
  });

  it('レベル1（正確な地点）ではピンのみを表示し、円は表示されない', () => {
    const store = app.getStore();
    const mapCtrl = app.getActiveMapView().getMapController();

    store.setPinPosition(validPin);
    store.setAccuracyLevel(1);

    const state = mapCtrl.getDebugLayerState();
    assert.equal(state.isPinVisible, true);
    assert.equal(state.isCircleVisible, false);
    assert.equal(state.circleRadiusMeters, null);
  });

  it('レベル2〜4ではピンと半透明の円が表示され、正しい地理的半径（50m, 150m, 500m）が設定される', () => {
    const store = app.getStore();
    const mapCtrl = app.getActiveMapView().getMapController();

    store.setPinPosition(validPin);

    const expectedRadii = [
      { level: 2, radius: 50 },
      { level: 3, radius: 150 },
      { level: 4, radius: 500 },
    ];

    for (const { level, radius } of expectedRadii) {
      store.setAccuracyLevel(level);
      const layerState = mapCtrl.getDebugLayerState();
      assert.equal(layerState.isPinVisible, true, `レベル${level}でピンが表示されること`);
      assert.equal(layerState.isCircleVisible, true, `レベル${level}で円が表示されること`);
      assert.equal(
        layerState.circleRadiusMeters,
        radius,
        `レベル${level}の円の半径が${radius}mであること`
      );
      assert.equal(
        getAccuracyLevelConfig(level).radiusMeters,
        radius
      );
    }
  });

  it('レベル0（地域のみ）ではピンと円を非表示にし、以前のピン位置があっても位置情報を送信しない。またレベル0から他のレベルに戻すと以前のピン位置が復元される', () => {
    const store = app.getStore();
    const mapCtrl = app.getActiveMapView().getMapController();

    // 1. まずレベル2でピンを設置する
    store.setAccuracyLevel(2);
    store.setPinPosition(validPin);
    assert.equal(mapCtrl.getDebugLayerState().isPinVisible, true);
    assert.equal(mapCtrl.getDebugLayerState().isCircleVisible, true);

    // 2. レベル0（地域のみ）へ変更する
    store.setAccuracyLevel(0);
    const lv0Snapshot = store.getSnapshot();
    const lv0Layers = mapCtrl.getDebugLayerState();

    // ピンと円が非表示になること
    assert.equal(lv0Layers.isPinVisible, false);
    assert.equal(lv0Layers.isCircleVisible, false);
    assert.equal(lv0Snapshot.effectivePinPosition, null);

    // ただし内部の lastPinPosition は復元用に保持されていること
    assert.deepEqual(lv0Snapshot.lastPinPosition, validPin);

    // レベル0での送信ペイロードには以前の座標や半径が一切含まれないこと（仕様要件 3 / 4.3）
    assert.equal(lv0Snapshot.canSubmit, true);
    assert.deepEqual(lv0Snapshot.submissionPayload, {
      regionId: targetRegion.id,
      latitude: null,
      longitude: null,
      accuracyRadius: null,
    });

    // 3. レベル0からレベル3へ戻したとき、以前のピン位置（validPin）と半径150mの円が即座に復元されること
    store.setAccuracyLevel(3);
    const restoredSnapshot = store.getSnapshot();
    const restoredLayers = mapCtrl.getDebugLayerState();

    assert.deepEqual(restoredSnapshot.effectivePinPosition, validPin);
    assert.equal(restoredLayers.isPinVisible, true);
    assert.equal(restoredLayers.isCircleVisible, true);
    assert.equal(restoredLayers.circleRadiusMeters, 150);
  });

  it('レベル1〜4ではピン設置まで投稿ボタンが無効であり、レベル0ではピン未設置でも投稿ボタンが有効になる', () => {
    const store = app.getStore();
    const submitBtn = rootEl.querySelector('[data-testid="submit-photo-btn"]');
    const guideMsg = rootEl.querySelector('[data-testid="submission-guide-message"]');

    // 初期状態（レベル1、ピン未設置）
    assert.equal(submitBtn.disabled, true);
    assert.ok(
      guideMsg.textContent.includes('地図上で撮影地点を選択してください'),
      'ピン指定前の案内文が表示されること'
    );

    // ピン未設置のままレベル0へ切り替え -> 投稿可能になる
    store.setAccuracyLevel(0);
    assert.equal(submitBtn.disabled, false);
    assert.ok(
      guideMsg.textContent.includes('撮影地点が分からない場合は、地域のみで投稿できます'),
      'レベル0の案内文が表示されること'
    );

    // ピン未設置のままレベル4へ切り替え -> 再び無効になる
    store.setAccuracyLevel(4);
    assert.equal(submitBtn.disabled, true);

    // ピンを設置 -> 有効になる
    store.setPinPosition(validPin);
    assert.equal(submitBtn.disabled, false);
  });
});

describe('4. Googleフォーム事前入力URL生成と連携のテスト', () => {
  const sampleRegion = REGIONS[0];
  const samplePin = pointInTestRegion(sampleRegion, 0.333333, 0.678901);

  it('レベル1（正確な地点）では地域ID・小数点以下6桁の緯度経度・半径文字列"0"が省略されず送信される', () => {
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setAccuracyLevel(1);
    store.setPinPosition(samplePin);

    const result = buildGoogleFormUrl(VALID_TEST_FORM_CONFIG, store.getSnapshot());
    assert.equal(result.success, true);
    assert.ok(result.url);

    const parsed = new URL(result.url);
    assert.equal(parsed.searchParams.get('usp'), 'pp_url');
    assert.equal(
      parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.regionId),
      sampleRegion.id
    );
    assert.equal(
      parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.latitude),
      samplePin.lat.toFixed(6)
    );
    assert.equal(
      parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.longitude),
      samplePin.lng.toFixed(6)
    );
    // 半径 "0" が省略されず明示的に設定されていること
    assert.equal(
      parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.accuracyRadius),
      '0'
    );
  });

  it('レベル2〜4では選択した半径（50, 150, 500）が事前入力URLに設定される', () => {
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setPinPosition(samplePin);

    for (const [level, expectedRadius] of [
      [2, '50'],
      [3, '150'],
      [4, '500'],
    ]) {
      store.setAccuracyLevel(level);
      const result = buildGoogleFormUrl(VALID_TEST_FORM_CONFIG, store.getSnapshot());
      assert.equal(result.success, true);
      const parsed = new URL(result.url);
      assert.equal(
        parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.accuracyRadius),
        expectedRadius
      );
    }
  });

  it('レベル0（地域のみ）では地域IDのみが送信され、緯度・経度・半径パラメータは完全に省略される', () => {
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    // 以前にピンを置いた履歴があってもレベル0なら省略されることを検証
    store.setPinPosition(samplePin);
    store.setAccuracyLevel(0);

    const result = buildGoogleFormUrl(VALID_TEST_FORM_CONFIG, store.getSnapshot());
    assert.equal(result.success, true);
    assert.ok(result.url);

    const parsed = new URL(result.url);
    assert.equal(
      parsed.searchParams.get(VALID_TEST_FORM_CONFIG.entryIds.regionId),
      sampleRegion.id
    );
    assert.equal(parsed.searchParams.has(VALID_TEST_FORM_CONFIG.entryIds.latitude), false);
    assert.equal(parsed.searchParams.has(VALID_TEST_FORM_CONFIG.entryIds.longitude), false);
    assert.equal(parsed.searchParams.has(VALID_TEST_FORM_CONFIG.entryIds.accuracyRadius), false);
  });

  it('レベル0ではベースURLに残る重複座標キーを除去し、他のクエリとuspだけを保つ', () => {
    const configWithStaleLocation = {
      ...VALID_TEST_FORM_CONFIG,
      formUrl: `${VALID_TEST_FORM_CONFIG.formUrl}?usp=old&keep=preserved` +
        `&${VALID_TEST_FORM_CONFIG.entryIds.latitude}=35.111111` +
        `&${VALID_TEST_FORM_CONFIG.entryIds.latitude}=35.222222` +
        `&${VALID_TEST_FORM_CONFIG.entryIds.longitude}=139.333333` +
        `&${VALID_TEST_FORM_CONFIG.entryIds.accuracyRadius}=500`,
    };
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setPinPosition(samplePin);
    store.setAccuracyLevel(0);

    const result = buildGoogleFormUrl(configWithStaleLocation, store.getSnapshot());
    assert.equal(result.success, true);
    const parsed = new URL(result.url);
    for (const field of ['latitude', 'longitude', 'accuracyRadius']) {
      assert.equal(parsed.searchParams.has(VALID_TEST_FORM_CONFIG.entryIds[field]), false, `${field}の古い値も重複値も残らないこと`);
    }
    assert.equal(parsed.searchParams.get('keep'), 'preserved', 'フォーム設定にあった別のクエリは維持されること');
    assert.equal(parsed.searchParams.get('usp'), 'pp_url', '事前入力のuspを設定すること');
  });

  it('フォームURLはHTTPSのdocs.google.com回答用パスだけを受け入れ、不正なentry IDを例外にしない', () => {
    const invalidUrls = [
      'http://docs.google.com/forms/d/e/FORM_ID/viewform',
      'https://docs.google.com.evil.test/forms/d/e/FORM_ID/viewform',
      'https://docs.google.com/forms/d/e/FORM_ID/edit',
      'https://user:pass@docs.google.com/forms/d/e/FORM_ID/viewform',
      'https://@docs.google.com/forms/d/e/FORM_ID/viewform',
      'https://docs.google.com:8443/forms/d/e/FORM_ID/viewform',
      'https://docs.google.com/forms/d/e/FORM_ID/viewform#response',
    ];
    for (const formUrl of invalidUrls) {
      assert.equal(validateGoogleFormConfig({ ...VALID_TEST_FORM_CONFIG, formUrl }).valid, false, `${formUrl} は拒否されること`);
    }

    const shortUrlResult = validateGoogleFormConfig({
      ...VALID_TEST_FORM_CONFIG,
      formUrl: 'https://forms.gle/short-code',
    });
    assert.equal(shortUrlResult.valid, false);
    assert.ok(shortUrlResult.errors.some((message) => message.includes('展開済みの回答用URL')));

    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setPinPosition(samplePin);
    store.setAccuracyLevel(1);
    const malformedEntryResult = buildGoogleFormUrl({
      ...VALID_TEST_FORM_CONFIG,
      entryIds: { ...VALID_TEST_FORM_CONFIG.entryIds, latitude: 222222222 },
    }, store.getSnapshot());
    assert.equal(malformedEntryResult.success, false);
    assert.equal(malformedEntryResult.url, null);
    assert.equal(malformedEntryResult.errorCode, 'CONFIG_INCOMPLETE');
  });

  it('精度レベル2〜4の短い表示と説明が設定半径と一致する', () => {
    for (const level of [2, 3, 4]) {
      const config = ACCURACY_LEVELS.find((candidate) => candidate.level === level);
      assert.ok(config);
      assert.ok(config.shortLabel.includes(`(${config.radiusMeters}m)`));
      assert.ok(config.description.includes(`半径${config.radiusMeters}m程度`));
    }
  });

  it('初期プレースホルダー設定や設定不備の場合はGoogleフォームへの遷移URLを生成せずブロックする', () => {
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setAccuracyLevel(1);
    store.setPinPosition(samplePin);

    // 未設定プレースホルダー設定は検証で false になること
    const placeholderValidation = validateGoogleFormConfig(UNCONFIGURED_PLACEHOLDER_FORM_CONFIG);
    assert.equal(placeholderValidation.valid, false);

    const buildWithPlaceholder = buildGoogleFormUrl(UNCONFIGURED_PLACEHOLDER_FORM_CONFIG, store.getSnapshot());
    assert.equal(buildWithPlaceholder.success, false);
    assert.equal(buildWithPlaceholder.url, null);
    assert.equal(buildWithPlaceholder.errorCode, 'CONFIG_INCOMPLETE');
    assert.ok(buildWithPlaceholder.previewQueryString.includes(sampleRegion.id));
  });

  it('本番の GOOGLE_FORM_CONFIG は検証を通過し、レベル0〜4で正しい事前入力URLを生成できる', () => {
    const validation = validateGoogleFormConfig(GOOGLE_FORM_CONFIG);
    assert.equal(validation.valid, true, '本番のフォーム設定が妥当であること');
    assert.equal(
      GOOGLE_FORM_CONFIG.formUrl,
      'https://docs.google.com/forms/d/e/1FAIpQLSeFYPB0RD6ENjKX9Ju3XvF6kq-fatpaSS4ny1uLDEsMMoBWZA/viewform'
    );
    assert.equal(GOOGLE_FORM_CONFIG.entryIds.regionId, 'entry.849123997');
    assert.equal(GOOGLE_FORM_CONFIG.entryIds.latitude, 'entry.2018650203');
    assert.equal(GOOGLE_FORM_CONFIG.entryIds.longitude, 'entry.1920272994');
    assert.equal(GOOGLE_FORM_CONFIG.entryIds.accuracyRadius, 'entry.1323470590');

    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setPinPosition(samplePin);

    // レベル1（半径 '0'）
    store.setAccuracyLevel(1);
    const resLv1 = buildGoogleFormUrl(GOOGLE_FORM_CONFIG, store.getSnapshot());
    assert.equal(resLv1.success, true);
    const parsedLv1 = new URL(resLv1.url);
    assert.equal(parsedLv1.searchParams.get('usp'), 'pp_url');
    assert.equal(parsedLv1.searchParams.get('entry.849123997'), sampleRegion.id);
    assert.equal(parsedLv1.searchParams.get('entry.2018650203'), samplePin.lat.toFixed(6));
    assert.equal(parsedLv1.searchParams.get('entry.1920272994'), samplePin.lng.toFixed(6));
    assert.equal(parsedLv1.searchParams.get('entry.1323470590'), '0');

    // レベル2〜4（'50', '150', '500'）
    for (const [level, expectedRadius] of [
      [2, '50'],
      [3, '150'],
      [4, '500'],
    ]) {
      store.setAccuracyLevel(level);
      const res = buildGoogleFormUrl(GOOGLE_FORM_CONFIG, store.getSnapshot());
      assert.equal(res.success, true);
      const parsed = new URL(res.url);
      assert.equal(parsed.searchParams.get('entry.849123997'), sampleRegion.id);
      assert.equal(parsed.searchParams.get('entry.2018650203'), samplePin.lat.toFixed(6));
      assert.equal(parsed.searchParams.get('entry.1920272994'), samplePin.lng.toFixed(6));
      assert.equal(parsed.searchParams.get('entry.1323470590'), expectedRadius);
    }

    // レベル0（地域のみ：entry.849123997 のみ送信、緯度・経度・半径省略）
    store.setAccuracyLevel(0);
    const resLv0 = buildGoogleFormUrl(GOOGLE_FORM_CONFIG, store.getSnapshot());
    assert.equal(resLv0.success, true);
    const parsedLv0 = new URL(resLv0.url);
    assert.equal(parsedLv0.searchParams.get('entry.849123997'), sampleRegion.id);
    assert.equal(parsedLv0.searchParams.has('entry.2018650203'), false);
    assert.equal(parsedLv0.searchParams.has('entry.1920272994'), false);
    assert.equal(parsedLv0.searchParams.has('entry.1323470590'), false);
  });

  it('ピン未設置のままレベル1〜4でURL生成を試みた場合は不完全なURLを生成せずエラーを返す', () => {
    const store = new SubmissionStateStore();
    store.selectRegion(sampleRegion);
    store.setAccuracyLevel(2); // ピン未設置

    const result = buildGoogleFormUrl(VALID_TEST_FORM_CONFIG, store.getSnapshot());
    assert.equal(result.success, false);
    assert.equal(result.url, null);
    assert.equal(result.errorCode, 'PIN_REQUIRED');
  });
});

describe('5. UI・レスポンシブ構造・地図出典表記・確認モーダルの統合テスト', () => {
  let rootEl;
  let app;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    rootEl = document.getElementById('app');
  });

  afterEach(() => {
    if (app) {
      app.destroy();
      app = null;
    }
  });

  it('地図上に国土地理院の出典表記（地理院タイル）が常時表示され、地図コンテナと下部スライダーパネルが分離されている', () => {
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: GOOGLE_FORM_CONFIG,
    });
    app.start();
    app.navigateToRegion(REGIONS[0].id);

    const mapStage = rootEl.querySelector('.map-stage');
    const controlPanel = rootEl.querySelector('.control-panel');
    assert.ok(mapStage && controlPanel);
    // スライダーパネルが地図ステージの内部ではなく兄弟要素として分離配置されており、タッチ・ドラッグが干渉しないこと
    assert.equal(mapStage.contains(controlPanel), false);

    // 地理院タイルの出典リンクが地図内に常時存在すること
    const attributionControl = mapStage.querySelector('.leaflet-control-attribution');
    assert.ok(attributionControl, 'Leaflet出典コントロールが存在すること');
    assert.ok(
      attributionControl.innerHTML.includes('地理院タイル'),
      '「地理院タイル」の出典表記が含まれること'
    );
  });

  it('投稿ボタンを押すと確認モーダルが開き、設定未完了時は遷移ボタンが無効化されて案内が表示される', () => {
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: UNCONFIGURED_PLACEHOLDER_FORM_CONFIG, // 未設定プレースホルダー設定
    });
    app.start();
    app.navigateToRegion(REGIONS[0].id);

    // レベル0にして投稿ボタンを押下
    app.getStore().setAccuracyLevel(0);
    const submitBtn = rootEl.querySelector('[data-testid="submit-photo-btn"]');
    submitBtn.click();

    const modal = rootEl.querySelector('.modal-backdrop');
    assert.ok(modal, '確認モーダルが表示されること');
    assert.ok(modal.textContent.includes('Googleアカウント'), 'Googleアカウントの案内があること');
    assert.ok(modal.textContent.includes('未設定のため遷移不可'), '未設定時はダミーURLへ遷移しないこと');
  });

  it('本番のGoogleフォーム設定（GOOGLE_FORM_CONFIG）で確認モーダル内に有効な遷移リンクが生成される', () => {
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: GOOGLE_FORM_CONFIG,
    });
    app.start();
    app.navigateToRegion(REGIONS[0].id);

    app.getStore().setPinPosition(pointInTestRegion(REGIONS[0]));
    app.getStore().setAccuracyLevel(2);

    const submitBtn = rootEl.querySelector('[data-testid="submit-photo-btn"]');
    submitBtn.click();

    const proceedLink = rootEl.querySelector('a.modal-proceed-link');
    assert.ok(proceedLink, '本番設定で有効なGoogleフォーム遷移リンクが表示されること');
    assert.ok(proceedLink.href.includes(`entry.849123997=${REGIONS[0].id}`));
    assert.ok(proceedLink.href.includes('entry.1323470590=50'));
  });

  it('Googleフォーム設定が完了している場合は確認モーダル内に有効な遷移リンクが生成され、タイル読み込みエラーやオフライン時には再読み込み案内が表示される', () => {
    app = new PhotoSpotApp({
      rootElement: rootEl,
      regions: REGIONS,
      formConfig: VALID_TEST_FORM_CONFIG,
    });
    app.start();
    app.navigateToRegion(REGIONS[0].id);

    // ネットワークオフラインイベント発火 -> エラーバナー表示確認
    window.dispatchEvent(new Event('offline'));
    const errorBanner = rootEl.querySelector('.map-error-banner');
    assert.equal(errorBanner.hidden, false, 'オフライン時にエラーバナーが表示されること');

    // 再読み込みは実タイルの成功前に案内を隠さない
    const reloadBtn = errorBanner.querySelector('.map-error-banner__btn');
    reloadBtn.click();
    assert.equal(errorBanner.hidden, false, '再読み込みだけではエラーバナーを閉じないこと');

    // ピンを設置してレベル2（50m）で投稿確認モーダルを開く
    app.getStore().setPinPosition(pointInTestRegion(REGIONS[0]));
    app.getStore().setAccuracyLevel(2);

    const submitBtn = rootEl.querySelector('[data-testid="submit-photo-btn"]');
    submitBtn.click();

    const proceedLink = rootEl.querySelector('a.modal-proceed-link');
    assert.ok(proceedLink, '有効なGoogleフォーム遷移リンクが表示されること');
    assert.ok(proceedLink.href.includes(`entry.111111111=${REGIONS[0].id}`));
    assert.ok(proceedLink.href.includes('entry.444444444=50'));
  });
});
