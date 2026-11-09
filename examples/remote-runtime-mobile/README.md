# Native remote Runtime carrier

This package is the first native portion of the shared remote Runtime implementation: a real `react-native-webrtc` peer/channel adapter and the platform CSPRNG initialization. It does not run a local Runtime, relay AI, assert an App role or change business permissions.

Pass `createReactNativeRuntimePeer` as `peerFactory` to the SDK's `connectRemoteRuntime` after completing an admitted native client's official-browser login. It uses the same scoped identity, primary discovery, protobuf frames, own AIConfig and AI clients as Web. A Nimi-only app uses a local sign-in-attempt generation for `currentUserContext`; only the verified Realm result establishes its Nimi identity. Native packages must actually link both native dependencies; a JavaScript import alone is insufficient.

The current public Registry carrier admits Web sources only. Native App Link/source qualification, the reference application's Android shell, secure callback/session custody and native build remain separate implementation work. Do not reuse a Web registration or a self-declared native flag to pretend those steps are complete.

Install this reference as a standalone package, outside the root desktop/web pnpm workspace. React Native's optional peer dependencies must not change existing desktop/web package resolution. During local development, select the complete SDK tarball with a pnpm override, as for the Web reference. The current archive may expose APIs not yet present in the published SDK of the same version; reinstall when the archive changes.

`pnpm check` verifies this adapter against the actual upstream React Native/WebRTC declarations and public SDK. It is not an APK build, live native WebRTC test or mobile acceptance. Android development continues; user-operated USB/device tests are paused. Device paths remain **NOT-VERIFIED** in the existing RRA plan packet.

Upstream native integration: https://github.com/react-native-webrtc/react-native-webrtc . The package requires a native build and cannot run in an ordinary browser preview or Expo Go.
