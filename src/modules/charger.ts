import { assertLength, bytesFrom, dataView, readUint16LE } from "../binary.js";
import type { ByteInput } from "../binary.js";
import { BATTERY_LEVEL_STATUS_UUID } from "../uuids.js";
import type { GattClient, MaybePromise } from "./shared.js";
import { invokeCallback } from "./shared.js";

export const BATTERY_LEVEL_STATUS_LENGTH = 4;
export const BATTERY_LEVEL_PRESENT_FLAG = 1 << 1;

export enum PowerSourceState {
  NotConnected = 0,
  Connected = 1,
  Unknown = 2,
  Reserved = 3,
}

export enum ChargeState {
  Unknown = 0,
  Charging = 1,
  DischargingActive = 2,
  DischargingInactive = 3,
}

export enum ChargeLevel {
  Unknown = 0,
  Good = 1,
  Low = 2,
  Critical = 3,
}

export class BatteryLevelStatus {
  constructor(
    readonly flags: number,
    readonly powerState: number,
    readonly batteryLevel: number,
  ) {}

  static fromBytes(payload: ByteInput): BatteryLevelStatus {
    const bytes = bytesFrom(payload);
    assertLength(bytes, BATTERY_LEVEL_STATUS_LENGTH, "Battery Level Status");
    return new BatteryLevelStatus(bytes[0], readUint16LE(dataView(bytes), 1), bytes[3]);
  }

  get batteryLevelPresent(): boolean {
    return Boolean(this.flags & BATTERY_LEVEL_PRESENT_FLAG);
  }

  get batteryPresent(): boolean {
    return Boolean(this.powerState & 1);
  }

  get wiredPower(): PowerSourceState {
    return (this.powerState >> 1) & 0x3;
  }

  get wirelessPower(): PowerSourceState {
    return (this.powerState >> 3) & 0x3;
  }

  get chargeState(): ChargeState {
    return (this.powerState >> 5) & 0x3;
  }

  get chargeLevel(): ChargeLevel {
    return (this.powerState >> 7) & 0x3;
  }

  get chargeType(): number {
    return (this.powerState >> 9) & 0x7;
  }

  get chargingFault(): number {
    return (this.powerState >> 12) & 0xf;
  }

  toDict(): Record<string, number | boolean> {
    return {
      flags: this.flags,
      power_state: this.powerState,
      battery_level: this.batteryLevel,
      battery_level_present: this.batteryLevelPresent,
      battery_present: this.batteryPresent,
      wired_power: this.wiredPower,
      wireless_power: this.wirelessPower,
      charge_state: this.chargeState,
      charge_level: this.chargeLevel,
      charge_type: this.chargeType,
      charging_fault: this.chargingFault,
    };
  }
}

export type BatteryLevelStatusCallback = (status: BatteryLevelStatus) => MaybePromise<void>;

export class PowerStatusModule {
  readonly characteristicUuid = BATTERY_LEVEL_STATUS_UUID;

  constructor(private readonly client: GattClient) {}

  async read(): Promise<BatteryLevelStatus> {
    return BatteryLevelStatus.fromBytes(await this.client.readGattChar(this.characteristicUuid));
  }

  async subscribe(callback: BatteryLevelStatusCallback): Promise<void> {
    await this.unsubscribe();
    await this.client.startNotify(this.characteristicUuid, (_sender, data) => {
      invokeCallback(callback, BatteryLevelStatus.fromBytes(data));
    });
  }

  async unsubscribe(): Promise<void> {
    await this.client.stopNotify(this.characteristicUuid);
  }
}

/** @deprecated Use BatteryLevelStatus. */
export { BatteryLevelStatus as ChargerState };
/** @deprecated Use PowerStatusModule or client.power. */
export { PowerStatusModule as ChargerModule };
export const CHARGER_STATE_LENGTH = BATTERY_LEVEL_STATUS_LENGTH;
