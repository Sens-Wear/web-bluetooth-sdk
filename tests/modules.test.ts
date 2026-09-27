import { describe, expect, it, vi } from "vitest";

import { bytesFrom, type ByteInput } from "../src/binary";
import { BatteryModule } from "../src/modules/battery";
import { PowerStatusModule } from "../src/modules/charger";
import { HapticModule } from "../src/modules/haptic";
import { ImuModule } from "../src/modules/imu";
import { LedModule } from "../src/modules/led";
import { PpgModule } from "../src/modules/ppg";
import type { NotifyCallback, NotifyOptions, WriteOptions } from "../src/modules/shared";
import { TemperatureModule } from "../src/modules/temperature";
import { TimeModule } from "../src/modules/time";
import { TouchModule } from "../src/modules/touch";
import {
  BATTERY_LEVEL_STATUS_UUID, BATTERY_LEVEL_UUID, CURRENT_TIME_UUID, HAPTIC_PATTERN_UUID,
  IMU_DRAIN_PERIOD_UUID, IMU_ENABLE_UUID, LED_COLOR_UUID, MEASUREMENT_INTERVAL_UUID,
  PPG_PER_SAMPLE_IRQ_UUID, PPG_SAMPLING_ENABLE_UUID, TEMPERATURE_TYPE_UUID,
  TOUCH_SAMPLING_ENABLE_UUID, TOUCH_STATE_UUID, TOUCH_GESTURE_UUID, TOUCH_RAW_DATA_UUID,
  TEMPERATURE_MEASUREMENT_UUID,
} from "../src/uuids";

class FakeGattClient {
  reads = new Map<string, Uint8Array>();
  writes: Array<[string, number[], boolean]> = [];
  started = new Map<string, NotifyCallback>();
  stopped: string[] = [];

  async readGattChar(uuid: string): Promise<Uint8Array> {
    const value = this.reads.get(uuid);
    if (!value) throw new Error(`No fake payload for ${uuid}`);
    return value;
  }
  async writeGattChar(uuid: string, data: ByteInput, options: WriteOptions = {}): Promise<void> {
    this.writes.push([uuid, [...bytesFrom(data)], options.response ?? true]);
  }
  async startNotify(uuid: string, callback: NotifyCallback, _options?: NotifyOptions): Promise<void> {
    this.started.set(uuid, callback);
  }
  async stopNotify(uuid: string): Promise<void> {
    this.stopped.push(uuid);
    this.started.delete(uuid);
  }
}

describe("standard service modules", () => {
  it("reads and subscribes to battery endpoints", async () => {
    const gatt = new FakeGattClient();
    gatt.reads.set(BATTERY_LEVEL_UUID, new Uint8Array([71]));
    gatt.reads.set(BATTERY_LEVEL_STATUS_UUID, new Uint8Array([2, 1, 0, 71]));
    const battery = new BatteryModule(gatt);
    const power = new PowerStatusModule(gatt);
    expect((await battery.read()).percent).toBe(71);
    expect((await power.read()).batteryPresent).toBe(true);
    const callback = vi.fn();
    await battery.subscribe(callback);
    gatt.started.get(BATTERY_LEVEL_UUID)?.({} as never, new Uint8Array([70]));
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ percent: 70 }));
  });

  it("reads/writes time and thermometer configuration endpoints", async () => {
    const gatt = new FakeGattClient();
    gatt.reads.set(TEMPERATURE_TYPE_UUID, new Uint8Array([2]));
    gatt.reads.set(MEASUREMENT_INTERVAL_UUID, new Uint8Array([60, 0]));
    const temperature = new TemperatureModule(gatt);
    expect(await temperature.readTemperatureType()).toBe(2);
    expect(await temperature.readMeasurementInterval()).toBe(60);
    await temperature.setMeasurementInterval(120);

    const time = new TimeModule(gatt);
    await time.set(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(gatt.writes[0]).toEqual([MEASUREMENT_INTERVAL_UUID, [120, 0], true]);
    expect(gatt.writes[1][0]).toBe(CURRENT_TIME_UUID);
    expect(gatt.writes[1][1]).toEqual([0xea, 0x07, 1, 2, 3, 4, 5, 5, 0, 1]);
    await expect(time.set(new Date(Date.UTC(2019, 0, 1)))).rejects.toThrow(RangeError);
    await expect(temperature.setMeasurementInterval(61)).rejects.toThrow(RangeError);
    await expect(temperature.setMeasurementInterval(65_521)).rejects.toThrow(RangeError);
  });
});

describe("custom service modules", () => {
  it("uses IMU configuration endpoints and validation", async () => {
    const gatt = new FakeGattClient();
    gatt.reads.set(IMU_ENABLE_UUID, new Uint8Array([1]));
    gatt.reads.set(IMU_DRAIN_PERIOD_UUID, new Uint8Array([100, 0, 0, 0]));
    const imu = new ImuModule(gatt);
    expect(await imu.isEnabled()).toBe(true);
    expect(await imu.readDrainPeriodMs()).toBe(100);
    await imu.setEnabled(false);
    await imu.setDrainPeriodMs(250);
    expect(gatt.writes).toEqual([
      [IMU_ENABLE_UUID, [0], true],
      [IMU_DRAIN_PERIOD_UUID, [250, 0, 0, 0], true],
    ]);
    await expect(imu.setDrainPeriodMs(0)).rejects.toThrow(RangeError);
  });

  it("controls PPG and touch boolean configurations", async () => {
    const gatt = new FakeGattClient();
    gatt.reads.set(PPG_SAMPLING_ENABLE_UUID, new Uint8Array([1]));
    gatt.reads.set(PPG_PER_SAMPLE_IRQ_UUID, new Uint8Array([0]));
    gatt.reads.set(TOUCH_SAMPLING_ENABLE_UUID, new Uint8Array([1]));
    const ppg = new PpgModule(gatt);
    const touch = new TouchModule(gatt);
    expect(await ppg.isSamplingEnabled()).toBe(true);
    expect(await ppg.isPerSampleIrqEnabled()).toBe(false);
    expect(await touch.isSamplingEnabled()).toBe(true);
    await ppg.setSamplingEnabled(false);
    await ppg.setPerSampleIrqEnabled(true);
    await touch.setSamplingEnabled(false);
    expect(gatt.writes).toEqual([
      [PPG_SAMPLING_ENABLE_UUID, [0], true],
      [PPG_PER_SAMPLE_IRQ_UUID, [1], true],
      [TOUCH_SAMPLING_ENABLE_UUID, [0], true],
    ]);
    await expect(ppg.setSamplingEnabled(1 as never)).rejects.toThrow(TypeError);
    await expect(touch.setSamplingEnabled("yes" as never)).rejects.toThrow(TypeError);
  });

  it("writes corrected RGB and 32-frame haptic payloads", async () => {
    const gatt = new FakeGattClient();
    const led = new LedModule(gatt);
    const haptic = new HapticModule(gatt);
    await led.setRgb(0x10, 0x20, 0x30, { response: false });
    await haptic.play([[25, 100], [25, 0]]);
    expect(gatt.writes).toEqual([
      [LED_COLOR_UUID, [0x30, 0x20, 0x10, 0], false],
      [HAPTIC_PATTERN_UUID, [1, 0, 2, 0, 25, 0, 100, 25, 0, 0], true],
    ]);
  });

  it("routes every touch stream through the same parser for reads and notifications", async () => {
    const gatt = new FakeGattClient();
    const touch = new TouchModule(gatt);
    const state = new Uint8Array(13);
    state[8] = 1;
    new DataView(state.buffer).setUint16(9, 448, true);
    const raw = new Uint8Array(16);
    raw[8] = 1;
    new DataView(raw.buffer).setUint16(10, 448, true);
    raw[14] = 0; // Host contact is independent from the native TCH diagnostic.
    const gesture = new Uint8Array(10);
    gesture.set([6, 0x41], 8);
    gatt.reads.set(TOUCH_STATE_UUID, state);
    gatt.reads.set(TOUCH_RAW_DATA_UUID, raw);
    gatt.reads.set(TOUCH_GESTURE_UUID, gesture);
    const onState = vi.fn(), onRaw = vi.fn(), onGesture = vi.fn();
    await touch.subscribeState(onState);
    await touch.subscribeRaw(onRaw);
    await touch.subscribeGesture(onGesture);
    gatt.started.get(TOUCH_STATE_UUID)?.({} as never, state);
    gatt.started.get(TOUCH_RAW_DATA_UUID)?.({} as never, raw);
    gatt.started.get(TOUCH_GESTURE_UUID)?.({} as never, gesture);
    expect(onState).toHaveBeenCalledWith(await touch.readState());
    expect(onRaw).toHaveBeenCalledWith(await touch.readRaw());
    expect(onGesture).toHaveBeenCalledWith(await touch.readGesture());
    expect((await touch.readRaw()).positionMm).toBe(21);
    expect(gatt.writes).toHaveLength(0); // Subscription does not start sensing.
    await touch.unsubscribeAll();
    expect(gatt.started.size).toBe(0);
  });

  it("rejects unsupported write commands before touching the transport", async () => {
    const gatt = new FakeGattClient();
    const imu = new ImuModule(gatt), ppg = new PpgModule(gatt);
    const touch = new TouchModule(gatt), temperature = new TemperatureModule(gatt);
    const haptic = new HapticModule(gatt), time = new TimeModule(gatt);
    const options = { response: false };
    const writes = [
      () => imu.setEnabled(true, options),
      () => imu.setPhysicalStreamsEnabled(true, options),
      () => imu.setDrainPeriodMs(100, options),
      () => ppg.setSamplingEnabled(true, options),
      () => ppg.setPerSampleIrqEnabled(true, options),
      () => touch.setSamplingEnabled(true, options),
      () => touch.setEnabled(true, options),
      () => temperature.setMeasurementInterval(60, options),
      () => haptic.play([[10, 10]], options),
      () => haptic.vibrate(10, 10, options),
      () => time.set(new Date(Date.UTC(2026, 0, 1)), options),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow(RangeError);
    await expect(touch.setSamplingEnabled(true, { response: 1 as never })).rejects.toThrow(TypeError);
    expect(gatt.writes).toHaveLength(0);
  });

  it("subscribes to temperature interval indications independently from measurements", async () => {
    const gatt = new FakeGattClient();
    const temperature = new TemperatureModule(gatt);
    const onInterval = vi.fn();
    await temperature.subscribe(vi.fn());
    await temperature.subscribeMeasurementInterval(onInterval);
    gatt.started.get(MEASUREMENT_INTERVAL_UUID)?.({} as never, new Uint8Array([120, 0]));
    expect(onInterval).toHaveBeenCalledWith(120);
    expect(() => gatt.started.get(MEASUREMENT_INTERVAL_UUID)?.({} as never, new Uint8Array([1])))
      .toThrow("Measurement Interval payload must be 2 bytes");
    await temperature.unsubscribe();
    expect(gatt.started.has(TEMPERATURE_MEASUREMENT_UUID)).toBe(false);
    expect(gatt.started.has(MEASUREMENT_INTERVAL_UUID)).toBe(true);
    await temperature.unsubscribeAll();
    expect(gatt.started.size).toBe(0);
  });
});
