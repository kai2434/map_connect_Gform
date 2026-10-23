import { REGIONS } from '../config/regions';
import type { RegionConfig } from '../types';
import type {
  CsvColumnMapping,
  LoadedLocalImage,
  ParsedCsvResult,
  PhotoSubmissionRecord,
  SubmissionContentType,
} from './photoViewerTypes';

/**
 * RFC 4180 準拠のCSV文字列パーサー
 * - UTF-8 BOM の除去
 * - ダブルクォートで囲まれたフィールド内のカンマ・改行（CRLF / LF）・エスケープ（""）を正確に処理する
 */
export function parseRawCsvRows(csvText: string): string[][] {
  const cleaned = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i]!;

    if (inQuotes) {
      if (ch === '"') {
        const nextCh = cleaned[i + 1];
        if (nextCh === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r') {
      if (cleaned[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // 末尾の完全に空の行を除去
  while (
    rows.length > 0 &&
    rows[rows.length - 1]!.every((cell) => cell.trim() === '')
  ) {
    rows.pop();
  }

  return rows;
}

/**
 * ヘッダー配列からGoogleフォーム回答CSVの列マッピングを自動検出する
 *
 * 標準構成（タイムスタンプ + 7問）：
 * Col 0: タイムスタンプ
 * Col 1 (1問目): 地域ID
 * Col 2 (2問目): 緯度
 * Col 3 (3問目): 経度
 * Col 4 (4問目): 位置精度半径（m）
 * Col 5 (5問目): 撮影者名
 * Col 6 (6問目): 写真ファイル
 * Col 7 (7問目・最後): コメント
 */
export function detectCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const normalized = headers.map((h) => h.trim().toLowerCase());

  const findIndexByPatterns = (patterns: RegExp[], excludeIndices: Set<number>): number => {
    for (const pattern of patterns) {
      for (let idx = 0; idx < normalized.length; idx += 1) {
        if (excludeIndices.has(idx)) continue;
        if (pattern.test(normalized[idx]!)) {
          excludeIndices.add(idx);
          return idx;
        }
      }
    }
    return -1;
  };

  const used = new Set<number>();

  const timestampCol = findIndexByPatterns(
    [/タイムスタンプ/, /timestamp/, /日時/, /送信日時/, /date/],
    used
  );
  const regionIdCol = findIndexByPatterns(
    [/地域id/, /region[_\s-]?id/, /対象地域/, /地域/, /エリア/, /region/],
    used
  );
  const latitudeCol = findIndexByPatterns(
    [/緯度/, /latitude/, /^lat$/],
    used
  );
  const longitudeCol = findIndexByPatterns(
    [/経度/, /longitude/, /^lng$/, /^lon$/],
    used
  );
  const accuracyRadiusCol = findIndexByPatterns(
    [/位置精度/, /精度半径/, /accuracy/, /半径/, /radius/, /精度/],
    used
  );
  const contributorNameCol = findIndexByPatterns(
    [/撮影者/, /ニックネーム/, /投稿者/, /氏名/, /お名前/, /名前/, /contributor/, /author/, /name/],
    used
  );
  const photoCol = findIndexByPatterns(
    [/写真/, /画像/, /ファイル/, /photo/, /image/, /file/, /upload/],
    used
  );
  let commentCol = findIndexByPatterns(
    [/コメント/, /感想/, /メッセージ/, /説明/, /備考/, /自由記述/, /comment/, /note/, /message/, /description/],
    used
  );

  // 7問目（最後の質問）がコメントである仕様に基づき、未検出かつ8列以上ある場合は最終列（または7番目インデックス）を割り当てる
  if (commentCol === -1 && headers.length >= 8) {
    const lastIdx = headers.length - 1;
    if (!used.has(lastIdx)) {
      commentCol = lastIdx;
      used.add(lastIdx);
    } else if (!used.has(7)) {
      commentCol = 7;
      used.add(7);
    }
  }

  return {
    timestampCol: timestampCol !== -1 ? timestampCol : 0,
    regionIdCol: regionIdCol !== -1 ? regionIdCol : 1,
    latitudeCol: latitudeCol !== -1 ? latitudeCol : 2,
    longitudeCol: longitudeCol !== -1 ? longitudeCol : 3,
    accuracyRadiusCol: accuracyRadiusCol !== -1 ? accuracyRadiusCol : 4,
    contributorNameCol: contributorNameCol !== -1 ? contributorNameCol : 5,
    photoCol: photoCol !== -1 ? photoCol : 6,
    commentCol: commentCol !== -1 ? commentCol : headers.length >= 8 ? headers.length - 1 : -1,
  };
}

/**
 * 数値セルを安全にパースする（空欄や不正値は null）
 */
function parseOptionalNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/m$/i, '').trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

/**
 * 画像の有無とコメントの有無から SubmissionContentType を判定する
 */
export function resolveContentType(
  hasPhoto: boolean,
  commentText: string
): SubmissionContentType {
  const hasComment = commentText.trim().length > 0;
  if (hasPhoto && hasComment) {
    return 'photo-and-comment';
  }
  if (hasPhoto) {
    return 'photo-only';
  }
  return 'comment-only';
}

/**
 * ファイル名から拡張子を除いたベース名を取得する
 */
function getBaseNameWithoutExt(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIdx = base.lastIndexOf('.');
  return dotIdx > 0 ? base.slice(0, dotIdx) : base;
}

/**
 * 投稿レコード一覧に対して、ローカルから読み込んだ画像ファイル一覧（LoadedLocalImage[]）をスマートに紐付ける
 *
 * マッチング優先順位：
 * 1. rawPhotoCell 内にローカル画像のファイル名（または拡張子なしベース名）が含まれている場合
 * 2. Googleフォームのドライブ保存形式「<元ファイル名> - <投稿者名>.<拡張子>」またはファイル名に撮影者名が含まれる場合（未使用画像を優先）
 * 3. rawPhotoCell が空でなく（GoogleドライブのURL等が入っており）、かつ未割当の画像がある場合、写真あり行の順番通りに未使用画像を自動割り当て
 */
export function matchImagesToRecords(
  records: PhotoSubmissionRecord[],
  localImages: LoadedLocalImage[]
): PhotoSubmissionRecord[] {
  if (localImages.length === 0) {
    return records.map((rec) => ({
      ...rec,
      contentType: resolveContentType(rec.imageUrls.length > 0, rec.comment),
    }));
  }

  const usedImageKeys = new Set<string>();
  const updated = records.map((rec) => ({
    ...rec,
    imageUrls: [...rec.imageUrls],
    imageFileNames: [...rec.imageFileNames],
  }));

  // Pass 1: ファイル名またはベース名の直接一致
  for (const rec of updated) {
    if (rec.imageUrls.length > 0) continue;
    const rawCell = rec.rawPhotoCell.trim();
    if (!rawCell) continue;

    const rawTokens = rawCell
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const matched: LoadedLocalImage[] = [];
    for (const img of localImages) {
      const lowerFileName = img.fileName.toLowerCase();
      const lowerBase = getBaseNameWithoutExt(img.fileName).toLowerCase();

      const isDirectHit =
        rawCell.toLowerCase().includes(lowerFileName) ||
        rawTokens.some((token) => {
          const tokenLower = token.toLowerCase();
          const tokenBase = getBaseNameWithoutExt(token).toLowerCase();
          return (
            tokenLower === lowerFileName ||
            (lowerBase.length >= 3 && tokenBase === lowerBase) ||
            (tokenBase.length >= 3 && lowerBase.startsWith(`${tokenBase} - `))
          );
        });

      if (isDirectHit) {
        matched.push(img);
        usedImageKeys.add(img.key);
      }
    }

    if (matched.length > 0) {
      rec.imageUrls = matched.map((m) => m.url);
      rec.imageFileNames = matched.map((m) => m.fileName);
    }
  }

  // Pass 2: Googleフォームの「<ファイル名> - <撮影者名>.jpg」形式による撮影者名一致（未使用画像から検索）
  for (const rec of updated) {
    if (rec.imageUrls.length > 0) continue;
    if (!rec.rawPhotoCell.trim()) continue;
    const contributor = rec.contributorName.trim();
    if (!contributor || contributor === '匿名') continue;

    const candidate = localImages.find(
      (img) =>
        !usedImageKeys.has(img.key) &&
        img.fileName.toLowerCase().includes(contributor.toLowerCase())
    );
    if (candidate) {
      rec.imageUrls = [candidate.url];
      rec.imageFileNames = [candidate.fileName];
      usedImageKeys.add(candidate.key);
    }
  }

  // Pass 3: 写真列（rawPhotoCell）にGoogleドライブURL等の値が入っているがまだ画像が未割当の行に対し、残りの未使用画像を順番に割り当てる
  const remainingImages = localImages.filter((img) => !usedImageKeys.has(img.key));
  let remainingIdx = 0;
  for (const rec of updated) {
    if (rec.imageUrls.length > 0) continue;
    if (!rec.rawPhotoCell.trim()) continue;
    if (remainingIdx < remainingImages.length) {
      const img = remainingImages[remainingIdx]!;
      rec.imageUrls = [img.url];
      rec.imageFileNames = [img.fileName];
      usedImageKeys.add(img.key);
      remainingIdx += 1;
    }
  }

  return updated.map((rec) => ({
    ...rec,
    contentType: resolveContentType(rec.imageUrls.length > 0, rec.comment),
  }));
}

/**
 * Googleフォーム回答CSVテキストを解析し、投稿レコード配列を生成する
 */
export function parseSubmissionCsv(
  csvText: string,
  regions: readonly RegionConfig[] = REGIONS,
  localImages: LoadedLocalImage[] = [],
  customMapping?: Partial<CsvColumnMapping>
): ParsedCsvResult {
  const rows = parseRawCsvRows(csvText);
  if (rows.length === 0) {
    return {
      headers: [],
      mapping: detectCsvColumnMapping([]),
      records: [],
    };
  }

  const headers = rows[0]!.map((h) => h.trim());
  const detected = detectCsvColumnMapping(headers);
  const mapping: CsvColumnMapping = {
    ...detected,
    ...customMapping,
  };

  const regionNameMap = new Map<string, string>();
  for (const r of regions) {
    regionNameMap.set(r.id, r.name);
  }

  const rawRecords: PhotoSubmissionRecord[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.every((cell) => cell.trim() === '')) continue;

    const getCell = (colIdx: number): string =>
      colIdx >= 0 && colIdx < row.length ? row[colIdx]!.trim() : '';

    const timestamp = getCell(mapping.timestampCol);
    const regionId = getCell(mapping.regionIdCol) || 'unknown';
    const regionName = regionNameMap.get(regionId) ?? regionId;

    const latVal = parseOptionalNumber(getCell(mapping.latitudeCol));
    const lngVal = parseOptionalNumber(getCell(mapping.longitudeCol));
    const hasValidCoords =
      latVal !== null &&
      lngVal !== null &&
      latVal >= -90 &&
      latVal <= 90 &&
      lngVal >= -180 &&
      lngVal <= 180;

    const radiusVal = parseOptionalNumber(getCell(mapping.accuracyRadiusCol));
    const contributorName = getCell(mapping.contributorNameCol) || '匿名';
    const rawPhotoCell = getCell(mapping.photoCol);
    // コメントは改行を保持するため前後の空白のみトリム
    const comment =
      mapping.commentCol >= 0 && mapping.commentCol < row.length
        ? row[mapping.commentCol]!.replace(/\r\n/g, '\n').trim()
        : '';

    // もし rawPhotoCell 自体が data:image/... やローカル相対パス（./images/...）なら初期画像として登録
    const initialUrls: string[] = [];
    const initialNames: string[] = [];
    if (
      rawPhotoCell.startsWith('data:image/') ||
      rawPhotoCell.startsWith('blob:') ||
      rawPhotoCell.startsWith('./') ||
      rawPhotoCell.startsWith('../')
    ) {
      initialUrls.push(rawPhotoCell);
      initialNames.push(rawPhotoCell.startsWith('data:') ? '埋め込み画像' : rawPhotoCell);
    }

    rawRecords.push({
      id: `submission-${rowIndex}`,
      rowIndex,
      timestamp,
      regionId,
      regionName,
      latitude: hasValidCoords ? latVal : null,
      longitude: hasValidCoords ? lngVal : null,
      accuracyRadius: hasValidCoords ? (radiusVal ?? 0) : null,
      contributorName,
      comment,
      rawPhotoCell,
      imageUrls: initialUrls,
      imageFileNames: initialNames,
      contentType: resolveContentType(initialUrls.length > 0, comment),
    });
  }

  const matchedRecords = matchImagesToRecords(rawRecords, localImages);

  return {
    headers,
    mapping,
    records: matchedRecords,
  };
}
