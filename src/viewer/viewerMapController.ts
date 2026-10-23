import * as L from 'leaflet';
import { GSI_ATTRIBUTION_HTML, GSI_PALE_TILE_URL } from '../map/mapController';
import type { RegionConfig } from '../types';
import type { PhotoSubmissionRecord } from './photoViewerTypes';

/**
 * HTMLエスケープ用ヘルパー（XSS防止）
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 位置精度半径の表示ラベルを生成する
 */
export function formatAccuracyBadgeText(radius: number | null): string {
  if (radius === null) {
    return 'Lv.0 地域のみ（座標なし）';
  }
  if (radius === 0) {
    return 'Lv.1 正確な地点 (0m)';
  }
  return `おおよその地点 (半径${radius}m)`;
}

/**
 * ビューワー地図のイベントコールバック
 */
export interface ViewerMapCallbacks {
  /** ピンまたはポップアップの「拡大表示」がクリックされたとき */
  onOpenLightbox: (record: PhotoSubmissionRecord, imageIndex: number) => void;
  /** ピンが選択（クリック）されたとき */
  onSelectRecord: (recordId: string) => void;
}

/**
 * 投稿レコード（3パターン：写真のみ / コメントのみ / 写真＆コメント両方）に応じた
 * カスタムピン（L.DivIcon）を生成する
 */
function createSubmissionPinIcon(record: PhotoSubmissionRecord): L.DivIcon {
  const hasPhoto = record.imageUrls.length > 0;
  const hasComment = record.comment.trim().length > 0;
  const escapedAuthor = escapeHtml(record.contributorName);

  // パターン1 & 3: 写真がある場合（写真のみ / 写真＆コメント両方）
  if (hasPhoto) {
    const thumbUrl = escapeHtml(record.imageUrls[0]!);
    const countBadge =
      record.imageUrls.length > 1
        ? `<span class="viewer-pin__count-badge">+${record.imageUrls.length - 1}</span>`
        : '';
    const commentBadge = hasComment
      ? `<span class="viewer-pin__comment-badge" title="コメントあり" aria-label="コメントあり">💬</span>`
      : '';

    const html = `
      <div class="viewer-pin viewer-pin--photo ${hasComment ? 'viewer-pin--has-comment' : ''}"
           data-testid="viewer-map-pin"
           data-record-id="${escapeHtml(record.id)}"
           data-content-type="${record.contentType}"
           aria-label="${escapedAuthor}さんの投稿ピン">
        <div class="viewer-pin__frame">
          <img class="viewer-pin__img" src="${thumbUrl}" alt="${escapedAuthor}さんの投稿写真" />
        </div>
        ${countBadge}
        ${commentBadge}
        <div class="viewer-pin__tip"></div>
      </div>
    `;

    return L.divIcon({
      className: 'viewer-pin-wrapper',
      html,
      iconSize: [58, 68],
      iconAnchor: [29, 64],
      popupAnchor: [0, -60],
      tooltipAnchor: [0, -58],
    });
  }

  // パターン2: コメントのみ（写真なし）の場合 — 空画像枠を一切出さず吹き出しピンとして美しく表示
  const shortSnippet =
    record.comment.trim().length > 10
      ? `${ record.comment.trim().slice(0, 10) }…`
      : record.comment.trim() || escapedAuthor;

  const html = `
    <div class="viewer-pin viewer-pin--comment-only"
         data-testid="viewer-map-pin"
         data-record-id="${escapeHtml(record.id)}"
         data-content-type="${record.contentType}"
         aria-label="${escapedAuthor}さんのコメントピン">
      <div class="viewer-pin__bubble">
        <span class="viewer-pin__bubble-icon" aria-hidden="true">💬</span>
        <span class="viewer-pin__bubble-text">${escapeHtml(shortSnippet)}</span>
      </div>
      <div class="viewer-pin__tip viewer-pin__tip--comment"></div>
    </div>
  `;

  return L.divIcon({
    className: 'viewer-pin-wrapper',
    html,
    iconSize: [132, 48],
    iconAnchor: [66, 46],
    popupAnchor: [0, -42],
    tooltipAnchor: [0, -40],
  });
}

/**
 * ピンにカーソルを合わせたとき（Hover）の拡大プレビューカードHTMLを生成する
 * - 写真のみ / コメントのみ / 写真＆コメント両方の3パターンに最適化
 */
export function buildHoverTooltipHtml(record: PhotoSubmissionRecord): string {
  const hasPhoto = record.imageUrls.length > 0;
  const hasComment = record.comment.trim().length > 0;
  const escapedAuthor = escapeHtml(record.contributorName);
  const escapedRegion = escapeHtml(record.regionName);
  const badgeText = escapeHtml(formatAccuracyBadgeText(record.accuracyRadius));

  const photoSection = hasPhoto
    ? `
      <div class="viewer-hover-card__media">
        <img class="viewer-hover-card__img" src="${escapeHtml(record.imageUrls[0]!)}" alt="${escapedAuthor}さんの投稿写真" />
        ${
          record.imageUrls.length > 1
            ? `<span class="viewer-hover-card__multi">全${record.imageUrls.length}枚</span>`
            : ''
        }
      </div>
    `
    : '';

  const commentPreviewText =
    record.comment.trim().length > 90
      ? `${record.comment.trim().slice(0, 90)}…`
      : record.comment.trim();

  const commentSection = hasComment
    ? `
      <div class="viewer-hover-card__comment ${!hasPhoto ? 'viewer-hover-card__comment--featured' : ''}">
        <p class="viewer-hover-card__comment-text">${escapeHtml(commentPreviewText)}</p>
      </div>
    `
    : '';

  return `
    <div class="viewer-hover-card viewer-hover-card--${record.contentType}" data-testid="viewer-hover-card">
      ${photoSection}
      <div class="viewer-hover-card__body">
        <div class="viewer-hover-card__meta">
          <strong class="viewer-hover-card__author">👤 ${escapedAuthor}</strong>
          <span class="viewer-hover-card__region">${escapedRegion}</span>
        </div>
        ${commentSection}
        <div class="viewer-hover-card__footer">
          <span class="viewer-hover-card__badge">${badgeText}</span>
          <span class="viewer-hover-card__hint">クリックで詳細表示</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * ピンをクリックしたとき（Click）の詳細ポップアップDOM要素を生成する
 * - 写真のみ / コメントのみ / 写真＆コメント両方の3パターンに最適化
 */
export function buildClickPopupElement(
  record: PhotoSubmissionRecord,
  callbacks: ViewerMapCallbacks
): HTMLElement {
  const hasPhoto = record.imageUrls.length > 0;
  const hasComment = record.comment.trim().length > 0;

  const wrapper = document.createElement('div');
  wrapper.className = `viewer-popup-card viewer-popup-card--${record.contentType}`;
  wrapper.setAttribute('data-testid', 'viewer-popup-card');
  wrapper.setAttribute('data-record-id', record.id);

  // 1. ヘッダー（撮影者名・地域名・日時）
  const header = document.createElement('div');
  header.className = 'viewer-popup-card__header';
  header.innerHTML = `
    <div class="viewer-popup-card__title-row">
      <strong class="viewer-popup-card__author">👤 ${escapeHtml(record.contributorName)}</strong>
      <span class="viewer-popup-card__region-badge">${escapeHtml(record.regionName)}</span>
    </div>
    ${
      record.timestamp
        ? `<div class="viewer-popup-card__time">🕒 ${escapeHtml(record.timestamp)}</div>`
        : ''
    }
  `;
  wrapper.appendChild(header);

  // 2. 写真セクション（写真がある場合のみ表示）
  if (hasPhoto) {
    let activeImgIdx = 0;
    const mediaBox = document.createElement('div');
    mediaBox.className = 'viewer-popup-card__media';

    const imgEl = document.createElement('img');
    imgEl.className = 'viewer-popup-card__img';
    imgEl.src = record.imageUrls[0]!;
    imgEl.alt = `${record.contributorName}さんの投稿写真`;
    imgEl.title = 'クリックでフルスクリーン拡大';
    imgEl.addEventListener('click', () => {
      callbacks.onOpenLightbox(record, activeImgIdx);
    });
    mediaBox.appendChild(imgEl);

    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'btn btn--small viewer-popup-card__zoom-btn';
    zoomBtn.setAttribute('data-testid', 'popup-open-lightbox-btn');
    zoomBtn.textContent = '🔍 写真を拡大表示';
    zoomBtn.addEventListener('click', () => {
      callbacks.onOpenLightbox(record, activeImgIdx);
    });
    mediaBox.appendChild(zoomBtn);

    if (record.imageUrls.length > 1) {
      const navRow = document.createElement('div');
      navRow.className = 'viewer-popup-card__gallery-nav';
      record.imageUrls.forEach((url, idx) => {
        const dotBtn = document.createElement('button');
        dotBtn.type = 'button';
        dotBtn.className = `viewer-popup-card__thumb-btn ${idx === 0 ? 'is-active' : ''}`;
        dotBtn.textContent = `${idx + 1}`;
        dotBtn.addEventListener('click', () => {
          activeImgIdx = idx;
          imgEl.src = url;
          navRow.querySelectorAll('.viewer-popup-card__thumb-btn').forEach((b, i) => {
            b.classList.toggle('is-active', i === idx);
          });
        });
        navRow.appendChild(dotBtn);
      });
      mediaBox.appendChild(navRow);
    }

    wrapper.appendChild(mediaBox);
  }

  // 3. コメントセクション（コメントがある場合のみ表示）
  if (hasComment) {
    const commentBox = document.createElement('div');
    commentBox.className = `viewer-popup-card__comment-box ${
      !hasPhoto ? 'viewer-popup-card__comment-box--hero' : ''
    }`;
    commentBox.setAttribute('data-testid', 'viewer-popup-comment');

    const label = document.createElement('div');
    label.className = 'viewer-popup-card__comment-label';
    label.textContent = '💬 投稿コメント';
    commentBox.appendChild(label);

    const textP = document.createElement('p');
    textP.className = 'viewer-popup-card__comment-text';
    textP.textContent = record.comment;
    commentBox.appendChild(textP);

    wrapper.appendChild(commentBox);
  }

  // 4. フッター（位置情報・精度メタデータ）
  const metaFooter = document.createElement('div');
  metaFooter.className = 'viewer-popup-card__meta-footer';
  const coordStr =
    record.latitude !== null && record.longitude !== null
      ? `北緯 ${record.latitude.toFixed(6)}°, 東経 ${record.longitude.toFixed(6)}°`
      : '座標指定なし（地域のみ投稿）';

  metaFooter.innerHTML = `
    <div class="viewer-popup-card__meta-item">
      <span class="viewer-popup-card__meta-label">位置精度:</span>
      <strong class="viewer-popup-card__meta-val">${escapeHtml(formatAccuracyBadgeText(record.accuracyRadius))}</strong>
    </div>
    <div class="viewer-popup-card__meta-item">
      <span class="viewer-popup-card__meta-label">記録座標:</span>
      <code class="viewer-popup-card__meta-code">${escapeHtml(coordStr)}</code>
    </div>
  `;
  wrapper.appendChild(metaFooter);

  return wrapper;
}

/**
 * ビューワー用Leaflet地図コントローラー
 */
export class ViewerMapController {
  private map: L.Map | null = null;
  private boundsLayerGroup: L.LayerGroup | null = null;
  private markersLayerGroup: L.LayerGroup | null = null;
  private activeAccuracyCircle: L.Circle | null = null;
  private markerById = new Map<string, L.Marker>();
  private recordById = new Map<string, PhotoSubmissionRecord>();
  private readonly callbacks: ViewerMapCallbacks;

  constructor(callbacks: ViewerMapCallbacks) {
    this.callbacks = callbacks;
  }

  public init(container: HTMLElement, regions: readonly RegionConfig[]): void {
    this.destroy();

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: true,
      touchZoom: true,
      minZoom: 5,
      maxZoom: 18,
    });

    L.control
      .zoom({
        position: 'topright',
        zoomInTitle: '地図を拡大',
        zoomOutTitle: '地図を縮小',
      })
      .addTo(map);

    map.attributionControl.setPrefix('Leaflet');

    L.tileLayer(GSI_PALE_TILE_URL, {
      attribution: GSI_ATTRIBUTION_HTML,
      minZoom: 5,
      maxNativeZoom: 18,
      maxZoom: 18,
      crossOrigin: true,
    }).addTo(map);

    this.boundsLayerGroup = L.layerGroup().addTo(map);
    this.markersLayerGroup = L.layerGroup().addTo(map);
    this.map = map;

    this.renderRegionBounds(regions, 'all');
  }

  /**
   * 募集対象地域の青い破線枠を描画し、必要に応じて表示範囲をフィットする
   */
  public renderRegionBounds(
    regions: readonly RegionConfig[],
    selectedRegionId: string,
    fitBounds = true
  ): void {
    if (!this.map || !this.boundsLayerGroup) return;
    this.boundsLayerGroup.clearLayers();

    const targetRegions =
      selectedRegionId === 'all'
        ? regions
        : regions.filter((r) => r.id === selectedRegionId);

    const allBoundsPoints: L.LatLngTuple[] = [];

    for (const region of targetRegions) {
      const { southWest, northEast } = region.bounds;
      const rectBounds: L.LatLngBoundsExpression = [
        [southWest.lat, southWest.lng],
        [northEast.lat, northEast.lng],
      ];
      const rect = L.rectangle(rectBounds, {
        color: '#1d4ed8',
        weight: 2.5,
        dashArray: '8, 6',
        fillColor: '#3b82f6',
        fillOpacity: 0.05,
        interactive: false,
      });
      this.boundsLayerGroup.addLayer(rect);

      allBoundsPoints.push([southWest.lat, southWest.lng]);
      allBoundsPoints.push([northEast.lat, northEast.lng]);
    }

    if (fitBounds && allBoundsPoints.length >= 2) {
      this.map.fitBounds(L.latLngBounds(allBoundsPoints), {
        padding: [36, 36],
        maxZoom: 15,
      });
    }
  }

  /**
   * 指定された投稿レコード一覧（座標あり）のピンを地図上に展開する
   */
  public renderSubmissions(
    records: readonly PhotoSubmissionRecord[],
    fitToPins = false
  ): void {
    if (!this.map || !this.markersLayerGroup) return;
    this.markersLayerGroup.clearLayers();
    this.markerById.clear();
    this.recordById.clear();
    this.hideAccuracyCircle();

    const pinCoords: L.LatLngTuple[] = [];

    for (const rec of records) {
      if (rec.latitude === null || rec.longitude === null) continue;

      this.recordById.set(rec.id, rec);
      const latLng: L.LatLngTuple = [rec.latitude, rec.longitude];
      pinCoords.push(latLng);

      const marker = L.marker(latLng, {
        icon: createSubmissionPinIcon(rec),
        title: `${rec.contributorName} (${rec.regionName})`,
      });

      // 1. ピンにカーソルを合わせたとき（Hover）：拡大写真＋コメントプレビューのツールチップ表示 ＆ 精度円表示
      marker.bindTooltip(buildHoverTooltipHtml(rec), {
        direction: 'top',
        offset: [0, -4],
        opacity: 1,
        className: 'viewer-hover-tooltip',
      });

      marker.on('mouseover', () => {
        this.showAccuracyCircle(rec);
      });

      marker.on('mouseout', () => {
        if (!marker.isPopupOpen()) {
          this.hideAccuracyCircle();
        }
      });

      // 2. ピンをクリックしたとき（Click）：詳細ポップアップ表示 ＆ 精度円表示
      const popupContent = buildClickPopupElement(rec, this.callbacks);
      marker.bindPopup(popupContent, {
        maxWidth: 340,
        minWidth: 260,
        className: 'viewer-detail-popup',
      });

      marker.on('popupopen', () => {
        this.showAccuracyCircle(rec);
        this.callbacks.onSelectRecord(rec.id);
      });

      marker.on('popupclose', () => {
        this.hideAccuracyCircle();
      });

      this.markersLayerGroup.addLayer(marker);
      this.markerById.set(rec.id, marker);
    }

    if (fitToPins && pinCoords.length > 0) {
      this.map.fitBounds(L.latLngBounds(pinCoords), {
        padding: [56, 56],
        maxZoom: 16,
      });
    }
  }

  /**
   * 特定の投稿ピンにフォーカスし、ポップアップを開く
   */
  public focusSubmissionPin(recordId: string): void {
    const marker = this.markerById.get(recordId);
    const rec = this.recordById.get(recordId);
    if (!this.map || !marker || !rec || rec.latitude === null || rec.longitude === null) {
      return;
    }

    this.map.setView([rec.latitude, rec.longitude], Math.max(this.map.getZoom(), 15), {
      animate: true,
    });
    marker.openPopup();
    this.showAccuracyCircle(rec);
  }

  /**
   * 位置精度半径（50m / 150m / 500m）が設定されている場合にオレンジ色の円を表示する
   */
  private showAccuracyCircle(record: PhotoSubmissionRecord): void {
    this.hideAccuracyCircle();
    if (
      !this.map ||
      record.latitude === null ||
      record.longitude === null ||
      record.accuracyRadius === null ||
      record.accuracyRadius <= 0
    ) {
      return;
    }

    this.activeAccuracyCircle = L.circle([record.latitude, record.longitude], {
      radius: record.accuracyRadius,
      color: '#ea580c',
      weight: 2.5,
      fillColor: '#f97316',
      fillOpacity: 0.22,
      interactive: false,
    }).addTo(this.map);
  }

  private hideAccuracyCircle(): void {
    if (this.activeAccuracyCircle && this.map) {
      this.map.removeLayer(this.activeAccuracyCircle);
      this.activeAccuracyCircle = null;
    }
  }

  public getMapInstance(): L.Map | null {
    return this.map;
  }

  public destroy(): void {
    this.hideAccuracyCircle();
    this.markerById.clear();
    this.recordById.clear();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
