<!-- nimi-docs: {"authority":["rule.nimi.platform.remote-clients.android-registration","rule.nimi.platform.remote-clients.android-development","rule.nimi.platform.ui-design-system.android-app-session","rule.nimi.zhiyu.local-partner-surface.android-entry","rule.nimi.platform.app-ecosystem.mobile-development-entry"],"sources":["kit/package.json","kit/auth/src/app/mobile.ts","kit/auth/android","apps/zhiyu/src/mobile/main.tsx","apps/zhiyu/capacitor.config.ts","apps/zhiyu/android","app-tools/lib/mobile-development.mjs"]} -->

# Connect an Existing Android App

The current Android 12+ path uses the Kit Capacitor container and the same remote Runtime protocol as Web. Zhiyu is the reference App. Use the [matching source packages and host](/start/install); there is no `create --platform mobile` scaffold or App Tools APK/store publication path.

## Choose the Callback Carrier

| Carrier | Prerequisites |
| --- | --- |
| Local `android-dev-scheme` | Debug installation, registered package and signing fingerprint, exact private-use callback, and a reviewed local Registry explicitly configured in non-production Realm |
| Distributed `android-app-link` | Signed App, admitted package/certificate and HTTPS callback, publisher-controlled Digital Asset Links and an OS-verified App Link |

The development Scheme is not a substitute for domain verification. Production Realm and the public Registry reject that development source kind; Kit never automatically falls back between carriers. Both use official system-browser login, PKCE/state checks and the same business permission owners.

## Prepare the App

Use an existing native project with the required Capacitor App, Browser and NimiAppAccess plugins. Kit `auth/app/mobile` supplies `createMobileNimiAppSession`. Configure the exact admitted client and Realm in the factory and `plugins.NimiAppAccess`; set `loggingBehavior: 'none'` to prevent native bridge payload logging. The adapter validates installed package/signature and the selected callback carrier.

Declare a real App-owned `dev:android` script and `local_development.mobile.command: pnpm run dev:android` in `nimi.app.yaml`. `nimi-app dev --platform mobile` delegates that script. Desktop `--resume`, registration selectors and CDP flags do not apply. Native project setup, signing, device access and build tools remain App-owned.

## Run the Zhiyu Reference

Prepare the JDK/Android SDK versions and signing configuration described in the [Zhiyu README](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md#android-本机开发). Start the configured Realm, official login site and Nimi Home. The PC must be the bound primary host, remote access must be enabled, and the Android source must be admitted and confirmed in Home.

From `apps/zhiyu`:

```bash
pnpm build:mobile
pnpm sync:android
pnpm dev:mobile
```

For local USB development only, an authorized device can use `adb -d reverse tcp:3000 tcp:3000` and `adb -d reverse tcp:3002 tcp:3002` for official login and coordination. AI and files still use the direct phone-to-PC peer connection, so those reverse ports do not prove that the business connection works.

Complete system-browser login and the callback on the actual device. Connect to the primary Runtime, open an existing partner and send a real message. The shared renderer displays the host's existing Conversation and memory; it does not create an Android-owned Agent. Native Desktop Avatar launch and native package placement remain unavailable.

## Lifecycle and Acceptance

Backgrounding ends the old connection. Returning to the foreground rechecks identity before reconnecting an earlier active connection; it never replays a message or resumes the old stream. Losing the short login transaction or in-memory context can require a new sign-in. Signing out ends this App context, not the PC Home account.

Verify login/callback, direct connection, an actual Conversation result, source pause or disconnect, and foreground/background behavior with the selected source and device. Record package/source revision, signature, Android version, host and network conditions. Typechecking, a built APK or a successful development Scheme does not establish distributed App Link acceptance. Keep unrun App Link, production-source and public-network paths `NOT-VERIFIED` until tested; iOS requires its own implemented adapter.

## Source Basis

- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`.nimi/spec/zhiyu/local-partner-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/zhiyu/local-partner-surface.authority.yaml)
- [`apps/zhiyu/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md)
- [`apps/zhiyu/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/package.json)
- [`apps/zhiyu/capacitor.config.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/capacitor.config.ts)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
- [`kit/auth/src/app/mobile.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/src/app/mobile.ts)
- [`app-tools/lib/mobile-development.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/mobile-development.mjs)
