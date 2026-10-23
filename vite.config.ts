/**
 * ビルド設定リファレンス（vite.config.ts）
 * 本プロジェクトはネイティブバイナリ非依存の scripts/build.mjs（TypeScript公式コンパイラ tsc + ES Modules出力）
 * によって dist/ へ静的ビルドされます（base: './' 相当の相対パス構成）。
 */
export default {
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
};
