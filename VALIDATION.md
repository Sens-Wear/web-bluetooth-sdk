# Validation

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
The test suite carries forward the React Native SDK 0.4.0 protocol/module tests and adds
browser chooser, permission, UUID, byte-view, GATT queue, notification, timeout,
disconnect, and reconnect tests using fake devices. Type checking also covers tests
and TypeScript examples. These checks do not validate physical Bluetooth hardware.

## Physical browser/device procedure

1. Build this SDK and serve its directory on localhost. Open `examples/browser.html`
   in a browser/OS with Web Bluetooth support. Repeat with the intended HTTPS host.
2. Click Connect and cancel the chooser. Check that the error is displayed and another
   click opens a fresh chooser. Select the expected SensWear device.
3. Read firmware version, capability flags, and battery level. Connect a base-only
   build and verify that missing daughter-board services do not prevent connection.
4. Change the LED color. On a haptic build, trigger one short vibration and confirm it.
5. Subscribe to battery notifications and enable IMU sampling. Check that acceleration
   samples arrive and that bigint timestamps retain their exact values.
6. On each matching shield build, exercise the PPG, touch, temperature and haptic
   methods from README. Confirm temperature measurement/interval indications and
   explicit write-with-response behavior. Compare bytes/units with the documented
   firmware layout. PPG is raw ADC data, not heart rate or SpO2.
7. Unsubscribe, subscribe again, and verify that each event is delivered once. Start
   concurrent reads/writes/subscriptions and verify no overlapping-GATT errors occur.
8. Power off or move the device out of range while streaming. Verify the disconnect
   callback, stopped streams, and rejected disconnected reads. Reconnect, restore
   subscriptions, and confirm fresh GATT handles and resumed streams.
9. Disconnect explicitly, reconnect the same client, then destroy it. Verify that
   destroyed clients reject new connections and that the UI offers a fresh client.
10. Reload the page and use `getGrantedDevices()` where supported. Test revoked browser
    permission and an offline device; show the original errors and offer the chooser.

No firmware images are built or flashed as part of this SDK port. No real device
connection is needed for the automated suite.
