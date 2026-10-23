# 地域別写真撮影地点投稿Webサイト

複数の指定地域について写真を募集し、利用者が国土地理院地図（Leaflet.js）上で**撮影地点の座標**と**5段階の位置精度**を指定したうえで、**Googleフォームの事前入力URL**へ引き継いで写真を投稿できる静的Webサイトです。

---

## 目次

1. [必要な開発環境](#1-必要な開発環境)
2. [インストール方法](#2-インストール方法)
3. [ローカル起動方法](#3-ローカル起動方法)
4. [ビルドおよびテスト実行方法](#4-ビルドおよびテスト実行方法)
5. [地域の追加・変更方法](#5-地域の追加変更方法)
6. [緯度経度の設定方法](#6-緯度経度の設定方法)
7. [位置精度半径の変更方法](#7-位置精度半径の変更方法)
8. [Googleフォームの連携状態と作成方法](#8-googleフォームの連携状態と作成方法)
9. [フォームentry IDの取得方法と連携先変更](#9-フォームentry-idの取得方法と連携先変更)
10. [GitHub Pagesへの公開方法](#10-github-pagesへの公開方法)
11. [既知の制約事項](#11-既知の制約事項)
12. [ディレクトリ・ファイル構成](#12-ディレクトリファイル構成)

---

## 1. 必要な開発環境

- **Node.js**: v20 以上推奨（v22 / v24 で動作確認済み）
- **npm**: v10 以上推奨
- モダンWebブラウザ（Google Chrome, Safari, Firefox, Microsoft Edge の最新版、および iOS Safari / Android Chrome）

> **技術構成に関する補足**  
> 本番サイトは **TypeScript + Leaflet.js** から生成する静的ファイルで動作します。ブラウザE2Eテストは `playwright-core` を使用するため、ローカルでは Chrome のインストールが必要です。通常の場所から見つからない場合は、環境変数 `CHROME_PATH` に実行ファイルを指定してください。GitHub Actions ではワークフローがChromeを準備します。

---

## 2. インストール方法

プロジェクトのルートディレクトリで以下のコマンドを実行します。

```bash
npm install
```

（環境によってネイティブスクリプトの制限がある場合は `npm install --ignore-scripts` でも同様にインストールできます。）

---

## 3. ローカル起動方法

開発サーバーを起動するには以下のコマンドを実行します。

```bash
npm run dev
```

- 自動的にTypeScriptのビルドが実行され、`http://localhost:5173/` でローカルサーバーが起動します。
- `src/` 配下のファイルを編集・保存すると、自動的に再ビルドが行われます。

ビルド済み成果物（`dist/`）のみを配信して確認する場合は以下を実行します。

```bash
npm run preview
```

---

## 4. ビルドおよびテスト実行方法

### 本番用静的サイトのビルド

```bash
npm run build
```

- TypeScriptの型チェックとコンパイルが実行され、新しい `dist/` ディレクトリに静的Webサイト一式が出力されます。
- 既存の `dist/` は削除せず、成功したビルドの切替時に `.build-history/dist-<日時>-<ID>/` へ移動保存します。ビルドに失敗した場合は現在の `dist/` を保ちます。
- 保存済みのビルドを残したまま別の場所へ出力する場合は、空の新しいフォルダを指定します。既存ファイルのある出力先は上書きしません。

```bash
npm run build -- --out-dir "B:\Temp\map-form-build-001"
```

上記のパスは例です。出力先はプロジェクトルート・`src/`・`tests/`・`node_modules/` の中には指定できません。

### 型チェックのみを実行

```bash
npm run typecheck
```

### 自動テストスイートの実行

```bash
npm test
```

- 地域設定から独立したテスト専用データを隔離ビルドし、地域選択、ピン操作、5段階精度スライダー、GoogleフォームURL、エラー処理、画面サイズ、キーボード操作、サブパス配信を検証します。テスト出力はOSの一時フォルダに作成し、既存の `dist/` は使いません。
- ブラウザE2Eテストを含むため、Chromeが必要です。Chromeの場所を自動検出できない環境では `CHROME_PATH` を指定します。

---

## 5. 地域の追加・変更方法

募集対象地域は **`src/config/regions.ts`** の `REGIONS` 配列で一元管理されています。

現在は、鞍馬・貴船、鞍馬広域、赤目四十八滝、赤目広域の4地域が登録されています。地域を追加する場合は、`REGIONS` 配列にオブジェクトを1件追記するだけで地域選択画面・地図画面の両方に自動反映されます。

```ts
// src/config/regions.ts
export const REGIONS: RegionConfig[] = [
  {
    id: 'shonan-enoshima-2026',          // 一意の地域ID（Googleフォームへ送信される値）
    name: '湘南・江の島エリア',           // 画面に表示する地域名
    description: '江の島および片瀬海岸周辺の風景写真を募集しています。', // 説明文（任意）
    bounds: {
      southWest: { lat: 35.295, lng: 139.472 }, // 南西端（左下）の緯度・経度
      northEast: { lat: 35.312, lng: 139.492 }, // 北東端（右上）の緯度・経度
    },
    thumbnail: './images/enoshima.jpg',  // ルート images/ 内の画像（任意・省略時は共通プレースホルダーを表示）
    isSample: false,                     // 実運用データの場合は false または省略
  },
];
```

- **バリデーション機能**: `id` の重複、`id` や `name` の空文字、不正な `bounds`（南西端が北東端より大きい等）は起動時に自動検出され、画面上で警告が表示されます。
- **ローカル画像**: サムネイル画像はプロジェクトルートの `images/` に置き、設定では `./images/ファイル名.jpg` のような相対パスを指定します。ビルドは `images/` 内の画像ファイル（AVIF、GIF、JPEG、PNG、SVG、WebP）だけを成果物へコピーします。隠しファイルやシンボリックリンク、他のフォルダはコピー対象になりません。

---

## 6. 緯度経度の設定方法

各地域の募集対象範囲（`bounds`）は、四角形の **南西端（`southWest`：左下）** と **北東端（`northEast`：右上）** の緯度（`lat`）・経度（`lng`）を10進数の度（世界測地系 WGS84 / JGD2011）で指定します。

### 緯度・経度の調べ方（地理院地図を利用する場合）
1. [地理院地図](https://maps.gsi.go.jp/) を開きます。
2. 募集したい四角形エリアの**左下（南西）**にあたる地点で右クリック（または中心十字を合わせる）し、表示される10進数の緯度・経度（例：`35.672000, 139.752000`）を `southWest` に設定します。
3. 同様に、募集したい四角形エリアの**右上（北東）**にあたる地点の緯度・経度（例：`35.686000, 139.770000`）を `northEast` に設定します。
4. 必ず以下の条件を満たすように設定してください。
   - `southWest.lat < northEast.lat`（南西端の緯度 ＜ 北東端の緯度）
   - `southWest.lng < northEast.lng`（南西端の経度 ＜ 北東端の経度）

---

## 7. 位置精度半径の変更方法

5段階の位置精度スライダーの設定は **`src/config/accuracyLevels.ts`** で管理されています。

初期設定は以下のとおりです。

| レベル | 名称 | 地図上の表示 | 初期設定半径 (`radiusMeters`) | Googleフォームへの送信値 |
|---|---|---|---|---|
| **レベル0** | 地域のみ・位置不明 | ピン・円ともに非表示 | `null` | 緯度・経度・半径パラメータを省略 |
| **レベル1** | 正確な地点 | ピンのみ表示 | `0` | 半径として文字列 `"0"` を明示送信 |
| **レベル2** | おおよそ・狭い | ピン＋半透明の円 | `50` (50m) | `"50"` |
| **レベル3** | おおよそ・中程度 | ピン＋半透明の円 | `150` (150m) | `"150"` |
| **レベル4** | おおよそ・広い | ピン＋半透明の円 | `500` (500m) | `"500"` |

レベル2〜4の半径（メートル単位）を変更したい場合は、`src/config/accuracyLevels.ts` 内の `radiusMeters` の数値を変更してください。変更した数値は地図上の円の実距離描画およびGoogleフォームへの送信値の両方に即座に反映されます。

---

## 8. Googleフォームの連携状態と作成方法

本プロジェクトの **`src/config/googleForm.ts`** には、すでに実運用のGoogleフォーム設定が反映されており、初期状態でそのまま事前入力URL連携が動作します。

```ts
// src/config/googleForm.ts（設定済み実運用値）
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

### 新しいGoogleフォームを独自に作成する場合
別のGoogleフォームに変更して運用したい場合は、以下の手順でフォームを作成します（詳細は [`docs/GOOGLE_FORM_SETUP.md`](./docs/GOOGLE_FORM_SETUP.md) を参照してください）。

1. [Googleフォーム](https://docs.google.com/forms/) で新しいフォームを作成します。
2. 以下の **6つの質問項目** を作成します。
   1. **地域ID**（記述式・**必須**）— Webサイトから事前入力
   2. **緯度**（記述式・**任意**）— Webサイトから事前入力（※「地域のみ」投稿に対応するため**必ず任意回答**にしてください）
   3. **経度**（記述式・**任意**）— Webサイトから事前入力（※**必ず任意回答**にしてください）
   4. **位置精度半径（m）**（記述式・**任意**）— Webサイトから事前入力（※**必ず任意回答**にしてください）
   5. **撮影者名**（記述式・**必須**）— 投稿者がフォーム上で入力
   6. **写真**（ファイルのアップロード・**必須**）— 投稿者がフォーム上で添付

---

## 9. フォームentry IDの取得方法と連携先変更

別のフォームへ連携先を変更する場合は、以下の手順で entry ID を取得して `src/config/googleForm.ts` を書き換えます。

1. Googleフォーム編集画面右上の「︙」メニューから **「事前入力したリンクを取得」** を開きます。
2. 「地域ID」「緯度」「経度」「位置精度半径（m）」の4項目に仮の値を入力し、**「リンクを取得」→「リンクをコピー」** を押します。
3. コピーされたURLから、ベースURL（`https://docs.google.com/forms/d/e/.../viewform`）と、各質問に対応する `entry.xxxxxxxxx` を確認します。
4. **`src/config/googleForm.ts`** を開き、`formUrl` と `entryIds` を書き換えて保存します。

```ts
// src/config/googleForm.ts（差し替え例）
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

> **安全設計**: `src/config/googleForm.ts` にプレースホルダー値（`YOUR_FORM_ID_HERE` 等）が残っている場合や設定が不正な場合は、誤って存在しないURLへ遷移することを防ぐため、確認モーダル上で遷移をブロックし、生成された送信パラメータのプレビューと設定方法の案内を表示します。

`formUrl` にはHTTPSの `docs.google.com/forms/.../viewform` 回答用URLを設定します。編集用URL、別ホスト、`forms.gle` 短縮URLは受け付けません。フォーム設定手順の詳細は [`docs/GOOGLE_FORM_SETUP.md`](./docs/GOOGLE_FORM_SETUP.md) を参照してください。

---

## 10. GitHub Pagesへの公開方法

詳細な手順は [`docs/DEPLOY.md`](./docs/DEPLOY.md) に記載しています。

1. 本プロジェクトをGitHubリポジトリの `main` ブランチにプッシュします。
2. GitHubリポジトリの **Settings > Pages > Build and deployment > Source** で **`GitHub Actions`** を選択します。
3. 同梱の `.github/workflows/deploy.yml` が自動実行され、テスト・ビルド通過後に GitHub Pages へデプロイされます。

---

## 11. 既知の制約事項

仕様要件に基づく運用上の制約事項は以下のとおりです。

1. **Googleアカウントログインの必要性**: Googleフォームの「ファイルのアップロード」機能を使用するため、投稿者が写真をアップロードする際には投稿者自身のGoogleアカウントへのログインが必要です。
2. **事前入力値の編集可能性**: Googleフォームの事前入力URL（クエリパラメータ）の仕様上、フォーム遷移後に利用者がフォーム上のテキスト欄を手動で書き換えることをフロントエンドのみで完全に禁止することはできません。
3. **送信完了の判定**: 本WebサイトからGoogleフォームへ遷移した時点では投稿は完了しておらず、利用者がGoogleフォーム側で「送信」ボタンを押した時点でGoogleスプレッドシートおよびGoogle Driveへ保存されます。
4. **位置精度半径の意味**: 位置精度半径（50m / 150m / 500m）は、利用者が自己申告する「おおよその撮影範囲」の目安であり、統計的な信頼区間やGPS測位誤差を示すものではありません。

---

## 12. ディレクトリ・ファイル構成

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Pages 自動デプロイワークフロー
├── docs/
│   ├── DEPLOY.md                   # GitHub Pages デプロイ手順書
│   ├── GOOGLE_FORM_SETUP.md        # Googleフォーム側の作成・entry ID取得手順書
│   └── SPEC_REVIEW_2026-10-23.md   # 指摘事項と修正・検証の履歴
├── scripts/
│   ├── build.mjs                   # 静的サイトビルドスクリプト（tsc + アセット出力）
│   ├── dev-server.mjs              # ローカル開発・プレビュー用HTTPサーバー
│   └── run-tests.mjs               # 自動テスト実行スクリプト
├── src/
│   ├── config/
│   │   ├── regions.ts              # 【設定】募集対象地域データ設定ファイル
│   │   ├── accuracyLevels.ts       # 【設定】5段階の位置精度レベル設定ファイル
│   │   └── googleForm.ts           # 【設定】GoogleフォームURL・entry ID設定ファイル
│   ├── domain/
│   │   ├── regionValidator.ts      # 地域データ・bounds・範囲内判定ロジック
│   │   ├── accuracyManager.ts      # 位置精度レベルの取得・検証ロジック
│   │   ├── submissionState.ts      # 座標・精度・送信ペイロードの一元状態管理ストア
│   │   └── googleFormUrlBuilder.ts # Googleフォーム事前入力URL生成・設定検証ロジック
│   ├── map/
│   │   └── mapController.ts        # Leaflet地図初期化・地理院タイル・募集枠・ピン・精度円管理
│   ├── ui/
│   │   ├── placeholderThumbnail.ts # サムネイル未設定時の共通プレースホルダーSVG
│   │   ├── regionSelectView.ts     # 地域選択画面UIコンポーネント
│   │   ├── mapView.ts              # 撮影地点指定画面UIコンポーネント
│   │   └── confirmModal.ts         # Googleフォーム遷移前の入力内容確認モーダル
│   ├── styles/
│   │   └── main.css                # スマートフォン・PC対応レスポンシブスタイルシート
│   ├── types/
│   │   └── index.ts                # 共通TypeScript型定義
│   ├── app.ts                      # 画面遷移・ルーティング統括クラス
│   └── main.ts                     # エントリーポイント
├── tests/
│   ├── fixtures/                   # 本番設定から独立したテスト地域・画像
│   ├── app.test.mjs                # アプリ機能のテスト
│   ├── build.test.mjs              # 既存ファイルを保護するビルドのテスト
│   └── e2e-browser.test.mjs        # Chromeによる実ブラウザE2Eテスト
├── index.html                      # メインHTML
├── package.json                    # パッケージ・スクリプト定義
└── tsconfig.json                   # TypeScriptコンパイラ設定
```
