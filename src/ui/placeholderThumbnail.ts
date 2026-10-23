/**
 * サムネイル未設定の地域カードに表示する共通プレースホルダーSVGデータURI（仕様要件 3.1）
 */
export function getCommonPlaceholderThumbnail(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220" width="400" height="220" role="img" aria-label="地域サムネイルプレースホルダー">
    <rect width="400" height="220" fill="#e2e8f0" />
    <g stroke="#cbd5e1" stroke-width="1.5" fill="none">
      <line x1="0" y1="55" x2="400" y2="55" />
      <line x1="0" y1="110" x2="400" y2="110" />
      <line x1="0" y1="165" x2="400" y2="165" />
      <line x1="100" y1="0" x2="100" y2="220" />
      <line x1="200" y1="0" x2="200" y2="220" />
      <line x1="300" y1="0" x2="300" y2="220" />
    </g>
    <rect x="75" y="36" width="250" height="148" rx="8" fill="#f8fafc" stroke="#64748b" stroke-width="2" stroke-dasharray="6 4" />
    <path d="M200 68c-13.255 0-24 10.745-24 24 0 16.2 21.4 36.8 22.8 38.1a1.8 1.8 0 0 0 2.4 0C202.6 128.8 224 108.2 224 92c0-13.255-10.745-24-24-24zm0 33a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" fill="#475569" />
    <text x="200" y="158" text-anchor="middle" fill="#334155" font-family="sans-serif" font-size="14" font-weight="bold">募集対象地域マップ</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
