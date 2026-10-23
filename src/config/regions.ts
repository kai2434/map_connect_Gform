import type { RegionConfig } from '../types';

/**
 * 募集対象地域の設定一覧
 *
 * 地域を追加・変更する場合は、この配列（REGIONS）を編集してください。
 * 設定ファイルに1件追加するだけで、地域選択画面および地図画面に自動的に反映されます。
 */
export const REGIONS: RegionConfig[] = [
  {
    id: 'kurama-kibune',
    name: '鞍馬・貴船地図',
    bounds: {
      southWest: { lat: 35.111324, lng: 135.759945 },
      northEast: { lat: 35.129903, lng: 135.775102 },
    },
  },
  {
    id: 'kurama-wide',
    name: '鞍馬広域地図',
    bounds: {
      southWest: { lat: 34.981872, lng: 135.753734 },
      northEast: { lat: 35.11373, lng: 135.795794 },
    },
  },
  {
    id: 'akame-shijuhachi-taki',
    name: '赤目四十八滝地図',
    bounds: {
      southWest: { lat: 34.555339, lng: 136.08295 },
      northEast: { lat: 34.566028, lng: 136.103573 },
    },
  },
  {
    id: 'akame-wide',
    name: '赤目広域地図',
    bounds: {
      southWest: { lat: 34.510919, lng: 135.743492 },
      northEast: { lat: 34.987933, lng: 136.084418 },
    },
  },
];
