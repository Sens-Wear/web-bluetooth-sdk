# SensWear Web Bluetooth SDK

TypeScript SDK for SensWear devices in web applications. It uses the browser's
Web Bluetooth API and exposes typed,
firmware-compatible interfaces for battery and charging state, clock synchronization,
temperature, IMU, PPG, touch, RGB LED, and haptic output.

This package, **senswear-web-bluetooth 0.4.0**, ports the React Native SDK 0.4.0 to browsers.
It preserves the device modules, parsers, encoders, UUIDs, enums, aliases, units, and exact
firmware wire layouts. There are no runtime dependencies, React requirements, native
bindings, Node polyfills, or changes to the React Native SDK. It explains
both the convenient TypeScript API and the exact values transported over Bluetooth, so it can
also be used when integrating another BLE stack.

## Changes in 0.4.0

`client.deviceInfo` reads the real firmware revision and compiled daughter-board
and feature flags. These new read-only endpoints leave existing sensor/actuator
payloads unchanged. Older firmware that omits them raises its GATT error; the
SDK does not invent a version or infer shields from advertised services.

## Changes in 0.3.0

The touch API documents the current 15-electrode linear strip and adds nullable
`positionNormalized` / `positionMm` helpers. Existing UUIDs, packet sizes, `x`/`y`
fields, gesture enums and compatibility aliases are unchanged. Old 2D packets are
still decoded without clamping; slider helpers return `null` for nonzero Y or X
outside the current strip range. The conversion requires the current slider firmware.

Temperature interval indications now have `subscribeMeasurementInterval()` and
`unsubscribeMeasurementInterval()` methods; `unsubscribeAll()` removes both
temperature monitors. Existing `temperature.unsubscribe()` removes measurement
indications only.

Typed time, temperature, IMU, PPG, touch and haptic writes now reject
`{ response: false }`, because those firmware characteristics advertise only Write.
Omit that option or use `true`. LED still supports Write Without Response, and the
low-level `writeGattChar()` remains available for other firmware and raw operations.

## Installation

```bash
# In this SDK directory:
npm ci
npm run build

# In your web application's directory, using the actual path to this SDK:
npm install /path/to/SDKs/WebBluetooth
```

The package is local; these instructions do not assume it is published to npm. You can also
run `npm pack` and install the resulting tarball into your application. Import from
`senswear-web-bluetooth` with Vite, React, Vue, Angular, or another browser bundler. The ESM
build also works directly in a `<script type="module">` via `dist/index.js`.

Node 18+ is required for development. At runtime use a browser/OS combination that exposes
`navigator.bluetooth` and supports JavaScript `bigint`. Check `SenswearClient.isSupported()`
in the browser. Imports and construction are safe during server rendering, but connections
must happen on the client. Chrome supports Web Bluetooth on Windows, macOS, ChromeOS, and
Android; other browser/platform combinations vary. See the current
[Chrome documentation](https://developer.chrome.com/docs/capabilities/bluetooth) and
[browser compatibility table](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility).

Use HTTPS in production or localhost for development. Call `connect()`, `requestDevice()`,
or `discover()` directly from a click/tap handler when opening the chooser. Do not await an
unrelated network call first. The browser owns device consent and chooser cancellation.
An embedded page also needs the appropriate Bluetooth Permissions Policy, for example
`allow="bluetooth"` on a permitted iframe. See the
[Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/).

## Quick start

```ts
import { SenswearClient } from "senswear-web-bluetooth";

const client = new SenswearClient(null, {
  onNotificationError(error, characteristicUuid) {
    console.error("Notification failed", characteristicUuid, error);
  },
  onDisconnected() {
    console.log("Disconnected; reconnect and subscribe again to resume streams.");
  },
});

document.querySelector("#connect")?.addEventListener("click", async () => {
  try {
    await client.connect(); // Opens the chooser on the first connection.
    console.log("Battery:", (await client.battery.read()).percent, "%");
    await client.led.set("#20A0FF");
  } catch (error) {
    console.error(error); // Includes chooser cancellation or denied permission.
  }
});

// Later: await client.disconnect(); // This client can reconnect.
// On disposal: await client.destroy(); // This client can no longer connect.
```

`disconnect()` removes subscriptions and cached GATT handles and closes the connection.
`destroy()` also releases the selected device reference. Neither revokes the browser's
stored permission. Use one active client per device because browser GATT connections are
shared. The runnable [browser demo](examples/browser.html) shows connection, metadata,
battery notifications, IMU streaming, RGB output, and haptics gated by firmware capabilities.

To try it, build the SDK, run `python -m http.server 8000 --bind 127.0.0.1` from this
directory, and open `http://localhost:8000/examples/browser.html` in a supported browser.

## Programming model

`SenswearClient` owns connection and GATT operations. Its typed modules are:

| Property | Capability |
|---|---|
| `deviceInfo` | Firmware revision and compiled shields/features |
| `battery` | Battery percentage |
| `power` | Battery presence, external power, charging state, charge level, faults |
| `time` | Read/set device UTC clock and read time metadata |
| `temperature` | Body-temperature indications and measurement interval |
| `imu` | Quaternion, acceleration, gyroscope, gesture, and activity |
| `ppg` | Red, infrared, and green optical ADC samples |
| `touch` | Touch coordinates, normalized gestures, and raw controller state |
| `led` | RGB output |
| `haptic` | Single vibrations and multi-frame patterns |

`client.charger` remains as a deprecated alias for `client.power`.

### Firmware revision and capabilities

```ts
import { DaughterBoard, DeviceFeature } from "senswear-web-bluetooth";

const info = await client.deviceInfo.read();
console.log(info.firmwareVersion);
console.log(info.capabilities.shields); // known DaughterBoard flags
if (info.capabilities.hasFeature(DeviceFeature.Ppg)) {
  const sample = await client.ppg.readRed();
}
console.log(info.capabilities.hasShield(DaughterBoard.Touch));
```

`readFirmwareVersion()` and `readCapabilities()` are also available separately.
`firmwareVersion` is the UTF-8 application version from the running firmware's
`VERSION` file, read from Device Information Service `180a`, characteristic
`2a26` (Read). This is independent of the SDK version. Invalid UTF-8, empty
revisions, and NUL bytes raise `ProtocolError`.

Capabilities use service `9b8e0001-6b7d-4e9f-9b0d-2d7f6e5a4c30`, characteristic
`9b8e0002-6b7d-4e9f-9b0d-2d7f6e5a4c30` (Read only). The exact packet is 9 bytes,
packed without padding; multibyte integers are unsigned little-endian. There
are no timestamps, units, or scale factors.

| Offset | Field | Wire type | Meaning |
|---|---|---|---|
| 0 | `protocolVersion` | uint8 | Schema version, currently 1 |
| 1 | `shieldMask` | uint32 | Compiled daughter-board shield flags |
| 5 | `featureMask` | uint32 | Firmware data/control feature flags |

`DaughterBoard` flags: `Haptic=1`, `Ppg=2`, `Temperature=4`, `Touch=8`.
`DeviceFeature` flags: `Imu=1`, `Led=2`, `Haptic=4`, `Ppg=8`, `Temperature=16`,
`Touch=32`, `Battery=64`, `Time=128`. Use feature flags to gate navigation or
operations. These values describe the firmware build, not physical attachment,
sensor health, or whether sampling is currently enabled. The PPG application
preset enables the temperature shield too and sets both shield bits.

`DeviceCapabilities.fromBytes()` accepts the standard SDK byte inputs and
rejects incorrect lengths or unsupported schema versions with `ProtocolError`.
All raw mask bits survive parsing; `unknownShieldMask` and `unknownFeatureMask`
expose future flags as unsigned numbers. `shields` lists known flags only.
`hasShield()` and `hasFeature()` accept flag combinations and require all
requested bits. No metadata is cached across connections. See the browser
[usage example](examples/readDeviceInfo.ts).

### Discovery and connection

```ts
// Inside a click handler:
const [found] = await SenswearClient.discover({ namePrefixes: ["Sens Wear", "SensWear"] });
const client = new SenswearClient(found.device, { timeoutMs: 10_000 });
await client.connect();
```

`discover()` opens the browser chooser and returns one selected device in an array; it
cannot scan silently or enumerate all nearby devices. Cancellation rejects with the
browser's original error. `requestDevice()` returns the selected browser device directly.
Each discovered result also has `device`, `id`, `name`, `address` (an alias for the opaque
browser ID), and `rssi: null`. Web Bluetooth does not expose MAC addresses or chooser RSSI.

The constructor accepts a browser device, discovered result, or an exact device name.
It also accepts an ID remembered by this SDK's `discover()`, `requestDevice()`, or
`getGrantedDevices()` on the same page/adapter. An unknown string is treated as a name,
never as a MAC address. With `null`, the user chooses a device matching the name prefixes.
`connect()` connects the GATT server; services and characteristics are discovered lazily
so devices without optional daughter boards still connect.

All `SENSWEAR_SERVICE_UUIDS` are included in chooser `optionalServices`. For custom firmware,
add `optionalServices: [customServiceUuid]`. `scanServiceUUIDs` adds advertised-service
filters to each name prefix; it does not grant access to unrelated custom services.
Set `namePrefixes: []` to filter only by services, or `acceptAllDevices: true` to explicitly
show all devices. Empty/contradictory filters are rejected.

Where supported, `await SenswearClient.getGrantedDevices()` returns previously permitted
SensWear devices without a chooser. Pass a returned device to the constructor to reconnect
after a reload. This is not a proximity scan: devices may be offline and connection can
fail. This API may be unavailable even where `requestDevice()` works; it then throws
`WebBluetoothUnavailableError` and the app can offer its Connect button again.

`timeoutMs` limits GATT connection time only, never the browser chooser. If a cancelled or
timed-out native connection is still settling, a new connection is rejected until it
settles; any late successful connection is closed. The SDK never reconnects automatically.
`onDisconnected(device)` signals unexpected disconnects. Reconnect explicitly, then restore
the desired subscriptions and configuration.

### Reads, writes, and subscriptions

Reads return typed objects:

```ts
const level = await client.battery.read();
console.log(level.percent);
```

Writes use a BLE write-with-response by default. Where a method accepts it, `{ response:
false }` selects write-without-response:

```ts
await client.led.set("#00FF40", { response: false });
```

Subscriptions parse every notification or indication before calling the application:

```ts
await client.imu.subscribeAccelerometer((sample) => {
  console.log(sample.timestampUs, sample.xG, sample.yG, sample.zG);
});

await client.imu.unsubscribe(IMU_ACCELEROMETER_UUID);
```

Only one subscription per characteristic is retained by a client. Starting it again replaces
the old listener. `disconnect()` removes every listener and disconnects GATT, which ends
both notifications and indications. Explicit `unsubscribe()` calls `stopNotifications()`.
The browser handles indication acknowledgements. Like the browser API, low-level value
listeners can also receive `characteristicvaluechanged` events triggered by reads.

Errors thrown while parsing notifications are sent to the module notification `onError` when
one is provided at the low-level API, otherwise to the client's `onNotificationError`.

GATT reads, writes, service discovery and subscription changes are queued to avoid
overlapping browser operations. Failed operations do not block later calls. Byte inputs
are copied before queued writes; reads and callbacks receive independent byte arrays.
The low-level notification sender is a `WebBluetoothRemoteGATTCharacteristic` with a
`DataView` value instead of a React Native characteristic containing base64.

Native-only options (`manager`, `scanOptions`, `connectionOptions`, `waitForPoweredOn`) and
`waitForPoweredOn()` are not available in this package: the browser controls its adapter,
permissions, MTU, and connection settings. `transactionId` remains accepted as a compatibility
label in low-level methods but has no cancellation effect. All typed module methods and
their validation rules below remain compatible with the React Native SDK.

## Data conventions

### Endianness

Every multibyte firmware value is little-endian. SDK users normally work with parsed fields;
the wire-layout tables below are included for protocol debugging and independent integrations.

### Timestamps

IMU and touch records contain signed 64-bit **microseconds**. PPG records contain unsigned
64-bit **milliseconds**. They are exposed as `bigint` (`timestampUs` or `timestampMs`) so no
integer precision is lost in JavaScript.

Each timestamped class also has a `timestamp: Date` convenience getter. `Date` only preserves
milliseconds and JavaScript numbers cannot exactly represent all 64-bit integers. Use the
`bigint` property for ordering, synchronization, or lossless storage.

Current Time and temperature timestamps are standard BLE calendar values interpreted as UTC.

### Units

| Field | Unit |
|---|---|
| `BatteryLevel.percent` | percent, integer 0–100 |
| `timestampUs` | microseconds |
| `timestampMs` | milliseconds |
| quaternion components | unitless Q14 converted to floating point |
| quaternion accuracy | radians; degrees convenience property also provided |
| accelerometer | g |
| gyroscope | raw firmware/BHI sample units |
| temperature | °C; °F convenience property also provided |
| PPG value | raw 18-bit ADC count |
| touch x | current linear shield: 0..896, 64 units per 3 mm electrode pitch |
| touch y | reserved zero on the current linear shield |
| IMU drain period | milliseconds |
| temperature interval | seconds |
| haptic duration | milliseconds |

Malformed lengths and encodings throw `ProtocolError`. Invalid application input normally
throws `RangeError` or `TypeError`.

## Battery level

The standard Bluetooth Battery Service provides remaining charge.

```ts
const level = await client.battery.read();
console.log(level.percent); // integer 0..100

await client.battery.subscribe((next) => {
  console.log(`${next.percent}%`);
});
await client.battery.unsubscribe();
```

`BatteryLevel.percent` is a percentage, not a fraction: `75` means 75%, not 0.75. The
firmware clamps reported values to 0–100.

| Item | Value |
|---|---|
| Service | `0x180F` Battery Service |
| Characteristic | `0x2A19` Battery Level |
| Operations | read, notify |
| Payload | one unsigned byte, 0–100 |

## Power and charging status

```ts
const status = await client.power.read();

console.log({
  batteryPresent: status.batteryPresent,
  wiredPower: status.wiredPower,
  wirelessPower: status.wirelessPower,
  chargeState: status.chargeState,
  chargeLevel: status.chargeLevel,
  batteryLevel: status.batteryLevel,
  chargingFault: status.chargingFault,
});

await client.power.subscribe((next) => console.log(next.toDict()));
```

This is the standard Battery Level Status characteristic. `batteryLevelPresent` tells you
whether the final byte is present semantically; current firmware sets that flag.

Enums:

| `PowerSourceState` | Value | Meaning |
|---|---:|---|
| `NotConnected` | 0 | source is not connected |
| `Connected` | 1 | source is connected |
| `Unknown` | 2 | state cannot be determined |
| `Reserved` | 3 | reserved encoding |

| `ChargeState` | Value | Meaning |
|---|---:|---|
| `Unknown` | 0 | charging state unknown |
| `Charging` | 1 | energy is entering the battery |
| `DischargingActive` | 2 | battery is powering an active device |
| `DischargingInactive` | 3 | battery is discharging while inactive |

| `ChargeLevel` | Value | Meaning |
|---|---:|---|
| `Unknown` | 0 | level category unknown |
| `Good` | 1 | normal charge |
| `Low` | 2 | low charge |
| `Critical` | 3 | critically low charge |

`chargeType` is the 3-bit standard charge-type field. `chargingFault` is the 4-bit standard
fault field. The current firmware maps its charger fault indication to the “other” reason bit;
applications should treat any nonzero `chargingFault` as a fault and retain the numeric value
for diagnostics.

Wire format (`<BHB>`, four bytes):

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `uint8` | flags; bit 1 means battery level is present |
| 1 | `uint16` | packed power state |
| 3 | `uint8` | battery percentage |

Packed `powerState`: bit 0 battery present; bits 1–2 wired source; 3–4 wireless source;
5–6 charge state; 7–8 charge level; 9–11 charge type; 12–15 charging fault.

## Device time

The device RTC uses the Bluetooth Current Time Service.

```ts
const current = await client.time.read();
console.log(current.value.toISOString(), current.adjustReason);

await client.time.set(new Date(), {
  adjustReason: AdjustReason.ExternalReference,
});

const local = await client.time.readLocalInformation();
console.log(local.utcOffsetMinutes); // number or null

const reference = await client.time.readReferenceInformation();
console.log(reference.accuracySeconds); // number or null
```

Dates passed to `set()` are serialized from their UTC fields. The firmware rejects dates
before 2020-01-01, and the SDK validates this before writing. `dayOfWeek` uses Bluetooth's
1=Monday through 7=Sunday convention. `fractions256` is the fractional second in units of
1/256 second.

`AdjustReason` is a bit field: `ManualUpdate=1`, `ExternalReference=2`,
`TimeZoneChange=4`, and `DstChange=8`. Values may be ORed together.

`LocalTimeInformation.timeZoneQuarterHours` is the UTC offset in 15-minute units; `-128`
means unknown. `utcOffsetMinutes` converts it and returns `null` for unknown. `dstOffset` is
the standard Bluetooth DST code; `255` means unknown.

`ReferenceTimeInformation.source` is the standard reference source code.
`accuracyEighthsSecond` is accuracy in 1/8 second; `255` means unknown.
`daysSinceUpdate` and `hoursSinceUpdate` are time since the last synchronization and use
`255` as unknown.

| Characteristic | UUID | Operations | Payload |
|---|---|---|---|
| Current Time | `0x2A2B` | read, write, notify | 10-byte calendar |
| Local Time Information | `0x2A0F` | read | signed zone byte + DST byte |
| Reference Time Information | `0x2A14` | read | source, accuracy, days, hours |

Current Time layout is little-endian year (`uint16`), then month, day, hour, minute, second,
day-of-week, fractions256, and adjust-reason bytes.

## Body temperature

Temperature Measurement is **indicate-only** in the firmware; it cannot be read directly.
Subscribe before waiting for a new measurement:

```ts
await client.temperature.subscribe((sample) => {
  console.log(sample.temperatureC);
  console.log(sample.temperatureF);
  console.log(sample.timestamp?.toISOString());
  console.log(sample.type); // TemperatureType.Body in current firmware
});

const type = await client.temperature.readTemperatureType();
const interval = await client.temperature.readMeasurementInterval();
await client.temperature.subscribeMeasurementInterval((seconds) => {
  console.log("Interval changed:", seconds);
});
await client.temperature.setMeasurementInterval(300);
// Removes both measurement and interval monitors:
await client.temperature.unsubscribeAll();
```

Interval indications contain a two-byte little-endian unsigned number of seconds.
`unsubscribeMeasurementInterval()` removes only that monitor; `unsubscribe()`
continues to remove temperature measurement indications only. The browser BLE
transport selects indications automatically from the characteristic properties.

`setMeasurementInterval(seconds)` accepts values the firmware can represent exactly:

- `0` disables scheduled measurements.
- Nonzero values must be whole-minute multiples from 60 through 65,520 seconds.
- Raw BLE writes with other nonzero values are rounded **up** by firmware, but the SDK rejects
  them so readback remains predictable.

`TemperatureType` values are: 1 armpit, 2 body, 3 ear, 4 finger, 5 gastrointestinal tract,
6 mouth, 7 rectum, 8 toe, and 9 tympanum.

Measurement wire format uses Bluetooth IEEE-11073 FLOAT:

| Field | Size | Current firmware |
|---|---:|---|
| flags | 1 | `0x06`: Celsius, timestamp present, type present |
| temperature | 4 | signed 24-bit mantissa + signed base-10 exponent |
| timestamp | 7 | year `uint16`, then month/day/hour/minute/second |
| type | 1 | body (`2`) |

The parser also handles legal packets where timestamp/type are absent or Fahrenheit is
selected, and always exposes `temperatureC`.

| Item | Value |
|---|---|
| Service | `0x1809` Health Thermometer |
| Measurement | `0x2A1C`, indicate |
| Temperature Type | `0x2A1D`, read |
| Measurement Interval | `0x2A21`, read/write/indicate |

## IMU

Physical streams are disabled after boot. Enable them before expecting quaternion,
accelerometer, or gyroscope data:

```ts
await client.imu.setEnabled(true);
console.log(await client.imu.isEnabled());

await client.imu.setDrainPeriodMs(100);
console.log(await client.imu.readDrainPeriodMs());
```

Quaternion, accelerometer, and gyroscope sampling is currently 100 Hz. `drainPeriodMs`
controls how often the firmware drains its FIFO and delivers accumulated samples; it changes
delivery latency/batching, **not** sensor sampling frequency. It must be nonzero.

Gesture and activity virtual sensors are event-driven and independent of the physical-stream
enable flag.

### Quaternion

```ts
await client.imu.subscribeQuaternion((q) => {
  console.log(q.timestampUs);
  console.log(q.x, q.y, q.z, q.w);
  console.log(q.accuracyRadians, q.accuracyDegrees);
});
```

Components and accuracy are Q14: raw / 16,384. `toTuple()` returns scaled `(x,y,z,w)`;
`toTuple({ normalized: false })` returns the signed raw integers. Accuracy is an angular
uncertainty, not a 0–100 quality score.

Payload `<qhhhhH>`: signed timestamp microseconds, signed x/y/z/w, unsigned accuracy.

### Accelerometer

```ts
await client.imu.subscribeAccelerometer((a) => {
  console.log(a.xG, a.yG, a.zG);
});
```

The firmware supplies the corrected wake-up accelerometer including gravity. Despite the
legacy 0.1 name “linear acceleration,” this is not gravity-removed linear acceleration.
Values are divided by 4096 to produce g. At rest, orientation permitting, one axis should be
near ±1 g.

Payload `<qhhh>`: timestamp microseconds then signed x/y/z.

### Gyroscope

```ts
await client.imu.subscribeGyroscope((g) => {
  console.log(g.x, g.y, g.z);
});
```

Gyroscope axes are exposed as signed raw firmware/BHI values because the firmware protocol
does not declare a physical scale. Do not label them degrees/second without applying a scale
established for the deployed firmware configuration.

### Gesture events

```ts
await client.imu.subscribeGesture((event) => {
  console.log(event.sensorId, event.gesture, event.timestampUs);
});
```

Normalized gesture values are `None=0`, `WristShake=3`, `FlickIn=4`, `FlickOut=5`.
Always inspect `sensorId`, because the same event channel can identify several virtual
sensors: any motion 142, wrist gesture 156, wrist wear 158, and no motion 159.

Payload `<qBB>`: timestamp, sensor ID, value.

### Activity events

```ts
await client.imu.subscribeActivity((event) => {
  console.log(event.activity, event.transition);
});
```

Activities: still 0, walking 1, running 2, bicycle 3, vehicle 4, tilting 5.
Transitions: ended 0, started 1. Wear-activity sensor ID is 154.

Payload `<qBBB>`: timestamp, sensor ID, activity, transition.

| Characteristic | UUID suffix | Size |
|---|---|---:|
| quaternion | `...6c11` | 18 |
| accelerometer | `...6c12` | 14 |
| gyroscope | `...6c13` | 14 |
| gesture | `...6c14` | 10 |
| activity | `...6c15` | 11 |
| stream enable | `...6c21` | 1 |
| drain period | `...6c22` | 4 |

Data service is `7d2b6c10-9d78-4f3c-a122-6d2c4e6d2a11`; configuration service uses
`...6c20`.

## PPG

The PPG interface exposes synchronized red, infrared, and green raw optical readings.
These are **ADC values**, not heart rate, oxygen saturation, absorbance, or calibrated light
intensity. Physiological metrics require signal-quality checks, filtering, motion-artifact
handling, calibration, and an application algorithm.

```ts
console.log(await client.ppg.isSamplingEnabled());
await client.ppg.setSamplingEnabled(true);

await client.ppg.subscribeRed((sample) => {
  console.log(sample.timestampMs, sample.value);
});
await client.ppg.subscribeIr(handleIr);
await client.ppg.subscribeGreen(handleGreen);
await client.ppg.unsubscribeAll();
```

Each `PpgSample.value` is a right-justified 18-bit value, normally 0–262,143. The wire field
is `uint32`; retain validation if receiving untrusted or mismatched firmware.

Current hardware configuration uses a 3200 Hz ADC rate with 16-sample averaging, producing
an effective 200 samples/second per color.

```ts
// IRQ cadence may only be changed while sampling is stopped.
await client.ppg.setSamplingEnabled(false);
await client.ppg.setPerSampleIrqEnabled(true);
await client.ppg.setSamplingEnabled(true);
```

Per-sample IRQ `false` allows batch/FIFO cadence; `true` requests an interrupt for each
effective sample. It changes delivery behavior, not the ADC data definition. Current firmware
boots with sampling enabled and per-sample IRQ disabled.

Every color payload is `<QI>`: unsigned timestamp milliseconds and unsigned ADC value.

| Channel/config | UUID |
|---|---|
| red | `029ca551-d022-4583-b483-91e9ea77034a` |
| infrared | `029ca552-d022-4583-b483-91e9ea77034a` |
| green | `029ca553-d022-4583-b483-91e9ea77034a` |
| sampling enable | `029ca561-d022-4583-b483-91e9ea77034a` |
| per-sample IRQ | `029ca562-d022-4583-b483-91e9ea77034a` |

Data and configuration services end in `...a54e...` and `...a560...`, respectively.

## Touch

The SensWear touch shield has 15 electrodes in one row. Firmware reads all channels
and computes position and gestures on the host. X increases from the connector
toward the tip; Y is retained in packets as a reserved zero field.

```ts
import { TOUCH_POSITION_MAX, TOUCH_LENGTH_MM } from "senswear-web-bluetooth";

await client.touch.subscribeState((state) => {
  if (state.positionNormalized !== null) {
    console.log(state.x, state.positionNormalized, state.positionMm);
  }
});
await client.touch.subscribeGesture((event) => {
  console.log(event.gesture, event.gestureState);
});
await client.touch.subscribeRaw((sample) => {
  // Use sample.touched for contact; touchState is a native controller diagnostic.
  console.log(sample.touched, sample.touchState);
});
await client.touch.setSamplingEnabled(true);
console.log(await client.touch.isSamplingEnabled());
// ... later, when the application no longer needs acquisition:
await client.touch.setSamplingEnabled(false);
await client.touch.unsubscribeAll();
```

Sampling starts disabled. Subscribing does not enable it. Stopping sampling puts
the controller in standby while leaving its supply powered; restarting resets
host gesture tracking. Idle frames need not produce notifications. Read methods
return the latest cached records, which may predate the current subscription or
be all zero before acquisition. Notifications are best-effort: transport congestion
may drop position and gesture events rather than block acquisition.

### Linear position

Both `TouchState` and `RawTouchSample` expose these values:

| Field/helper | Meaning |
|---|---|
| `timestampUs` | Signed 64-bit Unix microseconds, preserved as `bigint` |
| `timestamp` | Convenience `Date`; loses sub-millisecond precision |
| `touched` | Host-decoded contact presence |
| `x` | Unsigned coordinate, 0..896 across the current strip |
| `y` | Reserved zero in current firmware |
| `positionNormalized` | `x / 896`, or `null` for release/non-slider data |
| `positionMm` | `x * 3 / 64` mm from the first pad center, or `null` |

Pad centers are `0, 64, 128, ..., 896`; adjacent centers are 3 mm apart, spanning
42 mm from first to last center. Firmware already accounts for physical wiring,
including the swapped RX1/RX2 channels; applications must not swap them again.
Nominal millimeters use PCB pitch and do not imply calibrated touch accuracy.
Finger size, overlay and interpolation affect the result. Both coordinates are
zero when released; `touched=true, x=0` is a valid touch at the connector end.

Exported geometry constants are `TOUCH_ELECTRODE_COUNT=15`,
`TOUCH_ELECTRODE_PITCH=64`, `TOUCH_ELECTRODE_PITCH_MM=3`,
`TOUCH_POSITION_MAX=896`, and `TOUCH_LENGTH_MM=42`.
The nullable helpers require a touch, integer X in range, and Y=0. They leave
legacy/diagnostic packet fields unchanged instead of clamping or rejecting them.

### Host gestures

`gesture` is the normalized application value. `gestureState` carries the existing
MTCH6102 numeric encoding generated by the host decoder, not a native gesture
register read. Unknown values remain available as numbers.

| `TouchGesture` value | Meaning | `gestureState` |
|---:|---|---:|
| 0 | none | `0x00` |
| 1 | single click | `0x10` |
| 2 | click and hold | `0x11` |
| 3 | double click | `0x20` |
| 6 / 7 | right swipe / swipe and hold, toward the tip | `0x41` / `0x42` |
| 10 / 11 | left swipe / swipe and hold, toward the connector | `0x61` / `0x62` |

Legacy down values 4/5 (`0x31`/`0x32`) and up values 8/9 (`0x51`/`0x52`) stay
in the enum for compatibility; the linear firmware does not generate them.
Default host timing is 500 ms for hold, 250 ms for the double-tap window, and
320 ms stationary after a swipe for swipe-and-hold. Single taps wait for the
double-tap window before emission.

### Raw state and wire compatibility

The characteristic called raw touch data contains decoded position plus the
native `touchState` diagnostic byte. It does not contain the 15 electrode signals
or ADC measurements. Hardware TCH in that byte can disagree with host `touched`
on this one-dimensional board; use `touched` for application contact state.

`readState()`, `readGesture()` and `readRaw()` share parsers with their corresponding
subscriptions. Use `unsubscribeState()`, `unsubscribeGesture()`, `unsubscribeRaw()`
or `unsubscribeAll()` to stop monitors. Deprecated `TouchGestureEvent`,
`TouchRawState`, `isEnabled()` and `setEnabled()` aliases remain available.

All multibyte fields are little-endian. The unchanged layouts are:

| Data | Byte offsets | Size |
|---|---|---:|
| state | signed timestamp 0..7, bool 8, uint16 X 9..10, uint16 Y 11..12 | 13 |
| gesture | signed timestamp 0..7, uint8 gesture 8, uint8 gestureState 9 | 10 |
| raw | signed timestamp 0..7, bool 8, padding 9, uint16 X 10..11, uint16 Y 12..13, uint8 touchState 14, padding 15 | 16 |

Padding is ignored; exact packet lengths and boolean encodings are validated.
The service UUID is `33a5eb3f-0e13-424f-8b7a-942be0ee5cfc`; configuration uses
`33a5eb50-0e13-424f-8b7a-942be0ee5cfc`.

| Characteristic | UUID prefix (remaining fields as service) | Properties |
|---|---|---|
| state | `33a5eb42` | Read, Notify |
| gesture | `33a5eb43` | Read, Notify |
| raw | `33a5eb44` | Read, Notify |
| sampling enable | `33a5eb51` | Read, Write; one byte 0/1 |

## RGB LED

```ts
await client.led.set("#FF8000");
await client.led.set(0xFF8000);
await client.led.set([255, 128, 0]);
await client.led.set({ red: 255, green: 128, blue: 0 });
await client.led.setRgb(255, 128, 0);
await client.led.off();
```

Each component is an integer 0–255. The semantic integer is `0xRRGGBB`; on the little-endian
wire its four-byte `uint32` representation is `[BB, GG, RR, 00]`. Thus red is semantically
`0xFF0000` and transported as `[0x00, 0x00, 0xFF, 0x00]`.

The current hardware interface is RGB only. The fourth transport byte is reserved/zero; the
old SDK's RGBW interpretation was incorrect.

Service `3c688942-4143-470d-a798-4629803a1983`, characteristic
`3c688943-4143-470d-a798-4629803a1983`, operations read/write/write-without-response.

## Haptic actuator

```ts
await client.haptic.vibrate(200, 255);

await client.haptic.play([
  [100, 255], // vibration
  [50, 0],    // pause
  [150, 160], // softer vibration
]);
```

Every frame has:

- `durationMs`: integer 1–65,535 milliseconds.
- `intensity`: integer 0–255. Zero is a silent pause; 255 is maximum requested intensity.

A pattern must contain 1–32 frames. The firmware rejects an overlapping command while an
existing pattern is busy, so serialize patterns or wait at least `pattern.totalDurationMs`.

Payload:

| Offset | Type | Meaning |
|---:|---|---|
| 0 | `uint8` | version, currently 1 |
| 1 | `uint8` | flags, currently 0 |
| 2 | `uint16` | frame count |
| 4... | repeated `<HB>` | duration milliseconds, intensity |

Service `daa05e91-f514-4a4e-8fc5-d1b80f25f24d`, write characteristic ending `...5e92`.

## UUID index

| Interface | Service | Characteristic(s) |
|---|---|---|
| Battery | `180F` | level `2A19`, level status `2BED` |
| Time | `1805` | current `2A2B`, local `2A0F`, reference `2A14` |
| Thermometer | `1809` | measurement `2A1C`, type `2A1D`, interval `2A21` |
| IMU data | `7d2b6c10-9d78-4f3c-a122-6d2c4e6d2a11` | `...11` through `...15` |
| IMU config | same base ending `...6c20...` | enable `...21`, drain `...22` |
| PPG data | `029ca54e-d022-4583-b483-91e9ea77034a` | red `...551`, IR `...552`, green `...553` |
| PPG config | same base ending `...a560...` | enable `...561`, IRQ `...562` |
| Touch data | `33a5eb3f-0e13-424f-8b7a-942be0ee5cfc` | state `...42`, gesture `...43`, raw `...44` |
| Touch config | same base ending `...eb50...` | enable `...51` |
| LED | `3c688942-4143-470d-a798-4629803a1983` | color `...8943` |
| Haptic | `daa05e91-f514-4a4e-8fc5-d1b80f25f24d` | pattern `...5e92` |

All constants are exported from `senswear`, and `serviceUuidForCharacteristic()` maps each
known characteristic to its owning service.

## Migration from 0.1

Version 0.2 follows the new firmware and contains intentional breaking corrections:

- The proprietary power service was replaced by SIG Battery Level and Battery Level Status.
  `client.charger` is retained as an alias for `client.power`; legacy charger flag meanings
  and the 16-byte fuel-gauge payload no longer exist.
- Temperature now uses Health Thermometer indications and an interval in seconds. The old
  sampling-rate and transfer-interval methods were removed.
- IMU samples now begin with a 64-bit microsecond timestamp. Accelerometer data includes
  gravity. Gyroscope, gesture, activity, enable, and drain-period endpoints were added.
- PPG and touch modules were added.
- LED encoding is RGB `0xRRGGBB`, transported little-endian. The former RGBW layout was wrong.
- The haptic maximum is 32 frames, not 64.

Recompile application code and update assumptions about payload lengths, timestamps, units,
and LED byte order when moving from 0.1.

## End-to-end streaming example

Run this example inside a click handler, and only with firmware that exposes all three
streams. Keep the client and subscriptions alive while collecting samples; the final
unsubscribe/destroy block illustrates cleanup when your recording finishes.

```ts
import {
  IMU_ACCELEROMETER_UUID,
  PPG_RED_UUID,
  SenswearClient,
  TOUCH_STATE_UUID,
} from "senswear-web-bluetooth";

const client = new SenswearClient(null, {
  onNotificationError(error, uuid) {
    console.error(`BLE decode/monitor error on ${uuid}`, error);
  },
});

try {
  await client.connect();

  await client.imu.setEnabled(true);
  await client.imu.setDrainPeriodMs(100);
  await client.touch.setSamplingEnabled(true);
  await client.ppg.setSamplingEnabled(true);

  await client.imu.subscribeAccelerometer((a) => {
    persist({ kind: "accel", tUs: a.timestampUs.toString(), xG: a.xG, yG: a.yG, zG: a.zG });
  });
  await client.ppg.subscribeRed((p) => {
    persist({ kind: "ppg-red", tMs: p.timestampMs.toString(), adc: p.value });
  });
  await client.touch.subscribeState((t) => {
    persist({ kind: "touch", tUs: t.timestampUs.toString(), touched: t.touched, x: t.x, y: t.y });
  });

  // Later:
  await client.imu.unsubscribe(IMU_ACCELEROMETER_UUID);
  await client.ppg.unsubscribe(PPG_RED_UUID);
  await client.touch.unsubscribe(TOUCH_STATE_UUID);
} finally {
  await client.destroy();
}

function persist(record: unknown): void {
  console.log(record);
}
```

Convert `bigint` timestamps to strings before JSON serialization: native
`JSON.stringify()` does not serialize `bigint`.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Tests include exact firmware byte layouts, parsing, validation, module UUID routing, writes,
and notification callbacks. Browser transport tests use fake GATT devices; they do not
claim physical hardware validation. See [VALIDATION.md](VALIDATION.md) for the hardware checklist.
