import type { LoadedLocalImage } from './photoViewerTypes';

/**
 * デモ表示用の美しい風景SVGデータURIを生成するヘルパー
 */
function createScenicSvgDataUri(
  gradientStart: string,
  gradientEnd: string,
  accentColor: string,
  title: string,
  subtitle: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" width="640" height="420">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${gradientStart}" />
        <stop offset="100%" stop-color="${gradientEnd}" />
      </linearGradient>
    </defs>
    <rect width="640" height="420" fill="url(#sky)" />
    <circle cx="500" cy="105" r="46" fill="${accentColor}" opacity="0.85" />
    <path d="M0 310 L150 185 L290 285 L440 160 L640 295 L640 420 L0 420 Z" fill="rgba(15,23,42,0.32)" />
    <path d="M0 340 L210 220 L390 325 L530 215 L640 310 L640 420 L0 420 Z" fill="rgba(15,23,42,0.52)" />
    <rect x="28" y="298" width="584" height="94" rx="12" fill="rgba(15,23,42,0.68)" stroke="rgba(255,255,255,0.28)" />
    <text x="52" y="340" fill="#ffffff" font-family="sans-serif" font-size="24" font-weight="bold">${title}</text>
    <text x="52" y="372" fill="#e2e8f0" font-family="sans-serif" font-size="16">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 動作確認用のデモローカル画像一覧を生成する
 */
export function createDemoLocalImages(): LoadedLocalImage[] {
  return [
    {
      key: 'demo-img-1',
      fileName: 'kibune_shrine_autumn - 佐藤花子.jpg',
      url: createScenicSvgDataUri('#1e3a8a', '#0284c7', '#f59e0b', '貴船神社 石段の灯籠', '撮影者: 佐藤花子（写真＋コメント両方）'),
      size: 245000,
    },
    {
      key: 'demo-img-2',
      fileName: 'kurama_temple_view - 鈴木一郎.jpg',
      url: createScenicSvgDataUri('#065f46', '#10b981', '#fde047', '鞍馬寺 本殿金堂前の展望', '撮影者: 鈴木一郎（写真のみ投稿）'),
      size: 312000,
    },
    {
      key: 'demo-img-3',
      fileName: 'akame_udaki_falls - 高橋健太.jpg',
      url: createScenicSvgDataUri('#0f766e', '#0e7490', '#38bdf8', '赤目四十八滝 不動滝の渓流', '撮影者: 高橋健太（写真＋コメント両方）'),
      size: 289000,
    },
    {
      key: 'demo-img-4',
      fileName: 'akame_moss_forest - 伊藤美咲.jpg',
      url: createScenicSvgDataUri('#14532d', '#15803d', '#bef264', '赤目渓谷 苔むす遊歩道', '撮影者: 伊藤美咲（地域のみ Lv.0）'),
      size: 198000,
    },
  ];
}

/**
 * 動作確認用のデモGoogleフォーム回答CSV文字列を生成する
 * - ①写真のみ、②コメントのみ、③写真＆コメントの両方、およびLv.0（地域のみ）を網羅
 */
export function createDemoCsvText(): string {
  const rows = [
    [
      'タイムスタンプ',
      '地域ID',
      '緯度',
      '経度',
      '位置精度半径（m）',
      '撮影者名（ニックネーム可）',
      '写真ファイル',
      'コメント',
    ],
    [
      '2026/10/24 10:15:30',
      'kurama-kibune',
      '35.121650',
      '135.762950',
      '0',
      '佐藤花子',
      'https://drive.google.com/open?id=DEMO_FILE_01 (kibune_shrine_autumn)',
      '夕暮れ時に灯籠に明かりが灯り始めた瞬間を撮影しました。\n石段の雰囲気がとても幻想的でした！',
    ],
    [
      '2026/10/24 11:02:10',
      'kurama-kibune',
      '35.118420',
      '135.770510',
      '50',
      '鈴木一郎',
      'https://drive.google.com/open?id=DEMO_FILE_02 (kurama_temple_view)',
      '',
    ],
    [
      '2026/10/24 11:45:00',
      'kurama-kibune',
      '35.124800',
      '135.764100',
      '150',
      '田中翔太',
      '',
      '貴船川沿いの川床エリアです。せせらぎの音が涼しく、紅葉の色づき始めが綺麗でした（コメントのみの投稿サンプル）。',
    ],
    [
      '2026/10/24 13:20:45',
      'akame-shijuhachi-taki',
      '34.560850',
      '136.091200',
      '0',
      '高橋健太',
      'https://drive.google.com/open?id=DEMO_FILE_03 (akame_udaki_falls)',
      '不動滝の正面から撮影しました。マイナスイオンたっぷりで水しぶきが迫力満点です。',
    ],
    [
      '2026/10/24 14:05:12',
      'akame-shijuhachi-taki',
      '34.558900',
      '136.096800',
      '500',
      '渡辺直樹',
      '',
      '百畳岩の周辺で休憩しました。正確な場所はうろ覚えですが、渓谷の風が心地よかったです。',
    ],
    [
      '2026/10/24 15:30:00',
      'akame-wide',
      '',
      '',
      '',
      '伊藤美咲',
      'https://drive.google.com/open?id=DEMO_FILE_04 (akame_moss_forest)',
      '撮影場所の正確な位置は分かりませんでしたが、赤目エリアの苔がとても美しかったので投稿します（地域のみLv.0のサンプル）。',
    ],
  ];

  return rows
    .map((row) =>
      row
        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\r\n');
}
