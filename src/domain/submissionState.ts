import { ACCURACY_LEVELS, DEFAULT_ACCURACY_LEVEL } from '../config/accuracyLevels';
import type {
  AccuracyLevelConfig,
  AccuracyLevelId,
  LatLng,
  RegionConfig,
  SubmissionPayload,
} from '../types';
import { getAccuracyLevelConfig, isValidAccuracyLevel } from './accuracyManager';
import { isPointWithinBounds } from './regionValidator';

/**
 * 座標を小数点以下6桁の文字列にフォーマットする（仕様要件 4 / 5.3）
 */
export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

/**
 * 状態変更時に通知を受け取るリスナー関数型
 */
export type StateChangeListener = (state: SubmissionStateSnapshot) => void;

/**
 * UIおよび地図描画・フォームURL生成が参照する単一の状態スナップショット型
 * 座標や位置精度を複数箇所に重複保持しないための不変データ構造です。
 */
export interface SubmissionStateSnapshot {
  /** 現在選択されている地域（未選択時は null） */
  readonly selectedRegion: RegionConfig | null;
  /**
   * 同一地域内で最後に設置されたピンの座標（未設置時は null）
   * ※レベル0（地域のみ）に切り替えた場合も内部的に保持され、
   *   レベル1〜4へ戻した際に復元されます（仕様要件 3 / 4.3）。
   */
  readonly lastPinPosition: LatLng | null;
  /**
   * 現在の画面表示・送信で有効なピン座標
   * - レベル0の場合は lastPinPosition が存在しても必ず null を返します。
   * - レベル1〜4の場合は lastPinPosition を返します。
   */
  readonly effectivePinPosition: LatLng | null;
  /** 現在選択されている位置精度レベル番号（0〜4、初期値は1） */
  readonly accuracyLevel: AccuracyLevelId;
  /** 現在の位置精度レベル設定オブジェクト */
  readonly accuracyConfig: AccuracyLevelConfig;
  /**
   * 現在地図上に描画すべき円の半径（m）
   * - レベル0・レベル1・またはピン未設置時は null（円を描画しない）
   * - レベル2〜4かつピン設置済みの場合は設定された半径（例: 50, 150, 500）
   */
  readonly activeCircleRadiusMeters: number | null;
  /** 地図上にピンを表示すべきかどうか */
  readonly shouldShowPin: boolean;
  /** 地図上に半透明の円を表示すべきかどうか */
  readonly shouldShowCircle: boolean;
  /** 投稿ボタンを押下可能かどうか（レベル0は常時true、レベル1〜4はピン設置済み時のみtrue） */
  readonly canSubmit: boolean;
  /** Googleフォームへ送信する正規化済みペイロード（投稿不可時は null） */
  readonly submissionPayload: SubmissionPayload | null;
}

/**
 * 撮影地点・位置精度の状態を一元管理するストアクラス（仕様要件 8）
 * 地図の表示状態とGoogleフォームへの送信データに不整合が起きないよう、
 * すべての派生値を単一の状態から算出します。
 */
export class SubmissionStateStore {
  private selectedRegion: RegionConfig | null = null;
  private lastPinPosition: LatLng | null = null;
  private accuracyLevel: AccuracyLevelId = DEFAULT_ACCURACY_LEVEL;
  private readonly levels: readonly AccuracyLevelConfig[];
  private readonly listeners = new Set<StateChangeListener>();

  constructor(levels: readonly AccuracyLevelConfig[] = ACCURACY_LEVELS) {
    this.levels = levels;
  }

  /**
   * 地域を選択して状態を初期化する
   * 別の地域に切り替えた際はピン位置をリセットし、精度レベルを初期値（レベル1）に戻す
   */
  public selectRegion(region: RegionConfig | null): void {
    this.selectedRegion = region;
    this.lastPinPosition = null;
    this.accuracyLevel = DEFAULT_ACCURACY_LEVEL;
    this.notify();
  }

  /**
   * 募集対象範囲内にピンを設置・移動する
   * @returns 範囲内で設置に成功した場合は true、範囲外または地域未選択の場合は false
   */
  public setPinPosition(position: LatLng): boolean {
    if (!this.selectedRegion) {
      return false;
    }
    if (!isPointWithinBounds(position, this.selectedRegion.bounds)) {
      return false;
    }
    this.lastPinPosition = {
      lat: position.lat,
      lng: position.lng,
    };
    this.notify();
    return true;
  }

  /**
   * 位置精度レベル（0〜4）を変更する
   * レベル0に変更しても lastPinPosition は破棄せず保持し、
   * レベル1〜4に戻した際に以前のピン位置を復元できるようにする（仕様要件 3 / 4.3）
   */
  public setAccuracyLevel(level: AccuracyLevelId): boolean {
    if (!isValidAccuracyLevel(level, this.levels)) {
      return false;
    }
    this.accuracyLevel = level;
    this.notify();
    return true;
  }

  /**
   * 現在の状態スナップショットを取得する
   */
  public getSnapshot(): SubmissionStateSnapshot {
    const accuracyConfig = getAccuracyLevelConfig(this.accuracyLevel, this.levels);
    const isRegionOnly = this.accuracyLevel === 0;

    // レベル0ではピンを表示せず、送信座標としても扱わない
    const effectivePinPosition: LatLng | null =
      !isRegionOnly && this.lastPinPosition
        ? { lat: this.lastPinPosition.lat, lng: this.lastPinPosition.lng }
        : null;

    const shouldShowPin = accuracyConfig.showPin && effectivePinPosition !== null;
    const shouldShowCircle =
      accuracyConfig.showCircle &&
      effectivePinPosition !== null &&
      typeof accuracyConfig.radiusMeters === 'number' &&
      accuracyConfig.radiusMeters > 0;

    const activeCircleRadiusMeters = shouldShowCircle
      ? accuracyConfig.radiusMeters
      : null;

    // 地域が選択されており、かつ「レベル0」または「レベル1〜4でピン設置済み」なら投稿可能
    const canSubmit =
      this.selectedRegion !== null &&
      (isRegionOnly || effectivePinPosition !== null);

    let submissionPayload: SubmissionPayload | null = null;
    if (this.selectedRegion && canSubmit) {
      if (isRegionOnly) {
        // 仕様要件 3 / 4.3 / 5.3：レベル0では以前の位置情報を送信してはならず、緯度・経度・半径を省略（null）する
        submissionPayload = {
          regionId: this.selectedRegion.id,
          latitude: null,
          longitude: null,
          accuracyRadius: null,
        };
      } else if (effectivePinPosition !== null) {
        // 仕様要件 4 / 5.3：座標は小数点以下6桁、レベル1の半径は文字列 "0" を明示的に送信する
        const radiusStr =
          accuracyConfig.radiusMeters !== null
            ? String(accuracyConfig.radiusMeters)
            : '0';
        submissionPayload = {
          regionId: this.selectedRegion.id,
          latitude: formatCoordinate(effectivePinPosition.lat),
          longitude: formatCoordinate(effectivePinPosition.lng),
          accuracyRadius: radiusStr,
        };
      }
    }

    return {
      selectedRegion: this.selectedRegion,
      lastPinPosition: this.lastPinPosition
        ? { lat: this.lastPinPosition.lat, lng: this.lastPinPosition.lng }
        : null,
      effectivePinPosition,
      accuracyLevel: this.accuracyLevel,
      accuracyConfig,
      activeCircleRadiusMeters,
      shouldShowPin,
      shouldShowCircle,
      canSubmit,
      submissionPayload,
    };
  }

  /**
   * 状態変更リスナーを登録する
   * @returns リスナー解除用の関数
   */
  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 全リスナーを解除する（画面破棄時のクリーンアップ用）
   */
  public clearListeners(): void {
    this.listeners.clear();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
