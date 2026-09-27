import { assertLength, bytesFrom, dataView } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { ProtocolError } from "../errors.js";
import { DEVICE_CAPABILITIES_UUID, FIRMWARE_REVISION_UUID } from "../uuids.js";
import type { GattClient } from "./shared.js";

export const DEVICE_CAPABILITIES_LENGTH = 9;
export const DEVICE_CAPABILITIES_PROTOCOL_VERSION = 1;

export enum DaughterBoard {
  Haptic = 1,
  Ppg = 2,
  Temperature = 4,
  Touch = 8,
}

export enum DeviceFeature {
  Imu = 1,
  Led = 2,
  Haptic = 4,
  Ppg = 8,
  Temperature = 16,
  Touch = 32,
  Battery = 64,
  Time = 128,
}

/** Compiled firmware shields/features, not physical attachment or sensor health. */
export class DeviceCapabilities {
  constructor(
    readonly protocolVersion: number,
    readonly shieldMask: number,
    readonly featureMask: number,
  ) {
    if (protocolVersion !== DEVICE_CAPABILITIES_PROTOCOL_VERSION) {
      throw new ProtocolError(`Unsupported capabilities schema ${protocolVersion}.`);
    }
    for (const [label, value] of [["shieldMask", shieldMask], ["featureMask", featureMask]] as const) {
      if (typeof value !== "number") throw new TypeError(`${label} must be a number.`);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${label} must fit in an unsigned 32-bit integer.`);
      }
    }
  }

  static fromBytes(payload: ByteInput): DeviceCapabilities {
    const bytes = bytesFrom(payload);
    assertLength(bytes, DEVICE_CAPABILITIES_LENGTH, "Device Capabilities");
    const view = dataView(bytes);
    return new DeviceCapabilities(bytes[0], view.getUint32(1, true), view.getUint32(5, true));
  }

  hasShield(shield: DaughterBoard): boolean {
    return Boolean(shield) && ((this.shieldMask & shield) >>> 0) === shield;
  }

  hasFeature(feature: DeviceFeature): boolean {
    return Boolean(feature) && ((this.featureMask & feature) >>> 0) === feature;
  }

  get shields(): readonly DaughterBoard[] {
    return [DaughterBoard.Haptic, DaughterBoard.Ppg, DaughterBoard.Temperature, DaughterBoard.Touch]
      .filter((shield) => this.hasShield(shield));
  }

  get unknownShieldMask(): number {
    return (this.shieldMask & ~0x0f) >>> 0;
  }

  get unknownFeatureMask(): number {
    return (this.featureMask & ~0xff) >>> 0;
  }
}

/** Decode DIS UTF-8 without requiring Node Buffer or a TextDecoder polyfill. */
export function parseFirmwareVersion(payload: ByteInput): string {
  const bytes = bytesFrom(payload);
  let value: string;
  try {
    value = decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
  } catch {
    throw new ProtocolError("Firmware Revision must be valid UTF-8.");
  }
  if (!value.trim() || value.includes(String.fromCharCode(0))) {
    throw new ProtocolError("Firmware Revision must be a nonempty string without NUL bytes.");
  }
  return value;
}

export interface DeviceInfo {
  readonly firmwareVersion: string;
  readonly capabilities: DeviceCapabilities;
}

export class DeviceInfoModule {
  constructor(private readonly client: GattClient) {}

  async readFirmwareVersion(): Promise<string> {
    return parseFirmwareVersion(await this.client.readGattChar(FIRMWARE_REVISION_UUID));
  }

  async readCapabilities(): Promise<DeviceCapabilities> {
    return DeviceCapabilities.fromBytes(await this.client.readGattChar(DEVICE_CAPABILITIES_UUID));
  }

  async read(): Promise<DeviceInfo> {
    const firmwareVersion = await this.readFirmwareVersion();
    const capabilities = await this.readCapabilities();
    return { firmwareVersion, capabilities };
  }
}
