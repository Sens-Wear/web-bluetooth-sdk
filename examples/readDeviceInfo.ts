import { DeviceFeature, SenswearClient } from "senswear-web-bluetooth";

/** Call directly from a click/tap handler in a supported browser. */
export async function readDeviceInfo(): Promise<void> {
  const client = new SenswearClient();
  try {
    await client.connect();
    const info = await client.deviceInfo.read();
    console.log("Firmware:", info.firmwareVersion);
    console.log("Firmware shields:", info.capabilities.shields);
    console.log("PPG supported:", info.capabilities.hasFeature(DeviceFeature.Ppg));
  } finally {
    await client.destroy();
  }
}
