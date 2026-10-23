import { ACCURACY_LEVELS, DEFAULT_ACCURACY_LEVEL } from '../config/accuracyLevels';
import type {
  AccuracyLevelConfig,
  AccuracyLevelId,
  ValidationResult,
} from '../types';

/**
 * 値が有効な位置精度レベル番号（0〜4の整数）であるか判定する
 */
export function isValidAccuracyLevel(
  value: unknown,
  levels: readonly AccuracyLevelConfig[] = ACCURACY_LEVELS
): value is AccuracyLevelId {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return false;
  }
  return levels.some((item) => item.level === value);
}

/**
 * 指定されたレベル番号に対応する位置精度設定を取得する
 * 万一不正なレベルが渡された場合は初期レベル（レベル1）の設定を返す
 */
export function getAccuracyLevelConfig(
  level: AccuracyLevelId,
  levels: readonly AccuracyLevelConfig[] = ACCURACY_LEVELS
): AccuracyLevelConfig {
  const found = levels.find((item) => item.level === level);
  if (found) {
    return found;
  }
  const fallback = levels.find((item) => item.level === DEFAULT_ACCURACY_LEVEL) ?? levels[0];
  if (!fallback) {
    throw new Error('位置精度レベル設定（ACCURACY_LEVELS）が空です。');
  }
  return fallback;
}

/**
 * 位置精度設定ファイル（ACCURACY_LEVELS）の整合性を検証する
 */
export function validateAccuracyLevels(
  levels: readonly AccuracyLevelConfig[] = ACCURACY_LEVELS
): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(levels) || levels.length !== 5) {
    errors.push('位置精度レベルは0〜4の5段階である必要があります。');
    return { valid: false, errors };
  }

  const expectedLevels: AccuracyLevelId[] = [0, 1, 2, 3, 4];
  for (const expected of expectedLevels) {
    const item = levels.find((l) => l.level === expected);
    if (!item) {
      errors.push(`位置精度レベル ${expected} が定義されていません。`);
      continue;
    }

    if (expected === 0) {
      if (item.radiusMeters !== null) {
        errors.push('レベル0（地域のみ）の半径（radiusMeters）は null である必要があります。');
      }
      if (item.showPin || item.showCircle) {
        errors.push('レベル0（地域のみ）ではピンおよび円は非表示（false）である必要があります。');
      }
    } else if (expected === 1) {
      if (item.radiusMeters !== 0) {
        errors.push('レベル1（正確な地点）の半径（radiusMeters）は 0 である必要があります。');
      }
      if (!item.showPin || item.showCircle) {
        errors.push('レベル1（正確な地点）ではピンのみ表示（showPin: true, showCircle: false）である必要があります。');
      }
    } else {
      if (typeof item.radiusMeters !== 'number' || !Number.isFinite(item.radiusMeters) || item.radiusMeters <= 0) {
        errors.push(`レベル${expected}の半径（radiusMeters）は正の数値である必要があります。`);
      }
      if (!item.showPin || !item.showCircle) {
        errors.push(`レベル${expected}ではピンと円の両方を表示（showPin: true, showCircle: true）する必要があります。`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
