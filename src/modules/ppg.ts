import { assertLength, bytesFrom, dataView, readBigUint64LE, readUint32LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { ProtocolError } from "../errors.js";
import {
  PPG_GREEN_UUID, PPG_IR_UUID, PPG_PER_SAMPLE_IRQ_UUID, PPG_RED_UUID, PPG_SAMPLING_ENABLE_UUID,
} from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { encodeBoolean, invokeCallback, requireWriteResponse } from "./shared.js";

export const PPG_SAMPLE_LENGTH = 12;
export const PPG_ADC_MAX = 262143;

export class PpgSample {
  constructor(readonly timestampMs: bigint, readonly value: number) {}

  static fromBytes(payload: ByteInput): PpgSample {
    const bytes = bytesFrom(payload);
    assertLength(bytes, PPG_SAMPLE_LENGTH, "PPG sample");
    const view = dataView(bytes);
    return new PpgSample(readBigUint64LE(view, 0), readUint32LE(view, 8));
  }

  get timestamp(): Date {
    return new Date(Number(this.timestampMs));
  }
}

export class PpgModule {
  constructor(private readonly client: GattClient) {}

  async readRed(): Promise<PpgSample> { return this.read(PPG_RED_UUID); }
  async readIr(): Promise<PpgSample> { return this.read(PPG_IR_UUID); }
  async readGreen(): Promise<PpgSample> { return this.read(PPG_GREEN_UUID); }
  /** @deprecated Use readIr. */
  async readInfrared(): Promise<PpgSample> { return this.readIr(); }

  async isSamplingEnabled(): Promise<boolean> {
    return this.readBoolean(PPG_SAMPLING_ENABLE_UUID, "PPG sampling enable");
  }
  async setSamplingEnabled(enabled: boolean, options: { response?: boolean } = {}): Promise<void> {
    await this.client.writeGattChar(PPG_SAMPLING_ENABLE_UUID, encodeBoolean(enabled, "enabled"), {
      response: requireWriteResponse(options.response),
    });
  }
  async isPerSampleIrqEnabled(): Promise<boolean> {
    return this.readBoolean(PPG_PER_SAMPLE_IRQ_UUID, "PPG per-sample IRQ");
  }
  async setPerSampleIrqEnabled(enabled: boolean, options: { response?: boolean } = {}): Promise<void> {
    await this.client.writeGattChar(PPG_PER_SAMPLE_IRQ_UUID, encodeBoolean(enabled, "enabled"), {
      response: requireWriteResponse(options.response),
    });
  }

  async subscribeRed(callback: (sample: PpgSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(PPG_RED_UUID, callback);
  }
  async subscribeIr(callback: (sample: PpgSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(PPG_IR_UUID, callback);
  }
  /** @deprecated Use subscribeIr. */
  async subscribeInfrared(callback: (sample: PpgSample) => MaybePromise<void>): Promise<void> {
    return this.subscribeIr(callback);
  }
  async subscribeGreen(callback: (sample: PpgSample) => MaybePromise<void>): Promise<void> {
    return this.subscribe(PPG_GREEN_UUID, callback);
  }
  async unsubscribe(characteristicUuid: string): Promise<void> {
    await this.client.stopNotify(characteristicUuid);
  }
  async unsubscribeRed(): Promise<void> { await this.unsubscribe(PPG_RED_UUID); }
  async unsubscribeIr(): Promise<void> { await this.unsubscribe(PPG_IR_UUID); }
  /** @deprecated Use unsubscribeIr. */
  async unsubscribeInfrared(): Promise<void> { await this.unsubscribeIr(); }
  async unsubscribeGreen(): Promise<void> { await this.unsubscribe(PPG_GREEN_UUID); }
  async unsubscribeAll(): Promise<void> {
    await Promise.all([
      this.unsubscribeRed(),
      this.unsubscribeIr(),
      this.unsubscribeGreen(),
    ]);
  }

  private async read(uuid: string): Promise<PpgSample> {
    return PpgSample.fromBytes(await this.client.readGattChar(uuid));
  }
  private async readBoolean(uuid: string, label: string): Promise<boolean> {
    const bytes = bytesFrom(await this.client.readGattChar(uuid));
    assertLength(bytes, 1, label);
    if (bytes[0] > 1) throw new ProtocolError(`${label} must be encoded as 0 or 1.`);
    return bytes[0] === 1;
  }
  private async subscribe(uuid: string, callback: (sample: PpgSample) => MaybePromise<void>): Promise<void> {
    await this.client.stopNotify(uuid);
    await this.client.startNotify(uuid, (_sender, data) => invokeCallback(callback, PpgSample.fromBytes(data)));
  }
}
