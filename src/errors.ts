export class SenswearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DeviceNotFoundError extends SenswearError {}

export class NotConnectedError extends SenswearError {}

export class ProtocolError extends SenswearError {}

export class WebBluetoothUnavailableError extends SenswearError {}

export class ConnectionTimeoutError extends SenswearError {}
