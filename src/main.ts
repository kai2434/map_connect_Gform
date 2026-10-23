import { PhotoSpotApp } from './app';
import type { GoogleFormConfig } from './types';

declare global {
  interface Window {
    /** E2E実ブラウザ検証用のテスト設定オーバーライド（通常運用時は未定義） */
    __PHOTO_SPOT_TEST_FORM_CONFIG__?: GoogleFormConfig;
    /** E2E実ブラウザ検証用のアプリケーションインスタンス参照 */
    __PHOTO_SPOT_APP__?: PhotoSpotApp;
  }
}

/**
 * ブラウザ起動時のエントリーポイント
 */
function bootstrap(): void {
  const rootElement = document.getElementById('app');
  if (!rootElement) {
    console.error('マウント先の #app 要素が見つかりません。');
    return;
  }

  const customFormConfig =
    typeof window !== 'undefined' ? window.__PHOTO_SPOT_TEST_FORM_CONFIG__ : undefined;

  const app = new PhotoSpotApp({
    rootElement,
    formConfig: customFormConfig,
  });
  app.start();

  if (typeof window !== 'undefined') {
    window.__PHOTO_SPOT_APP__ = app;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
