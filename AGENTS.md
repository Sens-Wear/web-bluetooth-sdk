# SensWear Web Bluetooth SDK

This is the browser port of the SensWear React Native TypeScript SDK 0.4.0.
Keep the company spelling SensWear. Firmware under `../../firmware/src/bluetooth`
is the protocol source of truth. Do not alter other repositories without task scope.

- `src/client.ts` owns browser discovery, connections, serialized GATT work and cleanup.
- `src/browser.ts` exports structural browser types without adding ambient globals.
- `src/modules/`, `src/binary.ts` and `src/uuids.ts` preserve the native SDK protocol.
- Preserve public module APIs, exact payload sizes, endianness, and bigint timestamps.
- Use strict TypeScript, two-space indentation, double quotes and semicolons.
- Use `.js` extensions in relative source imports so the emitted ESM works in browsers.
- Do not add React Native bindings or Node runtime dependencies/polyfills.
- All known services must remain in chooser optionalServices. The browser chooser
  requires user activation; do not insert asynchronous work ahead of requestDevice.
- Invalidate GATT handles and subscriptions on disconnect. Check connection generation
  after asynchronous work so stale operations cannot affect a new connection.
- Run `npm run typecheck`, `npm test`, and `npm run build` after transport changes.
- Never hand-edit generated `dist/` or `node_modules/` files.
- Do not publish or connect to hardware unless requested. Document hardware checks
  in VALIDATION.md and distinguish mocked tests from hardware validation.
