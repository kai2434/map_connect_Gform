import type { GoogleFormConfig } from '../types';

/**
 * Googleフォーム連携設定（仕様要件 4 / 5.3）
 *
 * 【設定手順】
 * 1. Googleフォームを作成し、「事前入力したリンクを取得」からURLを発行します。
 * 2. 発行されたURLのベース部分（`https://docs.google.com/forms/d/e/.../viewform`）を `formUrl` に設定します。
 * 3. 各質問に対応する `entry.xxxxxxxxx` を `entryIds` の4項目に設定します。
 * 詳細な手順は `README.md` および `docs/GOOGLE_FORM_SETUP.md` を参照してください。
 */
export const GOOGLE_FORM_CONFIG: GoogleFormConfig = {
  /**
   * GoogleフォームのベースURL（末尾が /viewform の回答用URL）
   */
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSeFYPB0RD6ENjKX9Ju3XvF6kq-fatpaSS4ny1uLDEsMMoBWZA/viewform',

  /**
   * 各質問項目の entry ID
   */
  entryIds: {
    /** 1. 地域ID（必須項目） */
    regionId: 'entry.849123997',
    /** 2. 緯度（任意項目：地域のみ投稿時は省略されます） */
    latitude: 'entry.2018650203',
    /** 3. 経度（任意項目：地域のみ投稿時は省略されます） */
    longitude: 'entry.1920272994',
    /** 4. 位置精度半径（m）（任意項目：レベル1では "0"、地域のみ投稿時は省略されます） */
    accuracyRadius: 'entry.1323470590',
  },
};
