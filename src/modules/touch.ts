import { assertLength, bytesFrom, dataView, readBigInt64LE, readUint16LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { ProtocolError } from "../errors.js";
import {
  TOUCH_GESTURE_UUID,
  TOUCH_RAW_DATA_UUID,
  TOUCH_SAMPLING_ENABLE_UUID,
  TOUCH_STATE_UUID,
} from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { encodeBoolean, invokeCallback, requireWriteResponse } from "./shared.js";

export const TOUCH_STATE_LENGTH = 13;
export const TOUCH_GESTURE_LENGTH = 10;
export const TOUCH_RAW_LENGTH = 16;

/** Geometry of the current SensWear linear touch shield, from connector to tip. */
export const TOUCH_ELECTRODE_COUNT = 15;
export const TOUCH_ELECTRODE_PITCH = 64;
export const TOUCH_ELECTRODE_PITCH_MM = 3;
export const TOUCH_POSITION_MAX = (TOUCH_ELECTRODE_COUNT - 1) * TOUCH_ELECTRODE_PITCH;
export const TOUCH_LENGTH_MM = (TOUCH_ELECTRODE_COUNT - 1) * TOUCH_ELECTRODE_PITCH_MM;

export enum TouchGesture {
  None = 0,
  SingleClick = 1,
  ClickAndHold = 2,
  DoubleClick = 3,
  DownSwipe = 4,
  DownSwipeAndHold = 5,
  RightSwipe = 6,
  RightSwipeAndHold = 7,
  UpSwipe = 8,
  UpSwipeAndHold = 9,
  LeftSwipe = 10,
  LeftSwipeAndHold = 11,
  SingleTap = SingleClick,
  Hold = ClickAndHold,
  DoubleTap = DoubleClick,
  SwipeDown = DownSwipe,
  SwipeDownHold = DownSwipeAndHold,
  SwipeRight = RightSwipe,
  SwipeRightHold = RightSwipeAndHold,
  SwipeUp = UpSwipe,
  SwipeUpHold = UpSwipeAndHold,
  SwipeLeft = LeftSwipe,
  SwipeLeftHold = LeftSwipeAndHold,
}

abstract class TouchTimestamped {
  constructor(readonly timestampUs: bigint) {}
  get timestamp(): Date { return new Date(Number(this.timestampUs) / 1000); }
}

export class TouchState extends TouchTimestamped {
  constructor(timestampUs: bigint, readonly touched: boolean, readonly x: number, readonly y: number) {
    super(timestampUs);
  }
  /** Position along the linear strip, 0..1; null for release or non-slider data. */
  get positionNormalized(): number | null { return normalizedPosition(this); }
  /** Nominal distance from the first electrode center, not calibrated accuracy. */
  get positionMm(): number | null {
    return this.positionNormalized === null ? null : this.x * TOUCH_ELECTRODE_PITCH_MM / TOUCH_ELECTRODE_PITCH;
  }
  static fromBytes(payload: ByteInput): TouchState {
    const bytes = bytesFrom(payload);
    assertLength(bytes, TOUCH_STATE_LENGTH, "Touch state");
    validateBoolean(bytes[8], "Touch state");
    const view = dataView(bytes);
    return new TouchState(readBigInt64LE(view, 0), bytes[8] === 1, readUint16LE(view, 9), readUint16LE(view, 11));
  }
}

export class TouchGestureSample extends TouchTimestamped {
  /** gestureState is a host-generated MTCH6102 code, not a native register read. */
  constructor(timestampUs: bigint, readonly gesture: number, readonly gestureState: number) {
    super(timestampUs);
  }
  static fromBytes(payload: ByteInput): TouchGestureSample {
    const bytes = bytesFrom(payload);
    assertLength(bytes, TOUCH_GESTURE_LENGTH, "Touch gesture");
    return new TouchGestureSample(readBigInt64LE(dataView(bytes), 0), bytes[8], bytes[9]);
  }

  get gestureType(): TouchGesture | number {
    return this.gesture >= TouchGesture.None && this.gesture <= TouchGesture.LeftSwipeAndHold
      ? this.gesture as TouchGesture
      : this.gesture;
  }

  /** @deprecated Use gestureState. */
  get rawGesture(): number { return this.gestureState; }
  /** @deprecated Use gesture. */
  get gestureValue(): number { return this.gesture; }
}

export class RawTouchSample extends TouchTimestamped {
  constructor(
    timestampUs: bigint,
    readonly touched: boolean,
    readonly x: number,
    readonly y: number,
    readonly touchState: number,
  ) {
    super(timestampUs);
  }
  /** Position along the linear strip, 0..1; null for release or non-slider data. */
  get positionNormalized(): number | null { return normalizedPosition(this); }
  /** Nominal distance from the first electrode center, not calibrated accuracy. */
  get positionMm(): number | null {
    return this.positionNormalized === null ? null : this.x * TOUCH_ELECTRODE_PITCH_MM / TOUCH_ELECTRODE_PITCH;
  }
  static fromBytes(payload: ByteInput): RawTouchSample {
    const bytes = bytesFrom(payload);
    assertLength(bytes, TOUCH_RAW_LENGTH, "Touch raw state");
    validateBoolean(bytes[8], "Touch raw state");
    const view = dataView(bytes);
    return new RawTouchSample(
      readBigInt64LE(view, 0),
      bytes[8] === 1,
      readUint16LE(view, 10),
      readUint16LE(view, 12),
      bytes[14],
    );
  }
}

export class TouchModule {
  constructor(private readonly client: GattClient) {}

  async readState(): Promise<TouchState> {
    return TouchState.fromBytes(await this.client.readGattChar(TOUCH_STATE_UUID));
  }
  async readGesture(): Promise<TouchGestureSample> {
    return TouchGestureSample.fromBytes(await this.client.readGattChar(TOUCH_GESTURE_UUID));
  }
  async readRaw(): Promise<RawTouchSample> {
    return RawTouchSample.fromBytes(await this.client.readGattChar(TOUCH_RAW_DATA_UUID));
  }
  async isSamplingEnabled(): Promise<boolean> {
    const bytes = bytesFrom(await this.client.readGattChar(TOUCH_SAMPLING_ENABLE_UUID));
    assertLength(bytes, 1, "Touch sampling enable");
    validateBoolean(bytes[0], "Touch sampling enable");
    return bytes[0] === 1;
  }
  async setSamplingEnabled(enabled: boolean, options: { response?: boolean } = {}): Promise<void> {
    await this.client.writeGattChar(
      TOUCH_SAMPLING_ENABLE_UUID,
      encodeBoolean(enabled, "enabled"),
      { response: requireWriteResponse(options.response) },
    );
  }

  async subscribeState(callback: (state: TouchState) => MaybePromise<void>): Promise<void> {
    return this.subscribe(TOUCH_STATE_UUID, TouchState.fromBytes, callback);
  }
  async subscribeGesture(callback: (event: TouchGestureSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(TOUCH_GESTURE_UUID, TouchGestureSample.fromBytes, callback);
  }
  async subscribeRaw(callback: (state: RawTouchSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(TOUCH_RAW_DATA_UUID, RawTouchSample.fromBytes, callback);
  }
  async unsubscribe(characteristicUuid: string): Promise<void> {
    await this.client.stopNotify(characteristicUuid);
  }
  async unsubscribeState(): Promise<void> { await this.unsubscribe(TOUCH_STATE_UUID); }
  async unsubscribeGesture(): Promise<void> { await this.unsubscribe(TOUCH_GESTURE_UUID); }
  async unsubscribeRaw(): Promise<void> { await this.unsubscribe(TOUCH_RAW_DATA_UUID); }
  async unsubscribeAll(): Promise<void> {
    await Promise.all([
      this.unsubscribeState(),
      this.unsubscribeGesture(),
      this.unsubscribeRaw(),
    ]);
  }

  /** @deprecated Use isSamplingEnabled. */
  async isEnabled(): Promise<boolean> { return this.isSamplingEnabled(); }
  /** @deprecated Use setSamplingEnabled. */
  async setEnabled(enabled: boolean, options: { response?: boolean } = {}): Promise<void> {
    await this.setSamplingEnabled(enabled, options);
  }

  private async subscribe<T>(uuid: string, parse: (data: ByteInput) => T, callback: (value: T) => MaybePromise<void>): Promise<void> {
    await this.client.stopNotify(uuid);
    await this.client.startNotify(uuid, (_sender, data) => invokeCallback(callback, parse(data)));
  }
}

/** @deprecated Use TouchGestureSample. */
export { TouchGestureSample as TouchGestureEvent };
/** @deprecated Use RawTouchSample. */
export { RawTouchSample as TouchRawState };

function validateBoolean(value: number, label: string): void {
  if (value > 1) throw new ProtocolError(`${label} boolean must be encoded as 0 or 1.`);
}

function normalizedPosition(sample: { touched: boolean; x: number; y: number }): number | null {
  if (!sample.touched || sample.y !== 0 || !Number.isInteger(sample.x) || sample.x < 0 || sample.x > TOUCH_POSITION_MAX) {
    return null;
  }
  return sample.x / TOUCH_POSITION_MAX;
}
