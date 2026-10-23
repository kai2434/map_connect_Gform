import type { RegionsListValidationReport } from '../domain/regionValidator';
import type { RegionConfig } from '../types';
import { getCommonPlaceholderThumbnail } from './placeholderThumbnail';

/**
 * 地域選択画面のイベントハンドラ型
 */
export interface RegionSelectViewCallbacks {
  /** 利用者が地域カードを選択したとき */
  onSelectRegion: (regionId: string) => void;
}

/**
 * 地域選択画面のレンダリングを行う関数（仕様要件 2.1 / 3.1 / 5 / 6 / 7）
 */
export function renderRegionSelectView(
  container: HTMLElement,
  validationReport: RegionsListValidationReport,
  externalErrorMessage: string | null,
  callbacks: RegionSelectViewCallbacks
): void {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'region-select-page';

  // 1. ヘッダーセクション
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="site-header__inner">
      <div class="site-header__badge-row">
        <span class="badge badge--primary">地域別写真募集プロジェクト</span>
      </div>
      <h1 class="site-header__title">撮影地点を指定して写真を投稿</h1>
      <p class="site-header__lead">
        写真を撮影した地域を選び、地図上で撮影地点と位置の精度（5段階）を指定してからGoogleフォームで写真を投稿できます。
        正確な撮影場所が分からない場合でも「おおよその範囲」や「地域のみ」で投稿可能です。
      </p>
    </div>
  `;
  wrapper.appendChild(header);

  const main = document.createElement('main');
  main.className = 'region-select-main';

  // 2. 存在しない地域IDが指定された場合などのエラーバナー表示
  if (externalErrorMessage) {
    const errorAlert = document.createElement('div');
    errorAlert.className = 'alert alert--error';
    errorAlert.setAttribute('role', 'alert');
    errorAlert.innerHTML = `
      <div class="alert__title">指定された地域を表示できません</div>
      <p class="alert__body"></p>
    `;
    const bodyEl = errorAlert.querySelector('.alert__body');
    if (bodyEl) {
      bodyEl.textContent = externalErrorMessage;
    }
    main.appendChild(errorAlert);
  }

  // 3. 地域設定ファイルの検証エラー・警告表示（重複IDや不正なboundsの検出結果）
  if (validationReport.errors.length > 0) {
    const configAlert = document.createElement('div');
    configAlert.className = 'alert alert--warning';
    configAlert.setAttribute('role', 'alert');
    const title = document.createElement('div');
    title.className = 'alert__title';
    title.textContent = '地域設定データに確認が必要な項目があります';
    configAlert.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'alert__list';
    for (const errText of validationReport.errors) {
      const li = document.createElement('li');
      li.textContent = errText;
      list.appendChild(li);
    }
    configAlert.appendChild(list);
    main.appendChild(configAlert);
  }

  // 4. サンプルデータが含まれている場合の明示バナー（仕様要件 5）
  const hasSampleRegions = validationReport.validRegions.some((r) => r.isSample);
  if (hasSampleRegions) {
    const sampleNotice = document.createElement('div');
    sampleNotice.className = 'alert alert--info';
    sampleNotice.setAttribute('role', 'status');
    sampleNotice.innerHTML = `
      <div class="alert__title">動作確認用サンプル地域データを表示中</div>
      <p class="alert__body">
        現在表示されている地域は、機能確認用の<strong>架空のサンプルデータ</strong>です（実際の写真募集範囲ではありません）。
        運用時は <code>src/config/regions.ts</code> を編集することで、任意の募集地域を追加・変更できます。
      </p>
    `;
    main.appendChild(sampleNotice);
  }

  // 5. 利用手順ステップ案内
  const stepsSection = document.createElement('section');
  stepsSection.className = 'flow-steps';
  stepsSection.setAttribute('aria-label', '投稿の手順');
  stepsSection.innerHTML = `
    <ol class="flow-steps__list">
      <li class="flow-steps__item flow-steps__item--active">
        <span class="flow-steps__num">1</span>
        <span class="flow-steps__text">対象地域を選択</span>
      </li>
      <li class="flow-steps__item">
        <span class="flow-steps__num">2</span>
        <span class="flow-steps__text">地図上で地点・精度を指定</span>
      </li>
      <li class="flow-steps__item">
        <span class="flow-steps__num">3</span>
        <span class="flow-steps__text">Googleフォームで写真を送信</span>
      </li>
    </ol>
  `;
  main.appendChild(stepsSection);

  // 6. 地域一覧セクション
  const listSection = document.createElement('section');
  listSection.className = 'region-list-section';
  listSection.setAttribute('aria-labelledby', 'region-list-heading');

  const headingRow = document.createElement('div');
  headingRow.className = 'section-header';
  headingRow.innerHTML = `
    <h2 id="region-list-heading" class="section-header__title">募集対象地域一覧（${validationReport.validRegions.length}件）</h2>
    <p class="section-header__subtitle">投稿したい写真を撮影した地域を選択してください</p>
  `;
  listSection.appendChild(headingRow);

  if (validationReport.validRegions.length === 0) {
    // 地域が0件の場合の例外表示（仕様要件 7 / 9）
    const emptyBox = document.createElement('div');
    emptyBox.className = 'empty-state';
    emptyBox.setAttribute('role', 'status');
    emptyBox.innerHTML = `
      <p class="empty-state__title">現在選択できる募集地域が登録されていません</p>
      <p class="empty-state__desc">
        管理者は設定ファイル（<code>src/config/regions.ts</code>）に有効な地域データ（id, name, bounds）を追加してください。
      </p>
    `;
    listSection.appendChild(emptyBox);
  } else {
    const grid = document.createElement('div');
    grid.className = 'region-grid';
    grid.setAttribute('role', 'list');

    for (const region of validationReport.validRegions) {
      const card = createRegionCard(region, callbacks.onSelectRegion);
      grid.appendChild(card);
    }
    listSection.appendChild(grid);
  }

  main.appendChild(listSection);
  wrapper.appendChild(main);

  // 7. フッター
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <p class="site-footer__text">
      地図データ出典：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院 地理院タイル</a>
      ｜ 写真および撮影者名の送信にはGoogleフォーム（要Googleアカウントログイン）を使用します。
    </p>
  `;
  wrapper.appendChild(footer);

  container.appendChild(wrapper);
}

/**
 * 個別の地域カードDOM要素を生成する
 */
function createRegionCard(
  region: RegionConfig,
  onSelect: (regionId: string) => void
): HTMLElement {
  const article = document.createElement('article');
  article.className = 'region-card';
  article.setAttribute('role', 'listitem');
  article.setAttribute('data-region-id', region.id);

  const placeholderUrl = getCommonPlaceholderThumbnail();
  const thumbnailUrl =
    region.thumbnail && region.thumbnail.trim().length > 0
      ? region.thumbnail.trim()
      : placeholderUrl;

  const thumbWrapper = document.createElement('div');
  thumbWrapper.className = 'region-card__thumb-wrapper';

  const img = document.createElement('img');
  img.className = 'region-card__thumb';
  img.src = thumbnailUrl;
  img.alt = `${region.name}のサムネイル画像`;
  img.loading = 'lazy';
  // 画像読み込み失敗時も共通プレースホルダーへフォールバック
  img.addEventListener('error', () => {
    if (img.src !== placeholderUrl) {
      img.src = placeholderUrl;
    }
  });
  thumbWrapper.appendChild(img);

  if (region.isSample) {
    const sampleBadge = document.createElement('span');
    sampleBadge.className = 'region-card__sample-badge';
    sampleBadge.textContent = 'サンプルデータ';
    thumbWrapper.appendChild(sampleBadge);
  }

  article.appendChild(thumbWrapper);

  const body = document.createElement('div');
  body.className = 'region-card__body';

  const idRow = document.createElement('div');
  idRow.className = 'region-card__meta';
  const idBadge = document.createElement('span');
  idBadge.className = 'region-card__id';
  idBadge.textContent = `地域ID: ${region.id}`;
  idRow.appendChild(idBadge);
  body.appendChild(idRow);

  const titleEl = document.createElement('h3');
  titleEl.className = 'region-card__title';
  titleEl.textContent = region.name;
  body.appendChild(titleEl);

  if (region.description) {
    const descEl = document.createElement('p');
    descEl.className = 'region-card__desc';
    descEl.textContent = region.description;
    body.appendChild(descEl);
  }

  const boundsInfo = document.createElement('p');
  boundsInfo.className = 'region-card__bounds';
  const { southWest, northEast } = region.bounds;
  boundsInfo.textContent = `対象範囲: 北緯 ${southWest.lat.toFixed(3)}°〜${northEast.lat.toFixed(3)}° / 東経 ${southWest.lng.toFixed(3)}°〜${northEast.lng.toFixed(3)}°`;
  body.appendChild(boundsInfo);

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'btn btn--primary region-card__btn';
  actionBtn.textContent = 'この地域の地図を開く →';
  actionBtn.setAttribute('aria-label', `${region.name}（ID: ${region.id}）の地図を開いて撮影地点を指定する`);
  actionBtn.addEventListener('click', () => {
    onSelect(region.id);
  });

  // カード全体のクリックでも遷移可能にする（キーボード操作はボタンに集約）
  thumbWrapper.style.cursor = 'pointer';
  thumbWrapper.addEventListener('click', () => {
    onSelect(region.id);
  });
  titleEl.style.cursor = 'pointer';
  titleEl.addEventListener('click', () => {
    onSelect(region.id);
  });

  body.appendChild(actionBtn);
  article.appendChild(body);

  return article;
}
