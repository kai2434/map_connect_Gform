import { REGIONS } from '../config/regions';
import type { RegionConfig } from '../types';
import {
  parseSubmissionCsv,
  resolveContentType,
} from './csvParser';
import { createDemoCsvText, createDemoLocalImages } from './demoData';
import type {
  LoadedLocalImage,
  PhotoSubmissionRecord,
  SubmissionContentType,
} from './photoViewerTypes';
import {
  escapeHtml,
  formatAccuracyBadgeText,
  ViewerMapController,
} from './viewerMapController';

/**
 * コンテンツ種別フィルタ
 */
type ContentFilterMode = 'all' | 'has-photo' | 'has-comment' | SubmissionContentType;

/**
 * 位置指定フィルタ
 */
type LocationFilterMode = 'all' | 'with-coords' | 'region-only';

/**
 * コンテンツ種別の日本語バッジ文言を返す
 */
function getContentTypeLabel(type: SubmissionContentType): string {
  switch (type) {
    case 'photo-and-comment':
      return '📷＋💬 写真＆コメント';
    case 'photo-only':
      return '📷 写真のみ';
    case 'comment-only':
      return '💬 コメントのみ';
  }
}

/**
 * 投稿写真＆コメントマップビューワー（viewer.html）のメインUIアプリケーション
 */
export class ViewerApp {
  private readonly root: HTMLElement;
  private readonly regions: readonly RegionConfig[];
  private readonly mapController: ViewerMapController;

  private rawCsvText = '';
  private localImages: LoadedLocalImage[] = [];
  private records: PhotoSubmissionRecord[] = [];
  private manualImageAssignments = new Map<string, string>(); // record.id -> localImage.key | '__none__'

  private selectedRegionId = 'all';
  private contentFilter: ContentFilterMode = 'all';
  private locationFilter: LocationFilterMode = 'all';
  private searchQuery = '';
  private activeRecordId: string | null = null;

  // Lightbox state
  private lightboxRecord: PhotoSubmissionRecord | null = null;
  private lightboxImageIndex = 0;

  // DOM Elements
  private mapHostEl: HTMLElement | null = null;
  private statusBannerEl: HTMLElement | null = null;
  private statsSummaryEl: HTMLElement | null = null;
  private sidebarListEl: HTMLElement | null = null;
  private regionOnlySectionEl: HTMLElement | null = null;
  private lightboxHostEl: HTMLElement | null = null;
  private dropOverlayEl: HTMLElement | null = null;

  constructor(root: HTMLElement, regions: readonly RegionConfig[] = REGIONS) {
    this.root = root;
    this.regions = regions;
    this.mapController = new ViewerMapController({
      onOpenLightbox: (record, imgIdx) => {
        this.openLightbox(record, imgIdx);
      },
      onSelectRecord: (recordId) => {
        this.highlightSidebarCard(recordId);
      },
    });
  }

  /**
   * ビューワー画面を初期化・描画する
   */
  public init(): void {
    this.renderLayout();
    if (this.mapHostEl) {
      this.mapController.init(this.mapHostEl, this.regions);
    }
    this.setupGlobalListeners();

    // 初回起動時にデモデータを自動ロードしてすぐに動作確認できるようにする
    this.loadDemoData();
  }

  /**
   * デモデータ（3パターン：写真のみ / コメントのみ / 写真＆コメント両方 ＋ 地域のみLv.0）を読み込む
   */
  public loadDemoData(): void {
    this.revokeObjectUrls();
    this.manualImageAssignments.clear();
    this.localImages = createDemoLocalImages();
    this.rawCsvText = createDemoCsvText();
    this.rebuildRecords(true);
    this.setStatusMessage(
      'info',
      '動作確認用のデモデータ（6件：①写真＆コメント両方、②写真のみ、③コメントのみ、および地域のみLv.0）を表示しています。上部のボタンまたはドラッグ＆ドロップでGoogleフォーム回答CSVと写真フォルダを読み込めます。'
    );
  }

  /**
   * CSVテキストと現在のローカル画像一覧から投稿レコードを再構築し、地図・サイドバーを更新する
   */
  private rebuildRecords(fitToPins = false): void {
    if (!this.rawCsvText.trim()) {
      this.records = [];
      this.refreshViews(false);
      return;
    }

    const parsed = parseSubmissionCsv(
      this.rawCsvText,
      this.regions,
      this.localImages
    );

    // 手動で画像割り当てが変更されているレコードがあれば反映する
    const finalRecords = parsed.records.map((rec) => {
      const manualKey = this.manualImageAssignments.get(rec.id);
      if (!manualKey) {
        return rec;
      }
      if (manualKey === '__none__') {
        return {
          ...rec,
          imageUrls: [],
          imageFileNames: [],
          contentType: resolveContentType(false, rec.comment),
        };
      }
      const foundImg = this.localImages.find((img) => img.key === manualKey);
      if (!foundImg) {
        return rec;
      }
      return {
        ...rec,
        imageUrls: [foundImg.url],
        imageFileNames: [foundImg.fileName],
        contentType: resolveContentType(true, rec.comment),
      };
    });

    this.records = finalRecords;
    this.refreshViews(fitToPins);
  }

  /**
   * 現在のフィルタ条件に合致するレコード一覧を返す
   */
  private getFilteredRecords(): PhotoSubmissionRecord[] {
    const q = this.searchQuery.trim().toLowerCase();

    return this.records.filter((rec) => {
      // 1. 地域フィルタ
      if (this.selectedRegionId !== 'all' && rec.regionId !== this.selectedRegionId) {
        return false;
      }

      // 2. コンテンツ種別フィルタ（写真のみ / コメントのみ / 写真＆コメント両方）
      if (this.contentFilter === 'has-photo' && rec.imageUrls.length === 0) {
        return false;
      }
      if (this.contentFilter === 'has-comment' && rec.comment.trim().length === 0) {
        return false;
      }
      if (
        (this.contentFilter === 'photo-only' ||
          this.contentFilter === 'comment-only' ||
          this.contentFilter === 'photo-and-comment') &&
        rec.contentType !== this.contentFilter
      ) {
        return false;
      }

      // 3. 位置種別フィルタ（座標あり vs 地域のみ）
      const hasCoords = rec.latitude !== null && rec.longitude !== null;
      if (this.locationFilter === 'with-coords' && !hasCoords) {
        return false;
      }
      if (this.locationFilter === 'region-only' && hasCoords) {
        return false;
      }

      // 4. キーワード検索（撮影者名・コメント・地域名・ファイル名）
      if (q.length > 0) {
        const haystack = [
          rec.contributorName,
          rec.comment,
          rec.regionName,
          rec.regionId,
          rec.rawPhotoCell,
          ...rec.imageFileNames,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * 地図ピン・統計サマリー・サイドバー一覧・地域のみ一覧を一括更新する
   */
  private refreshViews(fitToPins = false): void {
    const filtered = this.getFilteredRecords();
    const mapRecords = filtered.filter(
      (r) => r.latitude !== null && r.longitude !== null
    );
    const regionOnlyRecords = filtered.filter(
      (r) => r.latitude === null || r.longitude === null
    );

    this.mapController.renderSubmissions(mapRecords, fitToPins);
    this.renderStatsSummary(filtered);
    this.renderSidebarList(filtered);
    this.renderRegionOnlySection(regionOnlyRecords);
  }

  /**
   * 画面全体の基本DOM骨格を構築する
   */
  private renderLayout(): void {
    this.root.innerHTML = '';

    const page = document.createElement('div');
    page.className = 'viewer-page';

    // 1. トップヘッダー＆ファイル読み込みツールバー
    const header = document.createElement('header');
    header.className = 'viewer-header';
    header.innerHTML = `
      <div class="viewer-header__top">
        <div class="viewer-header__brand">
          <span class="viewer-header__badge">ローカル展開ビューワー</span>
          <h1 class="viewer-header__title">投稿写真＆コメント マップビューワー</h1>
        </div>
        <div class="viewer-header__actions">
          <label class="btn btn--primary viewer-upload-btn" data-testid="csv-upload-label">
            <span>📄 1. 回答CSVを選択</span>
            <input type="file" accept=".csv,text/csv" data-testid="csv-file-input" hidden />
          </label>
          <label class="btn btn--secondary viewer-upload-btn" data-testid="photo-folder-upload-label" title="Googleドライブからダウンロードした写真フォルダを丸ごと選択できます">
            <span>📁 2. 写真フォルダを選択</span>
            <input type="file" webkitdirectory directory multiple accept="image/*" data-testid="photo-folder-input" hidden />
          </label>
          <label class="btn btn--secondary viewer-upload-btn" data-testid="photo-files-upload-label" title="複数の写真ファイルを直接選択できます">
            <span>🖼️ 写真ファイル複数選択</span>
            <input type="file" multiple accept="image/*" data-testid="photo-files-input" hidden />
          </label>
          <button type="button" class="btn btn--ghost viewer-demo-btn" data-testid="load-demo-btn">
            ✨ デモデータを表示
          </button>
          <a href="./index.html" class="btn btn--ghost viewer-back-link" data-testid="back-to-submit-link">
            ← 写真投稿ページへ戻る
          </a>
        </div>
      </div>
      <div class="viewer-status-bar" data-testid="viewer-status-bar" role="status"></div>
    `;
    page.appendChild(header);

    this.statusBannerEl = header.querySelector('[data-testid="viewer-status-bar"]');

    // ファイル入力イベントのバインド
    const csvInput = header.querySelector<HTMLInputElement>('[data-testid="csv-file-input"]');
    csvInput?.addEventListener('change', () => {
      if (csvInput.files && csvInput.files.length > 0) {
        void this.handleCsvFileSelected(csvInput.files[0]!);
        csvInput.value = '';
      }
    });

    const folderInput = header.querySelector<HTMLInputElement>('[data-testid="photo-folder-input"]');
    folderInput?.addEventListener('change', () => {
      if (folderInput.files && folderInput.files.length > 0) {
        this.handleImageFilesSelected(Array.from(folderInput.files));
        folderInput.value = '';
      }
    });

    const filesInput = header.querySelector<HTMLInputElement>('[data-testid="photo-files-input"]');
    filesInput?.addEventListener('change', () => {
      if (filesInput.files && filesInput.files.length > 0) {
        this.handleImageFilesSelected(Array.from(filesInput.files));
        filesInput.value = '';
      }
    });

    const demoBtn = header.querySelector<HTMLButtonElement>('[data-testid="load-demo-btn"]');
    demoBtn?.addEventListener('click', () => {
      this.loadDemoData();
    });

    // 2. メイン2カラムレイアウト（左：地図＋地域のみギャラリー / 右：フィルタ＆投稿カード一覧サイドバー）
    const workspace = document.createElement('main');
    workspace.className = 'viewer-workspace';

    // 左カラム（マップ＋下部Lv.0地域のみセクション）
    const mapColumn = document.createElement('section');
    mapColumn.className = 'viewer-map-column';
    mapColumn.setAttribute('aria-label', '投稿地点マップ');

    const mapContainer = document.createElement('div');
    mapContainer.className = 'viewer-map-container';
    mapContainer.setAttribute('data-testid', 'viewer-map-canvas');
    this.mapHostEl = mapContainer;

    const mapLegend = document.createElement('div');
    mapLegend.className = 'viewer-map-legend';
    mapLegend.innerHTML = `
      <span class="viewer-map-legend__item"><span class="viewer-legend-dot viewer-legend-dot--both"></span>📷＋💬 写真＆コメント</span>
      <span class="viewer-map-legend__item"><span class="viewer-legend-dot viewer-legend-dot--photo"></span>📷 写真のみ</span>
      <span class="viewer-map-legend__item"><span class="viewer-legend-dot viewer-legend-dot--comment"></span>💬 コメントのみ</span>
      <span class="viewer-map-legend__hint">💡 ピンにカーソルを合わせると拡大プレビュー＆精度円、クリックで詳細・フルスクリーン表示</span>
    `;

    const regionOnlyContainer = document.createElement('div');
    regionOnlyContainer.className = 'viewer-region-only-bar';
    regionOnlyContainer.setAttribute('data-testid', 'viewer-region-only-section');
    this.regionOnlySectionEl = regionOnlyContainer;

    mapColumn.appendChild(mapContainer);
    mapColumn.appendChild(mapLegend);
    mapColumn.appendChild(regionOnlyContainer);

    // 右カラム（フィルタ＋統計＋投稿一覧サイドバー）
    const sidebar = document.createElement('aside');
    sidebar.className = 'viewer-sidebar';
    sidebar.setAttribute('aria-label', '投稿データの絞り込みと一覧');

    const filterBox = document.createElement('div');
    filterBox.className = 'viewer-filters';
    filterBox.innerHTML = `
      <div class="viewer-filters__row">
        <label class="viewer-filter-field">
          <span class="viewer-filter-field__label">対象地域</span>
          <select class="viewer-filter-select" data-testid="filter-region-select">
            <option value="all">すべての地域を表示</option>
            ${this.regions
              .map(
                (r) =>
                  `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`
              )
              .join('')}
          </select>
        </label>
        <label class="viewer-filter-field">
          <span class="viewer-filter-field__label">投稿内容（写真 / コメント）</span>
          <select class="viewer-filter-select" data-testid="filter-content-select">
            <option value="all">すべて表示</option>
            <option value="photo-and-comment">📷＋💬 写真＆コメント両方</option>
            <option value="photo-only">📷 写真のみ</option>
            <option value="comment-only">💬 コメントのみ</option>
            <option value="has-photo">写真を含む投稿すべて</option>
            <option value="has-comment">コメントを含む投稿すべて</option>
          </select>
        </label>
      </div>
      <div class="viewer-filters__row">
        <label class="viewer-filter-field">
          <span class="viewer-filter-field__label">位置指定</span>
          <select class="viewer-filter-select" data-testid="filter-location-select">
            <option value="all">すべて（地点ピン＋地域のみ）</option>
            <option value="with-coords">📍 地図上の地点あり（Lv.1〜4）</option>
            <option value="region-only">🗺️ 地域のみ・座標なし（Lv.0）</option>
          </select>
        </label>
        <label class="viewer-filter-field">
          <span class="viewer-filter-field__label">キーワード検索</span>
          <input
            type="search"
            class="viewer-filter-input"
            data-testid="filter-search-input"
            placeholder="撮影者名・コメントで検索..."
          />
        </label>
      </div>
    `;
    sidebar.appendChild(filterBox);

    // フィルタ変更イベント
    const regionSelect = filterBox.querySelector<HTMLSelectElement>(
      '[data-testid="filter-region-select"]'
    );
    regionSelect?.addEventListener('change', () => {
      this.selectedRegionId = regionSelect.value;
      this.mapController.renderRegionBounds(this.regions, this.selectedRegionId, true);
      this.refreshViews(false);
    });

    const contentSelect = filterBox.querySelector<HTMLSelectElement>(
      '[data-testid="filter-content-select"]'
    );
    contentSelect?.addEventListener('change', () => {
      this.contentFilter = contentSelect.value as ContentFilterMode;
      this.refreshViews(false);
    });

    const locationSelect = filterBox.querySelector<HTMLSelectElement>(
      '[data-testid="filter-location-select"]'
    );
    locationSelect?.addEventListener('change', () => {
      this.locationFilter = locationSelect.value as LocationFilterMode;
      this.refreshViews(false);
    });

    const searchInput = filterBox.querySelector<HTMLInputElement>(
      '[data-testid="filter-search-input"]'
    );
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.refreshViews(false);
    });

    const statsBar = document.createElement('div');
    statsBar.className = 'viewer-stats-bar';
    statsBar.setAttribute('data-testid', 'viewer-stats-bar');
    this.statsSummaryEl = statsBar;
    sidebar.appendChild(statsBar);

    const listContainer = document.createElement('div');
    listContainer.className = 'viewer-card-list';
    listContainer.setAttribute('data-testid', 'viewer-sidebar-list');
    this.sidebarListEl = listContainer;
    sidebar.appendChild(listContainer);

    workspace.appendChild(mapColumn);
    workspace.appendChild(sidebar);
    page.appendChild(workspace);

    // 3. フルスクリーン拡大ライトボックスモーダル用ホスト
    const lightboxHost = document.createElement('div');
    lightboxHost.className = 'viewer-lightbox-host';
    this.lightboxHostEl = lightboxHost;
    page.appendChild(lightboxHost);

    // 4. ドラッグ＆ドロップ案内オーバーレイ
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'viewer-drop-overlay';
    dropOverlay.hidden = true;
    dropOverlay.innerHTML = `
      <div class="viewer-drop-overlay__box">
        <div class="viewer-drop-overlay__icon">📂</div>
        <p class="viewer-drop-overlay__title">CSVファイルや写真ファイルをここにドロップして展開</p>
        <p class="viewer-drop-overlay__sub">ブラウザ内だけで安全に処理され、外部サーバーへは送信されません</p>
      </div>
    `;
    this.dropOverlayEl = dropOverlay;
    page.appendChild(dropOverlay);

    this.root.appendChild(page);
  }

  /**
   * 統計サマリーバーを描画する
   */
  private renderStatsSummary(filtered: readonly PhotoSubmissionRecord[]): void {
    if (!this.statsSummaryEl) return;

    const total = filtered.length;
    const bothCount = filtered.filter((r) => r.contentType === 'photo-and-comment').length;
    const photoOnlyCount = filtered.filter((r) => r.contentType === 'photo-only').length;
    const commentOnlyCount = filtered.filter((r) => r.contentType === 'comment-only').length;
    const pinnedCount = filtered.filter(
      (r) => r.latitude !== null && r.longitude !== null
    ).length;

    this.statsSummaryEl.innerHTML = `
      <div class="viewer-stats__main">
        表示中: <strong data-testid="stats-total-count">${total}</strong>件
        <span class="viewer-stats__sub">（地図ピン: <strong data-testid="stats-pinned-count">${pinnedCount}</strong>件 / 読み込み画像: <strong>${this.localImages.length}</strong>枚）</span>
      </div>
      <div class="viewer-stats__breakdown">
        <span class="viewer-stat-pill viewer-stat-pill--both" title="写真とコメントの両方がある投稿">📷＋💬 ${bothCount}</span>
        <span class="viewer-stat-pill viewer-stat-pill--photo" title="写真のみの投稿">📷のみ ${photoOnlyCount}</span>
        <span class="viewer-stat-pill viewer-stat-pill--comment" title="コメントのみの投稿">💬のみ ${commentOnlyCount}</span>
      </div>
    `;
  }

  /**
   * 右サイドバーの投稿カード一覧を描画する
   * - ①写真のみ、②コメントのみ、③写真＆コメント両方の3パターンそれぞれに最適化された美しいカードデザイン
   */
  private renderSidebarList(filtered: readonly PhotoSubmissionRecord[]): void {
    if (!this.sidebarListEl) return;
    this.sidebarListEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'viewer-empty-state';
      empty.setAttribute('data-testid', 'viewer-empty-state');
      empty.innerHTML = `
        <p class="viewer-empty-state__title">条件に一致する投稿データがありません</p>
        <p class="viewer-empty-state__desc">フィルタ条件を変更するか、CSVファイル・写真フォルダを読み込んでください。</p>
      `;
      this.sidebarListEl.appendChild(empty);
      return;
    }

    for (const rec of filtered) {
      const hasPhoto = rec.imageUrls.length > 0;
      const hasComment = rec.comment.trim().length > 0;
      const hasCoords = rec.latitude !== null && rec.longitude !== null;

      const card = document.createElement('article');
      card.className = `viewer-card viewer-card--${rec.contentType} ${
        this.activeRecordId === rec.id ? 'is-active' : ''
      }`;
      card.setAttribute('data-testid', 'viewer-sidebar-card');
      card.setAttribute('data-record-id', rec.id);
      card.setAttribute('data-content-type', rec.contentType);

      // ヘッダー（種別バッジ・地域バッジ・撮影者名）
      const cardHeader = document.createElement('div');
      cardHeader.className = 'viewer-card__header';
      cardHeader.innerHTML = `
        <div class="viewer-card__badges">
          <span class="viewer-card__type-badge viewer-card__type-badge--${rec.contentType}">
            ${escapeHtml(getContentTypeLabel(rec.contentType))}
          </span>
          <span class="viewer-card__region-badge">${escapeHtml(rec.regionName)}</span>
        </div>
        <div class="viewer-card__author-row">
          <strong class="viewer-card__author">👤 ${escapeHtml(rec.contributorName)}</strong>
          ${
            rec.timestamp
              ? `<span class="viewer-card__time">${escapeHtml(rec.timestamp)}</span>`
              : ''
          }
        </div>
      `;
      card.appendChild(cardHeader);

      // パターン1 & 3: 写真がある場合は美しいサムネイルプレビューを表示（コメントのみの場合は空画像枠を出さない）
      if (hasPhoto) {
        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'viewer-card__media';

        const img = document.createElement('img');
        img.className = 'viewer-card__img';
        img.src = rec.imageUrls[0]!;
        img.alt = `${rec.contributorName}さんの投稿写真`;
        img.loading = 'lazy';
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openLightbox(rec, 0);
        });
        mediaWrap.appendChild(img);

        const zoomOverlayBtn = document.createElement('button');
        zoomOverlayBtn.type = 'button';
        zoomOverlayBtn.className = 'viewer-card__zoom-chip';
        zoomOverlayBtn.setAttribute('data-testid', 'sidebar-open-lightbox-btn');
        zoomOverlayBtn.textContent = '🔍 拡大表示';
        zoomOverlayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openLightbox(rec, 0);
        });
        mediaWrap.appendChild(zoomOverlayBtn);

        card.appendChild(mediaWrap);
      }

      // パターン2 & 3: コメントがある場合はコメントボックスを表示（写真のみの場合は空コメント欄を出さない）
      if (hasComment) {
        const commentWrap = document.createElement('div');
        commentWrap.className = `viewer-card__comment ${
          !hasPhoto ? 'viewer-card__comment--featured' : ''
        }`;
        commentWrap.setAttribute('data-testid', 'viewer-card-comment');

        const commentP = document.createElement('p');
        commentP.className = 'viewer-card__comment-text';
        commentP.textContent = rec.comment;
        commentWrap.appendChild(commentP);

        card.appendChild(commentWrap);
      }

      // もしCSVの写真列には記述があるがローカル画像が未紐付けで、かつコメントも空の場合の案内
      if (!hasPhoto && !hasComment) {
        const notice = document.createElement('p');
        notice.className = 'viewer-card__unmatched-notice';
        notice.textContent = rec.rawPhotoCell
          ? `未紐付けの写真データ（${rec.rawPhotoCell}）があります。写真フォルダを選択するか下のメニューから画像を割り当ててください。`
          : '写真・コメントが未入力のレコードです。';
        card.appendChild(notice);
      }

      // フッター（位置精度・地図フォーカスボタン・画像手動割当セレクト）
      const footer = document.createElement('div');
      footer.className = 'viewer-card__footer';

      const locRow = document.createElement('div');
      locRow.className = 'viewer-card__loc-row';
      locRow.innerHTML = `
        <span class="viewer-card__accuracy-badge">${escapeHtml(
          formatAccuracyBadgeText(rec.accuracyRadius)
        )}</span>
      `;

      if (hasCoords) {
        const focusBtn = document.createElement('button');
        focusBtn.type = 'button';
        focusBtn.className = 'btn btn--small viewer-card__focus-btn';
        focusBtn.setAttribute('data-testid', 'focus-pin-btn');
        focusBtn.textContent = '📍 地図で場所を見る';
        focusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.activeRecordId = rec.id;
          this.highlightSidebarCard(rec.id);
          this.mapController.focusSubmissionPin(rec.id);
        });
        locRow.appendChild(focusBtn);
      } else {
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'btn btn--small viewer-card__focus-btn';
        detailBtn.textContent = '🔍 詳細モーダルを開く';
        detailBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openLightbox(rec, 0);
        });
        locRow.appendChild(detailBtn);
      }
      footer.appendChild(locRow);

      // ローカル画像が読み込まれている場合、任意の画像を手動で割り当て・変更できるセレクトボックスを提供
      if (this.localImages.length > 0) {
        const assignRow = document.createElement('div');
        assignRow.className = 'viewer-card__assign-row';
        const selectEl = document.createElement('select');
        selectEl.className = 'viewer-card__assign-select';
        selectEl.setAttribute('data-testid', 'manual-image-select');
        selectEl.setAttribute('aria-label', `${rec.contributorName}さんの投稿に割り当てる画像を選択`);

        const currentFileName = rec.imageFileNames[0] ?? '';
        selectEl.innerHTML = `
          <option value="">🖼️ 画像の割当を変更...</option>
          <option value="__none__">（画像なし・コメントのみにする）</option>
          ${this.localImages
            .map(
              (img) =>
                `<option value="${escapeHtml(img.key)}" ${
                  img.fileName === currentFileName ? 'selected' : ''
                }>${escapeHtml(img.fileName)}</option>`
            )
            .join('')}
        `;
        selectEl.addEventListener('click', (e) => e.stopPropagation());
        selectEl.addEventListener('change', (e) => {
          e.stopPropagation();
          const val = selectEl.value;
          if (!val) return;
          this.manualImageAssignments.set(rec.id, val);
          this.rebuildRecords(false);
        });
        assignRow.appendChild(selectEl);
        footer.appendChild(assignRow);
      }

      card.appendChild(footer);

      // カード全体クリックでピンへ移動（座標ありの場合）またはライトボックス表示
      card.addEventListener('click', () => {
        this.activeRecordId = rec.id;
        this.highlightSidebarCard(rec.id);
        if (hasCoords) {
          this.mapController.focusSubmissionPin(rec.id);
        } else {
          this.openLightbox(rec, 0);
        }
      });

      this.sidebarListEl.appendChild(card);
    }
  }

  /**
   * 地図下部の「地域のみ（Lv.0・座標なし）」ギャラリーバーを描画する
   */
  private renderRegionOnlySection(regionOnlyRecords: readonly PhotoSubmissionRecord[]): void {
    if (!this.regionOnlySectionEl) return;
    this.regionOnlySectionEl.innerHTML = '';

    if (regionOnlyRecords.length === 0) {
      this.regionOnlySectionEl.hidden = true;
      return;
    }

    this.regionOnlySectionEl.hidden = false;
    const title = document.createElement('div');
    title.className = 'viewer-region-only-bar__header';
    title.innerHTML = `
      <strong>🗺️ 地域のみ（Lv.0・座標指定なし）の投稿 (${regionOnlyRecords.length}件)</strong>
      <span>ピン座標を持たないため、こちらに一覧表示しています（クリックで拡大表示）</span>
    `;
    this.regionOnlySectionEl.appendChild(title);

    const strip = document.createElement('div');
    strip.className = 'viewer-region-only-bar__strip';

    for (const rec of regionOnlyRecords) {
      const hasPhoto = rec.imageUrls.length > 0;
      const hasComment = rec.comment.trim().length > 0;

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `viewer-region-chip viewer-region-chip--${rec.contentType}`;
      chip.setAttribute('data-testid', 'region-only-chip');
      chip.innerHTML = `
        ${
          hasPhoto
            ? `<img class="viewer-region-chip__thumb" src="${escapeHtml(rec.imageUrls[0]!)}" alt="" />`
            : `<span class="viewer-region-chip__icon">💬</span>`
        }
        <span class="viewer-region-chip__info">
          <strong class="viewer-region-chip__author">${escapeHtml(rec.contributorName)} (${escapeHtml(rec.regionName)})</strong>
          <span class="viewer-region-chip__snippet">${escapeHtml(
            hasComment ? rec.comment.slice(0, 36) : '写真のみ投稿'
          )}</span>
        </span>
      `;
      chip.addEventListener('click', () => {
        this.openLightbox(rec, 0);
      });
      strip.appendChild(chip);
    }

    this.regionOnlySectionEl.appendChild(strip);
  }

  /**
   * サイドバー内の選択中カードをハイライトし、スクロール表示する
   */
  private highlightSidebarCard(recordId: string): void {
    this.activeRecordId = recordId;
    if (!this.sidebarListEl) return;
    const cards = this.sidebarListEl.querySelectorAll<HTMLElement>('[data-testid="viewer-sidebar-card"]');
    cards.forEach((c) => {
      const isMatch = c.getAttribute('data-record-id') === recordId;
      c.classList.toggle('is-active', isMatch);
    });
  }

  /**
   * フルスクリーン拡大表示モーダル（Lightbox）を開く
   * - 写真のみ / コメントのみ / 写真＆コメント両方の3パターンそれぞれで綺麗に表示
   */
  public openLightbox(record: PhotoSubmissionRecord, imageIndex = 0): void {
    this.lightboxRecord = record;
    this.lightboxImageIndex = imageIndex;
    this.renderLightbox();
  }

  /**
   * ライトボックスを閉じる
   */
  public closeLightbox(): void {
    this.lightboxRecord = null;
    this.lightboxImageIndex = 0;
    if (this.lightboxHostEl) {
      this.lightboxHostEl.innerHTML = '';
    }
  }

  private renderLightbox(): void {
    if (!this.lightboxHostEl) return;
    this.lightboxHostEl.innerHTML = '';

    const rec = this.lightboxRecord;
    if (!rec) return;

    const hasPhoto = rec.imageUrls.length > 0;
    const hasComment = rec.comment.trim().length > 0;
    const safeIdx = hasPhoto
      ? Math.max(0, Math.min(this.lightboxImageIndex, rec.imageUrls.length - 1))
      : 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'viewer-lightbox';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', `${rec.contributorName}さんの投稿拡大表示`);
    backdrop.setAttribute('data-testid', 'viewer-lightbox-modal');

    const dialog = document.createElement('div');
    dialog.className = `viewer-lightbox__dialog viewer-lightbox__dialog--${rec.contentType}`;

    // 上部バー
    const topBar = document.createElement('div');
    topBar.className = 'viewer-lightbox__topbar';
    topBar.innerHTML = `
      <div class="viewer-lightbox__title-group">
        <span class="viewer-lightbox__type-badge">${escapeHtml(getContentTypeLabel(rec.contentType))}</span>
        <strong class="viewer-lightbox__author">👤 ${escapeHtml(rec.contributorName)}</strong>
        <span class="viewer-lightbox__region">${escapeHtml(rec.regionName)}</span>
        ${rec.timestamp ? `<span class="viewer-lightbox__time">🕒 ${escapeHtml(rec.timestamp)}</span>` : ''}
      </div>
      <button type="button" class="btn btn--small viewer-lightbox__close-btn" data-testid="lightbox-close-btn" aria-label="閉じる">
        ✕ 閉じる
      </button>
    `;
    dialog.appendChild(topBar);

    const closeBtn = topBar.querySelector('[data-testid="lightbox-close-btn"]');
    closeBtn?.addEventListener('click', () => this.closeLightbox());

    // コンテンツ本体（写真エリア ＆ コメント・メタ情報エリア）
    const contentArea = document.createElement('div');
    contentArea.className = 'viewer-lightbox__content';

    if (hasPhoto) {
      const stage = document.createElement('div');
      stage.className = 'viewer-lightbox__photo-stage';

      const img = document.createElement('img');
      img.className = 'viewer-lightbox__img';
      img.setAttribute('data-testid', 'lightbox-main-img');
      img.src = rec.imageUrls[safeIdx]!;
      img.alt = `${rec.contributorName}さんの投稿写真`;
      stage.appendChild(img);

      if (rec.imageUrls.length > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'viewer-lightbox__nav-btn viewer-lightbox__nav-btn--prev';
        prevBtn.textContent = '‹ 前へ';
        prevBtn.addEventListener('click', () => {
          this.lightboxImageIndex =
            (safeIdx - 1 + rec.imageUrls.length) % rec.imageUrls.length;
          this.renderLightbox();
        });

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'viewer-lightbox__nav-btn viewer-lightbox__nav-btn--next';
        nextBtn.textContent = '次へ ›';
        nextBtn.addEventListener('click', () => {
          this.lightboxImageIndex = (safeIdx + 1) % rec.imageUrls.length;
          this.renderLightbox();
        });

        stage.appendChild(prevBtn);
        stage.appendChild(nextBtn);
      }

      contentArea.appendChild(stage);
    }

    // 詳細・コメントパネル
    const infoPanel = document.createElement('div');
    infoPanel.className = 'viewer-lightbox__info-panel';

    if (hasComment) {
      const commentCard = document.createElement('div');
      commentCard.className = 'viewer-lightbox__comment-card';
      commentCard.setAttribute('data-testid', 'lightbox-comment-box');
      commentCard.innerHTML = `
        <div class="viewer-lightbox__comment-heading">💬 投稿コメント（7問目）</div>
        <p class="viewer-lightbox__comment-body"></p>
      `;
      const p = commentCard.querySelector('.viewer-lightbox__comment-body');
      if (p) {
        p.textContent = rec.comment;
      }
      infoPanel.appendChild(commentCard);
    }

    const metaTable = document.createElement('div');
    metaTable.className = 'viewer-lightbox__meta';
    const coordText =
      rec.latitude !== null && rec.longitude !== null
        ? `北緯 ${rec.latitude.toFixed(6)}°, 東経 ${rec.longitude.toFixed(6)}°`
        : '座標なし（地域のみ Lv.0）';

    metaTable.innerHTML = `
      <div class="viewer-lightbox__meta-row">
        <span>対象地域</span>
        <strong>${escapeHtml(rec.regionName)} (${escapeHtml(rec.regionId)})</strong>
      </div>
      <div class="viewer-lightbox__meta-row">
        <span>位置精度</span>
        <strong>${escapeHtml(formatAccuracyBadgeText(rec.accuracyRadius))}</strong>
      </div>
      <div class="viewer-lightbox__meta-row">
        <span>記録座標</span>
        <code>${escapeHtml(coordText)}</code>
      </div>
      ${
        rec.imageFileNames.length > 0
          ? `<div class="viewer-lightbox__meta-row">
              <span>画像ファイル</span>
              <code>${escapeHtml(rec.imageFileNames[safeIdx] ?? rec.imageFileNames[0]!)}</code>
            </div>`
          : ''
      }
    `;
    infoPanel.appendChild(metaTable);

    contentArea.appendChild(infoPanel);
    dialog.appendChild(contentArea);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeLightbox();
      }
    });

    backdrop.appendChild(dialog);
    this.lightboxHostEl.appendChild(backdrop);
  }

  /**
   * 選択されたCSVファイルを読み込んで解析する
   */
  private async handleCsvFileSelected(file: File): Promise<void> {
    try {
      const text = await file.text();
      this.rawCsvText = text;
      this.manualImageAssignments.clear();
      this.rebuildRecords(true);
      this.setStatusMessage(
        'success',
        `CSVファイル「${file.name}」を読み込みました（全${this.records.length}件）。続けて写真フォルダまたは写真ファイルを選択すると画像が自動紐付けされます。`
      );
    } catch (err) {
      this.setStatusMessage(
        'error',
        `CSVファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 選択された画像ファイル群（フォルダまたは複数ファイル）をObject URL化してレコードとマッチングする
   */
  private handleImageFilesSelected(files: File[]): void {
    const imageFiles = files.filter(
      (f) =>
        f.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|webp|gif|avif|svg)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      this.setStatusMessage(
        'warning',
        '選択されたファイルの中に画像ファイル（JPG/PNG/WebP/SVG等）が見つかりませんでした。'
      );
      return;
    }

    // もしデモ画像だけが入っている初期状態なら、ユーザーの実画像で置き換える
    const hadOnlyDemoImages =
      this.localImages.length > 0 &&
      this.localImages.every((img) => img.key.startsWith('demo-img-'));
    if (hadOnlyDemoImages) {
      this.localImages = [];
    }

    const existingNames = new Set(this.localImages.map((img) => img.fileName));
    let addedCount = 0;

    for (const file of imageFiles) {
      if (existingNames.has(file.name)) continue;
      const objUrl = URL.createObjectURL(file);
      this.localImages.push({
        key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${addedCount}`,
        fileName: file.name,
        url: objUrl,
        size: file.size,
      });
      existingNames.add(file.name);
      addedCount += 1;
    }

    this.rebuildRecords(false);
    const matchedPhotoRecords = this.records.filter(
      (r) => r.imageUrls.length > 0
    ).length;

    this.setStatusMessage(
      'success',
      `写真ファイルを${addedCount}枚追加しました（合計${this.localImages.length}枚 / 写真付き投稿${matchedPhotoRecords}件に紐付け完了）。`
    );
  }

  /**
   * ステータスバーにメッセージを表示する
   */
  private setStatusMessage(
    level: 'info' | 'success' | 'warning' | 'error',
    message: string
  ): void {
    if (!this.statusBannerEl) return;
    this.statusBannerEl.className = `viewer-status-bar viewer-status-bar--${level}`;
    this.statusBannerEl.textContent = message;
  }

  /**
   * Escapeキーによるライトボックス終了および画面全体へのドラッグ＆ドロップ対応をセットアップする
   */
  private setupGlobalListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.lightboxRecord) {
        this.closeLightbox();
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dropOverlayEl) {
        this.dropOverlayEl.hidden = false;
      }
    });

    window.addEventListener('dragleave', (e) => {
      if (
        e.relatedTarget === null &&
        this.dropOverlayEl
      ) {
        this.dropOverlayEl.hidden = true;
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.dropOverlayEl) {
        this.dropOverlayEl.hidden = true;
      }
      const droppedFiles = e.dataTransfer?.files
        ? Array.from(e.dataTransfer.files)
        : [];
      if (droppedFiles.length === 0) return;

      const csvFiles = droppedFiles.filter(
        (f) => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv'
      );
      const imgFiles = droppedFiles.filter(
        (f) =>
          f.type.startsWith('image/') ||
          /\.(jpg|jpeg|png|webp|gif|avif|svg)$/i.test(f.name)
      );

      if (imgFiles.length > 0) {
        this.handleImageFilesSelected(imgFiles);
      }
      if (csvFiles.length > 0) {
        void this.handleCsvFileSelected(csvFiles[0]!);
      }
    });
  }

  /**
   * 生成済みの Object URL を解放する
   */
  private revokeObjectUrls(): void {
    for (const img of this.localImages) {
      if (img.url.startsWith('blob:')) {
        URL.revokeObjectURL(img.url);
      }
    }
  }
}
