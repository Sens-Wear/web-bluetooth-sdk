import { assertLength, bytesFrom, dataView, readUint16LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { CURRENT_TIME_UUID, LOCAL_TIME_INFORMATION_UUID, REFERENCE_TIME_INFORMATION_UUID } from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { invokeCallback, requireWriteResponse } from "./shared.js";

export const CURRENT_TIME_LENGTH = 10;
export const LOCAL_TIME_INFORMATION_LENGTH = 2;
export const REFERENCE_TIME_INFORMATION_LENGTH = 4;

export enum AdjustReason {
  ManualUpdate = 1 << 0,
  ExternalReference = 1 << 1,
  TimeZoneChange = 1 << 2,
  DstChange = 1 << 3,
}

export class CurrentTime {
  constructor(
    readonly value: Date,
    readonly dayOfWeek: number,
    readonly fractions256: number,
    readonly adjustReason: number,
  ) {}

  static fromBytes(payload: ByteInput): CurrentTime {
    const bytes = bytesFrom(payload);
    assertLength(bytes, CURRENT_TIME_LENGTH, "Current Time");
    const view = dataView(bytes);
    const year = readUint16LE(view, 0);
    const value = new Date(Date.UTC(year, bytes[2] - 1, bytes[3], bytes[4], bytes[5], bytes[6], (bytes[8] * 1000) / 256));
    if (
      value.getUTCFullYear() !== year || value.getUTCMonth() !== bytes[2] - 1 ||
      value.getUTCDate() !== bytes[3] || value.getUTCHours() !== bytes[4] ||
      value.getUTCMinutes() !== bytes[5] || value.getUTCSeconds() !== bytes[6] ||
      bytes[7] < 1 || bytes[7] > 7
    ) {
      throw new RangeError("Current Time payload contains an invalid UTC date/time.");
    }
    return new CurrentTime(value, bytes[7], bytes[8], bytes[9]);
  }

  static fromDate(value: Date, adjustReason = AdjustReason.ManualUpdate): CurrentTime {
    if (!Number.isFinite(value.getTime())) {
      throw new RangeError("value must be a valid Date.");
    }
    const day = value.getUTCDay();
    return new CurrentTime(value, day === 0 ? 7 : day, Math.floor((value.getUTCMilliseconds() * 256) / 1000), adjustReason);
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(CURRENT_TIME_LENGTH);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, this.value.getUTCFullYear(), true);
    bytes.set([
      this.value.getUTCMonth() + 1,
      this.value.getUTCDate(),
      this.value.getUTCHours(),
      this.value.getUTCMinutes(),
      this.value.getUTCSeconds(),
      this.dayOfWeek,
      this.fractions256,
      this.adjustReason,
    ], 2);
    return bytes;
  }
}

export class LocalTimeInformation {
  constructor(readonly timeZoneQuarterHours: number, readonly dstOffset: number) {}

  static fromBytes(payload: ByteInput): LocalTimeInformation {
    const bytes = bytesFrom(payload);
    assertLength(bytes, LOCAL_TIME_INFORMATION_LENGTH, "Local Time Information");
    const zone = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt8(0);
    return new LocalTimeInformation(zone, bytes[1]);
  }

  get utcOffsetMinutes(): number | null {
    return this.timeZoneQuarterHours === -128 ? null : this.timeZoneQuarterHours * 15;
  }
}

export class ReferenceTimeInformation {
  constructor(
    readonly source: number,
    readonly accuracyEighthsSecond: number,
    readonly daysSinceUpdate: number,
    readonly hoursSinceUpdate: number,
  ) {}

  static fromBytes(payload: ByteInput): ReferenceTimeInformation {
    const bytes = bytesFrom(payload);
    assertLength(bytes, REFERENCE_TIME_INFORMATION_LENGTH, "Reference Time Information");
    return new ReferenceTimeInformation(bytes[0], bytes[1], bytes[2], bytes[3]);
  }

  get accuracySeconds(): number | null {
    return this.accuracyEighthsSecond === 255 ? null : this.accuracyEighthsSecond / 8;
  }
}

export class TimeModule {
  constructor(private readonly client: GattClient) {}

  async read(): Promise<CurrentTime> {
    return CurrentTime.fromBytes(await this.client.readGattChar(CURRENT_TIME_UUID));
  }

  async set(value: Date | CurrentTime, options: { adjustReason?: number; response?: boolean } = {}): Promise<void> {
    const current = value instanceof CurrentTime ? value : CurrentTime.fromDate(value, options.adjustReason);
    if (current.value.getTime() < Date.UTC(2020, 0, 1)) {
      throw new RangeError("Firmware accepts Current Time values from 2020-01-01 onward.");
    }
    await this.client.writeGattChar(CURRENT_TIME_UUID, current.toBytes(), { response: requireWriteResponse(options.response) });
  }

  async readLocalInformation(): Promise<LocalTimeInformation> {
    return LocalTimeInformation.fromBytes(await this.client.readGattChar(LOCAL_TIME_INFORMATION_UUID));
  }

  async readReferenceInformation(): Promise<ReferenceTimeInformation> {
    return ReferenceTimeInformation.fromBytes(await this.client.readGattChar(REFERENCE_TIME_INFORMATION_UUID));
  }

  async subscribe(callback: (value: CurrentTime) => MaybePromise<void>): Promise<void> {
    await this.unsubscribe();
    await this.client.startNotify(CURRENT_TIME_UUID, (_sender, data) => invokeCallback(callback, CurrentTime.fromBytes(data)));
  }

  async unsubscribe(): Promise<void> {
    await this.client.stopNotify(CURRENT_TIME_UUID);
  }
}
