# Native remote Runtime carrier

This package is the first native portion of the shared remote Runtime implementation: a real `react-native-webrtc` peer/channel adapter and the platform CSPRNG initialization. It does not run a local Runtime, relay AI, assert an App role or change business permissions.

Pass `createReactNativeRuntimePeer` as `peerFactory` to the SDK's `connectRemoteRuntime` after completing an admitted native client's official-browser login. It uses the same scoped identity, primary discovery, protobuf frames, own AIConfig and AI clients as Web. A Nimi-only app uses a local sign-in-attempt generation for `currentUserContext`; only the verified Realm result establishes its Nimi identity. Native packages must actually link both native dependencies; a JavaScript import alone is insufficient.

This package is a React Native byte-carrier adapter, not a complete Android App. The maintained Android container path is Kit `auth/app/mobile`, consumed by [Zhiyu](../../apps/zhiyu/README.md#android-本机开发). Platform source contracts admit distributed `android-app-link` and explicitly local non-production `android-dev-scheme` sources; this reference does not implement the corresponding native login/callback shell. Do not reuse a Web registration or a self-declared native flag. Public Registry admission and release availability must be established for the exact source, not inferred from this adapter. See the [Android guide](../../docs/start/connect-android-app.md).

Install this reference as a standalone package, outside the root desktop/web pnpm workspace. React Native's optional peer dependencies must not change existing desktop/web package resolution. During local development, select the complete SDK tarball with a pnpm override, as for the Web reference. The current archive may expose APIs not yet present in the published SDK of the same version; reinstall when the archive changes.

`pnpm check` verifies this adapter against the actual upstream React Native/WebRTC declarations and public SDK. It is not an APK build, live native WebRTC test or mobile acceptance. Validate the actual native binding, admitted source and device/network path for the selected build; unrun device paths remain **NOT-VERIFIED**.

Upstream native integration: https://github.com/react-native-webrtc/react-native-webrtc . The package requires a native build and cannot run in an ordinary browser preview or Expo Go.
