import { ACCURACY_LEVELS } from './config/accuracyLevels';
import { GOOGLE_FORM_CONFIG } from './config/googleForm';
import { REGIONS } from './config/regions';
import { validateAccuracyLevels } from './domain/accuracyManager';
import { findRegionById, validateRegionsList } from './domain/regionValidator';
import { SubmissionStateStore } from './domain/submissionState';
import type { AccuracyLevelConfig, GoogleFormConfig, RegionConfig } from './types';
import { renderMapView, type MapViewController } from './ui/mapView';
import { renderRegionSelectView } from './ui/regionSelectView';

/**
 * アプリケーション初期化オプション型
 */
export interface AppInitOptions {
  /** ルートマウント先DOM要素 */
  rootElement: HTMLElement;
  /** 地域設定リスト（省略時は設定ファイルの REGIONS を使用） */
  regions?: readonly RegionConfig[];
  /** 位置精度設定リスト（省略時は設定ファイルの ACCURACY_LEVELS を使用） */
  accuracyLevels?: readonly AccuracyLevelConfig[];
  /** Googleフォーム設定（省略時は設定ファイルの GOOGLE_FORM_CONFIG を使用） */
  formConfig?: GoogleFormConfig;
}

/**
 * アプリケーション全体の画面遷移・状態・ライフサイクルを統括するクラス
 */
export class PhotoSpotApp {
  private readonly rootElement: HTMLElement;
  private readonly regions: readonly RegionConfig[];
  private readonly accuracyLevels: readonly AccuracyLevelConfig[];
  private readonly formConfig: GoogleFormConfig;
  private readonly store: SubmissionStateStore;

  private activeMapView: MapViewController | null = null;
  private readonly handleHashChangeBound: () => void;

  constructor(options: AppInitOptions) {
    this.rootElement = options.rootElement;
    this.regions = options.regions ?? REGIONS;
    this.accuracyLevels = options.accuracyLevels ?? ACCURACY_LEVELS;
    this.formConfig = options.formConfig ?? GOOGLE_FORM_CONFIG;
    this.store = new SubmissionStateStore(this.accuracyLevels);
    this.handleHashChangeBound = () => this.syncRouteFromUrl();
  }

  /**
   * アプリケーションを起動し、初期画面を描画する
   */
  public start(): void {
    // 位置精度設定ファイルの整合性検証
    const accuracyValidation = validateAccuracyLevels(this.accuracyLevels);
    if (!accuracyValidation.valid) {
      this.renderFatalConfigError(accuracyValidation.errors);
      return;
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this.handleHashChangeBound);
    }

    this.syncRouteFromUrl();
  }

  /**
   * 指定した地域IDの地図画面へ遷移する
   * 存在しない地域IDが指定された場合は地域選択画面へ戻し、エラーメッセージを表示する（仕様要件 7 / 9）
   */
  public navigateToRegion(regionId: string, updateHash = true): void {
    const validationReport = validateRegionsList(this.regions);
    const targetRegion = findRegionById(validationReport.validRegions, regionId);

    if (!targetRegion) {
      this.cleanupActiveMapView();
      this.store.selectRegion(null);
      if (updateHash && typeof window !== 'undefined') {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      renderRegionSelectView(
        this.rootElement,
        validationReport,
        `指定された地域ID「${regionId || '空'}」は存在しないか、設定が無効です。以下の一覧から有効な募集地域を選択してください。`,
        {
          onSelectRegion: (selectedId: string) => this.navigateToRegion(selectedId, true),
        }
      );
      return;
    }

    this.cleanupActiveMapView();
    this.store.selectRegion(targetRegion);

    if (updateHash && typeof window !== 'undefined') {
      const targetHash = `#region=${encodeURIComponent(targetRegion.id)}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }

    this.activeMapView = renderMapView(this.rootElement, {
      region: targetRegion,
      store: this.store,
      formConfig: this.formConfig,
      onBackToRegions: () => {
        this.navigateToRegionList(true);
      },
    });
  }

  /**
   * 地域選択画面へ遷移する
   */
  public navigateToRegionList(updateHash = true, errorMessage: string | null = null): void {
    this.cleanupActiveMapView();
    this.store.selectRegion(null);

    if (updateHash && typeof window !== 'undefined' && window.location.hash) {
      history.pushState(null, '', window.location.pathname + window.location.search);
    }

    const validationReport = validateRegionsList(this.regions);
    renderRegionSelectView(this.rootElement, validationReport, errorMessage, {
      onSelectRegion: (regionId: string) => this.navigateToRegion(regionId, true),
    });
  }

  /**
   * 内部の状態ストアを取得する（テスト検証用）
   */
  public getStore(): SubmissionStateStore {
    return this.store;
  }

  /**
   * 現在アクティブな地図ビューコントローラーを取得する（テスト検証用）
   */
  public getActiveMapView(): MapViewController | null {
    return this.activeMapView;
  }

  /**
   * アプリケーションを破棄し、全リスナーと地図インスタンスを解放する
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.handleHashChangeBound);
    }
    this.cleanupActiveMapView();
    this.store.clearListeners();
    this.rootElement.innerHTML = '';
  }

  /**
   * URLのハッシュ（#region=xxx）またはクエリ（?region=xxx）を読み取って画面を同期する
   */
  private syncRouteFromUrl(): void {
    if (typeof window === 'undefined') {
      this.navigateToRegionList(false);
      return;
    }

    let requestedRegionId: string | null = null;

    // 1. ハッシュ (#region=xxx) の確認
    const hash = window.location.hash.replace(/^#/, '');
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      requestedRegionId = hashParams.get('region');
    }

    // 2. クエリパラメータ (?region=xxx) の確認
    if (!requestedRegionId && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      requestedRegionId = searchParams.get('region');
    }

    if (requestedRegionId !== null) {
      this.navigateToRegion(requestedRegionId, false);
    } else {
      this.navigateToRegionList(false);
    }
  }

  private cleanupActiveMapView(): void {
    if (this.activeMapView) {
      this.activeMapView.destroy();
      this.activeMapView = null;
    }
  }

  private renderFatalConfigError(errors: string[]): void {
    this.rootElement.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fatal-error-container';
    box.setAttribute('role', 'alert');

    const title = document.createElement('h1');
    title.textContent = 'システム設定エラー';
    box.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent =
      '位置精度設定ファイル（src/config/accuracyLevels.ts）に不備があるため起動できませんでした。';
    box.appendChild(desc);

    const list = document.createElement('ul');
    for (const err of errors) {
      const li = document.createElement('li');
      li.textContent = err;
      list.appendChild(li);
    }
    box.appendChild(list);
    this.rootElement.appendChild(box);
  }
}
