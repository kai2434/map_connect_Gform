import type { SubmissionStateSnapshot } from '../domain/submissionState';
import type { FormUrlBuildResult } from '../types';

const activeModalClosers = new WeakMap<HTMLElement, () => void>();

type ConfirmModalCloser = (restoreFocus?: boolean) => void;

/**
 * Googleフォーム遷移前の確認ダイアログを表示する関数（仕様要件 4 / 6 / 7 / 8.4）
 * - 送信される4項目（地域ID、緯度、経度、位置精度半径）を利用者に明示する
 * - 外部サービス（Googleフォーム）への遷移であること、および写真アップロードにGoogleアカウントが必要であることを案内する
 * - Googleフォーム設定が未完了（プレースホルダー等）の場合はダミーURLへの遷移を禁止し、設定案内と送信パラメータプレビューを表示する
 */
export function openSubmissionConfirmModal(
  parentContainer: HTMLElement,
  snapshot: SubmissionStateSnapshot,
  buildResult: FormUrlBuildResult,
  onClose?: () => void,
  restoreFocusTo?: HTMLElement
): ConfirmModalCloser {
  activeModalClosers.get(parentContainer)?.();
  const activeElement = document.activeElement;
  const focusReturnTarget =
    restoreFocusTo ?? (activeElement instanceof HTMLElement ? activeElement : null);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'confirm-modal-title');

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.tabIndex = -1;

  const regionName = snapshot.selectedRegion?.name ?? '未選択';
  const payload = buildResult.payload;

  const latDisplay =
    payload?.latitude !== null && payload?.latitude !== undefined
      ? `${payload.latitude}（北緯）`
      : '空欄（地域のみ投稿のため送信しません）';
  const lngDisplay =
    payload?.longitude !== null && payload?.longitude !== undefined
      ? `${payload.longitude}（東経）`
      : '空欄（地域のみ投稿のため送信しません）';

  let radiusDisplay = '空欄（地域のみ投稿のため送信しません）';
  if (payload?.accuracyRadius !== null && payload?.accuracyRadius !== undefined) {
    if (payload.accuracyRadius === '0') {
      radiusDisplay = '0 m（正確な地点：文字列 "0" を送信）';
    } else {
      radiusDisplay = `${payload.accuracyRadius} m（${snapshot.accuracyConfig.name}）`;
    }
  }

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'modal-dialog__header';
  header.innerHTML = `
    <h2 id="confirm-modal-title" class="modal-dialog__title">投稿内容の確認（Googleフォームへ移動）</h2>
  `;
  const closeIconBtn = document.createElement('button');
  closeIconBtn.type = 'button';
  closeIconBtn.className = 'modal-dialog__close';
  closeIconBtn.setAttribute('aria-label', '確認画面を閉じる');
  closeIconBtn.textContent = '×';
  header.appendChild(closeIconBtn);
  dialog.appendChild(header);

  // ボディ
  const body = document.createElement('div');
  body.className = 'modal-dialog__body';

  const intro = document.createElement('p');
  intro.className = 'modal-dialog__intro';
  intro.textContent =
    '以下の位置情報を引き継いで、外部サービス（Googleフォーム）を開きます。Googleフォーム側で「撮影者名」と「写真ファイル」を追加して送信を完了してください。';
  body.appendChild(intro);

  // 送信データ確認テーブル
  const table = document.createElement('dl');
  table.className = 'summary-list';

  const items: Array<{ label: string; value: string; code?: string }> = [
    {
      label: '1. 対象地域（地域ID）',
      value: `${regionName}`,
      code: payload?.regionId ?? '',
    },
    {
      label: '2. 撮影地点の緯度',
      value: latDisplay,
    },
    {
      label: '3. 撮影地点の経度',
      value: lngDisplay,
    },
    {
      label: '4. 位置精度半径（m）',
      value: radiusDisplay,
    },
  ];

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'summary-list__row';

    const dt = document.createElement('dt');
    dt.className = 'summary-list__term';
    dt.textContent = item.label;

    const dd = document.createElement('dd');
    dd.className = 'summary-list__desc';
    dd.textContent = item.value;

    if (item.code) {
      const codeSpan = document.createElement('code');
      codeSpan.className = 'summary-list__code';
      codeSpan.textContent = `ID: ${item.code}`;
      dd.appendChild(document.createTextNode(' '));
      dd.appendChild(codeSpan);
    }

    row.appendChild(dt);
    row.appendChild(dd);
    table.appendChild(row);
  }
  body.appendChild(table);

  // Googleアカウントに関する注意事項（仕様要件 4 / 5.4 / 8.4）
  const accountNotice = document.createElement('div');
  accountNotice.className = 'modal-notice modal-notice--neutral';
  accountNotice.innerHTML = `
    <strong>ご注意：</strong>
    <ul>
      <li>Googleフォームで写真をアップロードするには、<strong>投稿者ご自身のGoogleアカウントへのログイン</strong>が必要です。</li>
      <li>Googleフォームが開いた時点ではまだ投稿は完了していません。フォーム内の「送信」ボタンを押して完了してください。</li>
    </ul>
  `;
  body.appendChild(accountNotice);

  // 設定状態に応じた表示分岐
  if (!buildResult.success || !buildResult.url) {
    const errorBox = document.createElement('div');
    errorBox.className = 'alert alert--warning modal-config-alert';
    errorBox.setAttribute('role', 'alert');

    const alertTitle = document.createElement('div');
    alertTitle.className = 'alert__title';
    alertTitle.textContent =
      buildResult.errorCode === 'CONFIG_INCOMPLETE'
        ? 'Googleフォームの接続設定が未完了のため遷移を停止しました'
        : 'Googleフォームへ移動できません';

    const alertDesc = document.createElement('p');
    alertDesc.className = 'alert__body';
    alertDesc.textContent =
      buildResult.errorMessage ??
      'GoogleフォームのURLまたはentry IDが正しく設定されていません。';

    errorBox.appendChild(alertTitle);
    errorBox.appendChild(alertDesc);

    if (buildResult.previewQueryString) {
      const previewBlock = document.createElement('div');
      previewBlock.className = 'query-preview';
      previewBlock.innerHTML = `
        <div class="query-preview__label">生成された事前入力パラメータ（動作確認用プレビュー）：</div>
        <code class="query-preview__code"></code>
        <p class="query-preview__hint">
          ※管理者が <code>src/config/googleForm.ts</code> に実際の <code>formUrl</code> と <code>entry.xxxxxxx</code> を設定すると、このパラメータが付与されたGoogleフォームへ即座に遷移できるようになります。
        </p>
      `;
      const codeEl = previewBlock.querySelector('.query-preview__code');
      if (codeEl) {
        codeEl.textContent = `?${buildResult.previewQueryString}`;
      }
      errorBox.appendChild(previewBlock);
    }

    body.appendChild(errorBox);
  } else {
    const urlPreview = document.createElement('details');
    urlPreview.className = 'query-preview query-preview--collapsible';
    urlPreview.innerHTML = `
      <summary class="query-preview__label">遷移先Googleフォーム事前入力URL（詳細を表示）</summary>
      <code class="query-preview__code"></code>
    `;
    const codeEl = urlPreview.querySelector('.query-preview__code');
    if (codeEl) {
      codeEl.textContent = buildResult.url;
    }
    body.appendChild(urlPreview);
  }

  dialog.appendChild(body);

  // フッターアクション
  const footer = document.createElement('div');
  footer.className = 'modal-dialog__footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn--secondary';
  cancelBtn.textContent = '地図に戻って修正する';

  footer.appendChild(cancelBtn);

  if (buildResult.success && buildResult.url) {
    const proceedLink = document.createElement('a');
    proceedLink.href = buildResult.url;
    proceedLink.target = '_blank';
    proceedLink.rel = 'noopener noreferrer';
    proceedLink.className = 'btn btn--primary modal-proceed-link';
    proceedLink.textContent = 'Googleフォームへ進む（外部サイト） ↗';
    footer.appendChild(proceedLink);
  } else {
    const disabledProceedBtn = document.createElement('button');
    disabledProceedBtn.type = 'button';
    disabledProceedBtn.className = 'btn btn--primary';
    disabledProceedBtn.disabled = true;
    disabledProceedBtn.textContent = 'Googleフォーム未設定のため遷移不可';
    footer.appendChild(disabledProceedBtn);
  }

  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  parentContainer.appendChild(backdrop);

  const inertTargets: Array<{ element: HTMLElement; wasInert: boolean }> = [];
  for (const child of Array.from(parentContainer.children)) {
    if (child === backdrop) {
      continue;
    }
    const element = child as HTMLElement;
    inertTargets.push({ element, wasInert: element.inert });
    element.inert = true;
  }

  let isClosed = false;
  const cleanup = (restoreFocus = true): void => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    window.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('focusin', handleFocusIn, true);
    if (backdrop.parentNode) {
      backdrop.remove();
    }
    for (const target of inertTargets) {
      target.element.inert = target.wasInert;
    }
    if (activeModalClosers.get(parentContainer) === cleanup) {
      activeModalClosers.delete(parentContainer);
    }
    if (onClose) {
      onClose();
    }
    if (restoreFocus && focusReturnTarget?.isConnected) {
      focusReturnTarget.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      return;
    }

    if (e.key !== 'Tab') {
      return;
    }

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.hidden &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.closest('[inert]')
    );

    if (focusableElements.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusableElements[0]!;
    const last = focusableElements[focusableElements.length - 1]!;
    const current = document.activeElement;
    const focusIsOutside = !(current instanceof Node) || !dialog.contains(current);

    if (e.shiftKey && (current === first || focusIsOutside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || focusIsOutside)) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleFocusIn = (e: FocusEvent): void => {
    if (!(e.target instanceof Node) || !backdrop.contains(e.target)) {
      cancelBtn.focus();
    }
  };

  activeModalClosers.set(parentContainer, cleanup);
  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('focusin', handleFocusIn, true);
  closeIconBtn.addEventListener('click', () => cleanup());
  cancelBtn.addEventListener('click', () => cleanup());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      cleanup();
    }
  });

  cancelBtn.focus();

  return cleanup;
}
