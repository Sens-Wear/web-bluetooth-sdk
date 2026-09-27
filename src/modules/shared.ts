import type { WebBluetoothRemoteGATTCharacteristic } from "../browser.js";

import type { ByteInput } from "../binary.js";

export interface WriteOptions {
  response?: boolean;
  serviceUuid?: string;
  /** Compatibility label only; browsers do not expose transaction cancellation. */
  transactionId?: string;
}

export interface NotifyOptions {
  serviceUuid?: string;
  /** Compatibility label only; browsers do not expose transaction cancellation. */
  transactionId?: string;
  onError?: (error: unknown) => void;
}

export type NotifyCallback = (sender: WebBluetoothRemoteGATTCharacteristic, data: Uint8Array) => void;

export interface GattClient {
  readGattChar(characteristicUuid: string, serviceUuid?: string, transactionId?: string): Promise<Uint8Array>;
  writeGattChar(characteristicUuid: string, data: ByteInput, options?: WriteOptions): Promise<void>;
  startNotify(characteristicUuid: string, callback: NotifyCallback, options?: NotifyOptions): Promise<void>;
  stopNotify(characteristicUuid: string): Promise<void>;
}

export type MaybePromise<T> = T | Promise<T>;

/** Typed endpoints that advertise WRITE require an acknowledged GATT request. */
export function requireWriteResponse(response: boolean | undefined): true {
  if (response !== undefined && typeof response !== "boolean") {
    throw new TypeError("response must be a boolean.");
  }
  if (response === false) {
    throw new RangeError("This characteristic requires a write with response.");
  }
  return true;
}

export function encodeBoolean(value: boolean, label: string): number[] {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return [value ? 1 : 0];
}

export function invokeCallback<T>(callback: (value: T) => MaybePromise<void>, value: T): void {
  const result = callback(value);
  if (result instanceof Promise) {
    void result.catch((error) => {
      setTimeout(() => {
        throw error;
      }, 0);
    });
  }
}
