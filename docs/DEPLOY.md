# GitHub Pages デプロイ手順書

本プロジェクトは完全な静的Webサイトとして設計されており、相対パス（`./`）でアセットおよびESモジュールを読み込むため、`https://<ユーザー名>.github.io/<リポジトリ名>/` のようなサブパス環境でも追加設定なしで動作します。地域サムネイルはルート `images/` に置き、`./images/ファイル名.jpg` の形式で参照してください。ビルドは許可された画像形式だけをコピーします。

---

## 方法A：GitHub Actionsによる自動デプロイ（推奨）

リポジトリには `.github/workflows/deploy.yml` が同梱されています。`main` ブランチへプッシュするたびに、依存関係のインストール、Chrome準備、テスト、静的サイトのビルド、GitHub Pagesへのデプロイが実行されます。Chromeは `browser-actions/setup-chrome` で用意し、その実行パスを `CHROME_PATH` としてPlaywrightへ渡します。

### 手順

1. GitHub上で新規リポジトリを作成し、本プロジェクトのファイル一式をプッシュします。
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
2. GitHubリポジトリのページを開き、上部メニューの **「Settings」** → 左メニューの **「Pages」** を開きます。
3. **「Build and deployment」** の **「Source」** で **`GitHub Actions`** を選択します。
4. 上部メニューの **「Actions」** タブを開き、`Deploy to GitHub Pages` ワークフローが緑色のチェック（成功）になることを確認します（失敗していた場合や初回設定後は「Run workflow」から手動実行も可能です）。
5. 完了すると、`https://<あなたのユーザー名>.github.io/<リポジトリ名>/` でWebサイトが公開されます。

ワークフローは `npm ci --ignore-scripts` でロックファイルに従って依存を入れ、`npm test` と `npm run build` を別々に実行します。テストは一時フォルダにfixtureを使った隔離ビルドを作り、本番地域設定や既存の `dist/` に依存しません。Pagesへアップロードするのは新しく生成した `dist/` だけです。

---

## 方法B：ローカルでビルドして `dist/` を公開する方法

手動でビルド成果物を確認・配置したい場合は以下の手順で行えます。

1. ローカル環境でビルドを実行します。既存の `dist/` がある場合は、成功した切替時に `.build-history/` へ移動保存してから新しい成果物を `dist/` に配置します。ビルド失敗時は現在の `dist/` を保ちます。保存済み成果物の削除は行いません。
   ```bash
   npm run build
   ```
2. プロジェクト直下に生成された `dist/` フォルダの中に、以下のファイル一式が出力されます。
   - `dist/index.html`
   - `dist/.nojekyll`
   - `dist/main.js` ほかコンパイル済みJSモジュール一式
   - `dist/styles/main.css`
   - `dist/vendor/leaflet/`（Leaflet本体およびCSS）
   - `dist/images/`（設定で使うローカルサムネイルがある場合）
3. `dist/` フォルダの中身をそのまま任意の静的ホスティングサービス（GitHub Pagesの `gh-pages` ブランチ、Cloudflare Pages、Netlify、レンタルサーバー等）にアップロードするだけで動作します。

既存の `dist/` に触れずに試す場合は、空の出力先を明示できます。

```bash
npm run build -- --out-dir "B:\Temp\map-form-build-001"
```

既存ファイルを含む出力先は上書きせず、エラーで停止します。
