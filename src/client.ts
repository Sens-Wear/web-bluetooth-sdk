import { bytesFrom, type ByteInput } from "./binary.js";
import type {
  WebBluetooth, WebBluetoothDevice, WebBluetoothRemoteGATTCharacteristic,
  WebBluetoothRemoteGATTServer, WebBluetoothRemoteGATTService, WebBluetoothRequestOptions,
} from "./browser.js";
import {
  ConnectionTimeoutError, NotConnectedError, ProtocolError, SenswearError,
  WebBluetoothUnavailableError,
} from "./errors.js";
import { BatteryModule } from "./modules/battery.js";
import { PowerStatusModule } from "./modules/charger.js";
import { DeviceInfoModule } from "./modules/deviceInfo.js";
import { HapticModule } from "./modules/haptic.js";
import { ImuModule } from "./modules/imu.js";
import { LedModule } from "./modules/led.js";
import { PpgModule } from "./modules/ppg.js";
import type { NotifyCallback, NotifyOptions, WriteOptions } from "./modules/shared.js";
import { TemperatureModule } from "./modules/temperature.js";
import { TimeModule } from "./modules/time.js";
import { TouchModule } from "./modules/touch.js";
import { normalizeGattUuid, SENSWEAR_SERVICE_UUIDS, serviceUuidForCharacteristic } from "./uuids.js";

export const DEFAULT_NAME_PREFIXES = ["Sens Wear", "SensWear"] as const;

export interface DiscoveredDevice {
  id: string;
  /** Browser origin-scoped ID, never a Bluetooth MAC address. */
  address: string;
  name: string | null;
  /** The browser device chooser does not expose RSSI. */
  rssi: null;
  device: WebBluetoothDevice;
}

export interface SenswearDiscoveryOptions {
  /** Defaults to navigator.bluetooth; may be injected for tests. */
  bluetooth?: WebBluetooth;
  namePrefixes?: readonly string[];
  /** Advertised service filters, combined with each name prefix. */
  scanServiceUUIDs?: readonly string[] | null;
  /** Additional service permissions; all SensWear services are always included. */
  optionalServices?: readonly string[];
  /** Show all devices instead of applying name/service filters. */
  acceptAllDevices?: boolean;
  /** Compatibility option for discover(); the browser owns the chooser timeout. */
  timeoutMs?: number;
}

export interface SenswearClientOptions extends SenswearDiscoveryOptions {
  /** GATT connection timeout only, excluding time spent in the chooser. Default 10 seconds. */
  timeoutMs?: number;
  onNotificationError?: (error: unknown, characteristicUuid: string) => void;
  /** Called for an unexpected disconnect; subscriptions must be restored after reconnecting. */
  onDisconnected?: (device: WebBluetoothDevice) => void;
}

interface NotificationSubscription {
  characteristic: WebBluetoothRemoteGATTCharacteristic;
  listener: EventListener;
}

interface ConnectionAttempt {
  promise: Promise<SenswearClient>;
  reject: (error: unknown) => void;
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// Keep browser permissions scoped to the adapter that returned the device.
const rememberedDevices = new WeakMap<WebBluetooth, Map<string, WebBluetoothDevice>>();

export class SenswearClient {
  readonly timeoutMs: number;
  readonly namePrefixes: readonly string[];
  readonly battery = new BatteryModule(this);
  readonly deviceInfo = new DeviceInfoModule(this);
  readonly power = new PowerStatusModule(this);
  /** @deprecated Use power. */
  readonly charger = this.power;
  readonly haptic = new HapticModule(this);
  readonly imu = new ImuModule(this);
  readonly led = new LedModule(this);
  readonly ppg = new PpgModule(this);
  readonly temperature = new TemperatureModule(this);
  readonly time = new TimeModule(this);
  readonly touch = new TouchModule(this);
  readonly addressOrName: string | null;

  private selectedDevice: WebBluetoothDevice | null;
  private server: WebBluetoothRemoteGATTServer | null = null;
  private activeAttempt: ConnectionAttempt | null = null;
  private pendingGatt: Promise<WebBluetoothRemoteGATTServer> | null = null;
  private destroyed = false;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly services = new Map<string, WebBluetoothRemoteGATTService>();
  private readonly characteristics = new Map<string, WebBluetoothRemoteGATTCharacteristic>();
  private readonly subscriptions = new Map<string, NotificationSubscription>();

  constructor(
    deviceOrName: WebBluetoothDevice | DiscoveredDevice | string | null = null,
    private readonly options: SenswearClientOptions = {},
  ) {
    this.addressOrName = typeof deviceOrName === "string" ? deviceOrName.trim() : null;
    this.selectedDevice = typeof deviceOrName === "object" && deviceOrName !== null
      ? "device" in deviceOrName ? deviceOrName.device : deviceOrName
      : null;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
      throw new RangeError("timeoutMs must be positive and no greater than 2147483647.");
    }
    this.namePrefixes = options.namePrefixes ?? DEFAULT_NAME_PREFIXES;
  }

  static isSupported(): boolean {
    return typeof globalThis.isSecureContext !== "boolean" || globalThis.isSecureContext
      ? typeof browserBluetooth()?.requestDevice === "function"
      : false;
  }

  /** Call directly from a click/tap handler. Browser cancellation errors propagate unchanged. */
  static async requestDevice(options: SenswearDiscoveryOptions = {}): Promise<WebBluetoothDevice> {
    const bluetooth = requireBluetooth(options.bluetooth);
    const device = await bluetooth.requestDevice(requestOptions(options));
    remember(bluetooth, device);
    return device;
  }

  /** A chooser, not a background scan: returns exactly the one selected device. */
  static async discover(options: SenswearDiscoveryOptions = {}): Promise<DiscoveredDevice[]> {
    return [describeDevice(await SenswearClient.requestDevice(options))];
  }

  /** Previously permitted devices, including offline ones. Never opens a chooser. */
  static async getGrantedDevices(options: SenswearDiscoveryOptions = {}): Promise<DiscoveredDevice[]> {
    const bluetooth = requireBluetooth(options.bluetooth);
    if (bluetooth.getDevices === undefined) {
      throw new WebBluetoothUnavailableError("This browser does not support bluetooth.getDevices(). Use requestDevice() from a click handler.");
    }
    const devices = await bluetooth.getDevices();
    const prefixes = options.namePrefixes ?? DEFAULT_NAME_PREFIXES;
    return devices.filter((device) => options.acceptAllDevices || prefixes.length === 0 ||
      prefixes.some((prefix) => device.name?.startsWith(prefix))).map((device) => {
      remember(bluetooth, device);
      return describeDevice(device);
    });
  }

  get device(): WebBluetoothDevice | null {
    return this.selectedDevice;
  }

  get deviceId(): string | null {
    return this.server?.connected ? this.selectedDevice?.id ?? null : null;
  }

  get address(): string | null {
    return this.deviceId;
  }

  async isConnected(): Promise<boolean> {
    return this.server?.connected ?? false;
  }

  connect(): Promise<this> {
    if (this.destroyed) return Promise.reject(new SenswearError("This client has been destroyed."));
    if (this.activeAttempt !== null) return this.activeAttempt.promise.then(() => this);
    if (this.server?.connected) return Promise.resolve(this);
    if (this.pendingGatt !== null) {
      return Promise.reject(new SenswearError("The previous browser GATT connection is still settling. Retry once it finishes."));
    }

    let resolveAttempt!: (client: SenswearClient) => void;
    let rejectAttempt!: (error: unknown) => void;
    const promise = new Promise<SenswearClient>((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    const attempt: ConnectionAttempt = { promise, reject: rejectAttempt, cancelled: false };
    this.activeAttempt = attempt;
    // openConnection reaches requestDevice synchronously, preserving user activation.
    void this.openConnection(attempt).then(() => resolveAttempt(this), (error: unknown) => {
      if (this.activeAttempt === attempt) this.clearConnection();
      rejectAttempt(error);
    }).finally(() => {
      clearTimeout(attempt.timer);
      if (this.activeAttempt === attempt) this.activeAttempt = null;
    });
    return promise.then(() => this);
  }

  async disconnect(): Promise<void> {
    this.cancelAttempt(new NotConnectedError("Connection cancelled by disconnect()."));
    const gatt = this.selectedDevice?.gatt;
    this.clearConnection();
    // A disconnect disables all CCCDs; do not wait behind a stalled GATT operation.
    gatt?.disconnect();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.selectedDevice = null;
  }

  async readGattChar(characteristicUuid: string, serviceUuid?: string, _transactionId?: string): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const characteristic = await this.getCharacteristic(characteristicUuid, serviceUuid);
      return bytesFromView(await characteristic.readValue());
    });
  }

  async writeGattChar(characteristicUuid: string, data: ByteInput, options: WriteOptions = {}): Promise<void> {
    if (options.response !== undefined && typeof options.response !== "boolean") {
      throw new TypeError("response must be a boolean.");
    }
    // Snapshot caller-owned views before waiting for other GATT operations.
    const value = Uint8Array.from(bytesFrom(data));
    return this.enqueue(async () => {
      const characteristic = await this.getCharacteristic(characteristicUuid, options.serviceUuid);
      if (options.response ?? true) await characteristic.writeValueWithResponse(value);
      else await characteristic.writeValueWithoutResponse(value);
    });
  }

  async startNotify(characteristicUuid: string, callback: NotifyCallback, options: NotifyOptions = {}): Promise<void> {
    const key = normalizeGattUuid(characteristicUuid);
    const generation = this.generation;
    return this.enqueue(async () => {
      await this.removeSubscription(key);
      this.assertGeneration(generation);
      const characteristic = await this.getCharacteristic(characteristicUuid, options.serviceUuid);
      const listener: EventListener = () => {
        try {
          if (characteristic.value === undefined) {
            throw new ProtocolError(`Characteristic ${characteristicUuid} did not include a value.`);
          }
          callback(characteristic, bytesFromView(characteristic.value));
        } catch (error) {
          this.handleNotificationError(error, characteristicUuid, options);
        }
      };
      characteristic.addEventListener("characteristicvaluechanged", listener);
      const subscription = { characteristic, listener };
      this.subscriptions.set(key, subscription);
      try {
        await characteristic.startNotifications();
      } catch (error) {
        characteristic.removeEventListener("characteristicvaluechanged", listener);
        if (this.subscriptions.get(key) === subscription) this.subscriptions.delete(key);
        throw error;
      }
    });
  }

  async stopNotify(characteristicUuid: string): Promise<void> {
    const key = normalizeGattUuid(characteristicUuid);
    if (!this.server?.connected) return;
    return this.enqueue(() => this.removeSubscription(key));
  }

  private async openConnection(attempt: ConnectionAttempt): Promise<void> {
    let device = this.selectedDevice;
    if (device === null) {
      const bluetooth = requireBluetooth(this.options.bluetooth);
      const target = this.addressOrName;
      device = target ? rememberedDevices.get(bluetooth)?.get(target) ?? null : null;
      if (device === null) {
        device = await bluetooth.requestDevice(requestOptions(this.options, target || undefined));
        remember(bluetooth, device);
      }
    }
    if (attempt.cancelled) throw new NotConnectedError("Connection was cancelled.");
    if (device.gatt === undefined) throw new WebBluetoothUnavailableError("The selected device has no GATT server.");
    this.selectedDevice = device;
    device.addEventListener("gattserverdisconnected", this.onDeviceDisconnected);
    attempt.timer = setTimeout(() => {
      this.cancelAttempt(new ConnectionTimeoutError(`GATT connection timed out after ${this.timeoutMs} ms.`));
      this.clearConnection();
      device.gatt?.disconnect();
    }, this.timeoutMs);
    const connection = device.gatt.connect();
    this.pendingGatt = connection;
    try {
      const server = await connection;
      if (attempt.cancelled) {
        server.disconnect();
        throw new NotConnectedError("Connection was cancelled.");
      }
      if (!server.connected) throw new NotConnectedError("Device disconnected while connecting.");
      this.server = server;
    } finally {
      if (this.pendingGatt === connection) this.pendingGatt = null;
    }
  }

  private cancelAttempt(error: unknown): void {
    const attempt = this.activeAttempt;
    if (attempt === null) return;
    attempt.cancelled = true;
    clearTimeout(attempt.timer);
    this.activeAttempt = null;
    attempt.reject(error);
  }

  private readonly onDeviceDisconnected: EventListener = () => {
    const device = this.selectedDevice;
    this.cancelAttempt(new NotConnectedError("Device disconnected while connecting."));
    this.clearConnection();
    if (device !== null) this.options.onDisconnected?.(device);
  };

  private clearConnection(): void {
    this.generation += 1;
    this.server = null;
    this.selectedDevice?.removeEventListener("gattserverdisconnected", this.onDeviceDisconnected);
    for (const { characteristic, listener } of this.subscriptions.values()) {
      characteristic.removeEventListener("characteristicvaluechanged", listener);
    }
    this.subscriptions.clear();
    this.services.clear();
    this.characteristics.clear();
    this.queue = Promise.resolve();
  }

  private requireServer(): WebBluetoothRemoteGATTServer {
    if (!this.server?.connected || this.destroyed) {
      throw new NotConnectedError("Connect to a SensWear device before using GATT operations.");
    }
    return this.server;
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new NotConnectedError("The connection changed during the GATT operation.");
    this.requireServer();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.requireServer();
    const generation = this.generation;
    const result = this.queue.then(async () => {
      this.assertGeneration(generation);
      const value = await operation();
      this.assertGeneration(generation);
      return value;
    });
    // Recover the queue after a rejected operation; subsequent calls can still proceed.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async getCharacteristic(uuid: string, serviceUuid?: string): Promise<WebBluetoothRemoteGATTCharacteristic> {
    const server = this.requireServer();
    const generation = this.generation;
    const characteristicUuid = normalizeGattUuid(uuid);
    const serviceKey = normalizeGattUuid(serviceUuid ?? serviceUuidForCharacteristic(uuid));
    const key = `${serviceKey}/${characteristicUuid}`;
    const cached = this.characteristics.get(key);
    if (cached !== undefined) return cached;
    let service = this.services.get(serviceKey);
    if (service === undefined) {
      service = await server.getPrimaryService(serviceKey);
      this.assertGeneration(generation);
      this.services.set(serviceKey, service);
    }
    const characteristic = await service.getCharacteristic(characteristicUuid);
    this.assertGeneration(generation);
    this.characteristics.set(key, characteristic);
    return characteristic;
  }

  private async removeSubscription(key: string): Promise<void> {
    const subscription = this.subscriptions.get(key);
    if (subscription === undefined) return;
    // Always detach locally, including when stopNotifications rejects.
    this.subscriptions.delete(key);
    subscription.characteristic.removeEventListener("characteristicvaluechanged", subscription.listener);
    await subscription.characteristic.stopNotifications();
  }

  private handleNotificationError(error: unknown, uuid: string, options: NotifyOptions): void {
    if (options.onError !== undefined) options.onError(error);
    else if (this.options.onNotificationError !== undefined) this.options.onNotificationError(error, uuid);
    else setTimeout(() => { throw error; }, 0);
  }
}

function browserBluetooth(): WebBluetooth | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth;
}

function requireBluetooth(injected?: WebBluetooth): WebBluetooth {
  if (injected !== undefined) return injected;
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) {
    throw new WebBluetoothUnavailableError("Web Bluetooth requires HTTPS or localhost.");
  }
  const bluetooth = browserBluetooth();
  if (typeof bluetooth?.requestDevice !== "function") {
    throw new WebBluetoothUnavailableError("Web Bluetooth is unavailable. Use a supported browser in a secure context.");
  }
  return bluetooth;
}

function requestOptions(options: SenswearDiscoveryOptions, name?: string): WebBluetoothRequestOptions {
  const optionalServices = [...new Set([
    ...SENSWEAR_SERVICE_UUIDS, ...(options.optionalServices ?? []).map(normalizeGattUuid),
  ])];
  if (options.acceptAllDevices) {
    if (name || options.namePrefixes !== undefined || options.scanServiceUUIDs?.length) {
      throw new TypeError("acceptAllDevices cannot be combined with name or service filters.");
    }
    return { acceptAllDevices: true, optionalServices };
  }
  const services = options.scanServiceUUIDs?.map(normalizeGattUuid);
  const prefixes = options.namePrefixes ?? DEFAULT_NAME_PREFIXES;
  if (prefixes.some((prefix) => prefix.length === 0)) throw new TypeError("namePrefixes cannot contain an empty prefix.");
  const filters: NonNullable<WebBluetoothRequestOptions["filters"]> = name
    ? [{ name }] : prefixes.map((namePrefix) => ({ namePrefix }));
  if (services?.length) {
    if (filters.length === 0) filters.push({ services });
    else for (const filter of filters) filter.services = services;
  }
  if (filters.length === 0) throw new TypeError("Provide name/service filters or explicitly set acceptAllDevices: true.");
  return { filters, optionalServices };
}

function remember(bluetooth: WebBluetooth, device: WebBluetoothDevice): void {
  let devices = rememberedDevices.get(bluetooth);
  if (devices === undefined) {
    devices = new Map();
    rememberedDevices.set(bluetooth, devices);
  }
  devices.set(device.id, device);
}

function describeDevice(device: WebBluetoothDevice): DiscoveredDevice {
  return { id: device.id, address: device.id, name: device.name ?? null, rssi: null, device };
}

function bytesFromView(view: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}
