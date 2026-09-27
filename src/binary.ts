import { ProtocolError } from "./errors.js";

export type ByteInput = Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[];

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Map([...BASE64_ALPHABET].map((char, index) => [char, index]));

export function bytesFrom(input: ByteInput): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("input must be bytes, an ArrayBuffer, an ArrayBuffer view, or an array of byte values.");
}

export function assertLength(data: Uint8Array, expectedLength: number, label: string): void {
  if (data.length !== expectedLength) {
    throw new ProtocolError(`${label} payload must be ${expectedLength} bytes, got ${data.length}.`);
  }
}

export function dataView(input: ByteInput): DataView {
  const bytes = bytesFrom(input);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readInt16LE(view: DataView, offset: number): number {
  return view.getInt16(offset, true);
}

export function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

export function readInt32LE(view: DataView, offset: number): number {
  return view.getInt32(offset, true);
}

export function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function readBigInt64LE(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, true);
}

export function readBigUint64LE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

export function writeUint16LE(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

export function writeInt32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

export function writeUint32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function writeBigInt64LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

export function writeBigUint64LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export function concatBytes(parts: readonly ByteInput[]): Uint8Array {
  const normalized = parts.map(bytesFrom);
  const totalLength = normalized.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of normalized) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export function bytesToBase64(input: ByteInput): string {
  const bytes = bytesFrom(input);
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;
    const remaining = bytes.length - index;

    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += remaining > 1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : "=";
    output += remaining > 2 ? BASE64_ALPHABET[triplet & 0x3f] : "=";
  }

  return output;
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s/g, "");
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  if (clean.length % 4 === 1) {
    throw new ProtocolError("Base64 value has an invalid length.");
  }

  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outputLength = Math.floor((clean.length * 3) / 4) - padding;
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let inputIndex = 0; inputIndex < clean.length; inputIndex += 4) {
    const chars = clean.slice(inputIndex, inputIndex + 4);
    const sextets = [...chars].map((char, charIndex) => {
      if (char === "=") {
        if (inputIndex + charIndex < clean.length - padding) {
          throw new ProtocolError("Base64 padding is only valid at the end of a value.");
        }
        return 0;
      }
      const sextet = BASE64_LOOKUP.get(char);
      if (sextet === undefined) {
        throw new ProtocolError(`Base64 value contains invalid character ${JSON.stringify(char)}.`);
      }
      return sextet;
    });

    while (sextets.length < 4) {
      sextets.push(0);
    }

    const triplet = (sextets[0] << 18) | (sextets[1] << 12) | (sextets[2] << 6) | sextets[3];
    if (outputIndex < outputLength) {
      output[outputIndex++] = (triplet >> 16) & 0xff;
    }
    if (outputIndex < outputLength) {
      output[outputIndex++] = (triplet >> 8) & 0xff;
    }
    if (outputIndex < outputLength) {
      output[outputIndex++] = triplet & 0xff;
    }
  }

  return output;
}
