import type {
  LatLng,
  RegionBounds,
  RegionConfig,
  ValidationResult,
} from '../types';

/**
 * 緯度として有効な数値（-90〜90）であるか判定する
 */
export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/**
 * 経度として有効な数値（-180〜180）であるか判定する
 */
export function isValidLongitude(lng: unknown): lng is number {
  return typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/**
 * 地域の募集対象範囲（bounds）が地理的に有効か検証する
 * - 南西端と北東端の緯度・経度が有効範囲内であること
 * - 南西端の緯度 < 北東端の緯度 であること
 * - 南西端の経度 < 北東端の経度 であること
 */
export function validateRegionBounds(bounds: RegionBounds | undefined | null): ValidationResult {
  const errors: string[] = [];

  if (!bounds || !bounds.southWest || !bounds.northEast) {
    return {
      valid: false,
      errors: ['募集範囲（bounds）の南西端または北東端が定義されていません。'],
    };
  }

  const { southWest, northEast } = bounds;

  if (!isValidLatitude(southWest.lat)) {
    errors.push(`南西端の緯度（${String(southWest.lat)}）が不正です（-90〜90の範囲で指定してください）。`);
  }
  if (!isValidLongitude(southWest.lng)) {
    errors.push(`南西端の経度（${String(southWest.lng)}）が不正です（-180〜180の範囲で指定してください）。`);
  }
  if (!isValidLatitude(northEast.lat)) {
    errors.push(`北東端の緯度（${String(northEast.lat)}）が不正です（-90〜90の範囲で指定してください）。`);
  }
  if (!isValidLongitude(northEast.lng)) {
    errors.push(`北東端の経度（${String(northEast.lng)}）が不正です（-180〜180の範囲で指定してください）。`);
  }

  if (errors.length === 0) {
    if (southWest.lat >= northEast.lat) {
      errors.push(
        `南西端の緯度（${southWest.lat}）は北東端の緯度（${northEast.lat}）より小さい値にする必要があります。`
      );
    }
    if (southWest.lng >= northEast.lng) {
      errors.push(
        `南西端の経度（${southWest.lng}）は北東端の経度（${northEast.lng}）より小さい値にする必要があります。`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 単一の地域設定オブジェクトを検証する
 */
export function validateRegionConfig(region: RegionConfig | undefined | null): ValidationResult {
  const errors: string[] = [];

  if (!region) {
    return {
      valid: false,
      errors: ['地域データが指定されていません。'],
    };
  }

  const id = typeof region.id === 'string' ? region.id.trim() : '';
  const name = typeof region.name === 'string' ? region.name.trim() : '';

  if (!id) {
    errors.push('地域ID（id）が空です。一意の文字列を指定してください。');
  }
  if (!name) {
    errors.push(`地域ID「${id || '不明'}」の地域名（name）が空です。`);
  }

  const boundsResult = validateRegionBounds(region.bounds);
  if (!boundsResult.valid) {
    for (const err of boundsResult.errors) {
      errors.push(`地域「${name || id || '不明'}」: ${err}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 地域設定リスト全体の検証結果型
 */
export interface RegionsListValidationReport {
  /** すべての地域が有効かつ1件以上存在するか */
  valid: boolean;
  /** 検証を通過した有効な地域一覧 */
  validRegions: RegionConfig[];
  /** 検出されたエラーメッセージ一覧 */
  errors: string[];
  /** 重複IDが存在したかどうか */
  hasDuplicateIds: boolean;
}

/**
 * 地域設定リスト全体を検証し、不正なboundsや重複IDを検出する
 */
export function validateRegionsList(
  regions: readonly RegionConfig[] | undefined | null
): RegionsListValidationReport {
  const errors: string[] = [];
  const validRegions: RegionConfig[] = [];
  const seenIds = new Set<string>();
  let hasDuplicateIds = false;

  if (!regions || !Array.isArray(regions) || regions.length === 0) {
    return {
      valid: false,
      validRegions: [],
      errors: [
        '募集対象地域が1件も登録されていません。設定ファイル（src/config/regions.ts）に地域データを追加してください。',
      ],
      hasDuplicateIds: false,
    };
  }

  for (const region of regions) {
    const singleResult = validateRegionConfig(region);
    if (!singleResult.valid) {
      errors.push(...singleResult.errors);
      continue;
    }

    const normalizedId = region.id.trim();
    if (seenIds.has(normalizedId)) {
      hasDuplicateIds = true;
      errors.push(
        `地域ID「${normalizedId}」が重複して登録されています。地域IDは一意である必要があります。`
      );
      continue;
    }

    seenIds.add(normalizedId);
    validRegions.push({
      ...region,
      id: normalizedId,
      name: region.name.trim(),
    });
  }

  return {
    valid: errors.length === 0 && validRegions.length > 0,
    validRegions,
    errors,
    hasDuplicateIds,
  };
}

/**
 * 指定された座標（lat, lng）が募集対象範囲（bounds）の四角形内にあるか判定する（境界線上を含む）
 */
export function isPointWithinBounds(point: LatLng, bounds: RegionBounds): boolean {
  if (!isValidLatitude(point.lat) || !isValidLongitude(point.lng)) {
    return false;
  }
  const { southWest, northEast } = bounds;
  return (
    point.lat >= southWest.lat &&
    point.lat <= northEast.lat &&
    point.lng >= southWest.lng &&
    point.lng <= northEast.lng
  );
}

/**
 * 地域IDから該当する地域設定を検索する
 */
export function findRegionById(
  regions: readonly RegionConfig[],
  regionId: string | null | undefined
): RegionConfig | undefined {
  if (!regionId || typeof regionId !== 'string') {
    return undefined;
  }
  const trimmed = regionId.trim();
  return regions.find((r) => r.id === trimmed);
}
