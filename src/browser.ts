/** Structural subsets of Web Bluetooth; native browser objects implement these interfaces.
 * No ambient globals or additional type packages are required by consumers.
 */
export interface WebBluetooth {
  requestDevice(options: WebBluetoothRequestOptions): Promise<WebBluetoothDevice>;
  getDevices?(): Promise<WebBluetoothDevice[]>;
  getAvailability?(): Promise<boolean>;
}

export interface WebBluetoothRequestOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: Array<string | number> }>;
  acceptAllDevices?: boolean;
  optionalServices?: Array<string | number>;
}

export interface WebBluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: WebBluetoothRemoteGATTServer;
}

export interface WebBluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<WebBluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<WebBluetoothRemoteGATTService>;
}

export interface WebBluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristic(characteristic: string | number): Promise<WebBluetoothRemoteGATTCharacteristic>;
}

export interface WebBluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly value?: DataView;
  readonly properties: {
    readonly read: boolean;
    readonly write: boolean;
    readonly writeWithoutResponse: boolean;
    readonly notify: boolean;
    readonly indicate: boolean;
  };
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>;
}
