/**
 * 投稿写真＆コメントマップビューワー（viewer.html）で使用する型定義
 */

/**
 * 投稿のコンテンツ種別（3パターン）
 * - 'photo-only': 写真のみ（コメント空欄）
 * - 'comment-only': コメントのみ（写真なし）
 * - 'photo-and-comment': 写真とコメントの両方あり
 */
export type SubmissionContentType = 'photo-only' | 'comment-only' | 'photo-and-comment';

/**
 * ローカルから読み込まれた画像ファイル情報
 */
export interface LoadedLocalImage {
  /** 一意のキー（ファイル名＋サイズまたは連番） */
  key: string;
  /** 元のファイル名（例: "IMG_001 - 山田太郎.jpg"） */
  fileName: string;
  /** Object URL または Data URI */
  url: string;
  /** ファイルサイズ（バイト） */
  size: number;
}

/**
 * Googleフォーム回答CSVの1行を正規化した投稿レコード型
 */
export interface PhotoSubmissionRecord {
  /** 行識別ID（例: "row-1"） */
  id: string;
  /** 行番号（1始まり） */
  rowIndex: number;
  /** タイムスタンプ文字列 */
  timestamp: string;
  /** 対象地域ID（例: "kurama-kibune"） */
  regionId: string;
  /** 対象地域の表示名（例: "鞍馬・貴船地図"） */
  regionName: string;
  /** 撮影地点の緯度（地域のみ投稿時は null） */
  latitude: number | null;
  /** 撮影地点の経度（地域のみ投稿時は null） */
  longitude: number | null;
  /** 位置精度半径（m：0 / 50 / 150 / 500、地域のみ投稿時は null） */
  accuracyRadius: number | null;
  /** 撮影者名（未入力時は「匿名」） */
  contributorName: string;
  /** 投稿コメント（7問目：改行保持、未入力時は空文字 ""） */
  comment: string;
  /** CSV内の写真ファイル列の元文字列（GoogleドライブURLやファイル名など） */
  rawPhotoCell: string;
  /** 紐付けられた画像のURL配列 */
  imageUrls: string[];
  /** 紐付けられた画像のファイル名配列 */
  imageFileNames: string[];
  /** 投稿のコンテンツ種別（写真のみ / コメントのみ / 写真＆コメント両方） */
  contentType: SubmissionContentType;
}

/**
 * CSVの列インデックスマッピング（0始まり、該当列なしの場合は -1）
 */
export interface CsvColumnMapping {
  timestampCol: number;
  regionIdCol: number;
  latitudeCol: number;
  longitudeCol: number;
  accuracyRadiusCol: number;
  contributorNameCol: number;
  photoCol: number;
  commentCol: number;
}

/**
 * CSV解析結果
 */
export interface ParsedCsvResult {
  /** ヘッダー配列 */
  headers: string[];
  /** 自動検出または指定された列マッピング */
  mapping: CsvColumnMapping;
  /** 解析された投稿レコード一覧 */
  records: PhotoSubmissionRecord[];
}
