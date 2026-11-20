<!-- nimi-docs: {"authority":["rule.nimi.platform.remote-clients.android-registration","rule.nimi.platform.remote-clients.android-development","rule.nimi.platform.ui-design-system.android-app-session","rule.nimi.zhiyu.local-partner-surface.android-entry","rule.nimi.platform.app-ecosystem.mobile-development-entry"],"sources":["kit/package.json","kit/auth/src/app/mobile.ts","kit/auth/android","apps/zhiyu/src/mobile/main.tsx","apps/zhiyu/capacitor.config.ts","apps/zhiyu/android","app-tools/lib/mobile-development.mjs"]} -->

# Connect an Existing Android App

Android 12+ Apps connect to your primary PC Runtime through the Kit Capacitor container, using the same remote Runtime protocol as Web. Zhiyu (`apps/zhiyu`) is the reference implementation.

To work with this path, install matching versions from the npm `pre` channel—App Tools `0.16.0-rc.9`, SDK `0.24.0-rc.10`, and Kit `0.24.0-rc.16` (separate from `latest`)—alongside a compatible host. See [Install](/start/install) for setup details. Having these `pre` packages published lets you build and test locally, but it does not mean every Android or App Link path is end-to-end verified.

There is currently no `create --platform mobile` scaffold and no App Tools APK or store publishing pipeline. Native project setup, signing, device access, and build tooling remain App-owned.

## Choose Your Realm and Callback Carrier

Ordinary Android debug builds default to the **official Realm** and an OS-verified **HTTPS App Link** using your actual debug package name and debug signing certificate—you do not need a release APK. You only use the local development Scheme when you explicitly target a local non-production Realm with `--realm local`.

| Mode | Callback carrier | What you need |
| --- | --- | --- |
| Default (including Android debug builds) | `android-app-link` | Admitted package name and signing certificate (debug or release), HTTPS callback, Digital Asset Links on your domain, and an OS-verified App Link |
| Explicit `--realm local` | `android-dev-scheme` | Debug build, registered package name and signing fingerprint, exact private-use callback Scheme, and a non-production local Realm configured with a maintainer-reviewed local Registry |

Keep two security boundaries in mind:

- `android-dev-scheme` does not verify domain ownership. The official production Realm and public Registry reject it, and Kit never falls back automatically between carriers.
- Both carriers use the official system-browser sign-in flow, PKCE/state verification, and the same permission model.

## Wire Up Your Android Project

Start with an existing native Android project that includes the Capacitor `App`, `Browser`, and `NimiAppAccess` plugins.

1. Import `createMobileNimiAppSession` from Kit's `auth/app/mobile`.
2. Configure the exact same admitted client and Realm in both the session factory and `plugins.NimiAppAccess`.
3. Set `loggingBehavior: 'none'` so the native bridge disables Capacitor bridge logging. The adapter checks the installed package name, signing certificate, and selected callback carrier at runtime.
4. Add a real `dev:android` script in `package.json`, then declare `local_development.mobile.command: pnpm run dev:android` in `nimi.app.yaml`.

Running `nimi-app dev --platform mobile` delegates directly to that script. Desktop options such as `--resume`, registration selectors, and CDP flags do not apply.

## Run the Zhiyu Reference App

Follow the [Zhiyu README](https://github.com/nimiplatform/nimi/blob/main/apps/zhiyu/README.md#android-普通开发与本地联调) to prepare the required JDK, Android SDK, and signing configuration.

On an ordinary development machine, you do not need to run a local Realm. Just run your installed, compatible Nimi Home and primary PC Runtime: make sure the PC is bound as the primary host, remote access is enabled, and the Android source is admitted and confirmed in Home. (Only start a local Realm and local login site if you plan to pass `--realm local`.)

From `apps/zhiyu`, run `pnpm dev:mobile`. It builds and syncs the Android project, then launches the app.

For an explicitly configured local non-production Realm, set up the login and coordination ports on the authorized USB device before starting in local mode:

```bash
adb -d reverse tcp:3000 tcp:3000
adb -d reverse tcp:3002 tcp:3002
pnpm dev:mobile -- --realm local
```

AI traffic and file transfers still travel over a direct phone-to-PC peer connection, so working reverse ports do not prove that the business connection works.

On your physical device, complete system-browser sign-in and the callback, connect to the primary Runtime, open an existing partner, and send a real message. The shared renderer shows the host's existing Conversation and memory without creating an Android-owned Agent. Native Desktop Avatar launch and native package placement remain unavailable on Android.

## Handle Lifecycle and Verify on a Real Device

Mobile connections follow strict session boundaries:

- Moving the App to the background closes the active connection.
- Returning to the foreground rechecks identity before rebuilding a previously active connection; it never replays messages or resumes an interrupted stream.
- If the short-lived login transaction or in-memory context is lost, the user may need to sign in again.
- Signing out clears only this App's session and leaves the PC Home account signed in.

Before calling an integration ready, test it on the actual target device and source: sign-in and callback, direct peer connection, a real Conversation round-trip, source pause or disconnect, and background/foreground transitions. Keep notes on the package and source revision, signing certificate, Android version, host state, and network setup.

Passing typechecks, building an APK, or succeeding with `android-dev-scheme` does not validate a real HTTPS App Link or public-network path. Keep any untested App Link, production-source, or public-network scenario marked `NOT-VERIFIED` until you run it end to end. iOS requires its own adapter implementation.
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
