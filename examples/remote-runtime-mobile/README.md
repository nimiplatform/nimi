# Native remote Runtime carrier

This package is the first native portion of the shared remote Runtime implementation: a real `react-native-webrtc` peer/channel adapter and the platform CSPRNG initialization. It does not run a local Runtime, relay AI, assert an App role or change business permissions.

Pass `createReactNativeRuntimePeer` as `peerFactory` to the SDK's `connectRemoteRuntime` after completing an admitted native client's official-browser login. It uses the same scoped identity, primary discovery, protobuf frames, own AIConfig and AI clients as Web. A Nimi-only app uses a local sign-in-attempt generation for `currentUserContext`; only the verified Realm result establishes its Nimi identity. Native packages must actually link both native dependencies; a JavaScript import alone is insufficient.

This package is only a React Native byte-carrier adapter, not a complete Android app. The maintained Android container integration lives in Kit `auth/app/mobile` and is used by [Zhiyu](../../apps/zhiyu/README.md#android-本机开发). Because this example does not include a native login or callback shell, you still need a valid mobile source registration: `android-app-link` for distributed builds, or `android-dev-scheme` strictly for local non-production development. Do not reuse a Web registration or rely on a self-declared native flag. Public Registry admission and release availability must be established for your actual app source rather than inferred from this adapter. For the complete setup, see the [Android guide](../../docs/start/connect-android-app.md).

Install this reference as a standalone package, outside the root desktop/web pnpm workspace. React Native's optional peer dependencies must not change existing desktop/web package resolution. During local development, select the complete SDK tarball with a pnpm override, as for the Web reference. The current archive may expose APIs not yet present in the published SDK of the same version; reinstall when the archive changes.

`pnpm check` only validates this adapter against the upstream React Native/WebRTC declarations and the public SDK. It does not build an APK, run a live native WebRTC test, or replace mobile acceptance. For mobile acceptance, validate the native binding, admitted source, and device and network paths on your target build; any device path you have not run remains **NOT-VERIFIED**.

Upstream native integration: https://github.com/react-native-webrtc/react-native-webrtc . The package requires a native build and cannot run in an ordinary browser preview or Expo Go.
