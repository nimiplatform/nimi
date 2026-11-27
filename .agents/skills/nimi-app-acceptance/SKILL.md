---
name: nimi-app-acceptance
description: Verify real Nimi Home or App interactions on the requested desktop, Web, or Android surface and debug the matching renderer.
---

# Nimi Home and App acceptance

Verify the requested behavior in the real supported Home or App. Start from the affected consumer and its direct contract; use the applicable AGENTS.md chain and the target's package manifest to choose the existing launch command.

## Home and native desktop Apps

- Launch Home through its guarded Desktop package script and native desktop Apps through their guarded scripts with Desktop-supervised Electron. Attach to the exact product being tested: Home's CDP is valid for Home acceptance, but cannot substitute for an App's own renderer and permissions. Do not open a direct Vite renderer or use another product's target as a substitute.
- Generic `nimi-app dev` selects and prints an ephemeral loopback CDP port. When a stable port is needed, use `pnpm --filter <app-package> dev -- --cdp-port <free-port>` with the actual package and an available port.
- Root `pnpm dev:desktop` (9333), `dev:zhiyu` (9334), `dev:lab` (9335), `dev:avatar` (9336), and `dev:harness` (9337) own deterministic default ports. Generic dev may read the exact `NIMI_APP_DEV_CDP_PORT` override from the project `.env`; `--cdp-port` overrides either path and `--no-cdp` disables CDP.
- Keep CDP loopback-only, development-only, and ephemeral. Prefer the matching CDP target for Home and App web UI, including Home's trusted management pages. Use Computer Use for native windows, system dialogs, and behavior CDP cannot cover; being an owner UI alone is not a reason to exclude CDP.
- To resume existing development data, use the exact registration selected from Desktop's current registration list. After Desktop restarts, refresh that list to obtain its new selector; an expired selector does not mean the registration is gone. A plain `dev` launch requires an explicit selection when registrations already exist; non-interactive runs must pass `--resume`. Use `--new-registration` only when the task calls for separate App data. Never replace a rejected resume with new registration.

## Web Apps

Use the declared Web entry (`nimi-app dev --platform web` when supported) and its exact HTTPS origin. Official Runtime-client login, source admission and first PC Home confirmation remain real prerequisites. Operate the browser UI with DOM/CDP and reuse existing source approval; never inject a native bridge or treat local startup/build as successful AI consumption. Native registration selectors, installers and native launch checks do not apply to the Web carrier.

## Android Apps

Use the target App's documented mobile entry and exercise the requested action on the Android device. For Zhiyu sign-in, verify the system browser returns to the App through the registered HTTPS App Link when testing the official Realm. The private-use scheme applies only to explicitly selected local Realm development. Follow the [Zhiyu Android guide](../../../apps/zhiyu/README.md#android-普通开发与本地联调).

## Observe and complete

- Reproduce the reported behavior or exercise the newly requested interaction, repair failures within scope, and rerun the affected journey. A missing prerequisite blocks only dependent work.
- Use existing browser/CDP tooling for renderer controls and the target device for Android system interactions. Do not invoke private bridge or service interfaces, inject success, or bypass registration, authorization, or permission checks to replace the user journey. Do not add alternative CDP defaults, acceptance harnesses, Playwright projects, helper endpoints, recordings, fixtures, baselines, or evidence systems.
- Preserve native window sizing during ordinary Electron acceptance: do not set a fixed Playwright viewport or call `Emulation.setDeviceMetricsOverride`. A renderer-only size can leave the rest of the native window blank. Exercise responsive layouts by resizing the native window through its owner UI. If a specific test requires device emulation, clear the override with `Emulation.clearDeviceMetricsOverride` in `finally` before disconnecting, restore any other overrides introduced by the test, and verify that the renderer fills the native content area before handoff.
- Run checks that cover the changed behavior. CDP visibility, screenshots, and fixture output do not establish the full product result.
- Report the observed outcome and mark relevant unexecuted paths `NOT-VERIFIED`. Put any necessary local artifacts under `.nimi/local/**`.
