import { assertLength, bytesFrom, concatBytes, dataView, readUint16LE, writeUint16LE } from "../binary.js";
import { ProtocolError } from "../errors.js";
import { HAPTIC_PATTERN_UUID } from "../uuids.js";
import type { GattClient } from "./shared.js";
import { requireWriteResponse } from "./shared.js";

export const HAPTIC_PATTERN_VERSION = 1;
export const HAPTIC_PATTERN_FLAGS = 0;
export const HAPTIC_MAX_FRAMES = 32;
export const HAPTIC_PATTERN_HEADER_LENGTH = 4;
export const HAPTIC_FRAME_LENGTH = 3;

export type HapticFrameTuple = [durationMs: number, intensity: number];
export type HapticFrameInput = HapticFrame | HapticFrameTuple | {
  durationMs?: number;
  duration_ms?: number;
  intensity: number;
};
export type HapticPatternInput = HapticPattern | Iterable<HapticFrameInput>;

export interface HapticFrameDict {
  duration_ms: number;
  intensity: number;
}

export interface HapticPatternDict {
  version: number;
  flags: number;
  frame_count: number;
  total_duration_ms: number;
  frames: HapticFrameDict[];
}

export class HapticFrame {
  readonly durationMs: number;
  readonly intensity: number;

  constructor(durationMs: number, intensity: number) {
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 0xffff) {
      throw new RangeError("durationMs must be an integer between 1 and 65535.");
    }
    if (!Number.isInteger(intensity) || intensity < 0 || intensity > 0xff) {
      throw new RangeError("intensity must be an integer between 0 and 255.");
    }
    this.durationMs = durationMs;
    this.intensity = intensity;
  }

  static coerce(frame: HapticFrameInput): HapticFrame {
    if (frame instanceof HapticFrame) {
      return frame;
    }
    if (Array.isArray(frame) && frame.length === 2) {
      return new HapticFrame(frame[0], frame[1]);
    }
    if (typeof frame === "object" && frame !== null && !Array.isArray(frame)) {
      const durationMs = frame.durationMs ?? frame.duration_ms;
      if (durationMs === undefined) {
        throw new TypeError("frame object must include durationMs or duration_ms.");
      }
      return new HapticFrame(durationMs, frame.intensity);
    }
    throw new TypeError("frame must be HapticFrame, a [durationMs, intensity] tuple, or a frame object.");
  }

  static fromBytes(payload: Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[]): HapticFrame {
    const bytes = bytesFrom(payload);
    assertLength(bytes, HAPTIC_FRAME_LENGTH, "Haptic frame");
    const view = dataView(bytes);
    return new HapticFrame(readUint16LE(view, 0), bytes[2]);
  }

  get duration_ms(): number {
    return this.durationMs;
  }

  toBytes(): Uint8Array {
    return concatBytes([writeUint16LE(this.durationMs), [this.intensity]]);
  }

  to_bytes(): Uint8Array {
    return this.toBytes();
  }

  toDict(): HapticFrameDict {
    return {
      duration_ms: this.durationMs,
      intensity: this.intensity,
    };
  }

  to_dict(): HapticFrameDict {
    return this.toDict();
  }
}

export class HapticPattern {
  readonly frames: readonly HapticFrame[];

  constructor(frames: Iterable<HapticFrame>) {
    this.frames = Object.freeze([...frames]);
    if (this.frames.length < 1 || this.frames.length > HAPTIC_MAX_FRAMES) {
      throw new RangeError(`haptic patterns must contain 1 to ${HAPTIC_MAX_FRAMES} frames.`);
    }
  }

  static fromFrames(frames: Iterable<HapticFrameInput>): HapticPattern {
    return new HapticPattern([...frames].map(HapticFrame.coerce));
  }

  static from_frames(frames: Iterable<HapticFrameInput>): HapticPattern {
    return HapticPattern.fromFrames(frames);
  }

  static fromBytes(payload: Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[]): HapticPattern {
    const bytes = bytesFrom(payload);
    if (bytes.length < HAPTIC_PATTERN_HEADER_LENGTH) {
      throw new ProtocolError(`Haptic pattern payload must be at least ${HAPTIC_PATTERN_HEADER_LENGTH} bytes.`);
    }

    const version = bytes[0];
    const flags = bytes[1];
    const frameCount = readUint16LE(dataView(bytes), 2);

    if (version !== HAPTIC_PATTERN_VERSION) {
      throw new ProtocolError(`Unsupported haptic pattern version ${version}.`);
    }
    if (flags !== HAPTIC_PATTERN_FLAGS) {
      throw new ProtocolError(`Unsupported haptic pattern flags ${flags}.`);
    }
    if (frameCount === 0 || frameCount > HAPTIC_MAX_FRAMES) {
      throw new ProtocolError(`Haptic pattern frame count must be 1 to ${HAPTIC_MAX_FRAMES}.`);
    }

    const expectedLength = HAPTIC_PATTERN_HEADER_LENGTH + frameCount * HAPTIC_FRAME_LENGTH;
    if (bytes.length !== expectedLength) {
      throw new ProtocolError(`Haptic pattern payload must be ${expectedLength} bytes, got ${bytes.length}.`);
    }

    const frames: HapticFrame[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const offset = HAPTIC_PATTERN_HEADER_LENGTH + index * HAPTIC_FRAME_LENGTH;
      frames.push(HapticFrame.fromBytes(bytes.slice(offset, offset + HAPTIC_FRAME_LENGTH)));
    }
    return new HapticPattern(frames);
  }

  static from_bytes(payload: Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[]): HapticPattern {
    return HapticPattern.fromBytes(payload);
  }

  get totalDurationMs(): number {
    return this.frames.reduce((total, frame) => total + frame.durationMs, 0);
  }

  get total_duration_ms(): number {
    return this.totalDurationMs;
  }

  toBytes(): Uint8Array {
    return concatBytes([
      [HAPTIC_PATTERN_VERSION, HAPTIC_PATTERN_FLAGS],
      writeUint16LE(this.frames.length),
      ...this.frames.map((frame) => frame.toBytes()),
    ]);
  }

  to_bytes(): Uint8Array {
    return this.toBytes();
  }

  toDict(): HapticPatternDict {
    return {
      version: HAPTIC_PATTERN_VERSION,
      flags: HAPTIC_PATTERN_FLAGS,
      frame_count: this.frames.length,
      total_duration_ms: this.totalDurationMs,
      frames: this.frames.map((frame) => frame.toDict()),
    };
  }

  to_dict(): HapticPatternDict {
    return this.toDict();
  }
}

export class HapticModule {
  readonly patternUuid = HAPTIC_PATTERN_UUID;

  constructor(private readonly client: GattClient) {}

  async play(pattern: HapticPatternInput, options: { response?: boolean } = {}): Promise<void> {
    const hapticPattern = coercePattern(pattern);
    await this.client.writeGattChar(this.patternUuid, hapticPattern.toBytes(), {
      response: requireWriteResponse(options.response),
    });
  }

  async vibrate(durationMs: number, intensity = 255, options: { response?: boolean } = {}): Promise<void> {
    await this.play(new HapticPattern([new HapticFrame(durationMs, intensity)]), {
      response: requireWriteResponse(options.response),
    });
  }
}

function coercePattern(pattern: HapticPatternInput): HapticPattern {
  if (pattern instanceof HapticPattern) {
    return pattern;
  }
  return HapticPattern.fromFrames(pattern);
}
