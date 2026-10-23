# Googleフォームの作成・連携設定手順書

本Webサイトから引き継ぐ位置情報（地域ID・緯度・経度・位置精度半径）を受け取り、投稿者から「撮影者名」と「写真ファイル」を収集するためのGoogleフォーム設定手順です。

---

## 1. Googleフォームの新規作成と質問項目（全6項目）

[Googleフォーム](https://docs.google.com/forms/) にアクセスし、新しいフォームを1つ作成します。
仕様要件に基づき、原則として**複数地域で1つのGoogleフォームを共用**します。

以下の表のとおり、**6つの質問項目**を作成してください。

| 順序 | 質問タイトル（例） | 質問の種類 | 必須設定 | 入力元・備考 |
|---|---|---|---|---|
| 1 | `地域ID` | **記述式（短文回答）** | **必須（ON）** | Webサイトから自動入力されます |
| 2 | `緯度` | **記述式（短文回答）** | **任意（OFF）** | Webサイトから自動入力（「地域のみ」投稿時は空欄になるため**必ず任意回答**にします） |
| 3 | `経度` | **記述式（短文回答）** | **任意（OFF）** | Webサイトから自動入力（「地域のみ」投稿時は空欄になるため**必ず任意回答**にします） |
| 4 | `位置精度半径（m）` | **記述式（短文回答）** | **任意（OFF）** | Webサイトから自動入力（正確な地点は `0`、おおよそは `50` / `150` / `500`、地域のみは空欄になるため**必ず任意回答**にします） |
| 5 | `撮影者名（ニックネーム可）` | **記述式（短文回答）** | **必須（ON）** | 投稿者がGoogleフォーム上で入力します |
| 6 | `写真ファイル` | **ファイルのアップロード** | **必須（ON）** | 投稿者がGoogleフォーム上で写真を添付します |

### 「ファイルのアップロード」設定時のポイント
- 「特定のファイル形式のみを許可する」をONにし、**「画像」**にチェックを入れることを推奨します。
- 最大ファイル数（例：1個〜5個）と最大ファイルサイズ（例：10MB）を運用方針に合わせて設定してください。
- Googleフォームの仕様上、「ファイルのアップロード」を含むフォームへ回答するには、**投稿者が自身のGoogleアカウントにログインしている必要があります**。

---

## 2. 事前入力したリンクと `entry.xxxxxxx`（entry ID）の取得方法

1. Googleフォーム編集画面の右上にある **「︙」（その他アイコン）** をクリックし、**「事前入力したリンクを取得」** を選択します。
2. 開いた画面で、以下の4つの質問欄に分かりやすい仮の文字列を入力します（撮影者名・写真は空欄のままで構いません）。
   - `地域ID` の欄：`SAMPLE_REGION`
   - `緯度` の欄：`35.680000`
   - `経度` の欄：`139.760000`
   - `位置精度半径（m）` の欄：`50`
3. 画面下部の **「リンクを取得」** ボタンを押し、表示された **「リンクをコピー」** をクリックします。
4. コピーしたURLをメモ帳などに貼り付けると、以下のような形式になっています。

```text
https://docs.google.com/forms/d/e/1FAIpQLSeXXXXXXXXXXXXXXXXXXXXXXXXXXXX/viewform?usp=pp_url&entry.100000001=SAMPLE_REGION&entry.100000002=35.680000&entry.100000003=139.760000&entry.100000004=50
```

このURLから以下の5つの値を読み取ります：

- **ベースURL (`formUrl`)**：`?` より前の部分
  - `https://docs.google.com/forms/d/e/1FAIpQLSeXXXXXXXXXXXXXXXXXXXXXXXXXXXX/viewform`
- **地域IDの entry ID (`regionId`)**：`=SAMPLE_REGION` の直前のキー
  - 例：`entry.100000001`
- **緯度の entry ID (`latitude`)**：`=35.680000` の直前のキー
  - 例：`entry.100000002`
- **経度の entry ID (`longitude`)**：`=139.760000` の直前のキー
  - 例：`entry.100000003`
- **位置精度半径の entry ID (`accuracyRadius`)**：`=50` の直前のキー
  - 例：`entry.100000004`

---

## 3. 設定ファイル（`src/config/googleForm.ts`）への反映

本プロジェクトでは、すでに**実運用のGoogleフォーム設定**が `src/config/googleForm.ts` に反映されており、初期状態でそのままGoogleフォーム連携が有効化されています。

```ts
// src/config/googleForm.ts（現在設定済みの実運用値）
import type { GoogleFormConfig } from '../types';

export const GOOGLE_FORM_CONFIG: GoogleFormConfig = {
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSeFYPB0RD6ENjKX9Ju3XvF6kq-fatpaSS4ny1uLDEsMMoBWZA/viewform',
  entryIds: {
    regionId: 'entry.849123997',       // 1. 地域ID（必須項目）
    latitude: 'entry.2018650203',      // 2. 緯度（任意項目：地域のみ投稿時は省略）
    longitude: 'entry.1920272994',     // 3. 経度（任意項目：地域のみ投稿時は省略）
    accuracyRadius: 'entry.1323470590', // 4. 位置精度半径（m）（任意項目：レベル1では "0"、地域のみ投稿時は省略）
  },
};
```

### 別のGoogleフォームへ連携先を変更する場合

ご自身で作成した別のフォームへ変更する場合は、第2節で取得したベースURLと4つの entry ID を `src/config/googleForm.ts` に上書き設定します。

```ts
// src/config/googleForm.ts（差し替え例）
import type { GoogleFormConfig } from '../types';

export const GOOGLE_FORM_CONFIG: GoogleFormConfig = {
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSeXXXXXXXXXXXXXXXXXXXXXXXXXXXX/viewform',
  entryIds: {
    regionId: 'entry.100000001',
    latitude: 'entry.100000002',
    longitude: 'entry.100000003',
    accuracyRadius: 'entry.100000004',
  },
};
```

設定を保存して `npm run build`（または開発サーバー `npm run dev`）を実行すると、投稿確認ダイアログの「Googleフォームへ進む（外部サイト）」ボタンから、選択した地域ID・緯度・経度・位置精度半径が自動入力された状態で新しいGoogleフォームが開きます。

### `formUrl` に設定できるURL

`formUrl` には、Googleフォームの回答用URLを `https://docs.google.com` のホストから設定してください。対応するパスは `/forms/d/e/{フォームID}/viewform` または `/forms/d/{フォームID}/viewform` で、Googleアカウント用の `/u/{番号}/` を含む形式も利用できます。事前入力リンク全体をコピーした場合は、設定値にクエリより前のURLを使います。

HTTP、Google以外のホスト、編集画面のURL、`forms.gle` 短縮URL、ユーザー情報・標準外ポート・フラグメント付きURLは受け付けません。`forms.gle` を使用せず、Googleフォームの「事前入力したリンクを取得」から得た展開済みの回答用URLを設定してください。URL設定が不正な場合、サイトはフォームへの遷移リンクを作りません。

---

## 4. スプレッドシートでの回答データの解釈方法

Googleフォームの「回答」タブから「スプレッドシートにリンク」を選択すると、回答一覧がGoogleスプレッドシートに自動記録されます。

| 投稿パターン | 地域ID | 緯度 | 経度 | 位置精度半径（m） | 解釈 |
|---|---|---|---|---|---|
| **レベル0：地域のみ・位置不明** | `sample-tokyo-marunouchi` | *(空欄)* | *(空欄)* | *(空欄)* | 撮影地域のみ判明（仮の中心座標などは入らない） |
| **レベル1：正確な地点** | `sample-tokyo-marunouchi` | `35.678900` | `139.761200` | `0` | ピン位置そのもの（半径 `0` が明示的に記録される） |
| **レベル2：おおよそ・狭い** | `sample-tokyo-marunouchi` | `35.678900` | `139.761200` | `50` | 指定座標を中心に半径50m程度の範囲 |
| **レベル3：おおよそ・中程度** | `sample-tokyo-marunouchi` | `35.678900` | `139.761200` | `150` | 指定座標を中心に半径150m程度の範囲 |
| **レベル4：おおよそ・広い** | `sample-tokyo-marunouchi` | `35.678900` | `139.761200` | `500` | 指定座標を中心に半径500m程度の範囲 |
