import { assertLength, bytesFrom } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { BATTERY_LEVEL_UUID } from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { invokeCallback } from "./shared.js";

export const BATTERY_LEVEL_LENGTH = 1;

export class BatteryLevel {
  constructor(readonly percent: number) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new RangeError("Battery percent must be an integer between 0 and 100.");
    }
  }

  static fromBytes(payload: ByteInput): BatteryLevel {
    const bytes = bytesFrom(payload);
    assertLength(bytes, BATTERY_LEVEL_LENGTH, "Battery Level");
    return new BatteryLevel(bytes[0]);
  }

  get stateOfChargePercent(): number {
    return this.percent;
  }

  toDict(): { percent: number } {
    return { percent: this.percent };
  }
}

export type BatteryLevelCallback = (level: BatteryLevel) => MaybePromise<void>;

export class BatteryModule {
  readonly characteristicUuid = BATTERY_LEVEL_UUID;

  constructor(private readonly client: GattClient) {}

  async read(): Promise<BatteryLevel> {
    return BatteryLevel.fromBytes(await this.client.readGattChar(this.characteristicUuid));
  }

  async subscribe(callback: BatteryLevelCallback): Promise<void> {
    await this.unsubscribe();
    await this.client.startNotify(this.characteristicUuid, (_sender, data) => {
      invokeCallback(callback, BatteryLevel.fromBytes(data));
    });
  }

  async unsubscribe(): Promise<void> {
    await this.client.stopNotify(this.characteristicUuid);
  }
}

/** @deprecated Use BatteryLevel. */
export { BatteryLevel as BatteryGaugeState };
/** @deprecated Use BatteryModule. */
export { BatteryModule as BatteryGaugeModule };
/** @deprecated The legacy gauge payload was replaced by the one-byte SIG Battery Level. */
export const GAUGE_STATE_LENGTH = BATTERY_LEVEL_LENGTH;
