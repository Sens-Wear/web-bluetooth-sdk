import { describe, expect, it } from "vitest";

import { ProtocolError } from "../src/errors";
import { BatteryLevel } from "../src/modules/battery";
import { BatteryLevelStatus, ChargeLevel, ChargeState, PowerSourceState } from "../src/modules/charger";
import { HAPTIC_MAX_FRAMES, HapticFrame, HapticPattern } from "../src/modules/haptic";
import {
  AccelerometerSample, Activity, ActivityEvent, ActivityTransition, Gesture, GestureEvent,
  GyroscopeSample, ImuSensorId, QuaternionSample,
} from "../src/modules/imu";
import { LedColor } from "../src/modules/led";
import { PPG_ADC_MAX, PpgSample } from "../src/modules/ppg";
import {
  TEMPERATURE_INTERVAL_MAX_SECONDS,
  TemperatureMeasurement,
  TemperatureType,
} from "../src/modules/temperature";
import { AdjustReason, CurrentTime, LocalTimeInformation, ReferenceTimeInformation } from "../src/modules/time";
import {
  RawTouchSample, TouchGesture, TouchGestureSample, TouchState,
  TOUCH_ELECTRODE_COUNT, TOUCH_ELECTRODE_PITCH, TOUCH_ELECTRODE_PITCH_MM,
  TOUCH_POSITION_MAX, TOUCH_LENGTH_MM,
} from "../src/modules/touch";
import * as Uuid from "../src/uuids";

describe("standard Bluetooth services", () => {
  it("decodes Battery Level and Battery Level Status", () => {
    expect(BatteryLevel.fromBytes([87]).percent).toBe(87);
    const powerState = 1 | (PowerSourceState.Connected << 1) | (ChargeState.Charging << 5) |
      (ChargeLevel.Good << 7) | (3 << 9) | (4 << 12);
    const status = BatteryLevelStatus.fromBytes([2, powerState & 255, powerState >> 8, 87]);
    expect(status.batteryLevelPresent).toBe(true);
    expect(status.batteryPresent).toBe(true);
    expect(status.wiredPower).toBe(PowerSourceState.Connected);
    expect(status.chargeState).toBe(ChargeState.Charging);
    expect(status.chargeLevel).toBe(ChargeLevel.Good);
    expect(status.chargeType).toBe(3);
    expect(status.chargingFault).toBe(4);
    expect(() => BatteryLevel.fromBytes([101])).toThrow(RangeError);
    expect(() => BatteryLevelStatus.fromBytes([0, 0, 0])).toThrow(ProtocolError);
  });

  it("round-trips Current Time and decodes time metadata", () => {
    const value = new Date(Date.UTC(2026, 6, 24, 12, 34, 56, 500));
    const current = CurrentTime.fromDate(value, AdjustReason.ExternalReference);
    const decoded = CurrentTime.fromBytes(current.toBytes());
    expect(decoded.value.toISOString()).toBe("2026-07-24T12:34:56.500Z");
    expect(decoded.dayOfWeek).toBe(5);
    expect(decoded.fractions256).toBe(128);
    expect(decoded.adjustReason).toBe(AdjustReason.ExternalReference);
    expect(LocalTimeInformation.fromBytes([8, 4]).utcOffsetMinutes).toBe(120);
    expect(LocalTimeInformation.fromBytes([128, 255]).utcOffsetMinutes).toBeNull();
    expect(ReferenceTimeInformation.fromBytes([2, 4, 1, 3]).accuracySeconds).toBe(0.5);
    expect(ReferenceTimeInformation.fromBytes([0, 255, 255, 255]).accuracySeconds).toBeNull();
  });

  it("decodes the indicated Health Thermometer measurement", () => {
    const bytes = new Uint8Array(13);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x06;
    // IEEE-11073 FLOAT: mantissa 3663, exponent -2 => 36.63 C.
    view.setUint32(1, (0xfe000000 | 3663) >>> 0, true);
    view.setUint16(5, 2026, true);
    bytes.set([7, 24, 12, 34, 56, TemperatureType.Body], 7);
    const sample = TemperatureMeasurement.fromBytes(bytes);
    expect(sample.temperatureC).toBeCloseTo(36.63);
    expect(sample.temperatureF).toBeCloseTo(97.934);
    expect(sample.timestamp?.toISOString()).toBe("2026-07-24T12:34:56.000Z");
    expect(sample.type).toBe(TemperatureType.Body);
    expect(() => TemperatureMeasurement.fromBytes(bytes.slice(0, 12))).toThrow(ProtocolError);

    const invalidDate = bytes.slice();
    invalidDate[7] = 13;
    expect(() => TemperatureMeasurement.fromBytes(invalidDate)).toThrow(ProtocolError);

    const specialValue = bytes.slice();
    new DataView(specialValue.buffer).setUint32(1, 0x007fffff, true);
    expect(() => TemperatureMeasurement.fromBytes(specialValue)).toThrow(ProtocolError);
    expect(TEMPERATURE_INTERVAL_MAX_SECONDS).toBe(65_520);
  });
});

describe("IMU protocol", () => {
  it("decodes timestamped quaternion, accelerometer, and gyroscope samples", () => {
    const quaternion = new Uint8Array(18);
    const qv = new DataView(quaternion.buffer);
    qv.setBigInt64(0, BigInt(1_725_000_000_123_456), true);
    qv.setInt16(8, 8192, true); qv.setInt16(10, -8192, true);
    qv.setInt16(12, 0, true); qv.setInt16(14, 16384, true); qv.setUint16(16, 1024, true);
    const q = QuaternionSample.fromBytes(quaternion);
    expect(q.timestampUs).toBe(BigInt(1_725_000_000_123_456));
    expect(q.toTuple()).toEqual([0.5, -0.5, 0, 1]);
    expect(q.accuracyRadians).toBeCloseTo(0.0625);

    const vector = new Uint8Array(14);
    const vv = new DataView(vector.buffer);
    vv.setBigInt64(0, BigInt(99), true);
    vv.setInt16(8, 4096, true); vv.setInt16(10, -2048, true); vv.setInt16(12, 1024, true);
    expect(AccelerometerSample.fromBytes(vector).toTuple()).toEqual([1, -0.5, 0.25]);
    expect(GyroscopeSample.fromBytes(vector).toTuple()).toEqual([4096, -2048, 1024]);
  });

  it("decodes gesture and activity events without hiding sensor IDs", () => {
    const gesture = new Uint8Array(10);
    new DataView(gesture.buffer).setBigInt64(0, BigInt(42), true);
    gesture.set([ImuSensorId.WristGesture, Gesture.FlickIn], 8);
    const g = GestureEvent.fromBytes(gesture);
    expect(g.sensorId).toBe(ImuSensorId.WristGesture);
    expect(g.gesture).toBe(Gesture.FlickIn);

    const activity = new Uint8Array(11);
    new DataView(activity.buffer).setBigInt64(0, BigInt(43), true);
    activity.set([ImuSensorId.WearActivity, Activity.Walking, ActivityTransition.Started], 8);
    const a = ActivityEvent.fromBytes(activity);
    expect(a.activity).toBe(Activity.Walking);
    expect(a.transition).toBe(ActivityTransition.Started);
  });
});

describe("PPG and touch protocol", () => {
  it("decodes unsigned millisecond PPG samples", () => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt(1_725_000_000_123), true);
    view.setUint32(8, PPG_ADC_MAX, true);
    const sample = PpgSample.fromBytes(bytes);
    expect(sample.timestampMs).toBe(BigInt(1_725_000_000_123));
    expect(sample.value).toBe(262143);
  });

  it("decodes packed and ABI-aligned touch records", () => {
    const stateBytes = new Uint8Array(13);
    const sv = new DataView(stateBytes.buffer);
    sv.setBigInt64(0, BigInt(123), true); stateBytes[8] = 1;
    sv.setUint16(9, 4095, true); sv.setUint16(11, 2048, true);
    expect(TouchState.fromBytes(stateBytes)).toMatchObject({ touched: true, x: 4095, y: 2048 });

    const gestureBytes = new Uint8Array(10);
    new DataView(gestureBytes.buffer).setBigInt64(0, BigInt(124), true);
    gestureBytes.set([TouchGesture.LeftSwipe, 0x61], 8);
    expect(TouchGestureSample.fromBytes(gestureBytes)).toMatchObject({
      gesture: TouchGesture.LeftSwipe,
      gestureState: 0x61,
    });

    const rawBytes = new Uint8Array(16);
    const rv = new DataView(rawBytes.buffer);
    rv.setBigInt64(0, BigInt(125), true); rawBytes[8] = 1;
    rv.setUint16(10, 111, true); rv.setUint16(12, 222, true); rawBytes[14] = 3;
    expect(RawTouchSample.fromBytes(rawBytes)).toMatchObject({ touched: true, x: 111, y: 222, touchState: 3 });
  });
});

describe("linear touch geometry", () => {
  it("maps every physical electrode center and neighboring-pad interpolation", () => {
    expect(TOUCH_ELECTRODE_COUNT).toBe(15);
    expect(TOUCH_ELECTRODE_PITCH).toBe(64);
    expect(TOUCH_ELECTRODE_PITCH_MM).toBe(3);
    expect(TOUCH_POSITION_MAX).toBe(896);
    expect(TOUCH_LENGTH_MM).toBe(42);
    for (let pad = 0; pad < 15; pad += 1) {
      const sample = new TouchState(BigInt(42), true, pad * 64, 0);
      expect(sample.positionNormalized).toBe(pad / 14);
      expect(sample.positionMm).toBe(pad * 3);
    }
    const midpoint = new RawTouchSample(BigInt(43), true, 32, 0, 0);
    expect(midpoint.positionMm).toBe(1.5);
    expect(midpoint.positionNormalized).toBe(32 / 896);
    // Native TCH can be clear even when the host detects a slider touch.
    expect(midpoint.touched).toBe(true);
    expect(midpoint.touchState).toBe(0);
  });

  it("distinguishes a valid connector-end touch from release and preserves legacy data", () => {
    expect(new TouchState(BigInt(0), true, 0, 0).positionNormalized).toBe(0);
    for (const sample of [
      new TouchState(BigInt(1), false, 0, 0),
      new TouchState(BigInt(2), true, 4095, 2048),
      new RawTouchSample(BigInt(3), true, 897, 0, 1),
      new RawTouchSample(BigInt(4), true, 20, 1, 1),
      new TouchState(BigInt(5), true, -1, 0),
      new TouchState(BigInt(6), true, 0.5, 0),
    ]) {
      expect(sample.positionNormalized).toBeNull();
      expect(sample.positionMm).toBeNull();
    }
    const legacy = new TouchState(BigInt(7), true, 4095, 2048);
    expect([legacy.x, legacy.y]).toEqual([4095, 2048]);
  });

  it("keeps exact signed timestamps, ignores ABI padding and validates malformed packets", () => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    const timestamp = BigInt("9007199254740993");
    view.setBigInt64(0, timestamp, true);
    bytes[8] = 1;
    bytes[9] = 0xa5;
    view.setUint16(10, 896, true);
    bytes[14] = 0;
    bytes[15] = 0x5a;
    const sample = RawTouchSample.fromBytes(bytes);
    expect(sample.timestampUs).toBe(timestamp);
    expect(sample.positionNormalized).toBe(1);
    expect(sample.positionMm).toBe(42);
    expect(() => RawTouchSample.fromBytes(bytes.slice(0, 15))).toThrow(ProtocolError);
    bytes[8] = 2;
    expect(() => RawTouchSample.fromBytes(bytes)).toThrow(ProtocolError);
    expect(() => TouchState.fromBytes(new Uint8Array(12))).toThrow(ProtocolError);
    const state = new Uint8Array(13);
    state[8] = 2;
    expect(() => TouchState.fromBytes(state)).toThrow(ProtocolError);
    expect(() => TouchGestureSample.fromBytes(new Uint8Array(11))).toThrow(ProtocolError);
    expect(new TouchGestureSample(BigInt(-1), 255, 254).gestureType).toBe(255);
  });
});

describe("output protocols", () => {
  it("uses firmware LED 0x00RRGGBB semantics and little-endian transport", () => {
    const color = new LedColor(0x11, 0x22, 0x33);
    expect(color.toInt()).toBe(0x112233);
    expect([...color.toBytes()]).toEqual([0x33, 0x22, 0x11, 0]);
    expect(LedColor.fromBytes([0x33, 0x22, 0x11, 0])).toEqual(color);
    expect(LedColor.fromHex("#102030").toHex()).toBe("#102030");
    expect(() => LedColor.fromHex("#10203040")).toThrow(TypeError);
  });

  it("encodes v1 haptic patterns and enforces the firmware's 32-frame limit", () => {
    const pattern = HapticPattern.fromFrames([[100, 255], new HapticFrame(50, 0)]);
    expect([...pattern.toBytes()]).toEqual([1, 0, 2, 0, 100, 0, 255, 50, 0, 0]);
    expect(HapticPattern.fromBytes(pattern.toBytes()).totalDurationMs).toBe(150);
    expect(() => HapticPattern.fromFrames(Array.from({ length: HAPTIC_MAX_FRAMES + 1 }, () => [1, 1] as [number, number])))
      .toThrow(RangeError);
  });
});

describe("GATT endpoint registry", () => {
  it("uses the current firmware UUIDs for PPG and touch", () => {
    expect(Uuid.PPG_SERVICE_UUID).toBe("029ca54e-d022-4583-b483-91e9ea77034a");
    expect(Uuid.PPG_IR_UUID).toBe("029ca552-d022-4583-b483-91e9ea77034a");
    expect(Uuid.PPG_SAMPLING_ENABLE_UUID).toBe("029ca561-d022-4583-b483-91e9ea77034a");
    expect(Uuid.TOUCH_SERVICE_UUID).toBe("33a5eb3f-0e13-424f-8b7a-942be0ee5cfc");
    expect(Uuid.TOUCH_RAW_DATA_UUID).toBe("33a5eb44-0e13-424f-8b7a-942be0ee5cfc");
    expect(Uuid.TOUCH_SAMPLING_ENABLE_UUID).toBe("33a5eb51-0e13-424f-8b7a-942be0ee5cfc");
  });

  it("routes every current firmware characteristic to its service", () => {
    const endpoints: Array<[string, string]> = [
      [Uuid.BATTERY_LEVEL_UUID, Uuid.BATTERY_SERVICE_UUID],
      [Uuid.BATTERY_LEVEL_STATUS_UUID, Uuid.BATTERY_SERVICE_UUID],
      [Uuid.CURRENT_TIME_UUID, Uuid.CURRENT_TIME_SERVICE_UUID],
      [Uuid.LOCAL_TIME_INFORMATION_UUID, Uuid.CURRENT_TIME_SERVICE_UUID],
      [Uuid.REFERENCE_TIME_INFORMATION_UUID, Uuid.CURRENT_TIME_SERVICE_UUID],
      [Uuid.TEMPERATURE_MEASUREMENT_UUID, Uuid.HEALTH_THERMOMETER_SERVICE_UUID],
      [Uuid.TEMPERATURE_TYPE_UUID, Uuid.HEALTH_THERMOMETER_SERVICE_UUID],
      [Uuid.MEASUREMENT_INTERVAL_UUID, Uuid.HEALTH_THERMOMETER_SERVICE_UUID],
      [Uuid.IMU_QUATERNION_UUID, Uuid.IMU_SERVICE_UUID],
      [Uuid.IMU_ACCELEROMETER_UUID, Uuid.IMU_SERVICE_UUID],
      [Uuid.IMU_GYROSCOPE_UUID, Uuid.IMU_SERVICE_UUID],
      [Uuid.IMU_GESTURE_UUID, Uuid.IMU_SERVICE_UUID],
      [Uuid.IMU_ACTIVITY_UUID, Uuid.IMU_SERVICE_UUID],
      [Uuid.IMU_ENABLE_UUID, Uuid.IMU_CONFIG_SERVICE_UUID],
      [Uuid.IMU_DRAIN_PERIOD_UUID, Uuid.IMU_CONFIG_SERVICE_UUID],
      [Uuid.PPG_RED_UUID, Uuid.PPG_SERVICE_UUID],
      [Uuid.PPG_IR_UUID, Uuid.PPG_SERVICE_UUID],
      [Uuid.PPG_GREEN_UUID, Uuid.PPG_SERVICE_UUID],
      [Uuid.PPG_SAMPLING_ENABLE_UUID, Uuid.PPG_CONFIG_SERVICE_UUID],
      [Uuid.PPG_PER_SAMPLE_IRQ_UUID, Uuid.PPG_CONFIG_SERVICE_UUID],
      [Uuid.TOUCH_STATE_UUID, Uuid.TOUCH_SERVICE_UUID],
      [Uuid.TOUCH_GESTURE_UUID, Uuid.TOUCH_SERVICE_UUID],
      [Uuid.TOUCH_RAW_DATA_UUID, Uuid.TOUCH_SERVICE_UUID],
      [Uuid.TOUCH_SAMPLING_ENABLE_UUID, Uuid.TOUCH_CONFIG_SERVICE_UUID],
      [Uuid.LED_COLOR_UUID, Uuid.LED_SERVICE_UUID],
      [Uuid.HAPTIC_PATTERN_UUID, Uuid.HAPTIC_SERVICE_UUID],
    ];
    for (const [characteristic, service] of endpoints) {
      expect(Uuid.serviceUuidForCharacteristic(characteristic)).toBe(service);
    }
  });
});
