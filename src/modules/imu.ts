import {
  assertLength, bytesFrom, dataView, readBigInt64LE, readInt16LE, readUint16LE,
  readUint32LE, writeUint32LE,
} from "../binary.js";
import type { ByteInput } from "../binary.js";
import { ProtocolError } from "../errors.js";
import {
  IMU_ACCELEROMETER_UUID, IMU_ACTIVITY_UUID, IMU_DRAIN_PERIOD_UUID, IMU_ENABLE_UUID,
  IMU_GESTURE_UUID, IMU_GYROSCOPE_UUID, IMU_QUATERNION_UUID,
} from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { encodeBoolean, invokeCallback, requireWriteResponse } from "./shared.js";

export const QUATERNION_LENGTH = 18;
export const VECTOR_SAMPLE_LENGTH = 14;
export const LINEAR_ACCELERATION_LENGTH = VECTOR_SAMPLE_LENGTH;
export const GESTURE_EVENT_LENGTH = 10;
export const ACTIVITY_EVENT_LENGTH = 11;
export const QUATERNION_Q14_SCALE = 16384;
export const ACCELEROMETER_LSB_PER_G = 4096;

export enum ImuSensorId {
  AnyMotion = 142,
  WearActivity = 154,
  WristGesture = 156,
  WristWear = 158,
  NoMotion = 159,
}

export enum Gesture {
  None = 0,
  WristShake = 3,
  FlickIn = 4,
  FlickOut = 5,
}

export enum Activity {
  Still = 0,
  Walking = 1,
  Running = 2,
  Bicycle = 3,
  Vehicle = 4,
  Tilting = 5,
}

export enum ActivityTransition {
  Ended = 0,
  Started = 1,
}

abstract class TimestampedSample {
  constructor(readonly timestampUs: bigint) {}

  get timestamp(): Date {
    return new Date(Number(this.timestampUs) / 1000);
  }
}

export class QuaternionSample extends TimestampedSample {
  constructor(
    timestampUs: bigint,
    readonly rawX: number,
    readonly rawY: number,
    readonly rawZ: number,
    readonly rawW: number,
    readonly rawAccuracy: number,
  ) {
    super(timestampUs);
  }

  static fromBytes(payload: ByteInput): QuaternionSample {
    const bytes = bytesFrom(payload);
    assertLength(bytes, QUATERNION_LENGTH, "IMU quaternion");
    const view = dataView(bytes);
    return new QuaternionSample(
      readBigInt64LE(view, 0), readInt16LE(view, 8), readInt16LE(view, 10),
      readInt16LE(view, 12), readInt16LE(view, 14), readUint16LE(view, 16),
    );
  }

  get x(): number { return this.rawX / QUATERNION_Q14_SCALE; }
  get y(): number { return this.rawY / QUATERNION_Q14_SCALE; }
  get z(): number { return this.rawZ / QUATERNION_Q14_SCALE; }
  get w(): number { return this.rawW / QUATERNION_Q14_SCALE; }
  get accuracyRadians(): number { return this.rawAccuracy / QUATERNION_Q14_SCALE; }
  get accuracyDegrees(): number { return this.accuracyRadians * 180 / Math.PI; }

  toTuple(options: { normalized?: boolean } = {}): [number, number, number, number] {
    return options.normalized ?? true
      ? [this.x, this.y, this.z, this.w]
      : [this.rawX, this.rawY, this.rawZ, this.rawW];
  }
}

export class AccelerometerSample extends TimestampedSample {
  constructor(timestampUs: bigint, readonly rawX: number, readonly rawY: number, readonly rawZ: number) {
    super(timestampUs);
  }

  static fromBytes(payload: ByteInput): AccelerometerSample {
    const values = decodeVector(payload, "IMU accelerometer");
    return new AccelerometerSample(...values);
  }

  get xG(): number { return this.rawX / ACCELEROMETER_LSB_PER_G; }
  get yG(): number { return this.rawY / ACCELEROMETER_LSB_PER_G; }
  get zG(): number { return this.rawZ / ACCELEROMETER_LSB_PER_G; }

  toTuple(options: { scaled?: boolean } = {}): [number, number, number] {
    return options.scaled ?? true ? [this.xG, this.yG, this.zG] : [this.rawX, this.rawY, this.rawZ];
  }
}

export class GyroscopeSample extends TimestampedSample {
  constructor(timestampUs: bigint, readonly x: number, readonly y: number, readonly z: number) {
    super(timestampUs);
  }

  static fromBytes(payload: ByteInput): GyroscopeSample {
    return new GyroscopeSample(...decodeVector(payload, "IMU gyroscope"));
  }

  toTuple(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

export class GestureEvent extends TimestampedSample {
  constructor(timestampUs: bigint, readonly sensorId: number, readonly value: number) {
    super(timestampUs);
  }

  static fromBytes(payload: ByteInput): GestureEvent {
    const bytes = bytesFrom(payload);
    assertLength(bytes, GESTURE_EVENT_LENGTH, "IMU gesture");
    return new GestureEvent(readBigInt64LE(dataView(bytes), 0), bytes[8], bytes[9]);
  }

  get gesture(): Gesture {
    return this.value as Gesture;
  }
}

export class ActivityEvent extends TimestampedSample {
  constructor(timestampUs: bigint, readonly sensorId: number, readonly activityValue: number, readonly transitionValue: number) {
    super(timestampUs);
  }

  static fromBytes(payload: ByteInput): ActivityEvent {
    const bytes = bytesFrom(payload);
    assertLength(bytes, ACTIVITY_EVENT_LENGTH, "IMU activity");
    return new ActivityEvent(readBigInt64LE(dataView(bytes), 0), bytes[8], bytes[9], bytes[10]);
  }

  get activity(): Activity { return this.activityValue as Activity; }
  get transition(): ActivityTransition { return this.transitionValue as ActivityTransition; }
}

export class ImuModule {
  constructor(private readonly client: GattClient) {}

  async readQuaternion(): Promise<QuaternionSample> {
    return QuaternionSample.fromBytes(await this.client.readGattChar(IMU_QUATERNION_UUID));
  }
  async readAccelerometer(): Promise<AccelerometerSample> {
    return AccelerometerSample.fromBytes(await this.client.readGattChar(IMU_ACCELEROMETER_UUID));
  }
  async readGyroscope(): Promise<GyroscopeSample> {
    return GyroscopeSample.fromBytes(await this.client.readGattChar(IMU_GYROSCOPE_UUID));
  }
  async readGesture(): Promise<GestureEvent> {
    return GestureEvent.fromBytes(await this.client.readGattChar(IMU_GESTURE_UUID));
  }
  async readActivity(): Promise<ActivityEvent> {
    return ActivityEvent.fromBytes(await this.client.readGattChar(IMU_ACTIVITY_UUID));
  }

  async isEnabled(): Promise<boolean> {
    return decodeBoolean(await this.client.readGattChar(IMU_ENABLE_UUID), "IMU enable");
  }
  async setEnabled(enabled: boolean, options: { response?: boolean } = {}): Promise<void> {
    await this.client.writeGattChar(IMU_ENABLE_UUID, encodeBoolean(enabled, "enabled"), {
      response: requireWriteResponse(options.response),
    });
  }
  async arePhysicalStreamsEnabled(): Promise<boolean> {
    return this.isEnabled();
  }
  async setPhysicalStreamsEnabled(
    enabled: boolean,
    options: { response?: boolean } = {},
  ): Promise<void> {
    await this.setEnabled(enabled, options);
  }
  async readDrainPeriodMs(): Promise<number> {
    const bytes = bytesFrom(await this.client.readGattChar(IMU_DRAIN_PERIOD_UUID));
    assertLength(bytes, 4, "IMU drain period");
    return readUint32LE(dataView(bytes), 0);
  }
  async setDrainPeriodMs(milliseconds: number, options: { response?: boolean } = {}): Promise<void> {
    if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 0xffffffff) {
      throw new RangeError("milliseconds must be an integer between 1 and 4294967295.");
    }
    await this.client.writeGattChar(IMU_DRAIN_PERIOD_UUID, writeUint32LE(milliseconds), { response: requireWriteResponse(options.response) });
  }

  async subscribeQuaternion(callback: (sample: QuaternionSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(IMU_QUATERNION_UUID, QuaternionSample.fromBytes, callback);
  }
  async subscribeAccelerometer(callback: (sample: AccelerometerSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(IMU_ACCELEROMETER_UUID, AccelerometerSample.fromBytes, callback);
  }
  async subscribeGyroscope(callback: (sample: GyroscopeSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(IMU_GYROSCOPE_UUID, GyroscopeSample.fromBytes, callback);
  }
  async subscribeGesture(callback: (event: GestureEvent) => MaybePromise<void>): Promise<void> {
    return this.subscribe(IMU_GESTURE_UUID, GestureEvent.fromBytes, callback);
  }
  async subscribeActivity(callback: (event: ActivityEvent) => MaybePromise<void>): Promise<void> {
    return this.subscribe(IMU_ACTIVITY_UUID, ActivityEvent.fromBytes, callback);
  }
  async unsubscribe(characteristicUuid: string): Promise<void> {
    await this.client.stopNotify(characteristicUuid);
  }

  private async subscribe<T>(uuid: string, parse: (data: ByteInput) => T, callback: (value: T) => MaybePromise<void>): Promise<void> {
    await this.client.stopNotify(uuid);
    await this.client.startNotify(uuid, (_sender, data) => invokeCallback(callback, parse(data)));
  }
}

function decodeVector(payload: ByteInput, label: string): [bigint, number, number, number] {
  const bytes = bytesFrom(payload);
  assertLength(bytes, VECTOR_SAMPLE_LENGTH, label);
  const view = dataView(bytes);
  return [readBigInt64LE(view, 0), readInt16LE(view, 8), readInt16LE(view, 10), readInt16LE(view, 12)];
}

function decodeBoolean(payload: ByteInput, label: string): boolean {
  const bytes = bytesFrom(payload);
  assertLength(bytes, 1, label);
  if (bytes[0] > 1) throw new ProtocolError(`${label} must be encoded as 0 or 1.`);
  return bytes[0] === 1;
}

/** @deprecated The firmware stream is a gravity-including accelerometer, not linear acceleration. */
export { AccelerometerSample as LinearAccelerationSample };
