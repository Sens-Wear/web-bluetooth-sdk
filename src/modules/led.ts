import { assertLength, bytesFrom, dataView, readUint32LE, writeUint32LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { LED_COLOR_UUID } from "../uuids.js";
import type { GattClient } from "./shared.js";

export const LED_COLOR_LENGTH = 4;

export type LedColorInput =
  | LedColor
  | number
  | string
  | readonly [number, number, number]
  | { red: number; green: number; blue: number };

export class LedColor {
  constructor(readonly red: number, readonly green: number, readonly blue: number) {
    validateByte(red, "red");
    validateByte(green, "green");
    validateByte(blue, "blue");
  }

  static fromBytes(payload: ByteInput): LedColor {
    const bytes = bytesFrom(payload);
    assertLength(bytes, LED_COLOR_LENGTH, "LED color");
    return LedColor.fromInt(readUint32LE(dataView(bytes), 0));
  }

  static fromInt(value: number): LedColor {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new RangeError("LED color integer must be between 0x000000 and 0xFFFFFF.");
    }
    return new LedColor((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  static fromHex(value: string): LedColor {
    const clean = value.startsWith("#") ? value.slice(1) : value;
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
      throw new TypeError("LED hex color must contain exactly six hexadecimal digits (RRGGBB).");
    }
    return LedColor.fromInt(Number.parseInt(clean, 16));
  }

  static coerce(value: LedColorInput): LedColor {
    if (value instanceof LedColor) return value;
    if (typeof value === "number") return LedColor.fromInt(value);
    if (typeof value === "string") return LedColor.fromHex(value);
    if (Array.isArray(value) && value.length === 3) return new LedColor(value[0], value[1], value[2]);
    if (typeof value === "object" && value !== null && "red" in value) {
      return new LedColor(value.red, value.green, value.blue);
    }
    throw new TypeError("LED color must be LedColor, 0xRRGGBB, '#RRGGBB', [r,g,b], or an RGB object.");
  }

  toInt(): number {
    return this.red * 0x10000 + this.green * 0x100 + this.blue;
  }

  toBytes(): Uint8Array {
    return writeUint32LE(this.toInt());
  }

  toHex(): string {
    return `#${this.toInt().toString(16).padStart(6, "0")}`;
  }

  toDict(): { red: number; green: number; blue: number } {
    return { red: this.red, green: this.green, blue: this.blue };
  }
}

export class LedModule {
  readonly characteristicUuid = LED_COLOR_UUID;
  constructor(private readonly client: GattClient) {}

  async read(): Promise<LedColor> {
    return LedColor.fromBytes(await this.client.readGattChar(this.characteristicUuid));
  }
  async set(color: LedColorInput, options: { response?: boolean } = {}): Promise<void> {
    await this.client.writeGattChar(this.characteristicUuid, LedColor.coerce(color).toBytes(), {
      response: options.response ?? true,
    });
  }
  async setRgb(red: number, green: number, blue: number, options: { response?: boolean } = {}): Promise<void> {
    await this.set(new LedColor(red, green, blue), options);
  }
  async off(options: { response?: boolean } = {}): Promise<void> {
    await this.set(0, options);
  }
}

function validateByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} must be an integer between 0 and 255.`);
  }
}
