import type {
  FormUrlBuildResult,
  GoogleFormConfig,
  ValidationResult,
} from '../types';
import type { SubmissionStateSnapshot } from './submissionState';

/**
 * プレースホルダー（未設定状態）と判定するパターン一覧
 * 仕様要件 4 / 5.3「設定値が未登録、無効、またはプレースホルダーである場合は、Googleフォームへの遷移を禁止」に対応
 */
const PLACEHOLDER_URL_PATTERNS = [
  /YOUR_FORM_ID/i,
  /EXAMPLE/i,
  /DUMMY/i,
  /PLACEHOLDER/i,
  /XXXX/i,
  /000000/,
];

const PLACEHOLDER_ENTRY_PATTERNS = [
  /^entry\.0+$/i,
  /^entry\.000000\d*$/i,
  /^entry\.123456\d*$/i,
  /YOUR_ENTRY/i,
  /PLACEHOLDER/i,
  /DUMMY/i,
];

const GOOGLE_FORMS_HOST = 'docs.google.com';
const GOOGLE_FORMS_ANSWER_PATH_PATTERN =
  /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/;

function getGoogleFormUrlError(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'GoogleフォームのURL形式が不正です。HTTPSの回答用URLを指定してください。';
  }

  if (parsed.hostname === 'forms.gle') {
    return 'forms.gle の短縮URLでは事前入力が保証できません。Googleフォームの「事前入力したリンクを取得」から得た、展開済みの回答用URLを設定してください。';
  }

  if (parsed.protocol !== 'https:') {
    return 'GoogleフォームのURLはHTTPSである必要があります。';
  }
  if (
    parsed.username ||
    parsed.password ||
    /^https:\/\/[^/?#]*@/i.test(rawUrl)
  ) {
    return 'GoogleフォームのURLにユーザー名やパスワードを含めることはできません。';
  }
  if (parsed.hostname !== GOOGLE_FORMS_HOST) {
    return 'Googleフォームの回答用URLには docs.google.com のホストを指定してください。';
  }
  if (parsed.port) {
    return 'GoogleフォームのURLに標準以外のポート番号を指定することはできません。';
  }
  if (parsed.hash || rawUrl.includes('#')) {
    return 'GoogleフォームのURLにフラグメント（#以降）を含めないでください。';
  }
  if (!GOOGLE_FORMS_ANSWER_PATH_PATTERN.test(parsed.pathname)) {
    return 'Googleフォームの回答用URLを指定してください。対応形式は /forms/d/e/{フォームID}/viewform または /forms/d/{フォームID}/viewform です。編集URLや他のパスは使用できません。';
  }

  return null;
}

function getEntryIdOrFallback(entryId: unknown, fallback: string): string {
  if (typeof entryId !== 'string') {
    return fallback;
  }
  return entryId.trim() || fallback;
}

/**
 * entry ID が Googleフォームの有効な形式（entry.<数字>）かつプレースホルダーでないか検証する
 */
export function isValidEntryId(entryId: unknown): entryId is string {
  if (typeof entryId !== 'string') {
    return false;
  }
  const trimmed = entryId.trim();
  if (!/^entry\.\d+$/.test(trimmed)) {
    return false;
  }
  for (const pattern of PLACEHOLDER_ENTRY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }
  return true;
}

/**
 * Googleフォーム設定（formUrl および entryIds）が実運用可能な状態か検証する
 */
export function validateGoogleFormConfig(
  config: GoogleFormConfig | undefined | null
): ValidationResult {
  const errors: string[] = [];

  if (!config) {
    return {
      valid: false,
      errors: ['Googleフォーム連携設定（GOOGLE_FORM_CONFIG）が定義されていません。'],
    };
  }

  const rawUrl = typeof config.formUrl === 'string' ? config.formUrl.trim() : '';
  if (!rawUrl) {
    errors.push(
      'GoogleフォームのベースURL（formUrl）が未設定です。src/config/googleForm.ts を編集して設定してください。'
    );
  } else {
    for (const pattern of PLACEHOLDER_URL_PATTERNS) {
      if (pattern.test(rawUrl)) {
        errors.push(
          'GoogleフォームのURLが初期プレースホルダー（未設定）のままです。src/config/googleForm.ts に実際のフォームURLを設定してください。'
        );
        break;
      }
    }

    const urlError = getGoogleFormUrlError(rawUrl);
    if (urlError) {
      errors.push(urlError);
    }
  }

  if (!config.entryIds) {
    errors.push('Googleフォームの質問項目ID（entryIds）が設定されていません。');
  } else {
    const fieldLabels: Array<{ key: keyof GoogleFormConfig['entryIds']; label: string }> = [
      { key: 'regionId', label: '地域ID（regionId）' },
      { key: 'latitude', label: '緯度（latitude）' },
      { key: 'longitude', label: '経度（longitude）' },
      { key: 'accuracyRadius', label: '位置精度半径（accuracyRadius）' },
    ];

    const usedEntryIds = new Set<string>();
    for (const { key, label } of fieldLabels) {
      const val = config.entryIds[key];
      if (!isValidEntryId(val)) {
        errors.push(
          `${label} の entry ID（"${String(val ?? '')}"）が未設定またはプレースホルダーです。「entry.数字」形式で実際のIDを設定してください。`
        );
      } else {
        const normalized = val.trim();
        if (usedEntryIds.has(normalized)) {
          errors.push(
            `${label} の entry ID（"${normalized}"）が他の項目と重複しています。各質問に固有の entry ID を設定してください。`
          );
        }
        usedEntryIds.add(normalized);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 現在の投稿状態スナップショットとGoogleフォーム設定から事前入力URLを生成する（仕様要件 4 / 5.3）
 *
 * - URL および URLSearchParams を使用して安全に構築
 * - レベル0（地域のみ）では緯度・経度・半径のパラメータを完全に省略
 * - レベル1（正確な地点）では半径として文字列 "0" を明示的に付与
 * - レベル2〜4では選択された半径（例: "50", "150", "500"）と小数点以下6桁の緯度・経度を付与
 * - 設定未完了・プレースホルダーの場合は遷移を禁止（success: false, url: null）しつつ、
 *   画面確認用に previewQueryString と payload を返す
 */
export function buildGoogleFormUrl(
  config: GoogleFormConfig,
  snapshot: SubmissionStateSnapshot
): FormUrlBuildResult {
  if (!snapshot.selectedRegion) {
    return {
      success: false,
      url: null,
      previewQueryString: '',
      payload: null,
      errorMessage: '地域が選択されていません。地域選択画面から対象地域を選択してください。',
      errorCode: 'REGION_MISSING',
    };
  }

  if (!snapshot.canSubmit || !snapshot.submissionPayload) {
    return {
      success: false,
      url: null,
      previewQueryString: '',
      payload: null,
      errorMessage:
        '撮影地点のピンが設置されていません。地図上の募集対象範囲内をタップしてピンを設置するか、位置が分からない場合はスライダーを「レベル0（地域のみ）」に変更してください。',
      errorCode: 'PIN_REQUIRED',
    };
  }

  const payload = snapshot.submissionPayload;

  // プレビュー用のクエリパラメータ構築（設定未完了時でもどの値が送られるか確認可能にする）
  const previewParams = new URLSearchParams();
  previewParams.set('usp', 'pp_url');
  const regionEntryKey = getEntryIdOrFallback(config?.entryIds?.regionId, 'entry.regionId');
  const latEntryKey = getEntryIdOrFallback(config?.entryIds?.latitude, 'entry.latitude');
  const lngEntryKey = getEntryIdOrFallback(config?.entryIds?.longitude, 'entry.longitude');
  const radiusEntryKey = getEntryIdOrFallback(
    config?.entryIds?.accuracyRadius,
    'entry.accuracyRadius'
  );

  previewParams.set(regionEntryKey, payload.regionId);
  if (payload.latitude !== null && payload.longitude !== null && payload.accuracyRadius !== null) {
    previewParams.set(latEntryKey, payload.latitude);
    previewParams.set(lngEntryKey, payload.longitude);
    previewParams.set(radiusEntryKey, payload.accuracyRadius);
  }
  const previewQueryString = previewParams.toString();

  // Googleフォーム設定の検証
  const configValidation = validateGoogleFormConfig(config);
  if (!configValidation.valid) {
    return {
      success: false,
      url: null,
      previewQueryString,
      payload,
      errorMessage: configValidation.errors.join(' '),
      errorCode: 'CONFIG_INCOMPLETE',
    };
  }

  try {
    const formUrl = new URL(config.formUrl.trim());
    formUrl.searchParams.set('usp', 'pp_url');

    // ベースURLに事前入力値が残っていても、今回の投稿内容と食い違わないよう管理項目を先に消去する。
    formUrl.searchParams.delete(config.entryIds.latitude.trim());
    formUrl.searchParams.delete(config.entryIds.longitude.trim());
    formUrl.searchParams.delete(config.entryIds.accuracyRadius.trim());

    // 1. 地域ID（必須）
    formUrl.searchParams.set(config.entryIds.regionId.trim(), payload.regionId);

    // 2〜4. 緯度・経度・位置精度半径（レベル0の場合は省略し、レベル1〜4の場合のみ付与）
    if (
      payload.latitude !== null &&
      payload.longitude !== null &&
      payload.accuracyRadius !== null
    ) {
      formUrl.searchParams.set(config.entryIds.latitude.trim(), payload.latitude);
      formUrl.searchParams.set(config.entryIds.longitude.trim(), payload.longitude);
      formUrl.searchParams.set(config.entryIds.accuracyRadius.trim(), payload.accuracyRadius);
    }

    return {
      success: true,
      url: formUrl.toString(),
      previewQueryString: formUrl.searchParams.toString(),
      payload,
      errorMessage: null,
    };
  } catch {
    return {
      success: false,
      url: null,
      previewQueryString,
      payload,
      errorMessage:
        'Googleフォーム事前入力URLの生成に失敗しました。設定ファイル（src/config/googleForm.ts）のURL形式を確認してください。',
      errorCode: 'INVALID_URL',
    };
  }
}
