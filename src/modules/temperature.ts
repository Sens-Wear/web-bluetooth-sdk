import { bytesFrom, dataView, readUint16LE, readUint32LE, writeUint16LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { ProtocolError } from "../errors.js";
import { MEASUREMENT_INTERVAL_UUID, TEMPERATURE_MEASUREMENT_UUID, TEMPERATURE_TYPE_UUID } from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { invokeCallback, requireWriteResponse } from "./shared.js";

export const TEMPERATURE_INTERVAL_RESOLUTION_SECONDS = 60;
export const TEMPERATURE_INTERVAL_MAX_SECONDS =
  Math.floor(0xffff / TEMPERATURE_INTERVAL_RESOLUTION_SECONDS) *
  TEMPERATURE_INTERVAL_RESOLUTION_SECONDS;

export enum TemperatureType {
  Armpit = 1,
  Body = 2,
  Ear = 3,
  Finger = 4,
  GastrointestinalTract = 5,
  Mouth = 6,
  Rectum = 7,
  Toe = 8,
  Tympanum = 9,
}

export class TemperatureMeasurement {
  constructor(
    readonly temperatureC: number,
    readonly timestamp: Date | null,
    readonly type: TemperatureType | null,
    readonly flags: number,
  ) {}

  static fromBytes(payload: ByteInput): TemperatureMeasurement {
    const bytes = bytesFrom(payload);
    if (bytes.length < 5) {
      throw new ProtocolError(`Temperature Measurement payload must be at least 5 bytes, got ${bytes.length}.`);
    }
    const flags = bytes[0];
    let offset = 5;
    let temperature = decodeIeee11073Float(readUint32LE(dataView(bytes), 1));
    if (flags & 1) {
      temperature = (temperature - 32) * 5 / 9;
    }

    let timestamp: Date | null = null;
    if (flags & 2) {
      if (bytes.length < offset + 7) {
        throw new ProtocolError("Temperature Measurement timestamp is truncated.");
      }
      const year = readUint16LE(dataView(bytes), offset);
      const month = bytes[offset + 2];
      const day = bytes[offset + 3];
      const hour = bytes[offset + 4];
      const minute = bytes[offset + 5];
      const second = bytes[offset + 6];
      timestamp = new Date(0);
      timestamp.setUTCFullYear(year, month - 1, day);
      timestamp.setUTCHours(hour, minute, second, 0);
      if (
        !Number.isFinite(timestamp.getTime()) ||
        timestamp.getUTCFullYear() !== year ||
        timestamp.getUTCMonth() !== month - 1 ||
        timestamp.getUTCDate() !== day ||
        timestamp.getUTCHours() !== hour ||
        timestamp.getUTCMinutes() !== minute ||
        timestamp.getUTCSeconds() !== second
      ) {
        throw new ProtocolError("Temperature Measurement timestamp is invalid.");
      }
      offset += 7;
    }

    let type: TemperatureType | null = null;
    if (flags & 4) {
      if (bytes.length < offset + 1) {
        throw new ProtocolError("Temperature Measurement type is missing.");
      }
      type = bytes[offset] as TemperatureType;
      offset += 1;
    }
    if (bytes.length !== offset) {
      throw new ProtocolError(`Temperature Measurement has ${bytes.length - offset} unexpected trailing byte(s).`);
    }
    return new TemperatureMeasurement(temperature, timestamp, type, flags);
  }

  get temperatureF(): number {
    return this.temperatureC * 9 / 5 + 32;
  }
}

export type TemperatureCallback = (sample: TemperatureMeasurement) => MaybePromise<void>;

export class TemperatureModule {
  readonly measurementUuid = TEMPERATURE_MEASUREMENT_UUID;

  constructor(private readonly client: GattClient) {}

  async readTemperatureType(): Promise<TemperatureType> {
    const bytes = bytesFrom(await this.client.readGattChar(TEMPERATURE_TYPE_UUID));
    if (bytes.length !== 1) throw new ProtocolError("Temperature Type payload must be 1 byte.");
    return bytes[0] as TemperatureType;
  }

  async readMeasurementInterval(): Promise<number> {
    return decodeMeasurementInterval(await this.client.readGattChar(MEASUREMENT_INTERVAL_UUID));
  }

  async setMeasurementInterval(seconds: number, options: { response?: boolean } = {}): Promise<void> {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > TEMPERATURE_INTERVAL_MAX_SECONDS) {
      throw new RangeError("seconds must be an integer between 0 and 65520.");
    }
    if (seconds % TEMPERATURE_INTERVAL_RESOLUTION_SECONDS !== 0) {
      throw new RangeError("seconds must be 0 or a whole-minute multiple of 60.");
    }
    await this.client.writeGattChar(MEASUREMENT_INTERVAL_UUID, writeUint16LE(seconds), {
      response: requireWriteResponse(options.response),
    });
  }

  async subscribe(callback: TemperatureCallback): Promise<void> {
    await this.unsubscribe();
    await this.client.startNotify(this.measurementUuid, (_sender, data) => {
      invokeCallback(callback, TemperatureMeasurement.fromBytes(data));
    });
  }

  async unsubscribe(): Promise<void> {
    await this.client.stopNotify(this.measurementUuid);
  }

  /** Monitor acknowledged interval indications, in seconds after firmware rounding. */
  async subscribeMeasurementInterval(callback: (seconds: number) => MaybePromise<void>): Promise<void> {
    await this.unsubscribeMeasurementInterval();
    await this.client.startNotify(MEASUREMENT_INTERVAL_UUID, (_sender, data) => {
      invokeCallback(callback, decodeMeasurementInterval(data));
    });
  }

  async unsubscribeMeasurementInterval(): Promise<void> {
    await this.client.stopNotify(MEASUREMENT_INTERVAL_UUID);
  }

  async unsubscribeAll(): Promise<void> {
    await Promise.all([this.unsubscribe(), this.unsubscribeMeasurementInterval()]);
  }
}

function decodeMeasurementInterval(payload: ByteInput): number {
  const bytes = bytesFrom(payload);
  if (bytes.length !== 2) throw new ProtocolError("Measurement Interval payload must be 2 bytes.");
  return readUint16LE(dataView(bytes), 0);
}

function decodeIeee11073Float(raw: number): number {
  const encodedMantissa = raw & 0x00ffffff;
  if ([0x007ffffe, 0x00800002, 0x007fffff, 0x00800000, 0x00800001].includes(encodedMantissa)) {
    throw new ProtocolError(
      `Unsupported IEEE-11073 special temperature value 0x${raw.toString(16).padStart(8, "0")}.`,
    );
  }
  let mantissa = encodedMantissa;
  if (mantissa & 0x00800000) mantissa -= 0x01000000;
  let exponent = (raw >>> 24) & 0xff;
  if (exponent & 0x80) exponent -= 0x100;
  return mantissa * 10 ** exponent;
}

/** @deprecated Use TemperatureMeasurement. */
export { TemperatureMeasurement as TemperatureSample };
export const TEMPERATURE_SAMPLE_LENGTH = 13;
