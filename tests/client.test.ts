import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BATTERY_LEVEL_UUID, BATTERY_SERVICE_UUID, ConnectionTimeoutError, LED_COLOR_UUID,
  LED_SERVICE_UUID, NotConnectedError, ProtocolError, SENSWEAR_SERVICE_UUIDS,
  SenswearClient, WebBluetoothUnavailableError, normalizeGattUuid,
} from "../src/index";
import type {
  WebBluetooth, WebBluetoothDevice, WebBluetoothRemoteGATTCharacteristic,
  WebBluetoothRemoteGATTServer, WebBluetoothRemoteGATTService,
} from "../src/index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeCharacteristic extends EventTarget implements WebBluetoothRemoteGATTCharacteristic {
  value = new DataView(Uint8Array.from([99, 72, 99]).buffer, 1, 1);
  properties = { read: true, write: true, writeWithoutResponse: true, notify: true, indicate: false };
  readValue = vi.fn(async (): Promise<DataView> => this.value);
  writeValueWithResponse = vi.fn(async (_value: BufferSource) => {});
  writeValueWithoutResponse = vi.fn(async (_value: BufferSource) => {});
  startNotifications = vi.fn(async () => this);
  stopNotifications = vi.fn(async () => this);
  constructor(readonly uuid: string) { super(); }
  emit(bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class FakeService implements WebBluetoothRemoteGATTService {
  characteristics = new Map<string, FakeCharacteristic>();
  getCharacteristic = vi.fn(async (uuid: string | number) => {
    const characteristic = this.characteristics.get(String(uuid));
    if (characteristic === undefined) throw new Error("Characteristic not found");
    return characteristic;
  });
  constructor(readonly uuid: string) {}
}

class FakeServer implements WebBluetoothRemoteGATTServer {
  connected = false;
  services = new Map<string, FakeService>();
  connect = vi.fn(async (): Promise<WebBluetoothRemoteGATTServer> => { this.connected = true; return this; });
  disconnect = vi.fn(() => { this.connected = false; });
  getPrimaryService = vi.fn(async (uuid: string | number) => {
    const service = this.services.get(String(uuid));
    if (service === undefined) throw new Error("Service not found");
    return service;
  });
}

class FakeDevice extends EventTarget implements WebBluetoothDevice {
  gatt = new FakeServer();
  constructor(readonly id = "browser-private-id", readonly name = "SensWear Test") { super(); }
  drop() {
    this.gatt.connected = false;
    this.dispatchEvent(new Event("gattserverdisconnected"));
  }
}

function setup() {
  const device = new FakeDevice();
  const batteryService = new FakeService(normalizeGattUuid(BATTERY_SERVICE_UUID));
  const battery = new FakeCharacteristic(normalizeGattUuid(BATTERY_LEVEL_UUID));
  batteryService.characteristics.set(battery.uuid, battery);
  device.gatt.services.set(batteryService.uuid, batteryService);
  const ledService = new FakeService(LED_SERVICE_UUID);
  const led = new FakeCharacteristic(LED_COLOR_UUID);
  ledService.characteristics.set(led.uuid, led);
  device.gatt.services.set(ledService.uuid, ledService);
  const bluetooth = {
    requestDevice: vi.fn(async () => device),
    getDevices: vi.fn(async () => [device]),
  } satisfies WebBluetooth;
  return { device, bluetooth, batteryService, battery, led };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("browser discovery", () => {
  it("works without browser globals until a browser operation is requested", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(SenswearClient.isSupported()).toBe(false);
    const client = new SenswearClient();
    expect(await client.isConnected()).toBe(false);
    await expect(client.connect()).rejects.toThrow(WebBluetoothUnavailableError);
    await client.destroy();
  });

  it("reports insecure contexts with a useful error", async () => {
    vi.stubGlobal("navigator", { bluetooth: setup().bluetooth });
    vi.stubGlobal("isSecureContext", false);
    expect(SenswearClient.isSupported()).toBe(false);
    await expect(SenswearClient.requestDevice()).rejects.toThrow("HTTPS or localhost");
  });

  it("opens the chooser synchronously and grants every SensWear service", async () => {
    const { bluetooth, device } = setup();
    const result = SenswearClient.discover({ bluetooth });
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(bluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ namePrefix: "Sens Wear" }, { namePrefix: "SensWear" }],
      optionalServices: SENSWEAR_SERVICE_UUIDS,
    });
    const found = await result;
    expect(found).toEqual([{ id: device.id, address: device.id, name: device.name, rssi: null, device }]);
    const client = new SenswearClient(found[0].id, { bluetooth });
    await client.connect();
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  it("uses navigator.bluetooth by default", async () => {
    const { bluetooth } = setup();
    vi.stubGlobal("navigator", { bluetooth });
    vi.stubGlobal("isSecureContext", true);
    expect(SenswearClient.isSupported()).toBe(true);
    const client = new SenswearClient();
    const connection = client.connect();
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    await connection;
    await client.destroy();
  });

  it("normalizes service filters and merges custom permissions", async () => {
    const { bluetooth } = setup();
    await SenswearClient.requestDevice({ bluetooth, namePrefixes: [], scanServiceUUIDs: ["180F"], optionalServices: ["180f", "1234"] });
    expect(bluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [normalizeGattUuid("180f")] }],
      optionalServices: [...SENSWEAR_SERVICE_UUIDS, normalizeGattUuid("1234")],
    });
  });

  it("requires explicit permission to show all devices", async () => {
    const { bluetooth } = setup();
    await expect(SenswearClient.requestDevice({ bluetooth, namePrefixes: [] })).rejects.toThrow(TypeError);
    await expect(SenswearClient.requestDevice({ bluetooth, namePrefixes: [""] })).rejects.toThrow(TypeError);
    await expect(SenswearClient.requestDevice({ bluetooth, acceptAllDevices: true, namePrefixes: [] })).rejects.toThrow(TypeError);
    expect(bluetooth.requestDevice).not.toHaveBeenCalled();
    await SenswearClient.requestDevice({ bluetooth, acceptAllDevices: true });
    expect(bluetooth.requestDevice).toHaveBeenCalledWith({ acceptAllDevices: true, optionalServices: SENSWEAR_SERVICE_UUIDS });
  });

  it("propagates chooser cancellation and permission errors unchanged", async () => {
    const { bluetooth } = setup();
    const cancellation = new DOMException("User cancelled", "NotFoundError");
    bluetooth.requestDevice.mockRejectedValue(cancellation);
    await expect(SenswearClient.discover({ bluetooth })).rejects.toBe(cancellation);
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
  });

  it("retrieves granted devices without prompting, filtering by name", async () => {
    const { bluetooth, device } = setup();
    bluetooth.getDevices.mockResolvedValue([device, new FakeDevice("other", "Other")]);
    const granted = await SenswearClient.getGrantedDevices({ bluetooth });
    expect(granted.map((item) => item.id)).toEqual([device.id]);
    const client = new SenswearClient(granted[0], { bluetooth });
    await client.connect();
    expect(bluetooth.requestDevice).not.toHaveBeenCalled();
    await client.destroy();
    await expect(SenswearClient.getGrantedDevices({ bluetooth: { requestDevice: bluetooth.requestDevice } })).rejects.toThrow("getDevices");
  });

  it("uses exact-name filters for names, without interpreting them as addresses", async () => {
    const { bluetooth } = setup();
    const client = new SenswearClient("SensWear-01", { bluetooth });
    await client.connect();
    expect(bluetooth.requestDevice).toHaveBeenCalledWith({ filters: [{ name: "SensWear-01" }], optionalServices: SENSWEAR_SERVICE_UUIDS });
    await client.destroy();
  });
});

describe("browser GATT operations", () => {
  it("requires a connection and validates connection timeouts", async () => {
    const client = new SenswearClient();
    await expect(client.battery.read()).rejects.toThrow(NotConnectedError);
    await expect(client.led.set("#112233")).rejects.toThrow(NotConnectedError);
    for (const timeoutMs of [0, -1, NaN, Infinity, 2 ** 31]) {
      expect(() => new SenswearClient(null, { timeoutMs })).toThrow(RangeError);
    }
  });

  it("reads byte subviews and caches normalized endpoints", async () => {
    const { device, battery, batteryService } = setup();
    const client = new SenswearClient(device);
    await client.connect();
    expect(client.deviceId).toBe(device.id);
    const bytes = await client.readGattChar(BATTERY_LEVEL_UUID);
    battery.value.setUint8(0, 60);
    expect([...bytes]).toEqual([72]);
    expect(await client.readGattChar(normalizeGattUuid(BATTERY_LEVEL_UUID).toUpperCase())).toEqual(Uint8Array.of(60));
    expect(device.gatt.getPrimaryService).toHaveBeenCalledTimes(1);
    expect(batteryService.getCharacteristic).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  it("preserves response mode and snapshots queued write data", async () => {
    const { device, led } = setup();
    const client = new SenswearClient(device);
    await client.connect();
    const data = Uint8Array.from([99, 3, 2, 1, 0, 99]);
    const write = client.writeGattChar(LED_COLOR_UUID, data.subarray(1, 5));
    data.fill(88);
    await write;
    await client.led.set("#010203", { response: false });
    expect(led.writeValueWithResponse).toHaveBeenCalledWith(Uint8Array.of(3, 2, 1, 0));
    expect(led.writeValueWithoutResponse).toHaveBeenCalledWith(Uint8Array.of(3, 2, 1, 0));
    await client.destroy();
  });

  it("serializes concurrent GATT work and recovers after an error", async () => {
    const { device, battery, led } = setup();
    const read = deferred<DataView>();
    battery.readValue.mockReturnValueOnce(read.promise);
    const client = new SenswearClient(device);
    await client.connect();
    const first = client.battery.read();
    const second = client.led.set("#112233");
    await vi.waitFor(() => expect(battery.readValue).toHaveBeenCalledTimes(1));
    expect(led.writeValueWithResponse).not.toHaveBeenCalled();
    const rejected = expect(first).rejects.toThrow("read failed");
    read.reject(new Error("read failed"));
    await rejected;
    await second;
    expect(led.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect((await client.battery.read()).percent).toBe(72);
    await client.destroy();
  });

  it("supports explicit services for custom firmware characteristics", async () => {
    const { device, batteryService, battery } = setup();
    batteryService.characteristics.set(normalizeGattUuid("1234"), battery);
    const client = new SenswearClient(device);
    await client.connect();
    expect(await client.readGattChar("1234", BATTERY_SERVICE_UUID)).toEqual(Uint8Array.of(72));
    await expect(client.readGattChar("1234")).rejects.toThrow("No SensWear service UUID");
    await client.destroy();
  });
});

describe("notifications and lifecycle", () => {
  it("replaces subscriptions and routes parse failures", async () => {
    const { device, battery } = setup();
    const onNotificationError = vi.fn();
    const client = new SenswearClient(device, { onNotificationError });
    await client.connect();
    const first = vi.fn();
    const second = vi.fn();
    await client.battery.subscribe(first);
    await client.battery.subscribe(second);
    battery.emit([51]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ percent: 51 }));
    battery.emit([1, 2]);
    expect(onNotificationError).toHaveBeenCalledWith(expect.any(ProtocolError), BATTERY_LEVEL_UUID);
    await client.stopNotify(normalizeGattUuid(BATTERY_LEVEL_UUID));
    battery.emit([52]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(battery.stopNotifications).toHaveBeenCalledTimes(2);
    await client.destroy();
  });

  it("attaches the listener before enabling indications and prefers local errors", async () => {
    const { device, battery } = setup();
    battery.properties.notify = false;
    battery.properties.indicate = true;
    battery.startNotifications.mockImplementation(async () => { battery.emit([44]); return battery; });
    const onNotificationError = vi.fn();
    const onError = vi.fn();
    const callback = vi.fn(() => { throw new Error("callback failed"); });
    const client = new SenswearClient(device, { onNotificationError });
    await client.connect();
    await client.startNotify(BATTERY_LEVEL_UUID, callback, { onError });
    expect(callback).toHaveBeenCalledWith(battery, Uint8Array.of(44));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onNotificationError).not.toHaveBeenCalled();
    await client.destroy();
  });

  it("cleans up failed starts and stops even when the browser rejects", async () => {
    const { device, battery } = setup();
    const callback = vi.fn();
    const client = new SenswearClient(device);
    await client.connect();
    battery.startNotifications.mockRejectedValueOnce(new Error("start failed"));
    await expect(client.battery.subscribe(callback)).rejects.toThrow("start failed");
    battery.emit([40]);
    expect(callback).not.toHaveBeenCalled();
    await client.battery.subscribe(callback);
    battery.stopNotifications.mockRejectedValueOnce(new Error("stop failed"));
    await expect(client.battery.unsubscribe()).rejects.toThrow("stop failed");
    battery.emit([41]);
    expect(callback).not.toHaveBeenCalled();
    await client.destroy();
  });

  it("cleans unexpected disconnects and rediscovers endpoints on reconnect", async () => {
    const { device, battery, batteryService } = setup();
    const onDisconnected = vi.fn();
    const callback = vi.fn();
    const client = new SenswearClient(device, { onDisconnected });
    await client.connect();
    await client.battery.subscribe(callback);
    device.drop();
    battery.emit([21]);
    expect(callback).not.toHaveBeenCalled();
    expect(onDisconnected).toHaveBeenCalledWith(device);
    expect(client.deviceId).toBeNull();
    await expect(client.battery.read()).rejects.toThrow(NotConnectedError);
    const replacement = new FakeCharacteristic(battery.uuid);
    replacement.emit([83]);
    batteryService.characteristics.set(battery.uuid, replacement);
    await client.connect();
    expect((await client.battery.read()).percent).toBe(83);
    await client.destroy();
    expect(await client.isConnected()).toBe(false);
    await expect(client.connect()).rejects.toThrow("destroyed");
    await client.destroy();
  });

  it("prevents stale queued operations from reaching a reconnected device", async () => {
    const { device, battery, led } = setup();
    const read = deferred<DataView>();
    battery.readValue.mockReturnValueOnce(read.promise);
    const client = new SenswearClient(device);
    await client.connect();
    const first = client.battery.read();
    const second = client.led.set("#112233");
    const failedFirst = expect(first).rejects.toThrow(NotConnectedError);
    const failedSecond = expect(second).rejects.toThrow(NotConnectedError);
    await vi.waitFor(() => expect(battery.readValue).toHaveBeenCalled());
    await client.disconnect();
    await client.connect();
    read.resolve(battery.value);
    await Promise.all([failedFirst, failedSecond]);
    expect(led.writeValueWithResponse).not.toHaveBeenCalled();
    expect((await client.battery.read()).percent).toBe(72);
    await client.destroy();
  });

  it("coalesces concurrent connects", async () => {
    const { device, bluetooth } = setup();
    const client = new SenswearClient(null, { bluetooth });
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  it("does not let a late failed subscription remove a new connection's listener", async () => {
    const { device, battery, batteryService } = setup();
    const start = deferred<FakeCharacteristic>();
    battery.startNotifications.mockReturnValueOnce(start.promise);
    const client = new SenswearClient(device);
    await client.connect();
    const oldSubscription = client.battery.subscribe(vi.fn());
    const failed = expect(oldSubscription).rejects.toThrow("old start failed");
    await vi.waitFor(() => expect(battery.startNotifications).toHaveBeenCalled());
    device.drop();
    const replacement = new FakeCharacteristic(battery.uuid);
    batteryService.characteristics.set(battery.uuid, replacement);
    await client.connect();
    const callback = vi.fn();
    await client.battery.subscribe(callback);
    start.reject(new Error("old start failed"));
    await failed;
    await client.battery.unsubscribe();
    replacement.emit([44]);
    expect(callback).not.toHaveBeenCalled();
    expect(replacement.stopNotifications).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  it("does not resume an old replacement subscription after reconnecting", async () => {
    const { device, battery, batteryService } = setup();
    const client = new SenswearClient(device);
    await client.connect();
    await client.startNotify(BATTERY_LEVEL_UUID, vi.fn());
    const stop = deferred<FakeCharacteristic>();
    battery.stopNotifications.mockReturnValueOnce(stop.promise);
    const restarting = client.startNotify(BATTERY_LEVEL_UUID, vi.fn());
    const failed = expect(restarting).rejects.toThrow(NotConnectedError);
    await vi.waitFor(() => expect(battery.stopNotifications).toHaveBeenCalled());
    device.drop();
    const replacement = new FakeCharacteristic(battery.uuid);
    batteryService.characteristics.set(battery.uuid, replacement);
    await client.connect();
    stop.resolve(battery);
    await failed;
    expect(replacement.startNotifications).not.toHaveBeenCalled();
    await client.destroy();
  });

  it("can retry after a connection failure", async () => {
    const { device } = setup();
    device.gatt.connect.mockRejectedValueOnce(new Error("connection failed"));
    const client = new SenswearClient(device);
    await expect(client.connect()).rejects.toThrow("connection failed");
    await client.connect();
    expect(await client.isConnected()).toBe(true);
    await client.destroy();
  });

  it("cancels an open chooser without connecting after a late selection", async () => {
    const { device, bluetooth } = setup();
    const chooser = deferred<FakeDevice>();
    bluetooth.requestDevice.mockReturnValueOnce(chooser.promise);
    const client = new SenswearClient(null, { bluetooth });
    const failed = expect(client.connect()).rejects.toThrow(NotConnectedError);
    await client.destroy();
    await failed;
    chooser.resolve(device);
    await Promise.resolve();
    expect(device.gatt.connect).not.toHaveBeenCalled();
    expect(client.device).toBeNull();
  });

  it("times out GATT connections and closes a late connection", async () => {
    vi.useFakeTimers();
    const { device } = setup();
    const connection = deferred<WebBluetoothRemoteGATTServer>();
    device.gatt.connect.mockReturnValueOnce(connection.promise);
    const client = new SenswearClient(device, { timeoutMs: 20 });
    const failed = expect(client.connect()).rejects.toThrow(ConnectionTimeoutError);
    await vi.advanceTimersByTimeAsync(20);
    await failed;
    await expect(client.connect()).rejects.toThrow("still settling");
    device.gatt.connected = true;
    connection.resolve(device.gatt);
    await vi.advanceTimersByTimeAsync(0);
    expect(device.gatt.connected).toBe(false);
    await client.connect();
    expect(await client.isConnected()).toBe(true);
    await client.destroy();
  });

  it("does not apply the GATT timeout to a chooser", async () => {
    vi.useFakeTimers();
    const { device, bluetooth } = setup();
    const chooser = deferred<FakeDevice>();
    bluetooth.requestDevice.mockReturnValueOnce(chooser.promise);
    const client = new SenswearClient(null, { bluetooth, timeoutMs: 20 });
    const connection = client.connect();
    await vi.advanceTimersByTimeAsync(200);
    chooser.resolve(device);
    await connection;
    expect(await client.isConnected()).toBe(true);
    await client.destroy();
  });
});
