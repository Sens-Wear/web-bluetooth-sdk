import { describe, expect, it, vi } from "vitest";
import { ProtocolError } from "../src/errors";
import {
  DaughterBoard, DeviceCapabilities, DeviceFeature, DeviceInfoModule, parseFirmwareVersion,
} from "../src/modules/deviceInfo";
import type { GattClient } from "../src/modules/shared";
import * as Uuid from "../src/uuids";

const firmwareVersion = Uint8Array.from([49, 46, 50, 46, 51, 45, 100, 101, 118]);
const ppgCapabilities = [1, 6, 0, 0, 0, 219, 0, 0, 0];

function fakeClient(): GattClient {
  const payloads = new Map([
    [Uuid.FIRMWARE_REVISION_UUID, firmwareVersion],
    [Uuid.DEVICE_CAPABILITIES_UUID, Uint8Array.from(ppgCapabilities)],
  ]);
  return {
    readGattChar: vi.fn(async (uuid: string) => {
      const payload = payloads.get(uuid);
      if (!payload) throw new Error(`Missing metadata ${uuid}`);
      return payload;
    }),
    writeGattChar: vi.fn(), startNotify: vi.fn(), stopNotify: vi.fn(),
  };
}

describe("firmware metadata", () => {
  it("decodes exact little-endian fields and preserves unknown high bits", () => {
    const capabilities = DeviceCapabilities.fromBytes([1, 6, 0, 0, 128, 219, 0, 0, 128]);
    expect(capabilities.protocolVersion).toBe(1);
    expect(capabilities.shieldMask).toBe(0x80000006);
    expect(capabilities.featureMask).toBe(0x800000db);
    expect(capabilities.shields).toEqual([DaughterBoard.Ppg, DaughterBoard.Temperature]);
    expect(capabilities.hasShield(DaughterBoard.Haptic)).toBe(false);
    expect(capabilities.hasFeature(DeviceFeature.Ppg)).toBe(true);
    expect(capabilities.hasFeature(DeviceFeature.Temperature)).toBe(true);
    expect(capabilities.hasFeature(DeviceFeature.Touch)).toBe(false);
    expect(capabilities.unknownShieldMask).toBe(0x80000000);
    expect(capabilities.unknownFeatureMask).toBe(0x80000000);
  });

  it("accepts base/all-shield builds and byte subviews", () => {
    const bytes = Uint8Array.from([99, 1, 0, 0, 0, 0, 195, 0, 0, 0, 99]);
    const base = DeviceCapabilities.fromBytes(bytes.subarray(1, 10));
    expect(base.shields).toEqual([]);
    expect(base.hasFeature(DeviceFeature.Imu | DeviceFeature.Led)).toBe(true);
    const all = DeviceCapabilities.fromBytes([1, 15, 0, 0, 0, 255, 0, 0, 0]);
    expect(all.shields).toHaveLength(4);
    expect(all.unknownShieldMask).toBe(0);
    expect(all.unknownFeatureMask).toBe(0);
    for (const feature of [DeviceFeature.Imu, DeviceFeature.Led, DeviceFeature.Haptic,
      DeviceFeature.Ppg, DeviceFeature.Temperature, DeviceFeature.Touch, DeviceFeature.Battery, DeviceFeature.Time]) {
      expect(all.hasFeature(feature)).toBe(true);
    }
  });

  it("rejects malformed lengths and unsupported schemas", () => {
    for (const length of [0, 1, 8, 10, 12]) {
      expect(() => DeviceCapabilities.fromBytes(new Uint8Array(length))).toThrow(ProtocolError);
    }
    for (const schema of [0, 2, 255]) {
      expect(() => DeviceCapabilities.fromBytes([schema, ...ppgCapabilities.slice(1)])).toThrow(ProtocolError);
    }
  });

  it("decodes DIS UTF-8 without silently replacing invalid data", () => {
    expect(parseFirmwareVersion(firmwareVersion)).toBe("1.2.3-dev");
    expect(parseFirmwareVersion([49, 46, 50, 46, 51, 45, 206, 178])).toBe("1.2.3-" + String.fromCharCode(0x03b2));
    for (const bytes of [[], [32], [255], [49, 0], [192, 175]]) {
      expect(() => parseFirmwareVersion(bytes)).toThrow(ProtocolError);
    }
  });

  it("routes both reads and returns the device snapshot", async () => {
    const gatt = fakeClient();
    const module = new DeviceInfoModule(gatt);
    const snapshot = await module.read();
    expect(snapshot.firmwareVersion).toBe("1.2.3-dev");
    expect(snapshot.capabilities.hasFeature(DeviceFeature.Ppg)).toBe(true);
    expect(gatt.readGattChar).toHaveBeenNthCalledWith(1, Uuid.FIRMWARE_REVISION_UUID);
    expect(gatt.readGattChar).toHaveBeenNthCalledWith(2, Uuid.DEVICE_CAPABILITIES_UUID);
    expect(await module.readFirmwareVersion()).toBe(snapshot.firmwareVersion);
    expect(await module.readCapabilities()).toEqual(snapshot.capabilities);
    expect(gatt.writeGattChar).not.toHaveBeenCalled();
  });

  it("does not fabricate capabilities when older firmware omits them", async () => {
    const gatt = fakeClient();
    vi.mocked(gatt.readGattChar).mockRejectedValueOnce(new Error("Characteristic unavailable"));
    await expect(new DeviceInfoModule(gatt).readCapabilities()).rejects.toThrow("Characteristic unavailable");
  });

  it("registers the two metadata characteristics and every current endpoint", () => {
    expect(Uuid.serviceUuidForCharacteristic(Uuid.FIRMWARE_REVISION_UUID)).toBe(Uuid.DEVICE_INFORMATION_SERVICE_UUID);
    expect(Uuid.serviceUuidForCharacteristic(Uuid.DEVICE_CAPABILITIES_UUID.toUpperCase())).toBe(Uuid.DEVICE_CAPABILITIES_SERVICE_UUID);
    for (const [name, uuid] of Object.entries(Uuid)) {
      if (name.endsWith("_UUID") && !name.endsWith("_SERVICE_UUID") && typeof uuid === "string") {
        expect(() => Uuid.serviceUuidForCharacteristic(uuid)).not.toThrow();
      }
    }
  });
});
