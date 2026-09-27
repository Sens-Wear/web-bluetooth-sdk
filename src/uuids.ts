// Bluetooth SIG Device Information and custom firmware capabilities.
export const DEVICE_INFORMATION_SERVICE_UUID = "180a";
export const FIRMWARE_REVISION_UUID = "2a26";
export const DEVICE_CAPABILITIES_SERVICE_UUID = "9b8e0001-6b7d-4e9f-9b0d-2d7f6e5a4c30";
export const DEVICE_CAPABILITIES_UUID = "9b8e0002-6b7d-4e9f-9b0d-2d7f6e5a4c30";

// Bluetooth SIG services and characteristics.
export const BATTERY_SERVICE_UUID = "180f";
export const BATTERY_LEVEL_UUID = "2a19";
export const BATTERY_LEVEL_STATUS_UUID = "2bed";

export const CURRENT_TIME_SERVICE_UUID = "1805";
export const CURRENT_TIME_UUID = "2a2b";
export const LOCAL_TIME_INFORMATION_UUID = "2a0f";
export const REFERENCE_TIME_INFORMATION_UUID = "2a14";

export const HEALTH_THERMOMETER_SERVICE_UUID = "1809";
export const TEMPERATURE_MEASUREMENT_UUID = "2a1c";
export const TEMPERATURE_TYPE_UUID = "2a1d";
export const MEASUREMENT_INTERVAL_UUID = "2a21";

// SensWear services and characteristics.
export const LED_SERVICE_UUID = "3c688942-4143-470d-a798-4629803a1983";
export const LED_COLOR_UUID = "3c688943-4143-470d-a798-4629803a1983";

export const IMU_SERVICE_UUID = "7d2b6c10-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_QUATERNION_UUID = "7d2b6c11-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_ACCELEROMETER_UUID = "7d2b6c12-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_GYROSCOPE_UUID = "7d2b6c13-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_GESTURE_UUID = "7d2b6c14-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_ACTIVITY_UUID = "7d2b6c15-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_CONFIG_SERVICE_UUID = "7d2b6c20-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_ENABLE_UUID = "7d2b6c21-9d78-4f3c-a122-6d2c4e6d2a11";
export const IMU_DRAIN_PERIOD_UUID = "7d2b6c22-9d78-4f3c-a122-6d2c4e6d2a11";

export const PPG_SERVICE_UUID = "029ca54e-d022-4583-b483-91e9ea77034a";
export const PPG_RED_UUID = "029ca551-d022-4583-b483-91e9ea77034a";
export const PPG_IR_UUID = "029ca552-d022-4583-b483-91e9ea77034a";
export const PPG_GREEN_UUID = "029ca553-d022-4583-b483-91e9ea77034a";
export const PPG_CONFIG_SERVICE_UUID = "029ca560-d022-4583-b483-91e9ea77034a";
export const PPG_SAMPLING_ENABLE_UUID = "029ca561-d022-4583-b483-91e9ea77034a";
export const PPG_PER_SAMPLE_IRQ_UUID = "029ca562-d022-4583-b483-91e9ea77034a";

export const TOUCH_SERVICE_UUID = "33a5eb3f-0e13-424f-8b7a-942be0ee5cfc";
export const TOUCH_STATE_UUID = "33a5eb42-0e13-424f-8b7a-942be0ee5cfc";
export const TOUCH_GESTURE_UUID = "33a5eb43-0e13-424f-8b7a-942be0ee5cfc";
export const TOUCH_RAW_DATA_UUID = "33a5eb44-0e13-424f-8b7a-942be0ee5cfc";
export const TOUCH_CONFIG_SERVICE_UUID = "33a5eb50-0e13-424f-8b7a-942be0ee5cfc";
export const TOUCH_SAMPLING_ENABLE_UUID = "33a5eb51-0e13-424f-8b7a-942be0ee5cfc";

export const HAPTIC_SERVICE_UUID = "daa05e91-f514-4a4e-8fc5-d1b80f25f24d";
export const HAPTIC_PATTERN_UUID = "daa05e92-f514-4a4e-8fc5-d1b80f25f24d";

// Compatibility aliases retained for applications built with 0.1.x.
export const IMU_LINEAR_ACCELERATION_UUID = IMU_ACCELEROMETER_UUID;
export const TEMPERATURE_SERVICE_UUID = HEALTH_THERMOMETER_SERVICE_UUID;
export const TEMPERATURE_SAMPLE_UUID = TEMPERATURE_MEASUREMENT_UUID;
export const PPG_INFRARED_UUID = PPG_IR_UUID;
export const PPG_SAMPLE_ENABLE_UUID = PPG_SAMPLING_ENABLE_UUID;
export const TOUCH_RAW_UUID = TOUCH_RAW_DATA_UUID;
export const TOUCH_ENABLE_UUID = TOUCH_SAMPLING_ENABLE_UUID;

const CHARACTERISTIC_SERVICE_UUIDS: Record<string, string> = {
  [FIRMWARE_REVISION_UUID]: DEVICE_INFORMATION_SERVICE_UUID,
  [DEVICE_CAPABILITIES_UUID]: DEVICE_CAPABILITIES_SERVICE_UUID,
  [BATTERY_LEVEL_UUID]: BATTERY_SERVICE_UUID,
  [BATTERY_LEVEL_STATUS_UUID]: BATTERY_SERVICE_UUID,
  [CURRENT_TIME_UUID]: CURRENT_TIME_SERVICE_UUID,
  [LOCAL_TIME_INFORMATION_UUID]: CURRENT_TIME_SERVICE_UUID,
  [REFERENCE_TIME_INFORMATION_UUID]: CURRENT_TIME_SERVICE_UUID,
  [TEMPERATURE_MEASUREMENT_UUID]: HEALTH_THERMOMETER_SERVICE_UUID,
  [TEMPERATURE_TYPE_UUID]: HEALTH_THERMOMETER_SERVICE_UUID,
  [MEASUREMENT_INTERVAL_UUID]: HEALTH_THERMOMETER_SERVICE_UUID,
  [LED_COLOR_UUID]: LED_SERVICE_UUID,
  [IMU_QUATERNION_UUID]: IMU_SERVICE_UUID,
  [IMU_ACCELEROMETER_UUID]: IMU_SERVICE_UUID,
  [IMU_GYROSCOPE_UUID]: IMU_SERVICE_UUID,
  [IMU_GESTURE_UUID]: IMU_SERVICE_UUID,
  [IMU_ACTIVITY_UUID]: IMU_SERVICE_UUID,
  [IMU_ENABLE_UUID]: IMU_CONFIG_SERVICE_UUID,
  [IMU_DRAIN_PERIOD_UUID]: IMU_CONFIG_SERVICE_UUID,
  [PPG_RED_UUID]: PPG_SERVICE_UUID,
  [PPG_IR_UUID]: PPG_SERVICE_UUID,
  [PPG_GREEN_UUID]: PPG_SERVICE_UUID,
  [PPG_SAMPLING_ENABLE_UUID]: PPG_CONFIG_SERVICE_UUID,
  [PPG_PER_SAMPLE_IRQ_UUID]: PPG_CONFIG_SERVICE_UUID,
  [TOUCH_STATE_UUID]: TOUCH_SERVICE_UUID,
  [TOUCH_GESTURE_UUID]: TOUCH_SERVICE_UUID,
  [TOUCH_RAW_DATA_UUID]: TOUCH_SERVICE_UUID,
  [TOUCH_SAMPLING_ENABLE_UUID]: TOUCH_CONFIG_SERVICE_UUID,
  [HAPTIC_PATTERN_UUID]: HAPTIC_SERVICE_UUID,
};

export function serviceUuidForCharacteristic(characteristicUuid: string): string {
  const key = characteristicUuid.toLowerCase().replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/, "$1");
  const serviceUuid = CHARACTERISTIC_SERVICE_UUIDS[key];
  if (serviceUuid === undefined) {
    throw new Error(`No SensWear service UUID is registered for characteristic ${characteristicUuid}.`);
  }
  return serviceUuid;
}

/** Web Bluetooth accepts canonical UUID strings, not strings such as "180f". */
export function normalizeGattUuid(uuid: string): string {
  const value = uuid.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(value) || /^[0-9a-f]{8}$/.test(value)) {
    return `${value.padStart(8, "0")}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    return value;
  }
  throw new TypeError(`Invalid GATT UUID: ${uuid}. Use a hexadecimal 16/32-bit or full UUID.`);
}

/** Request these permissions even when optional daughter-board services are absent. */
export const SENSWEAR_SERVICE_UUIDS: readonly string[] = Object.freeze(
  [...new Set(Object.values(CHARACTERISTIC_SERVICE_UUIDS).map(normalizeGattUuid))],
);
