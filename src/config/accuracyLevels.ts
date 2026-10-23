import type { AccuracyLevelConfig, AccuracyLevelId } from '../types';

/**
 * 位置精度スライダーの初期選択レベル（仕様要件 3 / 4.1：初期値はレベル1「正確な地点」）
 */
export const DEFAULT_ACCURACY_LEVEL: AccuracyLevelId = 1;

/**
 * 5段階の位置精度レベル定義（仕様要件 3 / 4.2）
 *
 * レベル2〜4の半径は各項目の radiusMeters を変更してください。
 * shortLabel と description は同じ値から生成されるため、表示との食い違いを防げます。
 * - レベル0: 地域のみ・位置不明（ピン・円を表示せず、座標・半径はGoogleフォームへ送信しない）
 * - レベル1: 正確な地点（ピンのみ表示、半径 "0" を明示的に送信）
 * - レベル2〜4: おおよその地点（ピン＋設定した半径の半透明円）
 */

type ApproximateAccuracyLevelSettings = {
  level: 2 | 3 | 4;
  name: string;
  shortName: string;
  radiusMeters: number;
};

function createApproximateAccuracyLevel({
  level,
  name,
  shortName,
  radiusMeters,
}: ApproximateAccuracyLevelSettings): AccuracyLevelConfig {
  return {
    level,
    name,
    shortLabel: `Lv.${level} ${shortName} (${radiusMeters}m)`,
    description: `ピンを中心とした半径${radiusMeters}m程度の範囲として記録します`,
    radiusMeters,
    showPin: true,
    showCircle: true,
  };
}

export const ACCURACY_LEVELS: readonly AccuracyLevelConfig[] = [
  {
    level: 0,
    name: '地域のみ・位置不明',
    shortLabel: 'Lv.0 地域のみ',
    description: '撮影地点が分からない場合は、地域のみで投稿できます（座標・半径は送信されません）',
    radiusMeters: null,
    showPin: false,
    showCircle: false,
  },
  {
    level: 1,
    name: '正確な地点',
    shortLabel: 'Lv.1 正確 (0m)',
    description: 'ピンを指した正確な撮影地点として記録します（半径 0m）',
    radiusMeters: 0,
    showPin: true,
    showCircle: false,
  },
  createApproximateAccuracyLevel({
    level: 2,
    name: 'おおよそ・狭い',
    shortName: '狭い',
    radiusMeters: 50,
  }),
  createApproximateAccuracyLevel({
    level: 3,
    name: 'おおよそ・中程度',
    shortName: '中程度',
    radiusMeters: 150,
  }),
  createApproximateAccuracyLevel({
    level: 4,
    name: 'おおよそ・広い',
    shortName: '広い',
    radiusMeters: 500,
  }),
] as const;
