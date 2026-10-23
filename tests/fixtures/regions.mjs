/**
 * 本番の地域設定から独立した、単体・ブラウザテスト専用地域。
 */
export const TEST_REGIONS = Object.freeze([
  {
    id: 'fixture-region-alpha',
    name: '検証地域アルファ',
    description: 'テスト専用の小さな募集範囲です。',
    bounds: {
      southWest: { lat: 47.010, lng: 8.510 },
      northEast: { lat: 47.040, lng: 8.550 },
    },
    thumbnail: './images/test-thumbnail.svg',
  },
  {
    id: 'fixture-region-beta',
    name: '検証地域ベータ',
    description: '地域件数やサンプル名に依存しないことを確かめる補助データです。',
    bounds: {
      southWest: { lat: -33.910, lng: 151.180 },
      northEast: { lat: -33.870, lng: 151.230 },
    },
  },
]);

export function pointInTestRegion(region = TEST_REGIONS[0], latRatio = 0.5, lngRatio = 0.5) {
  const { southWest, northEast } = region.bounds;
  return {
    lat: southWest.lat + (northEast.lat - southWest.lat) * latRatio,
    lng: southWest.lng + (northEast.lng - southWest.lng) * lngRatio,
  };
}
