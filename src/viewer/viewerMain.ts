import { REGIONS } from '../config/regions';
import { ViewerApp } from './viewerApp';

/**
 * テスト環境等から初期領域設定を上書き可能にするグローバルフック
 */
declare global {
  interface Window {
    __PHOTO_VIEWER_APP__?: ViewerApp;
  }
}

function bootstrapViewer(): void {
  const appRoot = document.getElementById('viewer-app');
  if (!appRoot) {
    throw new Error('マウント先の #viewer-app 要素が見つかりません。');
  }

  const app = new ViewerApp(appRoot, REGIONS);
  app.init();
  window.__PHOTO_VIEWER_APP__ = app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapViewer);
} else {
  bootstrapViewer();
}
