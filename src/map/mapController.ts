import * as L from 'leaflet';
import { isPointWithinBounds } from '../domain/regionValidator';
import type { SubmissionStateSnapshot } from '../domain/submissionState';
import type { LatLng, RegionBounds, RegionConfig } from '../types';

/**
 * 国土地理院 淡色地図タイルのURLテンプレート（仕様要件 1 / 2.2 / 3.2）
 */
export const GSI_PALE_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
export const GSI_STD_TILE_URL = GSI_PALE_TILE_URL;

/**
 * 国土地理院 出典表記HTML（仕様要件 3.2 / 6 / 11：常時表示）
 */
export const GSI_ATTRIBUTION_HTML =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>';

/**
 * 地図コントローラーからのイベント通知コールバック型
 */
export interface MapControllerCallbacks {
  /** 利用者が地図上の有効な募集範囲内をクリック・タップ、またはピンをドラッグ移動したとき */
  onPinPositionSelected: (position: LatLng) => void;
  /** 利用者が募集対象範囲外をタップ、または範囲外へピンをドラッグしたとき */
  onOutOfBoundsAttempt: (attemptedPosition: LatLng, reason: 'click' | 'drag') => void;
  /** レベル0（地域のみ）の状態で地図上をタップしたとき */
  onTapWhileRegionOnly?: (attemptedPosition: LatLng) => void;
  /** 地図タイルの読み込み失敗やネットワーク切断が発生・解消したとき */
  onMapLoadIssue: (hasIssue: boolean, message: string | null) => void;
}

/**
 * 募集対象範囲（bounds）から周辺移動可能範囲（maxBounds）を算出する
 * 仕様要件 3.2「地図の表示・移動可能範囲は募集対象範囲より広く設定する」に対応
 * PCのワイドモニター（1280px〜2560px幅）でも縮小（ズームアウト）操作が制限されないよう、
 * 募集範囲の10倍または最低±0.25度（約25km四方）の十分な周辺余裕を持たせます。
 */
export function computeExpandedMaxBounds(bounds: RegionBounds, expandFactor = 10): L.LatLngBoundsExpression {
  const latSpan = Math.max(bounds.northEast.lat - bounds.southWest.lat, 0.02);
  const lngSpan = Math.max(bounds.northEast.lng - bounds.southWest.lng, 0.02);

  const latPad = Math.max(latSpan * expandFactor, 0.25);
  const lngPad = Math.max(lngSpan * expandFactor, 0.25);

  const south = Math.max(-85, bounds.southWest.lat - latPad);
  const north = Math.min(85, bounds.northEast.lat + latPad);
  const west = Math.max(-180, bounds.southWest.lng - lngPad);
  const east = Math.min(180, bounds.northEast.lng + lngPad);

  return [
    [south, west],
    [north, east],
  ];
}

/**
 * 視認性の高いカスタムSVGピンアイコンを生成する
 * デフォルト画像パスへの依存を排除し、GitHub Pagesのサブパス環境でも確実に描画します。
 */
function createPinIcon(): L.DivIcon {
  const svgHtml = `
    <div class="custom-map-pin" aria-label="選択された撮影地点ピン">
      <svg viewBox="0 0 36 46" width="36" height="46" xmlns="http://www.w3.org/2000/svg" role="img">
        <path d="M18 2C9.716 2 3 8.716 3 17c0 10.65 13.05 24.72 14.08 25.81a1.25 1.25 0 0 0 1.84 0C19.95 41.72 33 27.65 33 17 33 8.716 26.284 2 18 2z"
              fill="#dc2626" stroke="#ffffff" stroke-width="2.5" />
        <circle cx="18" cy="17" r="6.5" fill="#ffffff" />
      </svg>
    </div>
  `;

  return L.divIcon({
    className: 'custom-map-pin-wrapper',
    html: svgHtml,
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    popupAnchor: [0, -42],
  });
}

/**
 * Leaflet地図の初期化・募集範囲描画・ピン操作・精度円描画を管理するクラス（仕様要件 2.2 / 3 / 8）
 */
export class MapController {
  private map: L.Map | null = null;
  private tileLayer: L.TileLayer | null = null;
  private regionRectangle: L.Rectangle | null = null;
  private pinMarker: L.Marker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private currentRegion: RegionConfig | null = null;
  private currentSnapshot: SubmissionStateSnapshot | null = null;
  private tileBatchActive = false;
  private tileBatchSuccessCount = 0;
  private readonly visibleTiles = new Map<string, HTMLImageElement>();
  private readonly failedVisibleTileKeys = new Set<string>();
  private lastCompletedVisibleBatchHadSuccess = false;
  private mapIssueMessage: string | null = null;
  private isNetworkOffline = false;

  private readonly callbacks: MapControllerCallbacks;
  private readonly handleOnlineBound: () => void;
  private readonly handleOfflineBound: () => void;

  constructor(callbacks: MapControllerCallbacks) {
    this.callbacks = callbacks;
    this.handleOnlineBound = () => this.handleNetworkChange(true);
    this.handleOfflineBound = () => this.handleNetworkChange(false);
  }

  /**
   * 指定されたDOMコンテナにLeaflet地図を初期化し、対象地域を表示する
   */
  public init(
    container: HTMLElement,
    region: RegionConfig,
    initialSnapshot: SubmissionStateSnapshot
  ): void {
    this.destroy();

    this.currentRegion = region;
    this.currentSnapshot = initialSnapshot;
    this.resetTileBatch();
    this.visibleTiles.clear();
    this.failedVisibleTileKeys.clear();
    this.lastCompletedVisibleBatchHadSuccess = false;
    this.mapIssueMessage = null;
    this.isNetworkOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    const expandedMaxBounds = computeExpandedMaxBounds(region.bounds);

    // Leaflet地図インスタンスの生成（ドラッグ移動・ホイールズーム・ピンチズーム・ズームボタン有効）
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: true,
      touchZoom: true,
      doubleClickZoom: false, // ダブルタップ時に誤ってピン設置と競合しないよう調整
      boxZoom: true,
      keyboard: true,
      maxBounds: expandedMaxBounds,
      maxBoundsViscosity: 0.75,
      minZoom: 5,
      maxZoom: 18,
    });

    // 右上に操作しやすいズームボタンを配置
    L.control
      .zoom({
        position: 'topright',
        zoomInTitle: '地図を拡大',
        zoomOutTitle: '地図を縮小',
      })
      .addTo(map);

    // 出典表記のプレフィックスをシンプルに保ち、国土地理院の出典を常時表示
    map.attributionControl.setPrefix('Leaflet');

    // 国土地理院タイルレイヤー（淡色地図：ズームレベル5〜18提供）の追加
    const tileLayer = L.tileLayer(GSI_PALE_TILE_URL, {
      attribution: GSI_ATTRIBUTION_HTML,
      minZoom: 5,
      maxNativeZoom: 18,
      maxZoom: 18,
      crossOrigin: true,
    });

    tileLayer.on('tileloadstart', (event: L.TileEvent) => {
      this.beginTileBatch();
      this.visibleTiles.set(this.getTileKey(event.coords), event.tile);
    });

    tileLayer.on('tileload', (event: L.TileEvent) => {
      const tileKey = this.getTileKey(event.coords);
      if (this.visibleTiles.get(tileKey) === event.tile) {
        this.beginTileBatch();
        this.tileBatchSuccessCount += 1;
        this.failedVisibleTileKeys.delete(tileKey);
      }
    });

    tileLayer.on('tileerror', (event: L.TileErrorEvent) => {
      const tileKey = this.getTileKey(event.coords);
      // 画面から外れた後に遅れて届いた失敗通知は、現表示の失敗として数えない。
      if (this.visibleTiles.get(tileKey) !== event.tile) {
        return;
      }
      this.beginTileBatch();
      this.failedVisibleTileKeys.add(tileKey);
      this.setMapIssue(
        this.isNetworkOffline
          ? 'ネットワーク接続がオフラインになっています。インターネット接続を確認してください。'
          : '地図タイルの読み込みに失敗しました。インターネット接続を確認するか、「地図を再読み込み」ボタンを押してください。'
      );
    });

    tileLayer.on('tileunload', (event: L.TileEvent) => {
      const tileKey = this.getTileKey(event.coords);
      if (this.visibleTiles.get(tileKey) !== event.tile) {
        return;
      }
      this.visibleTiles.delete(tileKey);
      this.failedVisibleTileKeys.delete(tileKey);
      if (
        this.lastCompletedVisibleBatchHadSuccess &&
        this.failedVisibleTileKeys.size === 0 &&
        !this.isNetworkOffline
      ) {
        this.clearMapIssue();
      }
    });

    tileLayer.on('load', () => {
      // Leaflet の load は失敗タイルを含む全要求の完了時にも発火するため、
      // 1件以上の成功と、現表示に失敗タイルが残っていないことを確認します。
      this.lastCompletedVisibleBatchHadSuccess =
        this.tileBatchActive && this.tileBatchSuccessCount > 0 && !this.isNetworkOffline;
      if (this.lastCompletedVisibleBatchHadSuccess && this.failedVisibleTileKeys.size === 0) {
        this.clearMapIssue();
      }
      this.resetTileBatch();
    });

    tileLayer.addTo(map);

    // ネットワーク状態の監視
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnlineBound);
      window.addEventListener('offline', this.handleOfflineBound);
      if (navigator.onLine === false) {
        this.handleNetworkChange(false);
      }
    }

    this.map = map;
    this.tileLayer = tileLayer;

    // 募集対象範囲の四角形を描画
    this.renderRegionBounds(region.bounds);

    // 初期表示で選択地域の募集対象範囲全体が画面内に収まるよう調整
    this.fitToRegionBounds();

    // 地図クリック・タップによるピン設置イベントの登録
    map.on('click', (event: L.LeafletMouseEvent) => {
      this.handleMapClick({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    });

    // 初期状態スナップショットの反映
    this.syncWithState(initialSnapshot);
  }

  /**
   * 募集対象範囲全体が画面内に収まるように表示範囲をリセットする
   */
  public fitToRegionBounds(): void {
    if (!this.map || !this.currentRegion) {
      return;
    }
    const { southWest, northEast } = this.currentRegion.bounds;
    const leafletBounds = L.latLngBounds(
      [southWest.lat, southWest.lng],
      [northEast.lat, northEast.lng]
    );
    this.map.fitBounds(leafletBounds, {
      padding: [28, 28],
      maxZoom: 16,
    });
  }

  /**
   * 地図の現在の中央地点を撮影地点として確定する。
   * 地図をパンしただけでは位置状態を変更せず、利用者がこの操作を実行した時点で既存の範囲判定へ渡す。
   */
  public selectMapCenterAsPin(): void {
    if (!this.map) {
      return;
    }
    const center = this.map.getCenter();
    this.handleMapClick({ lat: center.lat, lng: center.lng });
  }

  /**
   * 地図タイルの再読み込みを試行する（エラー発生時のリカバリ用）
   */
  public reloadTiles(): void {
    this.resetTileBatch();
    this.lastCompletedVisibleBatchHadSuccess = false;
    if (this.tileLayer) {
      this.tileLayer.redraw();
    }
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  /**
   * コンテナのサイズ変更時に地図レイアウトを再計算する
   */
  public invalidateSize(): void {
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  /**
   * 状態ストアのスナップショットと地図上のピン・位置精度円を同期する
   * - レベル0: ピンと円を非表示
   * - レベル1: ピンのみ表示、円は非表示
   * - レベル2〜4: ピンと実距離（m）に基づく半透明円を表示
   */
  public syncWithState(snapshot: SubmissionStateSnapshot): void {
    this.currentSnapshot = snapshot;
    if (!this.map) {
      return;
    }

    const pos = snapshot.effectivePinPosition;

    // 1. ピンの表示・非表示・位置更新
    if (snapshot.shouldShowPin && pos !== null) {
      if (!this.pinMarker) {
        this.pinMarker = this.createDraggableMarker(pos);
        this.pinMarker.addTo(this.map);
      } else {
        const currentLatLng = this.pinMarker.getLatLng();
        if (currentLatLng.lat !== pos.lat || currentLatLng.lng !== pos.lng) {
          this.pinMarker.setLatLng([pos.lat, pos.lng]);
        }
        if (!this.map.hasLayer(this.pinMarker)) {
          this.pinMarker.addTo(this.map);
        }
      }
    } else if (this.pinMarker && this.map.hasLayer(this.pinMarker)) {
      this.map.removeLayer(this.pinMarker);
    }

    // 2. 位置精度を示す半透明円の表示・非表示・半径更新（実距離メートル指定）
    if (
      snapshot.shouldShowCircle &&
      pos !== null &&
      snapshot.activeCircleRadiusMeters !== null &&
      snapshot.activeCircleRadiusMeters > 0
    ) {
      const radiusMeters = snapshot.activeCircleRadiusMeters;
      if (!this.accuracyCircle) {
        // 募集対象範囲（青色破線）と明確に区別できる暖色（オレンジ系）で描画
        // interactive: false により、円が画面外に及ぶ場合も地図ドラッグやタップを一切妨げない（仕様要件 6 / 7.2）
        this.accuracyCircle = L.circle([pos.lat, pos.lng], {
          radius: radiusMeters,
          color: '#ea580c',
          weight: 2.5,
          opacity: 0.9,
          fillColor: '#f97316',
          fillOpacity: 0.22,
          interactive: false,
        });
        this.accuracyCircle.addTo(this.map);
      } else {
        this.accuracyCircle.setLatLng([pos.lat, pos.lng]);
        this.accuracyCircle.setRadius(radiusMeters);
        if (!this.map.hasLayer(this.accuracyCircle)) {
          this.accuracyCircle.addTo(this.map);
        }
      }
    } else if (this.accuracyCircle && this.map.hasLayer(this.accuracyCircle)) {
      this.map.removeLayer(this.accuracyCircle);
    }
  }

  /**
   * テストおよび外部参照用に現在の描画状態を取得する
   */
  public getDebugLayerState(): {
    isInitialized: boolean;
    hasRegionRectangle: boolean;
    isPinVisible: boolean;
    pinLatLng: LatLng | null;
    isCircleVisible: boolean;
    circleRadiusMeters: number | null;
    zoom: number | null;
  } {
    if (!this.map) {
      return {
        isInitialized: false,
        hasRegionRectangle: false,
        isPinVisible: false,
        pinLatLng: null,
        isCircleVisible: false,
        circleRadiusMeters: null,
        zoom: null,
      };
    }

    const isPinVisible = Boolean(this.pinMarker && this.map.hasLayer(this.pinMarker));
    const isCircleVisible = Boolean(this.accuracyCircle && this.map.hasLayer(this.accuracyCircle));
    const markerPos = this.pinMarker ? this.pinMarker.getLatLng() : null;

    return {
      isInitialized: true,
      hasRegionRectangle: Boolean(this.regionRectangle && this.map.hasLayer(this.regionRectangle)),
      isPinVisible,
      pinLatLng: isPinVisible && markerPos ? { lat: markerPos.lat, lng: markerPos.lng } : null,
      isCircleVisible,
      circleRadiusMeters:
        isCircleVisible && this.accuracyCircle ? this.accuracyCircle.getRadius() : null,
      zoom: this.map.getZoom(),
    };
  }

  /**
   * 現在のLeaflet Mapインスタンスを取得する（テストおよび高度な制御用）
   */
  public getMapInstance(): L.Map | null {
    return this.map;
  }

  /**
   * 画面遷移時にイベントリスナーおよびLeafletインスタンスを完全に破棄する（仕様要件 8）
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnlineBound);
      window.removeEventListener('offline', this.handleOfflineBound);
    }

    if (this.pinMarker) {
      this.pinMarker.off();
      this.pinMarker = null;
    }
    if (this.accuracyCircle) {
      this.accuracyCircle = null;
    }
    if (this.regionRectangle) {
      this.regionRectangle = null;
    }
    if (this.tileLayer) {
      this.tileLayer.off();
      this.tileLayer = null;
    }
    if (this.map) {
      this.map.off();
      this.map.remove();
      this.map = null;
    }

    this.currentRegion = null;
    this.currentSnapshot = null;
    this.resetTileBatch();
    this.visibleTiles.clear();
    this.failedVisibleTileKeys.clear();
    this.lastCompletedVisibleBatchHadSuccess = false;
    this.mapIssueMessage = null;
    this.isNetworkOffline = false;
  }

  /**
   * 募集対象範囲の四角形を地図上に描画する
   * 位置精度の円（オレンジ色）と視覚的に区別しやすい青色系の枠線・破線を採用
   */
  private renderRegionBounds(bounds: RegionBounds): void {
    if (!this.map) {
      return;
    }
    const { southWest, northEast } = bounds;
    const rectBounds: L.LatLngBoundsExpression = [
      [southWest.lat, southWest.lng],
      [northEast.lat, northEast.lng],
    ];

    this.regionRectangle = L.rectangle(rectBounds, {
      color: '#1d4ed8',
      weight: 3,
      opacity: 0.95,
      dashArray: '8, 6',
      fillColor: '#3b82f6',
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(this.map);
  }

  /**
   * ドラッグ移動可能なピンマーカーを生成する
   */
  private createDraggableMarker(initialPosition: LatLng): L.Marker {
    const marker = L.marker([initialPosition.lat, initialPosition.lng], {
      draggable: true,
      icon: createPinIcon(),
      title: '撮影地点（ドラッグして微調整できます）',
      alt: '選択された撮影地点ピン',
    });

    // ドラッグ中に円もリアルタイムで追従させる（募集範囲内の場合）
    marker.on('drag', () => {
      if (!this.currentRegion || !this.accuracyCircle || !this.map) {
        return;
      }
      const current = marker.getLatLng();
      if (
        isPointWithinBounds({ lat: current.lat, lng: current.lng }, this.currentRegion.bounds) &&
        this.map.hasLayer(this.accuracyCircle)
      ) {
        this.accuracyCircle.setLatLng(current);
      }
    });

    // ドラッグ終了時に募集範囲内か判定し、範囲外なら元の有効位置へ戻して案内を表示する
    marker.on('dragend', () => {
      if (!this.currentRegion) {
        return;
      }
      const dropped = marker.getLatLng();
      const candidate: LatLng = { lat: dropped.lat, lng: dropped.lng };

      if (isPointWithinBounds(candidate, this.currentRegion.bounds)) {
        this.callbacks.onPinPositionSelected(candidate);
      } else {
        // 範囲外への移動を禁止し、直前の有効なピン位置に復元する
        const fallback = this.currentSnapshot?.effectivePinPosition ?? initialPosition;
        marker.setLatLng([fallback.lat, fallback.lng]);
        if (this.accuracyCircle && this.map?.hasLayer(this.accuracyCircle)) {
          this.accuracyCircle.setLatLng([fallback.lat, fallback.lng]);
        }
        this.callbacks.onOutOfBoundsAttempt(candidate, 'drag');
      }
    });

    return marker;
  }

  /**
   * 地図クリック・タップ時の処理
   */
  private handleMapClick(clickedPosition: LatLng): void {
    if (!this.currentRegion) {
      return;
    }

    // レベル0（地域のみ）選択中にタップされた場合
    if (this.currentSnapshot && this.currentSnapshot.accuracyLevel === 0) {
      if (!isPointWithinBounds(clickedPosition, this.currentRegion.bounds)) {
        this.callbacks.onOutOfBoundsAttempt(clickedPosition, 'click');
        return;
      }
      if (this.callbacks.onTapWhileRegionOnly) {
        this.callbacks.onTapWhileRegionOnly(clickedPosition);
      }
      return;
    }

    // 募集対象範囲内かチェック
    if (!isPointWithinBounds(clickedPosition, this.currentRegion.bounds)) {
      this.callbacks.onOutOfBoundsAttempt(clickedPosition, 'click');
      return;
    }

    this.callbacks.onPinPositionSelected(clickedPosition);
  }

  private beginTileBatch(): void {
    if (this.tileBatchActive) {
      return;
    }
    this.tileBatchActive = true;
    this.tileBatchSuccessCount = 0;
    this.lastCompletedVisibleBatchHadSuccess = false;
  }

  private resetTileBatch(): void {
    this.tileBatchActive = false;
    this.tileBatchSuccessCount = 0;
  }

  private getTileKey(coords: L.Coords): string {
    return `${coords.z}:${coords.x}:${coords.y}`;
  }

  private setMapIssue(message: string): void {
    if (this.mapIssueMessage === message) {
      return;
    }
    this.mapIssueMessage = message;
    this.callbacks.onMapLoadIssue(true, message);
  }

  private clearMapIssue(): void {
    if (this.mapIssueMessage === null) {
      return;
    }
    this.mapIssueMessage = null;
    this.callbacks.onMapLoadIssue(false, null);
  }

  /**
   * オンライン・オフライン状態変化時の通知処理
   */
  private handleNetworkChange(isOnline: boolean): void {
    this.isNetworkOffline = !isOnline;
    if (!isOnline) {
      this.setMapIssue(
        'ネットワーク接続がオフラインになっています。インターネット接続を確認してください。'
      );
    } else {
      // オンライン通知だけではタイル取得の成功を保証しないため、再試行後の成功を待つ。
      this.reloadTiles();
    }
  }
}
