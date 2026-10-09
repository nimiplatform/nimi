---
name: nimi-app-acceptance
description: Run real Nimi Home or Desktop-supervised App acceptance and debug the matching renderer. Use when the task requires Home or App interaction or renderer observation.
---

# Nimi Home and App acceptance

Verify the requested behavior in the real supported Home or App. Start from the affected consumer and its direct contract; use the applicable AGENTS.md chain and the target's package manifest to choose the existing launch command.

## Launch and target

- Launch Home through its guarded Desktop package script and Apps through their guarded scripts with Desktop-supervised Electron. Attach to the exact product being tested: Home's CDP is valid for Home acceptance, but cannot substitute for an App's own renderer and permissions. Do not open a direct Vite renderer or use another product's target as a substitute.
- Generic `nimi-app dev` selects and prints an ephemeral loopback CDP port. When a stable port is needed, use `pnpm --filter <app-package> dev -- --cdp-port <free-port>` with the actual package and an available port.
- Root `pnpm dev:desktop`, `dev:zhiyu`, `dev:lab`, and `dev:avatar` own deterministic default ports. Generic dev may read the exact `NIMI_APP_DEV_CDP_PORT` override from the project `.env`; `--cdp-port` overrides either path and `--no-cdp` disables CDP.
- Keep CDP loopback-only, development-only, and ephemeral. Prefer the matching CDP target for Home and App web UI, including Home's trusted management pages. Use Computer Use for native windows, system dialogs, and behavior CDP cannot cover; being an owner UI alone is not a reason to exclude CDP.
- To resume existing development data, use the exact registration selected from Desktop's current registration list. After Desktop restarts, refresh that list to obtain its new selector; an expired selector does not mean the registration is gone. A plain `dev` launch requires an explicit selection when registrations already exist; non-interactive runs must pass `--resume`. Use `--new-registration` only when the task calls for separate App data. Never replace a rejected resume with new registration.

## Observe and complete

- Reproduce the reported behavior or exercise the newly requested interaction, repair failures within scope, and rerun the affected journey. A missing prerequisite blocks only dependent work.
- Use existing browser/CDP tooling to observe and operate the formal UI controls. Do not invoke private bridge or service interfaces, inject success, or bypass registration, authorization, or permission checks to replace the user journey. Do not add alternative CDP defaults, acceptance harnesses, Playwright projects, helper endpoints, recordings, fixtures, baselines, or evidence systems.
- Preserve native window sizing during ordinary Electron acceptance: do not set a fixed Playwright viewport or call `Emulation.setDeviceMetricsOverride`. A renderer-only size can leave the rest of the native window blank. Exercise responsive layouts by resizing the native window through its owner UI. If a specific test requires device emulation, clear the override with `Emulation.clearDeviceMetricsOverride` in `finally` before disconnecting, restore any other overrides introduced by the test, and verify that the renderer fills the native content area before handoff.
- Run checks that cover the changed behavior. CDP visibility, screenshots, and fixture output do not establish the full product result.
- Report the observed outcome and mark relevant unexecuted paths `NOT-VERIFIED`. Put any necessary local artifacts under `.nimi/local/**`.
