/**
 * アプリケーション全体で使用する型定義ファイル
 * 将来的に地域登録GUIなどを追加する際にもそのまま流用できるよう、
 * ドメインデータ構造とUI状態を明確に分離しています。
 */

/**
 * 緯度・経度を表す座標型
 */
export interface LatLng {
  /** 緯度（-90 〜 90） */
  lat: number;
  /** 経度（-180 〜 180） */
  lng: number;
}

/**
 * 募集対象地域の四角形範囲（南西端・北東端）
 */
export interface RegionBounds {
  /** 南西端（左下）の緯度・経度 */
  southWest: LatLng;
  /** 北東端（右上）の緯度・経度 */
  northEast: LatLng;
}

/**
 * 地域設定データ型
 */
export interface RegionConfig {
  /** 一意の地域ID（Googleフォームへ送信される識別子） */
  id: string;
  /** 画面に表示する地域名 */
  name: string;
  /** 地域の説明文（任意） */
  description?: string;
  /** 募集対象範囲の四角形座標（南西端・北東端） */
  bounds: RegionBounds;
  /** サムネイル画像URLまたはデータURI（任意。未指定時は共通プレースホルダーを表示） */
  thumbnail?: string;
  /** サンプルデータであるかどうか（動作確認用データの明示用、任意） */
  isSample?: boolean;
}

/**
 * 位置精度レベルの5段階識別子（0〜4）
 */
export type AccuracyLevelId = 0 | 1 | 2 | 3 | 4;

/**
 * 位置精度レベルの設定データ型
 */
export interface AccuracyLevelConfig {
  /** レベル番号（0〜4） */
  level: AccuracyLevelId;
  /** 段階の名称（例：「正確な地点」「おおよそ・狭い」など） */
  name: string;
  /** 短いラベル（スライダー目盛り表示用） */
  shortLabel: string;
  /** 利用者向けの説明文 */
  description: string;
  /**
   * 地理的半径（メートル単位）
   * - レベル0（地域のみ・位置不明）の場合は null（座標・半径ともに送信しない）
   * - レベル1（正確な地点）の場合は 0（文字列 "0" を送信し、円は描画しない）
   * - レベル2〜4の場合は正の数値（例：50, 150, 500）
   */
  radiusMeters: number | null;
  /** ピンを地図上に表示するかどうか */
  showPin: boolean;
  /** 半透明の円を地図上に表示するかどうか */
  showCircle: boolean;
}

/**
 * Googleフォームの質問項目に対応する entry ID 設定型
 */
export interface GoogleFormEntryIds {
  /** 地域IDの質問 entry ID（例: "entry.123456789"） */
  regionId: string;
  /** 緯度の質問 entry ID */
  latitude: string;
  /** 経度の質問 entry ID */
  longitude: string;
  /** 位置精度半径（m）の質問 entry ID */
  accuracyRadius: string;
}

/**
 * Googleフォーム連携設定データ型
 */
export interface GoogleFormConfig {
  /**
   * GoogleフォームのベースURL
   * 例: "https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform"
   */
  formUrl: string;
  /** 各質問項目の entry ID マッピング */
  entryIds: GoogleFormEntryIds;
}

/**
 * Googleフォームへ引き継ぐ送信ペイロード型
 */
export interface SubmissionPayload {
  /** 地域ID（必須） */
  regionId: string;
  /** 緯度文字列（小数点以下6桁。レベル0の場合は null でパラメータ省略） */
  latitude: string | null;
  /** 経度文字列（小数点以下6桁。レベル0の場合は null でパラメータ省略） */
  longitude: string | null;
  /** 位置精度半径文字列（レベル1は "0"、レベル2〜4は半径数値文字列、レベル0は null で省略） */
  accuracyRadius: string | null;
}

/**
 * バリデーション結果型
 */
export interface ValidationResult {
  /** 検証が成功したかどうか */
  valid: boolean;
  /** エラーメッセージ一覧（日本語） */
  errors: string[];
}

/**
 * Googleフォーム事前入力URL生成結果型
 */
export interface FormUrlBuildResult {
  /** URL生成に成功し、実際に遷移可能かどうか */
  success: boolean;
  /** 生成された完全な事前入力URL（成功時のみ） */
  url: string | null;
  /** 設定未完了時でも確認用に表示できるクエリパラメータ文字列 */
  previewQueryString: string;
  /** 送信されるペイロード内容 */
  payload: SubmissionPayload | null;
  /** エラーまたは設定案内のメッセージ（日本語） */
  errorMessage: string | null;
  /** エラー種別（設定未完了・ピン未設置・URL不正など） */
  errorCode?: 'CONFIG_INCOMPLETE' | 'PIN_REQUIRED' | 'INVALID_URL' | 'REGION_MISSING';
}
