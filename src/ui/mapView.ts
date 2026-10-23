import { ACCURACY_LEVELS } from '../config/accuracyLevels';
import { GOOGLE_FORM_CONFIG } from '../config/googleForm';
import { buildGoogleFormUrl } from '../domain/googleFormUrlBuilder';
import {
  formatCoordinate,
  type SubmissionStateSnapshot,
  type SubmissionStateStore,
} from '../domain/submissionState';
import { MapController } from '../map/mapController';
import type { AccuracyLevelId, GoogleFormConfig, LatLng, RegionConfig } from '../types';
import { openSubmissionConfirmModal } from './confirmModal';

/**
 * 地図・撮影地点指定画面のオプション型
 */
export interface MapViewOptions {
  /** 対象地域の設定データ */
  region: RegionConfig;
  /** 状態管理ストア */
  store: SubmissionStateStore;
  /** Googleフォーム設定（省略時はデフォルト設定ファイルを使用） */
  formConfig?: GoogleFormConfig;
  /** 「地域選択へ戻る」ボタンが押されたときのコールバック */
  onBackToRegions: () => void;
}

/**
 * 地図画面のインスタンス制御インターフェース（テストおよびクリーンアップ用）
 */
export interface MapViewController {
  /** 内部の MapController インスタンスを取得する */
  getMapController: () => MapController;
  /** イベントリスナーおよびLeafletインスタンスを完全に破棄する */
  destroy: () => void;
}

/**
 * 撮影地点指定画面（地図＋5段階精度スライダー＋投稿操作パネル）を描画・制御する関数
 * （仕様要件 2.2 / 3 / 4 / 6 / 7 / 8）
 */
export function renderMapView(
  container: HTMLElement,
  options: MapViewOptions
): MapViewController {
  const { region, store, onBackToRegions } = options;
  const formConfig = options.formConfig ?? GOOGLE_FORM_CONFIG;

  container.innerHTML = '';

  const pageEl = document.createElement('div');
  pageEl.className = 'map-page';

  // ---------------------------------------------------------------------------
  // 1. 上部ヘッダーバー（戻るボタン、地域名・地域ID、範囲全体を表示ボタン）
  // ---------------------------------------------------------------------------
  const topBar = document.createElement('header');
  topBar.className = 'map-topbar';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn--ghost map-topbar__back';
  backBtn.setAttribute('aria-label', '地域選択画面へ戻る');
  backBtn.textContent = '← 地域選択へ戻る';

  const titleArea = document.createElement('div');
  titleArea.className = 'map-topbar__title-area';

  const regionTitle = document.createElement('h1');
  regionTitle.className = 'map-topbar__title';
  regionTitle.textContent = region.name;

  const regionIdSpan = document.createElement('span');
  regionIdSpan.className = 'map-topbar__id';
  regionIdSpan.textContent = `ID: ${region.id}`;

  titleArea.appendChild(regionTitle);
  titleArea.appendChild(regionIdSpan);

  const fitBoundsBtn = document.createElement('button');
  fitBoundsBtn.type = 'button';
  fitBoundsBtn.className = 'btn btn--ghost map-topbar__fit';
  fitBoundsBtn.setAttribute('aria-label', '募集対象範囲の全体を表示する');
  fitBoundsBtn.textContent = '範囲全体を表示';

  topBar.appendChild(backBtn);
  topBar.appendChild(titleArea);
  topBar.appendChild(fitBoundsBtn);
  pageEl.appendChild(topBar);

  // ---------------------------------------------------------------------------
  // 2. 中央：地図エリア（凡例・通知トースト・エラーバナー・Leafletキャンバス）
  // ---------------------------------------------------------------------------
  const mapStage = document.createElement('div');
  mapStage.className = 'map-stage';

  // 地図上の視覚的凡例（募集範囲と推定円の色・線の違いを文字でも明示：仕様要件 6 / 7.3）
  const legendBox = document.createElement('div');
  legendBox.className = 'map-legend';
  legendBox.setAttribute('aria-label', '地図の表示凡例');
  legendBox.innerHTML = `
    <span class="map-legend__item">
      <span class="map-legend__swatch map-legend__swatch--bounds" aria-hidden="true"></span>
      <span>青い破線枠：募集対象範囲（ピン設置可）</span>
    </span>
    <span class="map-legend__item">
      <span class="map-legend__swatch map-legend__swatch--circle" aria-hidden="true"></span>
      <span>オレンジ円：位置精度の範囲</span>
    </span>
  `;
  mapStage.appendChild(legendBox);

  // タイル読み込み失敗・オフライン時の常設エラーバナー（再読み込みボタン付き：仕様要件 7 / 9）
  const tileErrorBanner = document.createElement('div');
  tileErrorBanner.className = 'map-error-banner';
  tileErrorBanner.setAttribute('role', 'alert');
  tileErrorBanner.setAttribute('data-testid', 'map-tile-error-banner');
  tileErrorBanner.hidden = true;

  const tileErrorText = document.createElement('span');
  tileErrorText.className = 'map-error-banner__text';
  const tileReloadBtn = document.createElement('button');
  tileReloadBtn.type = 'button';
  tileReloadBtn.className = 'btn btn--small map-error-banner__btn';
  tileReloadBtn.textContent = '地図を再読み込み';

  tileErrorBanner.appendChild(tileErrorText);
  tileErrorBanner.appendChild(tileReloadBtn);
  mapStage.appendChild(tileErrorBanner);

  // 範囲外タップ時やレベル0タップ時の一時案内バナー
  const feedbackToast = document.createElement('div');
  feedbackToast.className = 'map-toast';
  feedbackToast.setAttribute('role', 'status');
  feedbackToast.setAttribute('aria-live', 'polite');
  feedbackToast.hidden = true;
  mapStage.appendChild(feedbackToast);

  // Leaflet地図を描画するDOMコンテナ
  const mapCanvas = document.createElement('div');
  mapCanvas.id = 'map-canvas';
  mapCanvas.className = 'map-canvas';
  mapCanvas.setAttribute('role', 'application');
  mapCanvas.setAttribute('aria-label', `${region.name}の撮影地点指定地図`);
  mapCanvas.tabIndex = 0;
  mapCanvas.setAttribute('aria-describedby', 'map-keyboard-help');
  mapStage.appendChild(mapCanvas);

  const keyboardHelp = document.createElement('p');
  keyboardHelp.id = 'map-keyboard-help';
  keyboardHelp.className = 'map-keyboard-help';
  keyboardHelp.textContent =
    '矢印キーで地図を移動できます。Tabキーで「地図中央を撮影地点にする」ボタンへ進み、EnterまたはSpaceで中央の地点を確定できます。';
  mapStage.appendChild(keyboardHelp);

  const mapCenterReticle = document.createElement('span');
  mapCenterReticle.className = 'map-center-reticle';
  mapCenterReticle.setAttribute('aria-hidden', 'true');
  mapStage.appendChild(mapCenterReticle);

  const selectMapCenterBtn = document.createElement('button');
  selectMapCenterBtn.type = 'button';
  selectMapCenterBtn.className = 'btn btn--primary map-center-select-btn';
  selectMapCenterBtn.setAttribute('data-testid', 'select-map-center-btn');
  selectMapCenterBtn.setAttribute('aria-keyshortcuts', 'Enter Space');
  selectMapCenterBtn.textContent = '地図中央を撮影地点にする';
  mapStage.appendChild(selectMapCenterBtn);

  pageEl.appendChild(mapStage);

  // ---------------------------------------------------------------------------
  // 3. 下部：操作パネル（座標表示、5段階スライダー、案内文、投稿ボタン）
  //    地図コンテナ（#map-canvas）の外側に独立配置しているため、スライダー操作と地図操作が干渉しない
  // ---------------------------------------------------------------------------
  const bottomPanel = document.createElement('section');
  bottomPanel.className = 'control-panel';
  bottomPanel.setAttribute('aria-label', '撮影地点と位置精度の指定パネル');

  // 3-1. 選択状態ステータス行（現在の精度レベルバッジ＋選択座標の表示）
  const statusRow = document.createElement('div');
  statusRow.className = 'control-panel__status-row';

  const statusPinBox = document.createElement('div');
  statusPinBox.className = 'status-box';
  statusPinBox.innerHTML = `
    <span class="status-box__label">選択地点：</span>
    <span class="status-box__value" data-testid="selected-coordinates-text">未指定</span>
  `;

  const statusAccuracyBox = document.createElement('div');
  statusAccuracyBox.className = 'status-box status-box--accuracy';
  statusAccuracyBox.innerHTML = `
    <span class="status-box__label">現在の精度：</span>
    <strong class="status-box__badge" data-testid="selected-accuracy-badge"></strong>
  `;

  statusRow.appendChild(statusPinBox);
  statusRow.appendChild(statusAccuracyBox);
  bottomPanel.appendChild(statusRow);

  // 3-2. 5段階位置精度スライダー（仕様要件 3 / 4）
  const sliderBlock = document.createElement('div');
  sliderBlock.className = 'slider-block';

  const sliderHeader = document.createElement('div');
  sliderHeader.className = 'slider-block__header';

  const sliderLabel = document.createElement('label');
  sliderLabel.htmlFor = 'accuracy-range-slider';
  sliderLabel.className = 'slider-block__title';
  sliderLabel.textContent = '位置精度の指定（5段階）';

  const sliderRadiusNote = document.createElement('span');
  sliderRadiusNote.className = 'slider-block__radius-note';
  sliderRadiusNote.setAttribute('data-testid', 'accuracy-radius-text');

  sliderHeader.appendChild(sliderLabel);
  sliderHeader.appendChild(sliderRadiusNote);
  sliderBlock.appendChild(sliderHeader);

  const rangeInput = document.createElement('input');
  rangeInput.type = 'range';
  rangeInput.id = 'accuracy-range-slider';
  rangeInput.className = 'accuracy-slider';
  rangeInput.min = '0';
  rangeInput.max = '4';
  rangeInput.step = '1';
  rangeInput.value = String(store.getSnapshot().accuracyLevel);
  rangeInput.setAttribute('aria-valuemin', '0');
  rangeInput.setAttribute('aria-valuemax', '4');

  sliderBlock.appendChild(rangeInput);

  // 5段階の目盛りボタン（タップでもキーボードでも即座に任意のレベルにスナップ可能）
  const ticksContainer = document.createElement('div');
  ticksContainer.className = 'slider-ticks';
  ticksContainer.setAttribute('role', 'group');
  ticksContainer.setAttribute('aria-label', '位置精度レベル選択ボタン');

  const tickButtons: HTMLButtonElement[] = [];
  for (const levelCfg of ACCURACY_LEVELS) {
    const tickBtn = document.createElement('button');
    tickBtn.type = 'button';
    tickBtn.className = 'slider-tick-btn';
    tickBtn.setAttribute('data-level', String(levelCfg.level));
    const radiusLabel =
      levelCfg.radiusMeters === null
        ? '座標なし'
        : `${levelCfg.radiusMeters}m`;
    const radiusSub =
      levelCfg.level === 0
        ? '座標なし'
        : levelCfg.level === 1
          ? '半径0m'
          : 'おおよそ';
    tickBtn.innerHTML = `
      <span class="slider-tick-btn__lv">Lv.${levelCfg.level}</span>
      <span class="slider-tick-btn__name">${levelCfg.level === 0 ? '地域のみ' : levelCfg.level === 1 ? '正確' : `${radiusLabel}`}</span>
      <span class="slider-tick-btn__sub">${radiusSub}</span>
    `;
    tickBtn.setAttribute(
      'aria-label',
      `レベル${levelCfg.level}: ${levelCfg.name}（半径: ${radiusLabel}）`
    );
    tickBtn.addEventListener('click', () => {
      store.setAccuracyLevel(levelCfg.level);
    });
    tickButtons.push(tickBtn);
    ticksContainer.appendChild(tickBtn);
  }
  sliderBlock.appendChild(ticksContainer);
  bottomPanel.appendChild(sliderBlock);

  // 3-3. 操作案内メッセージ＋投稿ボタン行
  const actionRow = document.createElement('div');
  actionRow.className = 'control-panel__action-row';

  const guideMessage = document.createElement('p');
  guideMessage.className = 'control-panel__guide';
  guideMessage.setAttribute('data-testid', 'submission-guide-message');
  guideMessage.setAttribute('aria-live', 'polite');

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn--primary btn--submit';
  submitBtn.setAttribute('data-testid', 'submit-photo-btn');
  submitBtn.textContent = 'この場所で写真を投稿する';

  actionRow.appendChild(guideMessage);
  actionRow.appendChild(submitBtn);
  bottomPanel.appendChild(actionRow);

  pageEl.appendChild(bottomPanel);
  container.appendChild(pageEl);

  // ---------------------------------------------------------------------------
  // ポインタ操作 vs キーボード操作の識別（タッチ・クリック操作時は中央照準を非表示にし、ピンとの混同を防ぐ）
  // ---------------------------------------------------------------------------
  let isPointerInteraction = false;
  const setKeyboardCenterMode = (active: boolean): void => {
    mapStage.classList.toggle('map-stage--keyboard-active', active);
  };

  const handleStagePointerDown = (): void => {
    isPointerInteraction = true;
    setKeyboardCenterMode(false);
  };
  const handleStageKeyDown = (e: KeyboardEvent): void => {
    if (
      e.key === 'Tab' ||
      e.key.startsWith('Arrow') ||
      e.key === 'Enter' ||
      e.key === ' '
    ) {
      isPointerInteraction = false;
      setKeyboardCenterMode(true);
    }
  };
  const handleStageFocusIn = (e: FocusEvent): void => {
    const target = e.target;
    if (target === selectMapCenterBtn) {
      setKeyboardCenterMode(true);
    } else if (target === mapCanvas && !isPointerInteraction) {
      setKeyboardCenterMode(true);
    }
  };
  const handleStageFocusOut = (e: FocusEvent): void => {
    const nextTarget = e.relatedTarget;
    if (!(nextTarget instanceof Node) || !mapStage.contains(nextTarget)) {
      setKeyboardCenterMode(false);
    }
  };

  mapStage.addEventListener('pointerdown', handleStagePointerDown, true);
  mapStage.addEventListener('mousedown', handleStagePointerDown, true);
  mapStage.addEventListener('touchstart', handleStagePointerDown, { capture: true, passive: true });
  mapStage.addEventListener('keydown', handleStageKeyDown, true);
  mapStage.addEventListener('focusin', handleStageFocusIn);
  mapStage.addEventListener('focusout', handleStageFocusOut);

  // ---------------------------------------------------------------------------
  // トースト通知制御
  // ---------------------------------------------------------------------------
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showToast = (
    message: string,
    type: 'warning' | 'info' = 'warning',
    actionButton?: { label: string; onClick: () => void }
  ): void => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    feedbackToast.innerHTML = '';
    feedbackToast.className = `map-toast map-toast--${type}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    feedbackToast.appendChild(textSpan);

    if (actionButton) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--small map-toast__action';
      btn.textContent = actionButton.label;
      btn.addEventListener('click', () => {
        feedbackToast.hidden = true;
        actionButton.onClick();
      });
      feedbackToast.appendChild(btn);
    }

    feedbackToast.hidden = false;
    toastTimer = setTimeout(() => {
      feedbackToast.hidden = true;
    }, 6000);
  };

  // ---------------------------------------------------------------------------
  // MapController の初期化とコールバック接続
  // ---------------------------------------------------------------------------
  const mapController = new MapController({
    onPinPositionSelected: (position: LatLng) => {
      feedbackToast.hidden = true;
      store.setPinPosition(position);
    },
    onOutOfBoundsAttempt: (_attemptedPosition: LatLng, reason: 'click' | 'drag') => {
      if (reason === 'drag') {
        showToast(
          '募集対象範囲（青い破線枠）の外にはピンを移動できません。元の位置に戻しました。',
          'warning'
        );
      } else {
        showToast(
          '募集対象範囲外です。青い破線枠の内側をタップして撮影地点を指定してください。',
          'warning'
        );
      }
    },
    onTapWhileRegionOnly: (attemptedPosition: LatLng) => {
      // レベル0選択中に範囲内をタップした場合：位置を記憶しつつ案内を表示し、ワンタップでレベル1へ切り替えられるようにする
      store.setPinPosition(attemptedPosition);
      showToast(
        '現在「レベル0（地域のみ・位置不明）」が選択されているためピンは非表示です。地点を指定して投稿する場合はレベル1以上に変更してください。',
        'info',
        {
          label: 'レベル1（正確な地点）に切り替える',
          onClick: () => {
            store.setAccuracyLevel(1);
          },
        }
      );
    },
    onMapLoadIssue: (hasIssue: boolean, message: string | null) => {
      if (hasIssue && message) {
        tileErrorText.textContent = message;
        tileErrorBanner.hidden = false;
      } else {
        tileErrorBanner.hidden = true;
      }
    },
  });

  mapController.init(mapCanvas, region, store.getSnapshot());

  // ---------------------------------------------------------------------------
  // UI状態の同期関数（単一スナップショットからすべての表示を更新）
  // ---------------------------------------------------------------------------
  const coordTextEl = statusPinBox.querySelector(
    '[data-testid="selected-coordinates-text"]'
  ) as HTMLElement;
  const accuracyBadgeEl = statusAccuracyBox.querySelector(
    '[data-testid="selected-accuracy-badge"]'
  ) as HTMLElement;

  const updateUiFromSnapshot = (snapshot: SubmissionStateSnapshot): void => {
    // 1. 地図レイヤー（ピン・円）の同期
    mapController.syncWithState(snapshot);

    // 2. スライダー値とARIA属性の同期
    rangeInput.value = String(snapshot.accuracyLevel);
    rangeInput.setAttribute('aria-valuenow', String(snapshot.accuracyLevel));
    rangeInput.setAttribute(
      'aria-valuetext',
      `レベル${snapshot.accuracyLevel}: ${snapshot.accuracyConfig.name}`
    );

    // 3. 目盛りボタンの選択状態更新
    for (const btn of tickButtons) {
      const btnLevel = Number(btn.getAttribute('data-level'));
      const isSelected = btnLevel === snapshot.accuracyLevel;
      btn.classList.toggle('slider-tick-btn--active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    }

    // 4. 現在の精度ラベル・半径テキストの更新
    accuracyBadgeEl.textContent = `Lv.${snapshot.accuracyLevel} ${snapshot.accuracyConfig.name}`;
    if (snapshot.accuracyConfig.radiusMeters === null) {
      sliderRadiusNote.textContent = '送信半径：空欄（座標・半径を送信しない）';
    } else if (snapshot.accuracyConfig.radiusMeters === 0) {
      sliderRadiusNote.textContent = '送信半径：0m（ピンのみ表示）';
    } else {
      sliderRadiusNote.textContent = `送信半径：${snapshot.accuracyConfig.radiusMeters}m（半透明の円を表示）`;
    }

    // 5. 選択された撮影地点の座標表示更新
    if (snapshot.accuracyLevel === 0) {
      if (snapshot.lastPinPosition) {
        coordTextEl.textContent = '地域のみ（記憶されたピン座標は送信されません）';
      } else {
        coordTextEl.textContent = '地域のみ（座標指定なし）';
      }
    } else if (snapshot.effectivePinPosition) {
      const latStr = formatCoordinate(snapshot.effectivePinPosition.lat);
      const lngStr = formatCoordinate(snapshot.effectivePinPosition.lng);
      coordTextEl.textContent = `北緯 ${latStr}°, 東経 ${lngStr}°`;
    } else {
      coordTextEl.textContent = '未指定（地図上の青い枠内をタップ）';
    }

    // 6. 操作案内文の更新（仕様要件 4.4：未指定時とレベル0時の必須文言を含む）
    if (snapshot.accuracyLevel === 0) {
      guideMessage.textContent =
        '撮影地点が分からない場合は、地域のみで投稿できます（位置情報はGoogleフォームへ送信されません）。';
      guideMessage.className = 'control-panel__guide control-panel__guide--ready';
    } else if (!snapshot.effectivePinPosition) {
      guideMessage.textContent =
        '地図上で撮影地点を選択してください（青い破線枠の内側をタップするとピンが設置されます）。';
      guideMessage.className = 'control-panel__guide control-panel__guide--prompt';
    } else {
      guideMessage.textContent = `${snapshot.accuracyConfig.description}。ピンをドラッグするか別の場所をタップして位置を微調整できます。`;
      guideMessage.className = 'control-panel__guide control-panel__guide--ready';
    }

    // 7. 投稿ボタンの有効・無効とラベル更新（仕様要件 3 / 4.4）
    submitBtn.disabled = !snapshot.canSubmit;
    submitBtn.setAttribute('aria-disabled', String(!snapshot.canSubmit));
    if (snapshot.accuracyLevel === 0) {
      submitBtn.textContent = '地域のみで写真を投稿する';
    } else {
      submitBtn.textContent = 'この場所で写真を投稿する';
    }
  };

  // 初回同期およびストア購読
  const unsubscribeStore = store.subscribe(updateUiFromSnapshot);
  updateUiFromSnapshot(store.getSnapshot());

  // ---------------------------------------------------------------------------
  // イベントリスナー登録
  // ---------------------------------------------------------------------------
  const handleRangeChange = (): void => {
    const numVal = Number(rangeInput.value);
    if (numVal >= 0 && numVal <= 4) {
      store.setAccuracyLevel(numVal as AccuracyLevelId);
    }
  };
  rangeInput.addEventListener('input', handleRangeChange);
  rangeInput.addEventListener('change', handleRangeChange);

  backBtn.addEventListener('click', () => {
    onBackToRegions();
  });

  fitBoundsBtn.addEventListener('click', () => {
    mapController.fitToRegionBounds();
  });

  tileReloadBtn.addEventListener('click', () => {
    mapController.reloadTiles();
  });

  selectMapCenterBtn.addEventListener('click', () => {
    mapController.selectMapCenterAsPin();
  });

  let closeConfirmModal: ((restoreFocus?: boolean) => void) | null = null;
  submitBtn.addEventListener('click', () => {
    const currentSnapshot = store.getSnapshot();
    if (!currentSnapshot.canSubmit) {
      showToast('地図上で撮影地点を選択してください。', 'warning');
      return;
    }
    const buildResult = buildGoogleFormUrl(formConfig, currentSnapshot);
    closeConfirmModal = openSubmissionConfirmModal(
      pageEl,
      currentSnapshot,
      buildResult,
      () => {
        closeConfirmModal = null;
      },
      submitBtn
    );
  });

  const handleWindowResize = (): void => {
    mapController.invalidateSize();
  };
  window.addEventListener('resize', handleWindowResize);

  // ---------------------------------------------------------------------------
  // クリーンアップ関数（仕様要件 8：画面遷移時の後処理）
  // ---------------------------------------------------------------------------
  const destroy = (): void => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (closeConfirmModal) {
      closeConfirmModal(false);
      closeConfirmModal = null;
    }
    unsubscribeStore();
    window.removeEventListener('resize', handleWindowResize);
    mapController.destroy();
  };

  return {
    getMapController: () => mapController,
    destroy,
  };
}
