export { SenswearClient, DEFAULT_NAME_PREFIXES } from "./client.js";
export type { DiscoveredDevice, SenswearClientOptions, SenswearDiscoveryOptions } from "./client.js";
export {
  DeviceNotFoundError,
  NotConnectedError,
  ProtocolError,
  SenswearError,
} from "./errors.js";
export * from "./modules/index.js";
export * from "./uuids.js";

export type * from "./browser.js";
export type { ByteInput } from "./binary.js";
export type { GattClient, NotifyCallback, NotifyOptions, WriteOptions, MaybePromise } from "./modules/shared.js";
export { WebBluetoothUnavailableError, ConnectionTimeoutError } from "./errors.js";
